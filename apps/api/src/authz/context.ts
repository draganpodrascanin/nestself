/**
 * Context validity check for the authorization engine (step 2).
 *
 * Validates that the principal's active context is backed by a current
 * membership, expert capability or staff role.
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
// Return types
// ---------------------------------------------------------------------------

export type ContextValidationResult =
  | { valid: true }
  | { valid: false; code: 'invalid_context' | 'org_context_expired' };

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
 * Returns a result object: `{ valid: true }` on success, or
 * `{ valid: false, code }` where `code` distinguishes between
 * `invalid_context` (never had access) and `org_context_expired`
 * (membership exists but is no longer date-current).
 *
 * Satisfies AUTHZ-R-32, ACC-R-15.
 */
export function isContextValid(
  principal: Principal,
  ctx: AuthorizationContext,
): ContextValidationResult {
  const context = principal.context;

  switch (context.kind) {
    case 'organization': {
      const membership = principal.memberships.find(
        (m) => m.orgId === context.orgId,
      );
      if (!membership) return { valid: false, code: 'invalid_context' };
      if (!isMembershipDateCurrent(membership, ctx.now)) {
        return { valid: false, code: membership.status === 'ACTIVE' ? 'org_context_expired' : 'invalid_context' };
      }
      return { valid: true };
    }

    case 'personal': {
      // C-22 / ACC-R-15: when a personal context carries `orgId`, the
      // membership in that specific org must be ACTIVE and date-current.
      if (context.orgId) {
        const membership = principal.memberships.find(
          (m) => m.orgId === context.orgId,
        );
        if (!membership) return { valid: false, code: 'invalid_context' };
        if (!isMembershipDateCurrent(membership, ctx.now)) {
          return { valid: false, code: membership.status === 'ACTIVE' ? 'org_context_expired' : 'invalid_context' };
        }
        return { valid: true };
      }
      // Without an orgId: at least one date-current membership.
      const hasAny = principal.memberships.some((m) =>
        isMembershipDateCurrent(m, ctx.now),
      );
      return hasAny
        ? { valid: true }
        : { valid: false, code: 'invalid_context' };
    }

    case 'expert':
      return principal.expert != null
        ? { valid: true }
        : { valid: false, code: 'invalid_context' };

    case 'operations':
      return principal.staffTemplates.length > 0
        ? { valid: true }
        : { valid: false, code: 'invalid_context' };

    default:
      return { valid: false, code: 'invalid_context' };
  }
}
