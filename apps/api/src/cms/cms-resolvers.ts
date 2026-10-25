/**
 * CMS authorization resolvers (T-C1.10 review fixes).
 *
 * Factory functions that use `deps.get(CmsResourceLoader)` to resolve
 * CMS entities to their authorization Resource representation. Every
 * CMS item and list route uses one of these via `@Authorize()`.
 *
 * @see authorize.decorator.ts for ResolverDeps
 */
import { ACTIONS, type Action, type Principal, type Resource } from '@nestself/contracts';
import type { ResourceResolver, ResolverDeps } from '../authz/authorize.decorator.js';
import { assertOperationsSession } from '../authz/resolvers.js';
import { CmsResourceLoader } from './cms-resource-loader.js';
import { CmsScopeService } from '../authz/cms-scope.service.js';
import { AuthorizationService } from '../authz/authorization.service.js';
import { ApiHttpException } from '../common/api-error.js';

// ---------------------------------------------------------------------------
// Visibility helper (WRK-R-39)
// ---------------------------------------------------------------------------

/**
 * Check whether the principal holds `content.preview` on the resource's
 * primary category. Used by the discipline ruling to decide 403 vs 404.
 *
 * Uses the non-auditing evaluateQuiet to avoid writing access.denied
 * audit rows for what is only a visibility probe. Rethrows non-
 * authorization errors (DB failures, etc.) so they don't get swallowed.
 */
async function hasPreviewAccess(
  deps: ResolverDeps,
  principal: Principal,
  primaryCategoryId: string | null,
): Promise<boolean> {
  if (!primaryCategoryId) return false;
  const authzService = deps.get(AuthorizationService);
  return authzService.evaluateQuiet(principal, ACTIONS['content.preview'], {
    type: 'content_resource',
    collectionId: primaryCategoryId,
  });
}

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

      // WRK-R-39: discipline ruling
      // Outside-discipline reviewer → 403 content_review_discipline when they
      // hold content.preview on the primary category, else 404.
      // Non-reviewers → return to engine, denyAs:'not_found' → 404.
      //
      // Disciplines are evaluated by the engine through the 'categories'
      // condition on the grant: resource.category is compared against
      // condition.allowed.  When category is null the condition passes
      // vacuously, so a scope-only check (no category) tells us whether
      // the user is a reviewer *at all*, while a full check (with
      // category = reviewDiscipline) tests the discipline.
      if (opts?.review) {
        const authzService = deps!.get(AuthorizationService);

        // Step 1: scope check — does the principal hold content.review
        // on the primary category?  Uses evaluateQuiet (no audit row)
        // because this is a probe, not a final denial decision.
        const isReviewerForCategory = await authzService.evaluateQuiet(
          principal,
          ACTIONS['content.review'],
          {
            type: loaded.type,
            id: loaded.id,
            collectionId: loaded.collectionId ?? undefined,
            // Omit category so the 'categories' condition passes vacuously.
          },
        );

        if (!isReviewerForCategory) {
          // Not a reviewer for this category (author, publisher, etc.).
          // Return the resource; the engine will deny and denyAs:'not_found'
          // converts the denial to 404.
          return { ...loaded, collectionId: loaded.collectionId ?? undefined };
        }

        // Step 2: the principal IS a reviewer for this category.
        // If no discipline is configured, the review cannot proceed.
        if (!loaded.reviewDiscipline) {
          const canPreview = await hasPreviewAccess(deps!, principal, loaded.collectionId);
          throw new ApiHttpException({
            status: canPreview ? 403 : 404,
            code: canPreview ? 'content_review_discipline' : 'not_found',
            message: canPreview
              ? 'The resource has no review discipline configured'
              : 'Resource not found',
          });
        }

        // Step 3: full authorization including the discipline condition
        // (category = reviewDiscipline). Uses evaluateQuiet to avoid
        // probe audit rows; the guard's own decision handles the audit.
        loaded.category = loaded.reviewDiscipline;
        const hasDisciplineGrant = await authzService.evaluateQuiet(
          principal,
          ACTIONS['content.review'],
          {
            type: loaded.type,
            id: loaded.id,
            collectionId: loaded.collectionId ?? undefined,
            category: loaded.reviewDiscipline,
          },
        );

        if (!hasDisciplineGrant) {
          // Reviewer for this category but NOT for this discipline.
          const canPreview = await hasPreviewAccess(deps!, principal, loaded.collectionId);
          throw new ApiHttpException({
            status: canPreview ? 403 : 404,
            code: canPreview ? 'content_review_discipline' : 'not_found',
            message: canPreview
              ? `Reviewer is not authorized for the ${loaded.reviewDiscipline} discipline`
              : 'Resource not found',
          });
        }
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

    // Stash the allowed set on the request for the controller to re-use
    // (avoids a second allowedCategoryIds call).
    (req as Record<string, unknown>)['_cmsAllowedCategoryIds'] = allowed;

    // Return with collectionId so the engine can match (ACC-R-24/WRK-R-31)
    return { type, collectionId: allowed[0] };
  };
}
