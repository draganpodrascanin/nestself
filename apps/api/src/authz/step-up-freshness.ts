/**
 * Step-up freshness (3.6.9, AUTHZ-R-46, T-2.6): an action with a step-up
 * class needs an authentication or step-up no older than the class allows.
 * Shared by `AuthorizationGuard` (`@Authorize` routes) and
 * `AuthorizationService.require` (service-level checks after loading a row).
 */
import { STEP_UP_CLASS_BY_ACTION, STEP_UP_MAX_AGE_SECONDS, type Action, type Principal } from '@nestself/contracts';
import { ApiHttpException } from '../common/api-error.js';
import type { KeyValueStore } from '../redis/key-value-store.js';
import { stepUpKey } from '../redis/redis-keys.js';

/**
 * Throw 403 `step_up_required` when the most recent of the authentication,
 * the session step-up and the bearer family's step-up is older than the
 * action's class allows. Actions without a class pass.
 */
export async function assertStepUpFresh(
  principal: Principal,
  action: Action,
  store: KeyValueStore,
  now: Date = new Date(),
): Promise<void> {
  const stepUpClass = STEP_UP_CLASS_BY_ACTION[action];
  if (!stepUpClass) return;
  const maxAge = STEP_UP_MAX_AGE_SECONDS[stepUpClass];
  const times = [principal.auth.time, principal.auth.lastStepUpAt];
  if (principal.tokenFamily) {
    times.push(await bearerStepUpAt(store, principal.tokenFamily));
  }
  const latest = Math.max(
    ...times.map((t) => (t ? new Date(t).getTime() : Number.NaN)).filter((t) => !Number.isNaN(t)),
  );
  if (now.getTime() - latest <= maxAge * 1_000) return;

  throw new ApiHttpException({
    status: 403,
    code: 'step_up_required',
    message: 'Re-authentication required for this action',
    details: { stepUpClass, maxAge, method: 'email_otp' },
  });
}

async function bearerStepUpAt(store: KeyValueStore, tokenFamily: string): Promise<string | null> {
  const raw = await store.get(stepUpKey(tokenFamily));
  if (!raw) return null;
  try {
    return (JSON.parse(raw) as { lastStepUpAt?: string }).lastStepUpAt ?? null;
  } catch {
    return null;
  }
}
