/**
 * @Authorize() decorator — declares the action and resource resolver
 * that the AuthorizationGuard evaluates.
 *
 * @see 4.6.1, AUTHZ-R-49, D-19
 */
import { SetMetadata } from '@nestjs/common';
import type { Action, Resource, Principal } from '@nestself/contracts';

export const AUTHORIZE_KEY = 'authorize';

export type ResourceResolver = (
  req: Record<string, unknown>,
  principal: Principal,
) => Resource | Promise<Resource>;

export interface AuthorizeMetadata {
  /** Alternatives in the order the guard evaluates them; any one allows the route. Never empty. */
  actions: Action[];
  resolver: ResourceResolver;
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
export const Authorize = (action: Action | readonly Action[], resolver: ResourceResolver) => {
  const actions = typeof action === 'string' ? [action] : [...action];
  if (actions.length === 0) {
    // An empty list would deny every caller; fail when the route is declared.
    throw new Error('@Authorize() needs at least one action');
  }
  return SetMetadata(AUTHORIZE_KEY, { actions, resolver } satisfies AuthorizeMetadata);
};
