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

/**
 * Determine whether a membership is current (ACTIVE and within dates)
 * relative to `now`.
 */
function isMembershipCurrent(
  m: Principal['memberships'][number],
  now: Date,
): boolean {
  if (m.status !== 'ACTIVE') return false;

  const start = new Date(m.startDate);
  if (start > now) return false;

  if (m.endDate != null) {
    const end = new Date(m.endDate);
    if (end <= now) return false;
  }

  return true;
}

/**
 * Check whether the principal's active context is valid.
 *
 * - `organization`: the user must hold an ACTIVE and date-current
 *   membership in that org.
 * - `personal`: at least one ACTIVE and date-current membership.
 * - `expert`: `principal.expert` must not be null.
 * - `operations`: `principal.staffTemplates` must be non-empty.
 *
 * Satisfies AUTHZ-R-32.
 */
export function isContextValid(
  principal: Principal,
  ctx: AuthorizationContext,
): boolean {
  const context = principal.context;

  switch (context.kind) {
    case 'organization':
      return principal.memberships.some(
        (m) => m.orgId === context.orgId && isMembershipCurrent(m, ctx.now),
      );

    case 'personal':
      // C-22 / ACC-R-15: when a personal context carries `orgId`, the
      // membership in that specific org must be ACTIVE and date-current.
      if (context.orgId) {
        return principal.memberships.some(
          (m) => m.orgId === context.orgId && isMembershipCurrent(m, ctx.now),
        );
      }
      return principal.memberships.some((m) =>
        isMembershipCurrent(m, ctx.now),
      );

    case 'expert':
      return principal.expert != null;

    case 'operations':
      return principal.staffTemplates.length > 0;

    default:
      return false;
  }
}
