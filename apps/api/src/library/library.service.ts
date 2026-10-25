/**
 * LibraryService -- read-side service for the employee library experience
 * (T-C1.11, section 9).
 *
 * Every read path joins with `availablePublications(ctx, db, filter).as('avail')`
 * in a SINGLE SQL statement so that the availability formula is evaluated once
 * and no TOCTOU race can serve withdrawn or future-scheduled content (C2/I1).
 *
 * No code path calls `this.dbService.db` inside a `withOrgScope` transaction;
 * saved-item reads happen inside the transaction and availability/detail
 * lookups run after it, preventing pool deadlocks (C1).
 */
import { createHmac } from 'node:crypto';
import { Inject, Injectable, Logger, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  and,
  eq,
  sql,
  desc,
  inArray,
} from 'drizzle-orm';
import type { DbExecutor } from '../db/db.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { DbService, withOrgScope } from '../db/db.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { AvailabilityService } from './availability/availability.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { AvailabilityContextLoader } from './availability/availability-context-loader.js';
import type { AvailabilityContext, ReaderLocale, AuthoredLocale } from './availability/availability-context.js';
import { authoredLocale } from './availability/availability-context.js';
import {
  contentResources,
  contentVariants,
  contentRevisions,
  contentPublications,
  contentRevisionMedia,
} from '../db/schema/cms.js';
import { categories, categoryLabels } from '../db/schema/taxonomy.js';
import { mediaAssets, mediaRenditions } from '../db/schema/media.js';
import { savedItems } from '../db/schema/library.js';
import { users } from '../db/schema/identity.js';
import { transliterateText, transliterateDocument, type ContentDocument } from '@nestself/content/schema';
import { ApiHttpException } from '../common/api-error.js';
import type { LibraryContentDetail, LibraryCard, SavedItem } from '@nestself/contracts';
import type { PrincipalContext } from './availability/availability-context-loader.js';
import {
  collectReferencedResourceIds,
  filterDocumentBody,
  extractCtaFromBody,
} from './body-filter.js';

// ---------------------------------------------------------------------------
// Cursor helpers (RTE-R-06: HMAC-signed opaque JSON keysets)
// ---------------------------------------------------------------------------

interface ListCursorKeyset { s: string; p: number; id: string }
interface SavedCursorKeyset { t: string; id: string }

/** PostgreSQL int4 range. */
const INT4_MIN = -2_147_483_648;
const INT4_MAX = 2_147_483_647;

/** PostgreSQL timestamp range (very generous). */
const PG_DATE_MIN = new Date('0001-01-01T00:00:00Z');
const PG_DATE_MAX = new Date('9999-12-31T23:59:59Z');

/** UUID / content-id pattern. */
const CURSOR_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

function hmacSign(payload: string, key: string): string {
  return createHmac('sha256', key).update(payload).digest('base64url');
}

function encodeCursor(keyset: Record<string, unknown>, key: string): string {
  const payload = JSON.stringify(keyset);
  const sig = hmacSign(payload, key);
  return Buffer.from(`${payload}\n${sig}`).toString('base64url');
}

function decodeCursorRaw(raw: string, key: string): Record<string, unknown> {
  let decoded: string;
  try {
    decoded = Buffer.from(raw, 'base64url').toString();
  } catch {
    throw cursorError();
  }
  const newlineIdx = decoded.lastIndexOf('\n');
  if (newlineIdx === -1) throw cursorError();

  const payload = decoded.slice(0, newlineIdx);
  const sig = decoded.slice(newlineIdx + 1);

  // Verify HMAC
  const expected = hmacSign(payload, key);
  if (sig !== expected) throw cursorError();

  try {
    const json = JSON.parse(payload);
    if (typeof json !== 'object' || json === null) throw 0;
    return json as Record<string, unknown>;
  } catch {
    throw cursorError();
  }
}

