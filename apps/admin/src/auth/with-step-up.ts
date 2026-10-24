/**
 * Runs an API call and, when the server answers `step_up_required`, asks the
 * user to re-authenticate and retries the call once.
 *
 * `stepUp` resolves `true` when the user verified and `false` when they
 * cancelled; on `false` the original error is rethrown so the caller's error
 * state still renders.
 */
import { ApiError } from '@nestself/api-client';

export async function withStepUp<T>(
  stepUp: () => Promise<boolean>,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ApiError && err.code === 'step_up_required' && (await stepUp())) {
      return fn();
    }
    throw err;
  }
}
