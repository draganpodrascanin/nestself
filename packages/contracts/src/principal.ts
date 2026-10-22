/**
 * Client-side authorization helpers and Principal re-exports.
 *
 * `can()` is a client-side hint only. The server's `authorize()` is the
 * single authority. [API-R-32, SYS-01, DR-01]
 *
 * @see Section 5.8.1 of auth-strategy.md
 */
import type { Principal } from './auth.ts';

export {
  PrincipalSchema,
  MeResponseSchema,
  ActiveContextSchema,
  AuthInfoSchema,
  PrincipalMembershipSchema,
} from './auth.ts';

/**
 * Client-side authorization hint. Not an enforcement point.
 *
 * At route level, `resource` is undefined and `can()` checks the flat
 * `effectiveActions` list from `MeResponse`. Component-level checks
 * may pass a `resource` for a coarser heuristic. The server remains
 * the single authority.
 *
 * Satisfies API-R-32, SYS-01, DR-01.
 */
export function can(
  principal: Principal,
  action: string,
  resource?: { orgId?: string; orgUnitId?: string },
  effectiveActions?: readonly string[],
): boolean {
  // Fast check: user state
  if (!principal.userId) return false;

  // Route-level: check the effectiveActions list when available
  if (!resource && effectiveActions) {
    return effectiveActions.includes(action);
  }

  // Context check (fallback when effectiveActions is not provided)
  const ctx = principal.context;
  if (ctx.kind === 'personal') {
    // Personal context: only own-scoped actions
    return (
      action.startsWith('preferences.') ||
      action.startsWith('feedback.') ||
      action.startsWith('content.read') ||
      action.startsWith('content.bookmark') ||
      action.startsWith('service.') ||
      action.startsWith('appointment.') ||
      action.startsWith('event.register') ||
      action.startsWith('conversation.participate') ||
      action.startsWith('voucher.activate') ||
      action.startsWith('data.')
    );
  }

  if (ctx.kind === 'organization' && resource?.orgId && ctx.orgId !== resource.orgId) {
    return false;
  }

  // Staff template check
  if (ctx.kind === 'operations') {
    return principal.staffTemplates.length > 0;
  }

  // Expert check
  if (ctx.kind === 'expert') {
    return principal.expert !== null;
  }

  // Grants are not carried in the Principal; this is a broad hint
  return true;
}
