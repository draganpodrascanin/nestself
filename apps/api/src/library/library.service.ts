/**
 * LibraryService — read-side service for the employee library experience
 * (T-C1.11, section 9).
 *
 * Every read path composes through the AvailabilityService subquery, so the
 * availability formula is implemented exactly once.
 */
import { Injectable, Logger } from '@nestjs/common';
import {
  and,
  eq,
  sql,
  desc,
  inArray,
  isNull,
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
import { transliterateText, transliterateDocument } from '@nestself/content/schema';
import type { LibraryContentDetail, LibraryCard, SavedItem } from '@nestself/contracts';
import type { PrincipalContext } from './availability/availability-context-loader.js';

@Injectable()
export class LibraryService {
  private readonly logger = new Logger(LibraryService.name);

  constructor(
    private readonly dbService: DbService,
    private readonly availabilityService: AvailabilityService,
    private readonly contextLoader: AvailabilityContextLoader,
  ) {}

  // ── Content detail ─────────────────────────────────────────────────

  async getContentDetail(
    principal: PrincipalContext,
    contentResourceId: string,
    readerLocale: ReaderLocale,
  ): Promise<LibraryContentDetail | null> {
    const ctx = await this.contextLoader.forReader(principal, readerLocale);

    // Single query: join availability subquery with detail tables
    const avail = await this.availabilityService.isAvailable(ctx, this.dbService.db, contentResourceId);
    if (!avail) {
      // AV-24 inconsistency check: is it available in another locale?
      await this.logLocaleInconsistency(ctx, contentResourceId);
      return null;
    }

    // Fetch the full detail within the transaction scope
    return this.buildDetail(ctx, avail, contentResourceId);
  }

  private async buildDetail(
    ctx: AvailabilityContext,
    avail: { publicationId: string; variantId: string; contentResourceId: string; locale: string },
    contentResourceId: string,
  ): Promise<LibraryContentDetail | null> {
    const db = this.dbService.db;
    const isCyrillic = ctx.readerLocale === 'sr-Cyrl';
    const authored = authoredLocale(ctx.readerLocale);

    // Fetch resource + variant + revision + publication in a single query
    const rows = await db
      .select({
        resourceId: contentResources.id,
        resourceType: contentResources.type,
        primaryCategoryId: contentResources.primaryCategoryId,
        variantId: contentVariants.id,
        variantLocale: contentVariants.locale,
        revisionId: contentRevisions.id,
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
        publicationId: contentPublications.id,
        editorialPriority: contentPublications.editorialPriority,
      })
      .from(contentPublications)
      .innerJoin(contentVariants, eq(contentVariants.id, contentPublications.contentVariantId))
      .innerJoin(contentResources, eq(contentResources.id, contentVariants.contentResourceId))
      .innerJoin(contentRevisions, eq(contentRevisions.id, contentPublications.contentRevisionId))
      .where(
        and(
          eq(contentPublications.id, avail.publicationId),
          eq(contentVariants.contentResourceId, contentResourceId),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    // Fetch related data in parallel
    const [
      category,
      authorUser,
      reviewerUser,
      mediaRefs,
      savedRow,
    ] = await Promise.all([
      this.getCategoryLabel(db, row.primaryCategoryId, authored),
      db.select({ displayName: users.displayName }).from(users).where(eq(users.id, row.authorUserId)).limit(1),
      row.approvedByUserId
        ? db.select({ displayName: users.displayName }).from(users).where(eq(users.id, row.approvedByUserId)).limit(1)
        : Promise.resolve([]),
      this.getMediaReferences(db, row.revisionId, isCyrillic, authored),
      this.getSavedStatus(ctx, contentResourceId),
    ]);

    // Filter related resources to only available ones
    const relatedResources = await this.getRelatedResources(
      ctx, db, row.relatedResourceIds ?? [], authored,
    );

    const title = isCyrillic ? transliterateText(row.title) : row.title;
    const summary = isCyrillic ? transliterateText(row.summary) : row.summary;
    const outcome = row.outcome
      ? (isCyrillic ? transliterateText(row.outcome) : row.outcome)
      : '';
    const body = isCyrillic ? transliterateDocument(row.body as any, 'sr-Cyrl') : row.body;
    const authorName = isCyrillic
      ? transliterateText(authorUser[0]?.displayName ?? '')
      : (authorUser[0]?.displayName ?? '');
    const reviewerName = row.approvedByUserId && reviewerUser[0]
      ? (isCyrillic ? transliterateText(reviewerUser[0].displayName) : reviewerUser[0].displayName)
      : null;
    const sources = Array.isArray(row.sources) ? (row.sources as Array<{ label: string; url: string | null }>) : [];
    const transliteratedSources = isCyrillic
      ? sources.map((s) => ({ label: transliterateText(s.label), url: s.url }))
      : sources;

    const categoryLabel = category?.name ?? '';
    const categoryDescription = category?.description ?? null;

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
        slug: category?.slug ?? '',
        label: isCyrillic ? transliterateText(categoryLabel) : categoryLabel,
        description: categoryDescription
          ? (isCyrillic ? transliterateText(categoryDescription) : categoryDescription)
          : null,
      },
      secondaryCategories: [],
      topics: [],
      authorName,
      reviewerName,
      reviewedAt: row.approvedAt,
      sources: transliteratedSources,
      media: mediaRefs,
      relatedResources,
      cta: null, // CTAs filtered per LIB-R-23, M1 has no CTA targets yet
      availableLocales: ['sr-Latn', 'sr-Cyrl', 'hu', 'en'],
      saved: savedRow,
      playbackPosition: null, // M1 does not implement playback
    };
  }

  // ── Content list ───────────────────────────────────────────────────

  async listContent(
    principal: PrincipalContext,
    readerLocale: ReaderLocale,
    opts: { categoryId?: string; cursor?: string; limit: number },
  ): Promise<{ items: LibraryCard[]; nextCursor: string | null }> {
    const ctx = await this.contextLoader.forReader(principal, readerLocale);
    const db = this.dbService.db;
    const isCyrillic = ctx.readerLocale === 'sr-Cyrl';
    const authored = authoredLocale(ctx.readerLocale);

    // Step 1: get available publication IDs
    const availRows = await this.availabilityService.availablePublications(ctx, db);

    if (availRows.length === 0) {
      return { items: [], nextCursor: null };
    }

    const availPubIds = availRows.map((r) => r.publicationId);

    // Decode cursor: "priority|startsAt|id" (pipe-separated, base64url-encoded)
    let cursorCondition: ReturnType<typeof sql> | undefined;
    if (opts.cursor) {
      const parts = Buffer.from(opts.cursor, 'base64url').toString().split('|');
      if (parts.length === 3) {
        const cursorPriority = parseInt(parts[0]!, 10);
        const cursorStartsAt = new Date(parts[1]!);
        const cursorId = parts[2]!;
        cursorCondition = sql`(${contentPublications.editorialPriority}, ${contentPublications.startsAt}, ${contentPublications.id})
          < (${cursorPriority}, ${cursorStartsAt}, ${cursorId})`;
      }
    }

    // Step 2: fetch details for available publications
    const limit = opts.limit + 1;
    const conditions = [
      inArray(contentPublications.id, availPubIds),
    ];
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
      .innerJoin(contentVariants, eq(contentVariants.id, contentPublications.contentVariantId))
      .innerJoin(contentResources, eq(contentResources.id, contentVariants.contentResourceId))
      .innerJoin(contentRevisions, eq(contentRevisions.id, contentPublications.contentRevisionId))
      .where(and(...conditions))
      .orderBy(
        desc(contentPublications.editorialPriority),
        desc(contentPublications.startsAt),
        desc(contentPublications.id),
      )
      .limit(limit);

    const hasMore = rows.length > opts.limit;
    const page = hasMore ? rows.slice(0, opts.limit) : rows;

    // Fetch saved status and category labels
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
        coverImageUrl: null, // M1: no cover images in sample data
        saved: savedIds.has(r.resourceId),
      };
    });

    let nextCursor: string | null = null;
    if (hasMore) {
      const last = page[page.length - 1]!;
      const raw = `${last.editorialPriority}|${last.startsAt.toISOString()}|${last.publicationId}`;
      nextCursor = Buffer.from(raw).toString('base64url');
    }

    return { items, nextCursor };
  }

  // ── Saved items ────────────────────────────────────────────────────

  async getSavedItems(
    principal: PrincipalContext,
    readerLocale: ReaderLocale,
    opts: { cursor?: string; limit?: number },
  ): Promise<{ items: SavedItem[]; nextCursor: string | null }> {
    const ctx = await this.contextLoader.forReader(principal, readerLocale);
    const isCyrillic = ctx.readerLocale === 'sr-Cyrl';
    const authored = authoredLocale(ctx.readerLocale);
    const limit = Math.min(opts.limit ?? 20, 50);

    return withOrgScope(this.dbService.db, ctx.orgId, async (tx) => {
      // Decode cursor
      let cursorDate: Date | undefined;
      let cursorId: string | undefined;
      if (opts.cursor) {
        const parts = Buffer.from(opts.cursor, 'base64url').toString().split('|');
        if (parts.length === 2) {
          cursorDate = new Date(parts[0]!);
          cursorId = parts[1];
        }
      }

      const fetchLimit = limit + 1;
      const rows = await tx
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

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;

      // Check availability for each saved resource
      const resourceIds = page.map((r) => r.contentResourceId);
      const availableIds = resourceIds.length > 0
        ? new Set(await this.availabilityService.availableResourceIds(ctx, this.dbService.db, resourceIds))
        : new Set<string>();

      // For available resources, fetch details
      const availableResourceIds = resourceIds.filter((id) => availableIds.has(id));
      const resourceDetails = availableResourceIds.length > 0
        ? await this.getResourceSummaries(this.dbService.db, availableResourceIds, authored)
        : new Map<string, { type: string; title: string; categoryName: string }>();

      const items: SavedItem[] = page.map((r) => {
        if (!availableIds.has(r.contentResourceId)) {
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
        const detail = resourceDetails.get(r.contentResourceId);
        return {
          resourceId: r.contentResourceId,
          type: (detail?.type ?? 'article') as SavedItem['type'],
          title: detail
            ? (isCyrillic ? transliterateText(detail.title) : detail.title)
            : null,
          status: 'available' as const,
          categoryName: detail
            ? (isCyrillic ? transliterateText(detail.categoryName) : detail.categoryName)
            : null,
          coverImageUrl: null,
          savedAt: r.createdAt,
        };
      });

      let nextCursor: string | null = null;
      if (hasMore) {
        const last = page[page.length - 1]!;
        nextCursor = Buffer.from(
          `${last.createdAt.toISOString()}|${last.id}`,
        ).toString('base64url');
      }

      return { items, nextCursor };
    });
  }

  async saveItem(
    principal: PrincipalContext,
    contentResourceId: string,
    readerLocale: ReaderLocale,
  ): Promise<void> {
    const ctx = await this.contextLoader.forReader(principal, readerLocale);

    // Verify the resource is available
    const avail = await this.availabilityService.isAvailable(ctx, this.dbService.db, contentResourceId);
    if (!avail) return Promise.reject(null); // caller handles 404

    await withOrgScope(this.dbService.db, ctx.orgId, async (tx) => {
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

  // ── Private helpers ────────────────────────────────────────────────

  private async getCategoryLabel(
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
      .innerJoin(
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
      .innerJoin(
        categoryLabels,
        and(
          eq(categoryLabels.categoryId, categories.id),
          eq(categoryLabels.locale, locale),
        ),
      )
      .where(inArray(categories.id, categoryIds));
    return new Map(rows.map((r) => [r.categoryId, r]));
  }

  private async getMediaReferences(
    db: DbExecutor,
    revisionId: string,
    isCyrillic: boolean,
    locale: AuthoredLocale,
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

    const now = new Date();
    const validAssets = rows.filter(
      (r) => r.state === 'ready' && (!r.rightsExpiresAt || r.rightsExpiresAt > now),
    );

    // Fetch renditions for valid assets
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
      const rawAlt = altObj?.[locale] ?? altObj?.['sr-Latn'] ?? null;
      const altText = rawAlt && isCyrillic ? transliterateText(rawAlt) : rawAlt;

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

  private async getRelatedResources(
    ctx: AvailabilityContext,
    db: DbExecutor,
    relatedIds: string[],
    locale: AuthoredLocale,
  ) {
    if (relatedIds.length === 0) return [];
    const availableIds = await this.availabilityService.availableResourceIds(
      ctx, db, relatedIds,
    );
    if (availableIds.length === 0) return [];

    const isCyrillic = ctx.readerLocale === 'sr-Cyrl';
    const details = await this.getResourceSummaries(db, availableIds.slice(0, 3), locale);

    return availableIds.slice(0, 3).map((id) => {
      const d = details.get(id);
      return {
        resourceId: id,
        type: (d?.type ?? 'article') as LibraryContentDetail['type'],
        title: d ? (isCyrillic ? transliterateText(d.title) : d.title) : '',
        summary: d ? (isCyrillic ? transliterateText(d.summary) : d.summary) : '',
        categoryName: d ? (isCyrillic ? transliterateText(d.categoryName) : d.categoryName) : '',
        coverImageUrl: null,
      };
    });
  }

  private async getResourceSummaries(
    db: DbExecutor,
    resourceIds: string[],
    locale: AuthoredLocale,
  ): Promise<Map<string, { type: string; title: string; summary: string; categoryName: string }>> {
    if (resourceIds.length === 0) return new Map();

    // Fetch the latest available publication for each resource
    const rows = await db
      .select({
        resourceId: contentResources.id,
        type: contentResources.type,
        title: contentRevisions.title,
        summary: contentRevisions.summary,
        categoryId: contentResources.primaryCategoryId,
      })
      .from(contentResources)
      .innerJoin(
        contentVariants,
        and(
          eq(contentVariants.contentResourceId, contentResources.id),
          eq(contentVariants.locale, locale),
        ),
      )
      .innerJoin(
        contentPublications,
        eq(contentPublications.contentVariantId, contentVariants.id),
      )
      .innerJoin(
        contentRevisions,
        eq(contentRevisions.id, contentPublications.contentRevisionId),
      )
      .where(
        and(
          inArray(contentResources.id, resourceIds),
          isNull(contentPublications.withdrawnAt),
        ),
      );

    const categoryIds = [...new Set(rows.map((r) => r.categoryId))];
    const catMap = await this.getCategoryLabels(db, categoryIds, locale);

    const result = new Map<string, { type: string; title: string; summary: string; categoryName: string }>();
    for (const r of rows) {
      if (!result.has(r.resourceId)) {
        result.set(r.resourceId, {
          type: r.type,
          title: r.title,
          summary: r.summary,
          categoryName: catMap.get(r.categoryId)?.name ?? '',
        });
      }
    }
    return result;
  }

  /**
   * ACC-R-25: log a warning if the resource is available in another locale
   * but not in the reader's locale. Logs ids only (no titles or PII).
   */
  private async logLocaleInconsistency(
    ctx: AvailabilityContext,
    contentResourceId: string,
  ): Promise<void> {
    // Check if ANY locale is available for this resource (not just the reader's)
    const otherLocales = (['sr-Latn', 'hu', 'en'] as const).filter(
      (l) => l !== authoredLocale(ctx.readerLocale),
    );
    for (const locale of otherLocales) {
      const otherCtx: AvailabilityContext = { ...ctx, readerLocale: locale };
      const avail = await this.availabilityService.isAvailable(
        otherCtx, this.dbService.db, contentResourceId,
      );
      if (avail) {
        this.logger.warn(
          `AV-24 locale inconsistency: resource=${contentResourceId} available in ${locale} but not in ${authoredLocale(ctx.readerLocale)} for org=${ctx.orgId}`,
        );
        return;
      }
    }
  }
}