function decodeListCursor(raw: string, key: string): ListCursorKeyset {
  const json = decodeCursorRaw(raw, key);
  const { s, p, id } = json as { s: unknown; p: unknown; id: unknown };
  if (typeof s !== 'string' || typeof p !== 'number' || typeof id !== 'string') throw cursorError();

  // Validate types within PG ranges
  if (!Number.isSafeInteger(p) || p < INT4_MIN || p > INT4_MAX) throw cursorError();
  const d = new Date(s);
  if (isNaN(d.getTime()) || d < PG_DATE_MIN || d > PG_DATE_MAX) throw cursorError();
  if (!CURSOR_ID_RE.test(id)) throw cursorError();

  return { s, p, id };
}

function decodeSavedCursor(raw: string, key: string): SavedCursorKeyset {
  const json = decodeCursorRaw(raw, key);
  const { t, id } = json as { t: unknown; id: unknown };
  if (typeof t !== 'string' || typeof id !== 'string') throw cursorError();

  const d = new Date(t);
  if (isNaN(d.getTime()) || d < PG_DATE_MIN || d > PG_DATE_MAX) throw cursorError();
  if (!CURSOR_ID_RE.test(id)) throw cursorError();

  return { t, id };
}

function cursorError(): ApiHttpException {
  return new ApiHttpException({
    status: HttpStatus.BAD_REQUEST,
    code: 'validation',
    message: 'Invalid cursor',
  });
}

// ---------------------------------------------------------------------------
// Source normalization (I3)
// ---------------------------------------------------------------------------

interface NormalizedSource { label: string; url: string | null }

function normalizeSources(raw: unknown, isCyrillic: boolean): NormalizedSource[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => {
    if (typeof entry === 'string') {
      return { label: isCyrillic ? transliterateText(entry) : entry, url: null };
    }
    if (entry && typeof entry === 'object') {
      const label = typeof entry.label === 'string' ? entry.label : '';
      const url = typeof entry.url === 'string' ? entry.url : null;
      return { label: isCyrillic ? transliterateText(label) : label, url };
    }
    return { label: '', url: null };
  });
}

