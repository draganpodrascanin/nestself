/**
 * operationsCategoryScope resolver (ACC-R-24, C-31).
 *
 * Used by staff list/dashboard routes that are filtered per category
 * assignment. When the request includes a `categoryId` query parameter,
 * the resolver returns `{ type, collectionId: categoryId }` and the
 * engine checks the grant. When no `categoryId` is provided and `list`
 * is true, it returns `{ type }` (no collectionId) so the engine checks
 * action existence; the controller then calls CmsScopeService for the
 * category set.
 */
import type { Principal, Resource } from '@nestself/contracts';
import { ApiHttpException } from '../common/api-error.js';
import { assertOperationsSession } from './resolvers.js';
import type { ResourceResolver } from './authorize.decorator.js';

export function operationsCategoryScope(
  type: string,
  opts?: { list?: boolean },
): ResourceResolver {
  return (req, principal: Principal): Resource => {
    assertOperationsSession(principal);

    const query = (req as { query?: Record<string, string | undefined> }).query;
    const categoryId = query?.categoryId;

    if (categoryId) {
      return { type, collectionId: categoryId };
    }
    if (opts?.list) {
      return { type };
    }
    throw new ApiHttpException({
      status: 400,
      code: 'validation',
      message: 'categoryId is required for this route',
    });
  };
}
