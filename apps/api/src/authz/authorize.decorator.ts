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
  action: Action;
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
 */
export function Authorize(
  action: Action,
  resolver: ResourceResolver,
  opts?: { denyAs?: 'not_found' },
) {
  return SetMetadata(AUTHORIZE_KEY, {
    action,
    resolver,
    denyAs: opts?.denyAs,
  } satisfies AuthorizeMetadata);
}
