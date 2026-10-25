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
  ne,
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
import { memberships } from '../../db/schema/organization.js';
import { mediaAssets } from '../../db/schema/media.js';
import type { AvailabilityContext, AuthoredLocale } from './availability-context.js';
import { authoredLocale } from './availability-context.js';

/** Filter arguments to push predicates into the SQL (C2). */
export interface AvailabilityFilter {
  resourceIds?: string[];
  variantIds?: string[];
  publicationIds?: string[];
  mediaAssetId?: string;
  /** Override the locale condition (AV-24 diagnostic). When set, replaces the single-locale eq with inArray. */
  localeOverrides?: AuthoredLocale[];
}

@Injectable()
export class AvailabilityService {
  /**
   * Returns a Drizzle query whose rows are the publications available to the
   * reader described by `ctx`. Columns are aliased so that `.as('avail')`
   * exposes `publication_id`, `variant_id`, `content_resource_id`, `locale`
   * for subquery joins (C1).
   *
   * The result implements every clause of the formula (5.9.1 items 3–10);
   * items 1–2 (active principal, active membership) are guard-level checks
   * that happen before reaching the service. For reader contexts, an
   * uncorrelated EXISTS on the membership provides defense in depth (C3).
   *
   * @see ACC-R-17, C-10
   */
  availablePublications(
    ctx: AvailabilityContext,
    db: DbExecutor,
    filter: AvailabilityFilter = {},
  ) {
    const conditions = [
      // Item 4: not withdrawn
      isNull(contentPublications.withdrawnAt),

      // Item 5: started
      lte(contentPublications.startsAt, ctx.now),

      // Item 3: resource active
      eq(contentResources.state, 'active'),

      // Item 6: not expired
      or(
        isNull(contentPublications.endsAt),
        gt(contentPublications.endsAt, ctx.now),
      ),

      // Item 7: supersession — NOT EXISTS newer non-withdrawn started publication.
      // Deterministic tie-break on (starts_at, id) DESC per variant (I4).
      notExists(
        db
          .select({ _: sql`1` })
          .from(sql`content_publications "newer"`)
          .where(
            sql`"newer".content_variant_id = ${contentPublications.contentVariantId}
                AND "newer".withdrawn_at IS NULL
                AND "newer".starts_at <= ${ctx.now}
                AND ("newer".starts_at, "newer".id) > (${contentPublications.startsAt}, ${contentPublications.id})`,
          ),
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
      notExists(
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
                ne(mediaAssets.state, 'ready'),
                and(
                  sql`${mediaAssets.rightsExpiresAt} IS NOT NULL`,
                  lte(mediaAssets.rightsExpiresAt, ctx.now),
                ),
              ),
            ),
          ),
      ),

      // ACC-R-25: locale filter — C-28
      filter.localeOverrides && filter.localeOverrides.length > 0
        ? inArray(contentVariants.locale, filter.localeOverrides)
        : eq(contentVariants.locale, authoredLocale(ctx.readerLocale)),
    ];

    // Defense in depth for reader contexts (C3): uncorrelated EXISTS on membership
    if (ctx.kind === 'reader') {
      conditions.push(
        exists(
          db
            .select({ _: sql`1` })
            .from(memberships)
            .where(
              and(
                eq(memberships.id, ctx.membershipId),
                eq(memberships.userId, ctx.userId),
                eq(memberships.orgId, ctx.orgId),
                eq(memberships.status, 'ACTIVE'),
                lte(memberships.startDate, ctx.now),
                or(
                  isNull(memberships.endDate),
                  gt(memberships.endDate, ctx.now),
                ),
              ),
            ),
        ),
      );
    }

    // Pushdown filters (C2)
    if (filter.resourceIds && filter.resourceIds.length > 0) {
      conditions.push(
        inArray(contentVariants.contentResourceId, filter.resourceIds),
      );
    }
    if (filter.variantIds && filter.variantIds.length > 0) {
      conditions.push(inArray(contentVariants.id, filter.variantIds));
    }
    if (filter.publicationIds && filter.publicationIds.length > 0) {
      conditions.push(inArray(contentPublications.id, filter.publicationIds));
    }
    if (filter.mediaAssetId) {
      conditions.push(
        exists(
          db
            .select({ _: sql`1` })
            .from(contentRevisionMedia)
            .where(
              and(
                eq(
                  contentRevisionMedia.contentRevisionId,
                  contentPublications.contentRevisionId,
                ),
                eq(contentRevisionMedia.mediaAssetId, filter.mediaAssetId),
              ),
            ),
        ),
      );
    }

    return db
      .select({
        publicationId:
          sql<string>`${contentPublications.id}`.as('publication_id'),
        variantId: sql<string>`${contentVariants.id}`.as('variant_id'),
        contentResourceId:
          sql<string>`${contentVariants.contentResourceId}`.as(
            'content_resource_id',
          ),
        locale: sql<string>`${contentVariants.locale}`.as('locale'),
      })
      .from(contentPublications)
      .innerJoin(
        contentVariants,
        eq(contentVariants.id, contentPublications.contentVariantId),
      )
      .innerJoin(
        contentResources,
        eq(contentResources.id, contentVariants.contentResourceId),
      )
      .where(and(...conditions));
  }

  /**
   * Check whether a single content resource is available. Returns the
   * publication row or `null`. Single SQL query via resourceIds filter pushdown.
   */
  async isAvailable(
    ctx: AvailabilityContext,
    db: DbExecutor,
    contentResourceId: string,
  ) {
    const rows = await this.availablePublications(ctx, db, {
      resourceIds: [contentResourceId],
    });
    return rows[0] ?? null;
  }

  /**
   * Filter a list of resource ids down to the available ones.
   * Single SQL query via resourceIds filter pushdown.
   */
  async availableResourceIds(
    ctx: AvailabilityContext,
    db: DbExecutor,
    ids: string[],
  ): Promise<string[]> {
    if (ids.length === 0) return [];
    const rows = await this.availablePublications(ctx, db, {
      resourceIds: ids,
    });
    return rows.map((r) => r.contentResourceId);
  }

  /**
   * Check whether a media asset is referenced by some available publication's
   * revision. Uses `availablePublications` with `mediaAssetId` filter to avoid
   * duplicating the formula (minor 1).
   */
  async isMediaAssetAvailable(
    ctx: AvailabilityContext,
    db: DbExecutor,
    assetId: string,
  ): Promise<boolean> {
    const rows = await this.availablePublications(ctx, db, { mediaAssetId: assetId });
    return rows.length > 0;
  }

  /**
   * Preview simulation (ACC-R-19, 5.9.4): evaluate the formula using a
   * simulated context. Never loads a real person's state (saved items,
   * playback, feedback). The context must have `kind: 'preview'`.
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
 * 3. `org_unit` matches when `org_id = ctx.orgId` AND either
 *    `include_descendants` and `org_unit_id` is in `ctx.orgUnitIds`,
 *    or exactly equals the primary unit otherwise.
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
        eq(contentPublicationAudiences.orgId, ctx.orgId),
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
