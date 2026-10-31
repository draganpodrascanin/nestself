/**
 * CmsScopeService — computes the set of category ids a principal may
 * access for a given action (ACC-R-24, C-31).
 *
 * Used by list/dashboard controllers after the guard passes with a
 * type-only resource (no collectionId).
 */
import { Injectable, Inject, forwardRef } from '@nestjs/common';
import type {
  Action,
  AuthorizationRequest,
  Principal,
  Resource,
} from '@nestself/contracts';
import { authorizeMany } from './authorize-many.js';
import { ContextLoader } from './context-loader.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { DbService } from '../db/db.service.js';
import { categories } from '../db/schema/taxonomy.js';

@Injectable()
export class CmsScopeService {
  constructor(
    private readonly dbService: DbService,
    @Inject(forwardRef(() => ContextLoader)) private readonly contextLoader: ContextLoader,
  ) {}

  /**
   * Return the list of category ids the principal may access for the given action.
   *
   * Builds the authorization context ONCE for the principal, then evaluates
   * all categories against it in a single `authorizeMany` call (O(1) context
   * build per list request, not O(n) per category).
   */
  async allowedCategoryIds(
    principal: Principal,
    action: Action,
  ): Promise<string[]> {
    const allIds = await this.listCategoryIds();
    if (allIds.length === 0) return [];

    // Build context once — the principal's grants and assignments are
    // category-independent; scope matching happens inside authorizeMany.
    const ctx = await this.contextLoader.build(
      principal,
      { type: 'content_resource' },
      { action },
    );

    // Evaluate all categories in one pass
    const requests: AuthorizationRequest[] = allIds.map((catId) => ({
      principal,
      action,
      resource: { type: 'content_resource', collectionId: catId } as Resource,
      ctx,
    }));
    const decisions = authorizeMany(requests);
    return allIds.filter((_, i) => decisions[i]!.allowed);
  }

  private async listCategoryIds(): Promise<string[]> {
    const rows = await this.dbService.db
      .select({ id: categories.id })
      .from(categories);
    return rows.map((r) => r.id);
  }
}
