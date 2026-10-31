/**
 * @Authorize() decorator — declares the action and resource resolver
 * that the AuthorizationGuard evaluates.
 *
 * @see 4.6.1, AUTHZ-R-49, D-19
 */
import { SetMetadata, type Type } from '@nestjs/common';
import type { Action, Resource, Principal } from '@nestself/contracts';

export const AUTHORIZE_KEY = 'authorize';

/**
 * Dependency accessor passed to resolvers that need DI services.
 * Backed by `ModuleRef.get(token, { strict: false })` in the guard.
 */
export interface ResolverDeps {
  get<T>(token: Type<T>): T;
}

/**
 * Function that derives the authorization Resource from the HTTP request.
 * `deps` is optional so that existing resolvers (and their tests) that
 * never need DI still compile with two arguments.
 */
export type ResourceResolver = (
  req: Record<string, unknown>,
  principal: Principal,
  deps?: ResolverDeps,
) => Resource | Promise<Resource>;

export interface AuthorizeMetadata {
  /** Alternatives in the order the guard evaluates them; any one allows the route. Never empty. */
  actions: Action[];
  resolver: ResourceResolver;
  /** When set, a denial answers 404 instead of 403 (ACC-R-22/23 non-disclosure). */
  denyAs?: 'not_found';
}

/**
 * Declare which action this route requires and how to derive the resource.
 *
 * ```ts
 * @Authorize(ACTIONS['program.overview'], (req) => ({
 *   type: 'program',
 *   orgId: (req as any).params.orgId,
 * }))
 * ```
 *
 * A list means "any of": the route is allowed when at least one listed action
 * is allowed. The guard evaluates them in order and stops at the first that
 * allows; the step-up class is that action's, and a denial is audited under
 * the first action with the whole list as `details.alternatives`.
 *
 * ```ts
 * @Authorize([ACTIONS['program.overview'], ACTIONS['access.preview']], resolver)
 * ```
 */
export function Authorize(
  action: Action | readonly Action[],
  resolver: ResourceResolver,
  opts?: { denyAs?: 'not_found' },
) {
  const actions = typeof action === 'string' ? [action] : [...action];
  if (actions.length === 0) {
    // An empty list would deny every caller; fail when the route is declared.
    throw new Error('@Authorize() needs at least one action');
  }
  return SetMetadata(AUTHORIZE_KEY, {
    actions,
    resolver,
    denyAs: opts?.denyAs,
  } satisfies AuthorizeMetadata);
}
