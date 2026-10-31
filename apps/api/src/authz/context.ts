/**
 * Context validity check for the authorization engine (step 2).
 *
 * The pure engine only returns `invalid_context`; the guard and service-layer
 * map that to `org_context_expired` through `denialCode` when the stored
 * session context names an organization (personal+orgId or organization).
 *
 * @see Section 4.5.3 step 2 of auth-strategy.md
 * Satisfies AUTHZ-R-32.
 */
import type {
  Principal,
  AuthorizationContext,
} from '@nestself/contracts';
import { isMembershipDateCurrent } from './personal-context.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Map a denial from the authorization engine into the HTTP error code.
 *
 * The engine always says `invalid_context`; this function upgrades it to
 * `org_context_expired` when the principal's stored session context names an
 * organization (personal+orgId or organization). Non-context denials pass
 * through as `'forbidden'`.
 *
 * Used by both `AuthorizationGuard` and `AuthorizationService.require` (I2).
 */
export function denialCode(
  principal: Principal,
  denialReason: string,
): 'invalid_context' | 'org_context_expired' | 'forbidden' {
  if (denialReason !== 'invalid_context') return 'forbidden';
  const pctx = principal.context;
  const namesOrg =
    (pctx.kind === 'personal' && 'orgId' in pctx && pctx.orgId != null) ||
    pctx.kind === 'organization';
  return namesOrg ? 'org_context_expired' : 'invalid_context';
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
