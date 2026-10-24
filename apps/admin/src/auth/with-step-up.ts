/**
 * Runs an API call and, when the server answers `step_up_required`, asks the
 * user to re-authenticate and retries the call once.
 *
 * `stepUp` resolves `true` when the user verified and `false` when they
 * cancelled; on `false` a `StepUpCancelledError` is thrown so callers (and
 * `handleApiError`) can tell a deliberate cancel from a failure.
 */
import { ApiError } from '@nestself/api-client';

/** Thrown by `withStepUp` when the user cancelled the step-up dialog. */
export class StepUpCancelledError extends Error {
  constructor() {
    super('Step-up cancelled by the user');
    this.name = 'StepUpCancelledError';
  }
}

export async function withStepUp<T>(
  stepUp: () => Promise<boolean>,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ApiError && err.code === 'step_up_required') {
      if (await stepUp()) return fn();
      throw new StepUpCancelledError();
    }
    throw err;
  }
}
