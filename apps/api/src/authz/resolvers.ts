/**
 * Shared `@Authorize()` resource resolvers.
 *
 * - `orgResourceFromContext`: for `/orgs/:orgId/*` controllers. Enforces
 *   API-R-21: the session's active context must be the organization named in
 *   the route; the body is never trusted for scoping (DR-02, AUTHZ-R-50).
 * - `operationsResource`: for `/ops/*` controllers. Enforces API-R-28: the
 *   active context must be `operations` and the caller must hold a session
 *   (bearer tokens are rejected with `session_required`).
 * - `personalOrgResource`: for `/library/*` and `/me/*` controllers. Enforces
 *   C-22 / ACC-R-04: the active context must be `personal` with an `orgId`
 *   matching an ACTIVE membership.
 */
import type { Principal, Resource } from '@nestself/contracts';
import { ApiHttpException } from '../common/api-error.js';
import type { ResourceResolver } from './authorize.decorator.js';
import { isMembershipDateCurrent } from './personal-context.js';
import { membershipContextCode } from './context.js';

function routeOrgId(req: Record<string, unknown>): string | undefined {
  const params = req['params'] as Record<string, string | undefined> | undefined;
  return params?.['orgId'];
}

/** Resource of the given type scoped to the organization in the active context. */
export function orgResourceFromContext(type: string): ResourceResolver {
  return (req, principal: Principal): Resource => {
    const orgId = routeOrgId(req);
    if (!orgId) {
      throw new ApiHttpException({ status: 404, code: 'not_found', message: 'Resource not found' });
    }
    if (principal.context.kind !== 'organization' || principal.context.orgId !== orgId) {
      throw new ApiHttpException({
        status: 403,
        code: 'context_mismatch',
        message: 'The active context does not match the requested organization',
      });
    }
    return { type, orgId };
  };
}

/**
 * Resource scoped to the personal context's organization (C-22, ACC-R-04).
 *
 * Used by `/library/*` and `/me/*` controllers. Requires the active context to
 * be `personal` with an `orgId` backed by an ACTIVE membership; returns a
 * resource with `{ type, id, orgId, ownerId }`.
 */
export function personalOrgResource(
  type: string,
  id?: (req: Record<string, unknown>) => string | undefined,
): ResourceResolver {
  return (req, principal: Principal): Resource => {
    const ctx = principal.context;
    if (ctx.kind !== 'personal' || !ctx.orgId) {
      throw new ApiHttpException({
        status: 403,
        code: 'invalid_context',
        message: 'This endpoint requires a personal context with an organisation',
      });
    }
    const orgId = ctx.orgId;
    // ACC-R-15: membership must be ACTIVE *and* date-current.
    // Distinguish between "no membership" (invalid_context) and
    // "membership expired / not yet started" using membershipContextCode.
    const membership = principal.memberships.find((m) => m.orgId === orgId);
    if (!membership) {
      throw new ApiHttpException({
        status: 403,
        code: 'invalid_context',
        message: 'No membership for the selected organisation',
      });
    }
    if (!isMembershipDateCurrent(membership)) {
      throw new ApiHttpException({
        status: 403,
        code: membershipContextCode(membership, new Date()),
        message: 'Organisation membership is not current',
      });
    }
    return {
      type,
      id: id?.(req),
      orgId,
      ownerId: principal.userId,
    };
  };
}

/** Platform-level resource for the operations workspace. */
export function operationsResource(type: string, id?: (req: Record<string, unknown>) => string | undefined): ResourceResolver {
  return (req, principal: Principal): Resource => {
    if (!principal.sessionId) {
      throw new ApiHttpException({
        status: 403,
        code: 'session_required',
        message: 'Operations endpoints require a web session',
      });
    }
    if (principal.context.kind !== 'operations') {
      throw new ApiHttpException({
        status: 403,
        code: 'context_mismatch',
        message: 'The active context must be operations',
      });
    }
    return { type, id: id?.(req) };
  };
}