// The four reader locales, always listed for a published resource.
const ALL_READER_LOCALES = ['sr-Latn', 'sr-Cyrl', 'hu', 'en'] as const;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class LibraryService {
  private readonly logger = new Logger(LibraryService.name);
  private readonly cursorKey: string;

  constructor(
    private readonly dbService: DbService,
    private readonly availabilityService: AvailabilityService,
    private readonly contextLoader: AvailabilityContextLoader,
    @Inject(ConfigService) configService: ConfigService,
  ) {
    this.cursorKey = configService.get<string>('resolvedLibraryCursorKey')!;
  }

  // == Content detail ======================================================

  async getContentDetail(
    principal: PrincipalContext,
    contentResourceId: string,
    readerLocale: ReaderLocale,
  ): Promise<LibraryContentDetail | null> {
    const ctx = await this.contextLoader.forReader(principal, readerLocale);
    const db = this.dbService.db;
    const isCyrillic = ctx.readerLocale === 'sr-Cyrl';
    const authored = authoredLocale(ctx.readerLocale);

    // ---- Main query + ancillary data in two parallel batches (max 2 connections) ----

    // Batch 1: main detail query (single statement with availability join)
    const avail = this.availabilityService
      .availablePublications(ctx, db, { resourceIds: [contentResourceId] })
      .as('avail');

    const rowsPromise = db
      .select({
        resourceId: contentResources.id,
        resourceType: contentResources.type,
        primaryCategoryId: contentResources.primaryCategoryId,
        title: contentRevisions.title,
        summary: contentRevisions.summary,
        outcome: contentRevisions.outcome,
        body: contentRevisions.body,
        durationSeconds: contentRevisions.durationSeconds,
        durationBand: contentRevisions.durationBand,
        difficulty: contentRevisions.difficulty,
        sources: contentRevisions.sources,
        relatedResourceIds: contentRevisions.relatedResourceIds,
        authorUserId: contentRevisions.authorUserId,
        approvedByUserId: contentRevisions.approvedByUserId,
        approvedAt: contentRevisions.approvedAt,
        revisionId: contentRevisions.id,
      })
      .from(contentPublications)
      .innerJoin(avail, eq(avail.publicationId, contentPublications.id))
      .innerJoin(contentVariants, eq(contentVariants.id, contentPublications.contentVariantId))
      .innerJoin(contentResources, eq(contentResources.id, contentVariants.contentResourceId))
      .innerJoin(contentRevisions, eq(contentRevisions.id, contentPublications.contentRevisionId))
      .limit(1);

    // Batch 2: saved status (independent, uses org-scoped connection)
    const savedPromise = this.getSavedStatus(ctx, contentResourceId);

    const [rows, savedStatus] = await Promise.all([rowsPromise, savedPromise]);

    const row = rows[0];
    if (!row) {
      this.logLocaleInconsistency(ctx, contentResourceId);
      return null;
    }

    // ---- Body filtering (must-fix 1: FMT-R-05, LIB-R-23, ACC-R-22) ----
    // Collect all resource ids referenced in the body, check their availability,
    // then filter the body before transliteration.
    const bodyRefIds = collectReferencedResourceIds(row.body);
    const availableRefIds = bodyRefIds.length > 0
      ? new Set(await this.availabilityService.availableResourceIds(ctx, db, bodyRefIds))
      : new Set<string>();

    const filteredBody = filterDocumentBody(row.body, {
      availableIds: availableRefIds,
      capabilities: ctx.capabilities,
    });

    // ---- CTA from the filtered body (must-fix 2: FMT-R-05) ----
    const extractedCta = extractCtaFromBody(filteredBody);
    let cta: LibraryContentDetail['cta'] = null;
    if (extractedCta) {
      const label = extractedCta.label
        ? (isCyrillic ? transliterateText(extractedCta.label) : extractedCta.label)
        : null;
      cta = {
        kind: extractedCta.kind,
        label,
        targetId: extractedCta.targetId,
      };
    }

    // ---- Ancillary data (second batch, one connection) ----
    const [category, authorUser, reviewerUser, mediaRefs] = await Promise.all([
      this.getCategoryDetail(db, row.primaryCategoryId, authored),
      db.select({ displayName: users.displayName }).from(users).where(eq(users.id, row.authorUserId)).limit(1),
      row.approvedByUserId
        ? db.select({ displayName: users.displayName }).from(users).where(eq(users.id, row.approvedByUserId)).limit(1)
        : Promise.resolve([]),
      this.getMediaReferences(db, row.revisionId, isCyrillic, authored),
    ]);

    // Related resources: single-statement with availability subquery (C2/I1).
    const relatedResources = await this.getRelatedResources(ctx, db, row.relatedResourceIds ?? [], authored, contentResourceId);

    const body = isCyrillic ? transliterateDocument(filteredBody as ContentDocument, 'sr-Cyrl') : filteredBody;
    const title = isCyrillic ? transliterateText(row.title) : row.title;
    const summary = isCyrillic ? transliterateText(row.summary) : row.summary;
    const outcome = row.outcome ? (isCyrillic ? transliterateText(row.outcome) : row.outcome) : '';
    const authorName = isCyrillic
      ? transliterateText(authorUser[0]?.displayName ?? '')
      : (authorUser[0]?.displayName ?? '');
    const reviewerName = row.approvedByUserId && reviewerUser[0]
      ? (isCyrillic ? transliterateText(reviewerUser[0].displayName) : reviewerUser[0].displayName)
      : null;

    const catSlug = category?.slug ?? '';
    const catName = category?.name ?? '';
    const catDesc = category?.description ?? null;

    return {
      id: contentResourceId,
      type: row.resourceType as LibraryContentDetail['type'],
      locale: ctx.readerLocale as LibraryContentDetail['locale'],
      title,
      summary,
      outcome,
      body,
      durationSeconds: row.durationSeconds,
      durationBand: row.durationBand as LibraryContentDetail['durationBand'],
      difficulty: row.difficulty,
      category: {
        id: row.primaryCategoryId,
        slug: catSlug,
        label: isCyrillic ? transliterateText(catName) : catName,
        description: catDesc ? (isCyrillic ? transliterateText(catDesc) : catDesc) : null,
      },
      secondaryCategories: [], // M2: tables arrive in migration 0007
      topics: [],              // M2: tables arrive in migration 0007
      authorName,
      reviewerName,
      reviewedAt: row.approvedAt,
      sources: normalizeSources(row.sources, isCyrillic),
      media: mediaRefs,
      relatedResources,
      cta,
      availableLocales: [...ALL_READER_LOCALES],
      saved: savedStatus,
      playbackPosition: null,
      replacementLink: null,
    };
  }

  // == Content list ========================================================

  async listContent(
    principal: PrincipalContext,
    readerLocale: ReaderLocale,
    opts: { categoryId?: string; cursor?: string; limit: number },
  ): Promise<{ items: LibraryCard[]; nextCursor: string | null }> {
    const ctx = await this.contextLoader.forReader(principal, readerLocale);
    const db = this.dbService.db;
    const isCyrillic = ctx.readerLocale === 'sr-Cyrl';
    const authored = authoredLocale(ctx.readerLocale);

    // Cursor validation (RTE-R-06: HMAC-signed)
    let cursorCondition: ReturnType<typeof sql> | undefined;
    if (opts.cursor) {
      const k = decodeListCursor(opts.cursor, this.cursorKey);
      cursorCondition = sql`(${contentPublications.editorialPriority}, ${contentPublications.startsAt}, ${contentPublications.id})
        < (${k.p}, ${new Date(k.s)}, ${k.id})`;
    }

    // Single statement: availability subquery + category filter + keyset + LIMIT (C2/I1).
    const avail = this.availabilityService.availablePublications(ctx, db).as('avail');
    const limit = opts.limit + 1;
    const conditions = [];
    if (opts.categoryId) {
      conditions.push(eq(contentResources.primaryCategoryId, opts.categoryId));
    }
    if (cursorCondition) {
      conditions.push(cursorCondition);
    }

    const rows = await db
      .select({
        resourceId: contentResources.id,
        type: contentResources.type,
        title: contentRevisions.title,
        summary: contentRevisions.summary,
        categoryId: contentResources.primaryCategoryId,
        durationBand: contentRevisions.durationBand,
        editorialPriority: contentPublications.editorialPriority,
        startsAt: contentPublications.startsAt,
        publicationId: contentPublications.id,
      })
      .from(contentPublications)
      .innerJoin(avail, eq(avail.publicationId, contentPublications.id))
      .innerJoin(contentVariants, eq(contentVariants.id, contentPublications.contentVariantId))
      .innerJoin(contentResources, eq(contentResources.id, contentVariants.contentResourceId))
      .innerJoin(contentRevisions, eq(contentRevisions.id, contentPublications.contentRevisionId))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(
        desc(contentPublications.editorialPriority),
        desc(contentPublications.startsAt),
        desc(contentPublications.id),
      )
      .limit(limit);

    const hasMore = rows.length > opts.limit;
    const page = hasMore ? rows.slice(0, opts.limit) : rows;

    // Saved status and category labels
    const resourceIds = page.map((r) => r.resourceId);
    const savedIds = resourceIds.length > 0
      ? await this.getSavedResourceIds(ctx, resourceIds)
      : new Set<string>();

    const categoryIds = [...new Set(page.map((r) => r.categoryId))];
    const categoryMap = await this.getCategoryLabels(db, categoryIds, authored);

    const items: LibraryCard[] = page.map((r) => {
      const catLabel = categoryMap.get(r.categoryId)?.name ?? '';
      return {
        resourceId: r.resourceId,
        type: r.type as LibraryCard['type'],
        locale: ctx.readerLocale as LibraryCard['locale'],
        title: isCyrillic ? transliterateText(r.title) : r.title,
        summary: isCyrillic ? transliterateText(r.summary) : r.summary,
        categoryName: isCyrillic ? transliterateText(catLabel) : catLabel,
        durationBand: r.durationBand as LibraryCard['durationBand'],
        coverImageUrl: null,
        saved: savedIds.has(r.resourceId),
        availableLocales: [...ALL_READER_LOCALES],
      };
    });

    let nextCursor: string | null = null;
    if (hasMore) {
      const last = page[page.length - 1]!;
      nextCursor = encodeCursor({
        s: last.startsAt.toISOString(),
        p: last.editorialPriority,
        id: last.publicationId,
      }, this.cursorKey);
    }

    return { items, nextCursor };
  }

  // == Saved items =========================================================

  async getSavedItems(
    principal: PrincipalContext,
    readerLocale: ReaderLocale,
    opts: { cursor?: string; limit: number },
  ): Promise<{ items: SavedItem[]; nextCursor: string | null }> {
    const ctx = await this.contextLoader.forReader(principal, readerLocale);
    const isCyrillic = ctx.readerLocale === 'sr-Cyrl';
    const authored = authoredLocale(ctx.readerLocale);
    const db = this.dbService.db;

    // Cursor validation (RTE-R-06: HMAC-signed)
    let cursorDate: Date | undefined;
    let cursorId: string | undefined;
    if (opts.cursor) {
      const k = decodeSavedCursor(opts.cursor, this.cursorKey);
      cursorDate = new Date(k.t);
      cursorId = k.id;
    }

    // Single statement inside withOrgScope: read saved items with availability
    // join in one query (minor 3).
    const fetchLimit = opts.limit + 1;

    const { savedRows, detailRows } = await withOrgScope(db, ctx.orgId, async (tx) => {
      // Read saved items
      const saved = await tx
        .select({
          id: savedItems.id,
          contentResourceId: savedItems.contentResourceId,
          createdAt: savedItems.createdAt,
        })
        .from(savedItems)
        .where(
          and(
            eq(savedItems.membershipId, ctx.membershipId),
            ...(cursorDate && cursorId
              ? [sql`(${savedItems.createdAt}, ${savedItems.id}) < (${cursorDate}, ${cursorId})`]
              : []),
          ),
        )
        .orderBy(desc(savedItems.createdAt), desc(savedItems.id))
        .limit(fetchLimit);

      if (saved.length === 0) {
        return { savedRows: saved, detailRows: [] as Array<{ resourceId: string; type: string; title: string; categoryId: string }> };
      }

      // Availability join in same transaction (minor 3: one statement)
      const resourceIds = saved.map((r) => r.contentResourceId);
      const avail = this.availabilityService
        .availablePublications(ctx, tx, { resourceIds })
        .as('avail');

      const details = await tx
        .select({
          resourceId: contentResources.id,
          type: contentResources.type,
          title: contentRevisions.title,
          categoryId: contentResources.primaryCategoryId,
        })
        .from(contentPublications)
        .innerJoin(avail, eq(avail.publicationId, contentPublications.id))
        .innerJoin(contentVariants, eq(contentVariants.id, contentPublications.contentVariantId))
        .innerJoin(contentResources, eq(contentResources.id, contentVariants.contentResourceId))
        .innerJoin(contentRevisions, eq(contentRevisions.id, contentPublications.contentRevisionId));

      return { savedRows: saved, detailRows: details };
    });

    const hasMore = savedRows.length > opts.limit;
    const page = hasMore ? savedRows.slice(0, opts.limit) : savedRows;
    if (page.length === 0) {
      return { items: [], nextCursor: null };
    }

    const availableDetails = new Map<string, { type: string; title: string; categoryId: string }>();
    for (const r of detailRows) {
      if (!availableDetails.has(r.resourceId)) {
        availableDetails.set(r.resourceId, r);
      }
    }

    // Category labels for available items
    const catIds = [...new Set([...availableDetails.values()].map((d) => d.categoryId))];
    const catMap = await this.getCategoryLabels(db, catIds, authored);

    const items: SavedItem[] = page.map((r) => {
      const detail = availableDetails.get(r.contentResourceId);
      if (!detail) {
        return {
          resourceId: r.contentResourceId,
          type: null,
          title: null,
          status: 'unavailable' as const,
          categoryName: null,
          coverImageUrl: null,
          savedAt: r.createdAt,
        };
      }
      const catLabel = catMap.get(detail.categoryId)?.name ?? '';
      return {
        resourceId: r.contentResourceId,
        type: detail.type as SavedItem['type'],
        title: isCyrillic ? transliterateText(detail.title) : detail.title,
        status: 'available' as const,
        categoryName: isCyrillic ? transliterateText(catLabel) : catLabel,
        coverImageUrl: null,
        savedAt: r.createdAt,
      };
    });

    let nextCursor: string | null = null;
    if (hasMore) {
      const last = page[page.length - 1]!;
      nextCursor = encodeCursor({
        t: last.createdAt.toISOString(),
        id: last.id,
      }, this.cursorKey);
    }

    return { items, nextCursor };
  }

  async saveItem(
    principal: PrincipalContext,
    contentResourceId: string,
    readerLocale: ReaderLocale,
  ): Promise<void> {
    const ctx = await this.contextLoader.forReader(principal, readerLocale);
    const db = this.dbService.db;

    // Verify available and save in one withOrgScope call (minor 3)
    await withOrgScope(db, ctx.orgId, async (tx) => {
      const avail = this.availabilityService
        .availablePublications(ctx, tx, { resourceIds: [contentResourceId] })
        .as('avail');

      const available = await tx
        .select({ publicationId: sql<string>`${contentPublications.id}` })
        .from(contentPublications)
        .innerJoin(avail, eq(avail.publicationId, contentPublications.id))
        .limit(1);

      if (available.length === 0) {
        throw new ApiHttpException({
          status: HttpStatus.NOT_FOUND,
          code: 'content_not_available',
          message: 'The requested content is not available',
        });
      }

      await tx
        .insert(savedItems)
        .values({
          userId: ctx.userId,
          membershipId: ctx.membershipId,
          orgId: ctx.orgId,
          contentResourceId,
        })
        .onConflictDoNothing({
          target: [savedItems.membershipId, savedItems.contentResourceId],
        });
    });
  }

  async removeSavedItem(
    principal: PrincipalContext,
    contentResourceId: string,
    readerLocale: ReaderLocale,
  ): Promise<void> {
    const ctx = await this.contextLoader.forReader(principal, readerLocale);

    await withOrgScope(this.dbService.db, ctx.orgId, async (tx) => {
      await tx
        .delete(savedItems)
        .where(
          and(
            eq(savedItems.membershipId, ctx.membershipId),
            eq(savedItems.contentResourceId, contentResourceId),
          ),
        );
    });
  }

  // == Private helpers =====================================================

  /** Category with slug, name, description. Left join so missing labels produce null. */
  private async getCategoryDetail(
    db: DbExecutor,
    categoryId: string,
    locale: AuthoredLocale,
  ) {
    const rows = await db
      .select({
        slug: categories.slug,
        name: categoryLabels.name,
        description: categoryLabels.description,
      })
      .from(categories)
      .leftJoin(
        categoryLabels,
        and(
          eq(categoryLabels.categoryId, categories.id),
          eq(categoryLabels.locale, locale),
        ),
      )
      .where(eq(categories.id, categoryId))
      .limit(1);
    return rows[0] ?? null;
  }

  private async getCategoryLabels(
    db: DbExecutor,
    categoryIds: string[],
    locale: AuthoredLocale,
  ): Promise<Map<string, { slug: string; name: string; description: string | null }>> {
    if (categoryIds.length === 0) return new Map();
    const rows = await db
      .select({
        categoryId: categories.id,
        slug: categories.slug,
        name: categoryLabels.name,
        description: categoryLabels.description,
      })
      .from(categories)
      .leftJoin(
        categoryLabels,
        and(
          eq(categoryLabels.categoryId, categories.id),
          eq(categoryLabels.locale, locale),
        ),
      )
      .where(inArray(categories.id, categoryIds));
    return new Map(rows.map((r) => [r.categoryId, { slug: r.slug, name: r.name ?? '', description: r.description ?? null }]));
  }

  private async getMediaReferences(
    db: DbExecutor,
    revisionId: string,
    isCyrillic: boolean,
    locale: AuthoredLocale,
  ) {
    // The availability formula (item 10) already guarantees every media asset
    // referenced by this revision is ready and has valid rights. No redundant
    // in-memory readiness check (minor 7).
    const rows = await db
      .select({
        assetId: mediaAssets.id,
        kind: mediaAssets.kind,
        width: mediaAssets.width,
        height: mediaAssets.height,
        focalPoint: mediaAssets.focalPoint,
        altText: mediaAssets.altText,
      })
      .from(contentRevisionMedia)
      .innerJoin(mediaAssets, eq(mediaAssets.id, contentRevisionMedia.mediaAssetId))
      .where(eq(contentRevisionMedia.contentRevisionId, revisionId));

    const assetIds = rows.map((r) => r.assetId);
    const renditionRows = assetIds.length > 0
      ? await db
          .select({
            mediaAssetId: mediaRenditions.mediaAssetId,
            kind: mediaRenditions.kind,
            mimeType: mediaRenditions.mimeType,
            width: mediaRenditions.width,
            height: mediaRenditions.height,
          })
          .from(mediaRenditions)
          .where(inArray(mediaRenditions.mediaAssetId, assetIds))
      : [];

    const renditionsByAsset = new Map<string, typeof renditionRows>();
    for (const r of renditionRows) {
      const existing = renditionsByAsset.get(r.mediaAssetId) ?? [];
      existing.push(r);
      renditionsByAsset.set(r.mediaAssetId, existing);
    }

    return rows.map((a) => {
      const altObj = a.altText as Record<string, string> | null;
      // Alt text in the reader's authored locale only; no fallback to another language (empty string when missing).
      const rawAlt = altObj?.[locale] ?? null;
      const altText = rawAlt ? (isCyrillic ? transliterateText(rawAlt) : rawAlt) : null;

      return {
        assetId: a.assetId,
        kind: a.kind,
        renditions: (renditionsByAsset.get(a.assetId) ?? []).map((r) => ({
          kind: r.kind,
          mimeType: r.mimeType,
          width: r.width,
          height: r.height,
        })),
        width: a.width,
        height: a.height,
        focalPoint: a.focalPoint,
        altText,
      };
    });
  }

  private async getSavedStatus(
    ctx: AvailabilityContext,
    contentResourceId: string,
  ): Promise<boolean> {
    if (ctx.kind !== 'reader') return false;
    return withOrgScope(this.dbService.db, ctx.orgId, async (tx) => {
      const rows = await tx
        .select({ id: savedItems.id })
        .from(savedItems)
        .where(
          and(
            eq(savedItems.membershipId, ctx.membershipId),
            eq(savedItems.contentResourceId, contentResourceId),
          ),
        )
        .limit(1);
      return rows.length > 0;
    });
  }

  private async getSavedResourceIds(
    ctx: AvailabilityContext,
    resourceIds: string[],
  ): Promise<Set<string>> {
    if (ctx.kind !== 'reader' || resourceIds.length === 0) return new Set();
    return withOrgScope(this.dbService.db, ctx.orgId, async (tx) => {
      const rows = await tx
        .select({ contentResourceId: savedItems.contentResourceId })
        .from(savedItems)
        .where(
          and(
            eq(savedItems.membershipId, ctx.membershipId),
            inArray(savedItems.contentResourceId, resourceIds),
          ),
        );
      return new Set(rows.map((r) => r.contentResourceId));
    });
  }

  /**
   * Related resources: single-statement availability join (C2/I1).
   * Ordered by `array_position(relatedIds, id)`, excluding the source resource.
   */
  private async getRelatedResources(
    ctx: AvailabilityContext,
    db: DbExecutor,
    relatedIds: string[],
    locale: AuthoredLocale,
    excludeResourceId: string,
  ) {
    const filtered = relatedIds.filter((id) => id !== excludeResourceId).slice(0, 3);
    if (filtered.length === 0) return [];

    const isCyrillic = ctx.readerLocale === 'sr-Cyrl';
    const avail = this.availabilityService
      .availablePublications(ctx, db, { resourceIds: filtered })
      .as('avail');

    const rows = await db
      .select({
        resourceId: contentResources.id,
        type: contentResources.type,
        title: contentRevisions.title,
        summary: contentRevisions.summary,
        categoryId: contentResources.primaryCategoryId,
      })
      .from(contentPublications)
      .innerJoin(avail, eq(avail.publicationId, contentPublications.id))
      .innerJoin(contentVariants, eq(contentVariants.id, contentPublications.contentVariantId))
      .innerJoin(contentResources, eq(contentResources.id, contentVariants.contentResourceId))
      .innerJoin(contentRevisions, eq(contentRevisions.id, contentPublications.contentRevisionId))
      .orderBy(sql`array_position(ARRAY[${sql.join(filtered.map((id) => sql`${id}`), sql`, `)}]::text[], ${contentResources.id})`);

    const catIds = [...new Set(rows.map((r) => r.categoryId))];
    const catMap = await this.getCategoryLabels(db, catIds, locale);

    // Deduplicate by resourceId (in case multiple publications match, take first)
    const seen = new Set<string>();
    return rows
      .filter((r) => {
        if (seen.has(r.resourceId)) return false;
        seen.add(r.resourceId);
        return true;
      })
      .map((r) => {
        const catLabel = catMap.get(r.categoryId)?.name ?? '';
        return {
          resourceId: r.resourceId,
          type: r.type as LibraryContentDetail['type'],
          title: isCyrillic ? transliterateText(r.title) : r.title,
          summary: isCyrillic ? transliterateText(r.summary) : r.summary,
          categoryName: isCyrillic ? transliterateText(catLabel) : catLabel,
          coverImageUrl: null,
        };
      });
  }

  /**
   * AV-24: fire-and-forget error-level log when a resource is available in
   * another locale but not in the reader's. One query (minor 4).
   * Logs ids only (no PII). Cannot turn a 404 into a 500.
   */
  private logLocaleInconsistency(
    ctx: AvailabilityContext,
    contentResourceId: string,
  ): void {
    const db = this.dbService.db;
    const currentAuthored = authoredLocale(ctx.readerLocale);
    // Fire and forget: do not await, catch all errors
    (async () => {
      // Single query: check if any other locale has an available publication
      const otherLocales = (['sr-Latn', 'hu', 'en'] as const).filter(
        (l) => l !== currentAuthored,
      );
      if (otherLocales.length === 0) return;

      const otherAvailCount = await db
        .select({ cnt: sql<number>`count(*)` })
        .from(contentVariants)
        .innerJoin(contentPublications, eq(contentPublications.contentVariantId, contentVariants.id))
        .where(
          and(
            eq(contentVariants.contentResourceId, contentResourceId),
            inArray(contentVariants.locale, [...otherLocales]),
            sql`${contentPublications.withdrawnAt} IS NULL`,
            sql`${contentPublications.startsAt} <= ${ctx.now}`,
          ),
        );

      if (otherAvailCount[0] && Number(otherAvailCount[0].cnt) > 0) {
        this.logger.error(
          `AV-24 locale inconsistency: resource=${contentResourceId} has publications in other locales but not in ${currentAuthored} for org=${ctx.orgId}`,
        );
      }
    })().catch(() => {
      // Swallow: this diagnostic must never propagate an error
    });
  }
}
