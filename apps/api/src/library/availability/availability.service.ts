/**
 * AvailabilityService — the single implementation of the availability formula
 * (C-10, ACC-R-17). Every employee read path composes the subquery returned by
 * `availablePublications`. There is no second TypeScript implementation of
 * the formula.
 *
 * @see 5.9 AvailabilityService
 */
import { Injectable } from '@nestjs/common';
import {
  sql,
  and,
  eq,
  lte,
  gt,
  isNull,
  or,
  inArray,
  exists,
  notExists,
} from 'drizzle-orm';
import type { DbExecutor } from '../../db/db.service.js';
import {
  contentPublications,
  contentPublicationAudiences,
  contentVariants,
  contentResources,
  contentRevisionMedia,
} from '../../db/schema/cms.js';
import { mediaAssets } from '../../db/schema/media.js';
import type { AvailabilityContext } from './availability-context.js';
import { authoredLocale } from './availability-context.js';

@Injectable()
export class AvailabilityService {
  /**
   * Returns a Drizzle query whose rows are the publications available to the
   * reader described by `ctx`. Columns: `publicationId`, `variantId`,
   * `contentResourceId`, `locale`.
   *
   * The result is a full query, not a subquery — callers wrap or join it as
   * they see fit. It implements every clause of the formula (5.9.1 items 3–10);
   * items 1–2 (active principal, active membership) are guard-level checks
   * that happen before reaching the service.
   *
   * @see ACC-R-17, C-10
   */
  availablePublications(ctx: AvailabilityContext, db: DbExecutor) {
    // CTE: latest started non-withdrawn publication per variant (5.9.1 item 7)
    // Uses DISTINCT ON to pick the row with the highest starts_at per variant.
    // The partial index `content_publications_variant_active_idx` covers this.
    const latestStarted = db
      .$with('latest_started')
      .as(
        db
          .select({
            publicationId:
              sql<string>`DISTINCT ON (${contentPublications.contentVariantId}) ${contentPublications.id}`.as(
                'publication_id',
              ),
            variantId: contentPublications.contentVariantId,
          })
          .from(contentPublications)
          .where(
            and(
              isNull(contentPublications.withdrawnAt), // item 4
              lte(contentPublications.startsAt, ctx.now), // item 5
            ),
          )
          .orderBy(
            contentPublications.contentVariantId,
            sql`${contentPublications.startsAt} DESC`,
          ),
      );

    return db
      .with(latestStarted)
      .select({
        publicationId: contentPublications.id,
        variantId: contentVariants.id,
        contentResourceId: contentVariants.contentResourceId,
        locale: contentVariants.locale,
      })
      .from(contentPublications)
      .innerJoin(
        latestStarted,
        eq(latestStarted.publicationId, contentPublications.id),
      )
      .innerJoin(
        contentVariants,
        eq(contentVariants.id, contentPublications.contentVariantId),
      )
      .innerJoin(
        contentResources,
        eq(contentResources.id, contentVariants.contentResourceId),
      )
      .where(
        and(
          // Item 3: resource active
          eq(contentResources.state, 'active'),

          // Item 6: not expired
          or(
            isNull(contentPublications.endsAt),
            gt(contentPublications.endsAt, ctx.now),
          ),

          // Item 8: audience match (OR across rows) — C-12
          exists(
            db
              .select({ _: sql`1` })
              .from(contentPublicationAudiences)
              .where(
                and(
                  eq(
                    contentPublicationAudiences.publicationId,
                    contentPublications.id,
                  ),
                  audiencePredicate(ctx),
                ),
              ),
          ),

          // Item 9: capability enabled — C-11
          // Fail-closed: if ctx.capabilities is empty, nothing matches.
          ctx.capabilities.length > 0
            ? sql`${contentPublications.requiredCapability} IN (${sql.join(
                ctx.capabilities.map((c) => sql`${c}`),
                sql`, `,
              )})`
            : sql`false`,

          // Item 10: media readiness and rights — C-14
          mediaReady(db, ctx.now),

          // ACC-R-25: locale filter — C-28
          eq(contentVariants.locale, authoredLocale(ctx.readerLocale)),
        ),
      );
  }

  /**
   * Check whether a single content resource is available. Returns the
   * publication row or `null`.
   */
  async isAvailable(
    ctx: AvailabilityContext,
    db: DbExecutor,
    contentResourceId: string,
  ) {
    const rows = await this.availablePublications(ctx, db);
    const match = rows.find((r) => r.contentResourceId === contentResourceId);
    return match ?? null;
  }

