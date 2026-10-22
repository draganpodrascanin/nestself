/**
 * Grant condition evaluation.
 *
 * Each condition on a grant is evaluated against the resource and context.
 * All conditions must pass for the grant to match.
 *
 * @see Section 4.5.5 of auth-strategy.md
 * Satisfies AUTHZ-R-36.
 */
import type {
  Action,
  GrantCondition,
  Resource,
  AuthorizationContext,
} from '@nestself/contracts';

/**
 * Evaluate a single grant condition against the resource and context.
 *
 * @param action - the action being evaluated; required so that the
 *   `confidential_approver` condition can restrict itself to the
 *   `approval.confidential` action only.
 *
 * Satisfies AUTHZ-R-36.
 */
export function evaluateCondition(
  condition: GrantCondition,
  resource: Resource,
  ctx: AuthorizationContext,
  action: Action,
): boolean {
  switch (condition.type) {
    case 'spending_ceiling':
      // If the resource carries no amount, the condition passes vacuously.
      if (resource.amountMinor == null) {
        return true;
      }
      // If amount is present but currency is missing or mismatched, fail closed.
      if (
        resource.currency == null ||
        resource.currency !== condition.currency
      ) {
        return false;
      }
      return resource.amountMinor <= condition.amountMinor;

    case 'categories':
      // If the resource carries no category, the condition passes.
      if (resource.category == null) {
        return true;
      }
      return condition.allowed.includes(resource.category);

    case 'confidential_approver':
      // Only the approval.confidential action can use a grant carrying this
      // condition; for any other action the condition fails.
      return action === 'approval.confidential';

    case 'time_window':
      return evaluateTimeWindow(condition, ctx);

    default:
      return false;
  }
}

/**
 * Evaluate all conditions on a grant. Returns true only if every
 * condition passes.
 *
 * Satisfies AUTHZ-R-36.
 */
export function evaluateConditions(
  conditions: readonly GrantCondition[],
  resource: Resource,
  ctx: AuthorizationContext,
  action: Action,
): boolean {
  return conditions.every((c) => evaluateCondition(c, resource, ctx, action));
}

// ---------------------------------------------------------------------------
// Time-window helper (no luxon; uses Intl)
// ---------------------------------------------------------------------------

function evaluateTimeWindow(
  condition: Extract<GrantCondition, { type: 'time_window' }>,
  ctx: AuthorizationContext,
): boolean {
  const tz = ctx.organizationTimezone || 'UTC';

  // Get the day of week and time in the organization's timezone.
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(ctx.now);
  const weekdayStr = parts.find((p) => p.type === 'weekday')?.value;
  const hourStr = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const minuteStr = parts.find((p) => p.type === 'minute')?.value ?? '00';

  // Map weekday abbreviation to 0-6 (Sun-Sat)
  const dayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const dayOfWeek = dayMap[weekdayStr ?? ''] ?? -1;

  if (!condition.days.includes(dayOfWeek)) {
    return false;
  }

  // Compare HH:MM strings; handle windows crossing midnight
  // (e.g. from "22:00" to "06:00").
  const currentTime = `${hourStr.padStart(2, '0')}:${minuteStr.padStart(2, '0')}`;

  if (condition.from <= condition.to) {
    // Normal window: from <= to  (e.g. 09:00 to 17:00)
    return currentTime >= condition.from && currentTime <= condition.to;
  }
  // Overnight window: from > to  (e.g. 22:00 to 06:00)
  return currentTime >= condition.from || currentTime <= condition.to;
}
