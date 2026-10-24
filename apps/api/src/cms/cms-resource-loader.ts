/**
 * CmsResourceLoader — resolves CMS entities to their authorization Resource
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

export interface CmsResource {
  type: string;
  id: string;
  collectionId: string | null;
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
}
