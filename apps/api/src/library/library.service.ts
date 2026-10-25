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
import { Injectable, Logger, HttpStatus } from '@nestjs/common';
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

// ---------------------------------------------------------------------------
// Cursor helpers (I2: opaque JSON keysets, validated)
// ---------------------------------------------------------------------------

interface ListCursorKeyset { s: string; p: number; id: string }
interface SavedCursorKeyset { t: string; id: string }

function encodeListCursor(k: ListCursorKeyset): string {
  return Buffer.from(JSON.stringify(k)).toString('base64url');
}

function decodeListCursor(raw: string): ListCursorKeyset {
  try {
    const json = JSON.parse(Buffer.from(raw, 'base64url').toString());
    if (typeof json !== 'object' || json === null) throw 0;
    const { s, p, id } = json;
    if (typeof s !== 'string' || typeof p !== 'number' || typeof id !== 'string') throw 0;
    if (isNaN(new Date(s).getTime())) throw 0;
    return { s, p, id };
  } catch {
    throw new ApiHttpException({ status: HttpStatus.BAD_REQUEST, code: 'validation', message: 'Invalid cursor' });
  }
}

function encodeSavedCursor(k: SavedCursorKeyset): string {
  return Buffer.from(JSON.stringify(k)).toString('base64url');
}

