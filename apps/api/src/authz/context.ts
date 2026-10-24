/**
 * Context validity check for the authorization engine (step 2).
 *
 * The pure engine only returns `invalid_context`; the authorization guard
 * maps that to `org_context_expired` when the stored session context names
 * an organization (personal with orgId, or organization).
 *
 * @see Section 4.5.3 step 2 of auth-strategy.md
 * Satisfies AUTHZ-R-32.
 */
import type {
  Principal,
  PrincipalMembership,
  AuthorizationContext,
} from '@nestself/contracts';
import { isMembershipDateCurrent } from './personal-context.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Classify a membership that is NOT date-current into the correct error code
 * for the authorization guard and resource resolvers (not for the engine).
 *
 * - ended (status no longer ACTIVE, or endDate in the past) → `org_context_expired`
 * - not yet started (status ACTIVE but startDate in the future) → `invalid_context`
 * - never activated (status INVITED) → `invalid_context`
 */
export function membershipContextCode(
  m: Pick<PrincipalMembership, 'status' | 'startDate' | 'endDate'>,
  now: Date,
): 'invalid_context' | 'org_context_expired' {
  if (m.status !== 'ACTIVE') return 'invalid_context'; // INVITED: never activated
  if (new Date(m.startDate) > now) return 'invalid_context'; // not yet started
  // ACTIVE with endDate in the past → expired
  return 'org_context_expired';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check whether the principal's active context is valid.
 *
 * - `organization`: the user must hold an ACTIVE and date-current
 *   membership in that org.
 * - `personal`: when an orgId is present, the membership in that specific
 *   org must be ACTIVE and date-current. Without an orgId, at least one
 *   ACTIVE and date-current membership is required.
 * - `expert`: `principal.expert` must not be null.
 * - `operations`: `principal.staffTemplates` must be non-empty.
 *
 * Returns `true` when the context is valid, `false` otherwise.
 * The engine always denies with `invalid_context`; the guard decides
 * whether to upgrade that to `org_context_expired`.
 *
 * Satisfies AUTHZ-R-32, ACC-R-15.
 */
export function isContextValid(
  principal: Principal,
  ctx: AuthorizationContext,
): boolean {
  const context = principal.context;

  switch (context.kind) {
    case 'organization': {
      const membership = principal.memberships.find(
        (m) => m.orgId === context.orgId,
      );
      if (!membership) return false;
      return isMembershipDateCurrent(membership, ctx.now);
    }

    case 'personal': {
      // C-22 / ACC-R-15: when a personal context carries `orgId`, the
      // membership in that specific org must be ACTIVE and date-current.
      if (context.orgId) {
        const membership = principal.memberships.find(
          (m) => m.orgId === context.orgId,
        );
        if (!membership) return false;
        return isMembershipDateCurrent(membership, ctx.now);
      }
      // Without an orgId: at least one date-current membership.
      return principal.memberships.some((m) =>
        isMembershipDateCurrent(m, ctx.now),
      );
    }

    case 'expert':
      return principal.expert != null;

    case 'operations':
      return principal.staffTemplates.length > 0;

    default:
      return false;
  }
}
