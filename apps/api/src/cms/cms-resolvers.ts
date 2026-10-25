/**
 * CMS authorization resolvers (T-C1.10 review fixes).
 *
 * Factory functions that use `deps.get(CmsResourceLoader)` to resolve
 * CMS entities to their authorization Resource representation. Every
 * CMS item and list route uses one of these via `@Authorize()`.
 *
 * @see authorize.decorator.ts for ResolverDeps
 */
import type { Action, Principal, Resource } from '@nestself/contracts';
import type { ResourceResolver, ResolverDeps } from '../authz/authorize.decorator.js';
import { assertOperationsSession } from '../authz/resolvers.js';
import { CmsResourceLoader } from './cms-resource-loader.js';
import { CmsScopeService } from '../authz/cms-scope.service.js';
import { ApiHttpException } from '../common/api-error.js';

// ---------------------------------------------------------------------------
// Item resolver factory
// ---------------------------------------------------------------------------

/**
 * Build a `ResourceResolver` for a single CMS entity identified by a
 * route parameter.
 *
 * Usage:
 *   `@Authorize(ACTIONS['content.write'], cmsResource('forRevision', 'revisionId'))`
 *   `@Authorize(ACTIONS['content.review'], cmsResource('forRevision', 'revisionId', { review: true }), { denyAs: 'not_found' })`
 */
export function cmsResource(
  method: 'forResource' | 'forVariant' | 'forRevision' | 'forAsset' | 'forPublication',
  paramName: string,
  opts?: { review?: boolean },
): ResourceResolver {
  return async (
    req: Record<string, unknown>,
    principal: Principal,
    deps?: ResolverDeps,
  ): Promise<Resource> => {
    assertOperationsSession(principal);

    const params = req['params'] as Record<string, string | undefined> | undefined;
    const id = params?.[paramName];
    if (!id) {
      throw new ApiHttpException({ status: 404, code: 'not_found', message: 'Resource not found' });
    }

    const loader = deps!.get(CmsResourceLoader);

    if (method === 'forRevision') {
      const loaded = await loader.forRevision(id, opts?.review ? { forReview: true } : undefined);
      if (!loaded) {
        throw new ApiHttpException({ status: 404, code: 'not_found', message: 'Resource not found' });
      }

      // ACC-R-07 fail-closed: refuse before the engine when discipline is null
      if (opts?.review) {
        if (!loaded.reviewDiscipline) {
          throw new ApiHttpException({
            status: 403,
            code: 'content_review_discipline',
            message: 'The resource has no review discipline configured',
          });
        }
        loaded.category = loaded.reviewDiscipline;
      }

      return { ...loaded, collectionId: loaded.collectionId ?? undefined };
    }

    const loaded = await loader[method](id);
    if (!loaded) {
      throw new ApiHttpException({ status: 404, code: 'not_found', message: 'Resource not found' });
    }
    return { ...loaded, collectionId: loaded.collectionId ?? undefined };
  };
}

// ---------------------------------------------------------------------------
// Create resolver (collectionId from request body)
// ---------------------------------------------------------------------------

export const cmsCreateResolver: ResourceResolver = (
  req: Record<string, unknown>,
  principal: Principal,
): Resource => {
  assertOperationsSession(principal);
  const body = req['body'] as Record<string, unknown> | undefined;
  const categoryId = body?.primaryCategoryId as string | undefined;
  if (!categoryId) {
    throw new ApiHttpException({
      status: 400,
      code: 'content_missing_required',
      message: 'primaryCategoryId is required',
    });
  }
  return { type: 'content_resource', id: '', collectionId: categoryId };
};

// ---------------------------------------------------------------------------
// Publish resolver (resourceId from request body)
// ---------------------------------------------------------------------------

export const cmsPublishResolver: ResourceResolver = async (
  req: Record<string, unknown>,
  principal: Principal,
  deps?: ResolverDeps,
): Promise<Resource> => {
  assertOperationsSession(principal);
  const body = req['body'] as Record<string, unknown> | undefined;
  const resourceId = body?.resourceId as string | undefined;
  if (!resourceId) {
    throw new ApiHttpException({
      status: 400,
      code: 'content_missing_required',
      message: 'resourceId is required',
    });
  }
  const loader = deps!.get(CmsResourceLoader);
  const loaded = await loader.forResource(resourceId);
  if (!loaded) {
    throw new ApiHttpException({ status: 404, code: 'not_found', message: 'Resource not found' });
  }
  return { ...loaded, collectionId: loaded.collectionId ?? undefined };
};

// ---------------------------------------------------------------------------
// List resolver (category-scoped, ACC-R-24)
// ---------------------------------------------------------------------------

/**
 * For list routes: when `categoryId` is in the query, resolve to that
 * category; otherwise verify the principal has the action on at least one
 * category (the controller then calls `CmsScopeService` for the set).
 */
export function cmsList(type: string, action: Action): ResourceResolver {
  return async (
    req: Record<string, unknown>,
    principal: Principal,
    deps?: ResolverDeps,
  ): Promise<Resource> => {
    assertOperationsSession(principal);

    const query = (req as { query?: Record<string, string | undefined> }).query;
    const categoryId = query?.categoryId;

    if (categoryId) {
      return { type, collectionId: categoryId };
    }

    // Verify the principal can reach at least one category
    const scopeService = deps!.get(CmsScopeService);
    const allowed = await scopeService.allowedCategoryIds(principal, action);
    if (allowed.length === 0) {
      throw new ApiHttpException({
        status: 403,
        code: 'forbidden',
        message: 'No accessible categories',
      });
    }

    // Return type-only resource; the controller uses the scope service for the full set.
    return { type };
  };
}
