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
   */
  async allowedCategoryIds(
    principal: Principal,
    action: Action,
  ): Promise<string[]> {
    const allIds = await this.listCategoryIds();
    if (allIds.length === 0) return [];

    // Build contexts and evaluate in batch
    const results: boolean[] = [];
    for (const catId of allIds) {
      const resource: Resource = { type: 'content_resource', collectionId: catId };
      const ctx = await this.contextLoader.build(principal, resource, { action });
      const requests: AuthorizationRequest[] = [{
        principal,
        action,
        resource,
        ctx,
      }];
      const [decision] = authorizeMany(requests);
      results.push(decision!.allowed);
    }
    return allIds.filter((_, i) => results[i]);
  }

  private async listCategoryIds(): Promise<string[]> {
    const rows = await this.dbService.db
      .select({ id: categories.id })
      .from(categories);
    return rows.map((r) => r.id);
  }
}
