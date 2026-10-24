/**
 * CmsResourceLoader -- resolves CMS entities to their authorization Resource
 * representation (I4, C-31).
 *
 * Each `for*` method returns `{ type, id, collectionId }` suitable for
 * `@Authorize()` resolvers.  Missing rows return `null` so the controller
 * can respond 404 without leaking existence.
 */
import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { DbService } from '../db/db.service.js';
import { mediaAssets } from '../db/schema/media.js';
import { contentResources, contentVariants, contentRevisions, contentPublications } from '../db/schema/cms.js';

export interface CmsResource {
  type: string;
  id: string;
  collectionId: string | null;
  /** Set to the resource's review_discipline when the action is content.review (ACC-R-07). */
  category?: string;
}

@Injectable()
export class CmsResourceLoader {
  constructor(private readonly dbService: DbService) {}

  /**
   * Resolve a media asset id to its authorization resource.
   * Returns `null` when the row does not exist.
   */
  async forAsset(id: string): Promise<CmsResource | null> {
    const rows = await this.dbService.db
      .select({
        id: mediaAssets.id,
        ownerCategoryId: mediaAssets.ownerCategoryId,
      })
      .from(mediaAssets)
      .where(eq(mediaAssets.id, id))
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    return {
      type: 'media_asset',
      id: row.id,
      collectionId: row.ownerCategoryId,
    };
  }

  /**
   * Resource for creating a content resource (5.3.3).
   * No database lookup: the category id comes from the request body.
   */
  forCreate(primaryCategoryId: string): CmsResource {
    return {
      type: 'content_resource',
      id: '',
      collectionId: primaryCategoryId,
    };
  }

  /**
   * Resolve a content resource by id.
   */
  async forResource(id: string): Promise<CmsResource | null> {
    const rows = await this.dbService.db
      .select({
        id: contentResources.id,
        primaryCategoryId: contentResources.primaryCategoryId,
      })
      .from(contentResources)
      .where(eq(contentResources.id, id))
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    return {
      type: 'content_resource',
      id: row.id,
      collectionId: row.primaryCategoryId,
    };
  }

  /**
   * Resolve a variant to its resource for authorization.
   */
  async forVariant(variantId: string): Promise<CmsResource | null> {
    const rows = await this.dbService.db
      .select({
        resourceId: contentResources.id,
        primaryCategoryId: contentResources.primaryCategoryId,
      })
      .from(contentVariants)
      .innerJoin(contentResources, eq(contentVariants.contentResourceId, contentResources.id))
      .where(eq(contentVariants.id, variantId))
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    return {
      type: 'content_resource',
      id: row.resourceId,
      collectionId: row.primaryCategoryId,
    };
  }

  /**
   * Resolve a revision to its resource for authorization.
   * When `forReview` is true, sets `category` to the resource's review_discipline
   * so the engine enforces discipline-scoped review (ACC-R-07).
   * Returns null if the review_discipline is missing when forReview is true
   * (fail-closed).
   */
  async forRevision(
    revisionId: string,
    opts?: { forReview?: boolean },
  ): Promise<(CmsResource & { reviewDiscipline?: string | null; authorUserId?: string; lastEditorUserId?: string; variantLocale?: string }) | null> {
    const rows = await this.dbService.db
      .select({
        resourceId: contentResources.id,
        primaryCategoryId: contentResources.primaryCategoryId,
        reviewDiscipline: contentResources.reviewDiscipline,
        authorUserId: contentRevisions.authorUserId,
        lastEditorUserId: contentRevisions.lastEditorUserId,
        variantLocale: contentVariants.locale,
      })
      .from(contentRevisions)
      .innerJoin(contentVariants, eq(contentRevisions.contentVariantId, contentVariants.id))
      .innerJoin(contentResources, eq(contentVariants.contentResourceId, contentResources.id))
      .where(eq(contentRevisions.id, revisionId))
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    const resource: CmsResource & { reviewDiscipline?: string | null; authorUserId?: string; lastEditorUserId?: string; variantLocale?: string } = {
      type: 'content_resource',
      id: row.resourceId,
      collectionId: row.primaryCategoryId,
      reviewDiscipline: row.reviewDiscipline,
      authorUserId: row.authorUserId,
      lastEditorUserId: row.lastEditorUserId,
      variantLocale: row.variantLocale,
    };

    if (opts?.forReview) {
      // ACC-R-07: set category for discipline matching
      resource.category = row.reviewDiscipline ?? undefined;
    }

    return resource;
  }

  /**
   * Resolve a publication to its resource for authorization.
   */
  async forPublication(publicationId: string): Promise<CmsResource | null> {
    const rows = await this.dbService.db
      .select({
        resourceId: contentResources.id,
        primaryCategoryId: contentResources.primaryCategoryId,
      })
      .from(contentPublications)
      .innerJoin(contentVariants, eq(contentPublications.contentVariantId, contentVariants.id))
      .innerJoin(contentResources, eq(contentVariants.contentResourceId, contentResources.id))
      .where(eq(contentPublications.id, publicationId))
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    return {
      type: 'content_resource',
      id: row.resourceId,
      collectionId: row.primaryCategoryId,
    };
  }
}