  /**
   * Filter a list of resource ids down to the available ones.
   */
  async availableResourceIds(
    ctx: AvailabilityContext,
    db: DbExecutor,
    ids: string[],
  ): Promise<string[]> {
    if (ids.length === 0) return [];
    const rows = await this.availablePublications(ctx, db);
    const availableSet = new Set(rows.map((r) => r.contentResourceId));
    return ids.filter((id) => availableSet.has(id));
  }

  /**
   * Check whether a media asset is referenced by some available publication's
   * revision and is itself `ready` with valid rights. Built on the same
   * availability subquery — no second formula.
   */
  async isMediaAssetAvailable(
    ctx: AvailabilityContext,
    db: DbExecutor,
    assetId: string,
  ): Promise<boolean> {
    const pubs = await this.availablePublications(ctx, db);
    // For each available publication, check if its revision references this asset
    for (const pub of pubs) {
      const refs = await db
        .select({ _: sql<number>`1` })
        .from(contentRevisionMedia)
        .innerJoin(
          contentPublications,
          eq(
            contentPublications.contentRevisionId,
            contentRevisionMedia.contentRevisionId,
          ),
        )
        .innerJoin(
          mediaAssets,
          eq(mediaAssets.id, contentRevisionMedia.mediaAssetId),
        )
        .where(
          and(
            eq(contentPublications.id, pub.publicationId),
            eq(contentRevisionMedia.mediaAssetId, assetId),
            eq(mediaAssets.state, 'ready'),
            or(
              isNull(mediaAssets.rightsExpiresAt),
              gt(mediaAssets.rightsExpiresAt, ctx.now),
            ),
          ),
        );
      if (refs.length > 0) return true;
    }
    return false;
  }

  /**
   * Preview simulation (ACC-R-19, 5.9.4): evaluate the formula using a
   * simulated context. Never loads a real person's state (saved items,
   * playback, feedback).
   */
  preview(simulatedCtx: AvailabilityContext, db: DbExecutor) {
    return this.availablePublications(simulatedCtx, db);
  }
}

// ---------------------------------------------------------------------------
// SQL predicate helpers (private)
// ---------------------------------------------------------------------------

/**
 * OR of three audience-match clauses (C-12, 5.9.2):
 * 1. `all_eligible` matches every organization.
 * 2. `organization` matches when `org_id = ctx.orgId`.
 * 3. `org_unit` matches when `include_descendants` and `org_unit_id` is in
 *    `ctx.orgUnitIds`, or exactly equals the primary unit otherwise.
 */
function audiencePredicate(ctx: AvailabilityContext) {
  const clauses = [
    // all_eligible matches everyone (capability check is separate)
    eq(contentPublicationAudiences.kind, 'all_eligible'),

    // organization: org_id = ctx.orgId
    and(
      eq(contentPublicationAudiences.kind, 'organization'),
      eq(contentPublicationAudiences.orgId, ctx.orgId),
    ),
  ];

  // org_unit matching — only when the reader has org units
  if (ctx.orgUnitIds.length > 0) {
    clauses.push(
      and(
        eq(contentPublicationAudiences.kind, 'org_unit'),
        or(
          // include_descendants: unit or any ancestor matches
          and(
            eq(contentPublicationAudiences.includeDescendants, true),
            inArray(contentPublicationAudiences.orgUnitId, ctx.orgUnitIds),
          ),
          // exact match only: primary unit matches
          and(
            eq(contentPublicationAudiences.includeDescendants, false),
            eq(contentPublicationAudiences.orgUnitId, ctx.orgUnitIds[0]!),
          ),
        ),
      )!,
    );
  }

  return or(...clauses);
}

/**
 * NOT EXISTS check for media assets that would disqualify a publication
 * (5.9.1 item 10, C-14). A publication is available only when every
 * referenced media asset is `ready` with valid rights.
 */
function mediaReady(db: DbExecutor, now: Date) {
  return notExists(
    db
      .select({ _: sql`1` })
      .from(contentRevisionMedia)
      .innerJoin(
        mediaAssets,
        eq(mediaAssets.id, contentRevisionMedia.mediaAssetId),
      )
      .where(
        and(
          eq(
            contentRevisionMedia.contentRevisionId,
            contentPublications.contentRevisionId,
          ),
          or(
            sql`${mediaAssets.state} != 'ready'`,
            and(
              sql`${mediaAssets.rightsExpiresAt} IS NOT NULL`,
              lte(mediaAssets.rightsExpiresAt, now),
            ),
          ),
        ),
      ),
  );
}
