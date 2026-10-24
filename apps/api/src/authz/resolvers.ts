/**
 * Shared `@Authorize()` resource resolvers.
 *
 * - `orgResourceFromContext`: for `/orgs/:orgId/*` controllers. Enforces
 *   API-R-21: the session's active context must be the organization named in
 *   the route; the body is never trusted for scoping (DR-02, AUTHZ-R-50).
 * - `operationsResource`: for `/ops/*` controllers. Enforces API-R-28: the
 *   active context must be `operations` and the caller must hold a session
 *   (bearer tokens are rejected with `session_required`).
 * - `operationsOrgResource`: for `/ops/orgs/:orgId/*` controllers. Same
 *   checks as `operationsResource`, scoped to the organization in the route.
 */
import type { Principal, Resource } from '@nestself/contracts';
import { ApiHttpException } from '../common/api-error.js';
import type { ResourceResolver } from './authorize.decorator.js';

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
 * API-R-28 checks shared by every `/ops/*` resolver: a web session (bearer
 * tokens are rejected with `session_required`) and the operations context.
 */
export function assertOperationsSession(principal: Principal): void {
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
}

/** Platform-level resource for the operations workspace. */
export function operationsResource(type: string, id?: (req: Record<string, unknown>) => string | undefined): ResourceResolver {
  return (req, principal: Principal): Resource => {
    assertOperationsSession(principal);
    return { type, id: id?.(req) };
  };
}

/**
 * Resource of the given type in the organization named by `:orgId`, reached
 * from the operations workspace (`/ops/orgs/:orgId/*`). `authorize()` applies
 * the `assigned_clients` scope through the caller's CLIENT assignment.
 */
export function operationsOrgResource(type: string): ResourceResolver {
  return (req, principal: Principal): Resource => {
    assertOperationsSession(principal);
    const orgId = routeOrgId(req);
    if (!orgId) {
      throw new ApiHttpException({ status: 404, code: 'not_found', message: 'Resource not found' });
    }
    return { type, orgId };
  };
}