function decodeSavedCursor(raw: string): SavedCursorKeyset {
  try {
    const json = JSON.parse(Buffer.from(raw, 'base64url').toString());
    if (typeof json !== 'object' || json === null) throw 0;
    const { t, id } = json;
    if (typeof t !== 'string' || typeof id !== 'string') throw 0;
    if (isNaN(new Date(t).getTime())) throw 0;
    return { t, id };
  } catch {
    throw new ApiHttpException({ status: HttpStatus.BAD_REQUEST, code: 'validation', message: 'Invalid cursor' });
  }
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

// ---------------------------------------------------------------------------
// CTA resolution (spec gap 1)
// ---------------------------------------------------------------------------

/**
 * CTA kinds whose target references another content resource and must be
 * available to the reader via the availability formula.
 */
const CTA_AVAILABILITY_KINDS = new Set(['open_content', 'open_collection']);

/**
 * CTA kinds mapped to the capability they require on the reader's org.
 * `suggest_topic` always renders; the rest require a specific capability.
 */
const CTA_CAPABILITY_MAP: Record<string, string | null> = {
  open_content: null,
  open_collection: null,
  open_service: null, // checked separately: capability matches the publication's own
  suggest_topic: null, // always available
  ask_general_question: 'general_questions',
  express_event_interest: 'event_interest',
};

interface RawCta { kind: string; label: string; target?: string | null }

function resolveCtaSync(
  raw: unknown,
  capabilities: readonly string[],
  isCyrillic: boolean,
): { kind: string; label: string; target: string | null } | null {
  if (!raw || typeof raw !== 'object') return null;
  const cta = raw as RawCta;
  if (!cta.kind || !cta.label) return null;

  // Capability gate
  const requiredCap = CTA_CAPABILITY_MAP[cta.kind];
  if (requiredCap !== undefined && requiredCap !== null && !capabilities.includes(requiredCap)) {
    return null;
  }

  // open_service: the capability is the publication's own required_capability,
  // which is already checked by the availability formula -- so it passes.

  const label = isCyrillic ? transliterateText(cta.label) : cta.label;
  return { kind: cta.kind, label, target: cta.target ?? null };
}

// The four reader locales, always listed for a published resource.
const ALL_READER_LOCALES = ['sr-Latn', 'sr-Cyrl', 'hu', 'en'] as const;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class LibraryService {
  private readonly logger = new Logger(LibraryService.name);

  constructor(
    private readonly dbService: DbService,
    private readonly availabilityService: AvailabilityService,
    private readonly contextLoader: AvailabilityContextLoader,
  ) {}

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

    // Single statement: availability subquery joined to detail tables (C2/I1).
    const avail = this.availabilityService
      .availablePublications(ctx, db, { resourceIds: [contentResourceId] })
      .as('avail');

    const rows = await db
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
        cta: contentRevisions.cta,
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

    const row = rows[0];
    if (!row) {
      this.logLocaleInconsistency(ctx, contentResourceId);
      return null;
    }

    // Parallel lookups for ancillary data
    const [category, authorUser, reviewerUser, mediaRefs, savedStatus] = await Promise.all([
      this.getCategoryDetail(db, row.primaryCategoryId, authored),
      db.select({ displayName: users.displayName }).from(users).where(eq(users.id, row.authorUserId)).limit(1),
      row.approvedByUserId
        ? db.select({ displayName: users.displayName }).from(users).where(eq(users.id, row.approvedByUserId)).limit(1)
        : Promise.resolve([]),
      this.getMediaReferences(db, row.revisionId, isCyrillic, authored, ctx.now),
      this.getSavedStatus(ctx, contentResourceId),
    ]);

    // Related resources: single-statement with availability subquery (C2/I1).
    const relatedResources = await this.getRelatedResources(ctx, db, row.relatedResourceIds ?? [], authored, contentResourceId);

    // CTA: resolve per the capability gate; availability-gated targets checked
    // via the related-resource availability join.
    let cta: LibraryContentDetail['cta'] = null;
    const rawCta = row.cta;
    if (rawCta && typeof rawCta === 'object') {
      const resolved = resolveCtaSync(rawCta, ctx.capabilities, isCyrillic);
      if (resolved) {
        // If CTA targets a content resource, it must be available
        if (CTA_AVAILABILITY_KINDS.has(resolved.kind) && resolved.target) {
          const targetAvail = await this.availabilityService.isAvailable(ctx, db, resolved.target);
          if (!targetAvail) {
            cta = null;
          } else {
            cta = resolved;
          }
        } else {
          cta = resolved;
        }
      }
    }

    const title = isCyrillic ? transliterateText(row.title) : row.title;
    const summary = isCyrillic ? transliterateText(row.summary) : row.summary;
    const outcome = row.outcome ? (isCyrillic ? transliterateText(row.outcome) : row.outcome) : '';
    const body = isCyrillic ? transliterateDocument(row.body as ContentDocument, 'sr-Cyrl') : row.body;
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

    // Cursor validation (I2)
    let cursorCondition: ReturnType<typeof sql> | undefined;
    if (opts.cursor) {
      const k = decodeListCursor(opts.cursor);
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
      nextCursor = encodeListCursor({
        s: last.startsAt.toISOString(),
        p: last.editorialPriority,
        id: last.publicationId,
      });
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

    // Cursor validation (I2)
    let cursorDate: Date | undefined;
    let cursorId: string | undefined;
    if (opts.cursor) {
      const k = decodeSavedCursor(opts.cursor);
      cursorDate = new Date(k.t);
      cursorId = k.id;
    }

    // Step 1: read saved items inside the org-scoped transaction (C1: no
    // secondary db calls while the connection is held).
    const fetchLimit = opts.limit + 1;
    const savedRows = await withOrgScope(db, ctx.orgId, async (tx) => {
      return tx
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
    });

    const hasMore = savedRows.length > opts.limit;
    const page = hasMore ? savedRows.slice(0, opts.limit) : savedRows;
    if (page.length === 0) {
      return { items: [], nextCursor: null };
    }

    // Step 2: availability check and detail fetch OUTSIDE the transaction (C1).
    const resourceIds = page.map((r) => r.contentResourceId);

    // Single-statement availability join for saved resource summaries (C2/I1).
    const avail = this.availabilityService
      .availablePublications(ctx, db, { resourceIds })
      .as('avail');

    const detailRows = await db
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
      nextCursor = encodeSavedCursor({
        t: last.createdAt.toISOString(),
        id: last.id,
      });
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

    // Verify available (single statement)
    const avail = await this.availabilityService.isAvailable(ctx, db, contentResourceId);
    if (!avail) {
      throw new ApiHttpException({
        status: HttpStatus.NOT_FOUND,
        code: 'content_not_available',
        message: 'The requested content is not available',
      });
    }

    await withOrgScope(db, ctx.orgId, async (tx) => {
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
    now: Date,
  ) {
    const rows = await db
      .select({
        assetId: mediaAssets.id,
        kind: mediaAssets.kind,
        width: mediaAssets.width,
        height: mediaAssets.height,
        focalPoint: mediaAssets.focalPoint,
        altText: mediaAssets.altText,
        state: mediaAssets.state,
        rightsExpiresAt: mediaAssets.rightsExpiresAt,
      })
      .from(contentRevisionMedia)
      .innerJoin(mediaAssets, eq(mediaAssets.id, contentRevisionMedia.mediaAssetId))
      .where(eq(contentRevisionMedia.contentRevisionId, revisionId));

    // Filter using ctx.now for consistent readiness check
    const validAssets = rows.filter(
      (r) => r.state === 'ready' && (!r.rightsExpiresAt || r.rightsExpiresAt > now),
    );

    const assetIds = validAssets.map((r) => r.assetId);
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

    return validAssets.map((a) => {
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
   * another locale but not in the reader's. Logs ids only (no PII). Cannot
   * turn a 404 into a 500 -- all errors are caught.
   */
  private logLocaleInconsistency(
    ctx: AvailabilityContext,
    contentResourceId: string,
  ): void {
    const db = this.dbService.db;
    const otherLocales = (['sr-Latn', 'hu', 'en'] as const).filter(
      (l) => l !== authoredLocale(ctx.readerLocale),
    );
    // Fire and forget: do not await, catch all errors
    (async () => {
      for (const locale of otherLocales) {
        const otherCtx: AvailabilityContext = { ...ctx, readerLocale: locale };
        const avail = await this.availabilityService.isAvailable(otherCtx, db, contentResourceId);
        if (avail) {
          this.logger.error(
            `AV-24 locale inconsistency: resource=${contentResourceId} available in ${locale} but not in ${authoredLocale(ctx.readerLocale)} for org=${ctx.orgId}`,
          );
          return;
        }
      }
    })().catch(() => {
      // Swallow: this diagnostic must never propagate an error
    });
  }
}
