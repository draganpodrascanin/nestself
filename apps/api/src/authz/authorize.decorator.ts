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
  action: Action;
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
 */
export const Authorize = (action: Action, resolver: ResourceResolver) =>
  SetMetadata(AUTHORIZE_KEY, { action, resolver } satisfies AuthorizeMetadata);
