/**
 * handle-api-error unit tests for the workspace app (T-C1.02).
 *
 * - `org_context_expired` triggers a switch to `{ kind: 'personal' }` and a translated toast.
 * - `step_up_required` opens the step-up dialog.
 * - `StepUpCancelledError` is silenced.
 * - Other error codes do NOT trigger a context switch.
 */
import { describe, it, expect, vi } from 'vitest';
import { handleApiError, type ErrorHandlerDeps } from './handle-api-error';
import { ApiError } from '@nestself/api-client';
import { StepUpCancelledError } from './with-step-up';

function createDeps(overrides: Partial<ErrorHandlerDeps> = {}): ErrorHandlerDeps {
  return {
    navigate: vi.fn() as unknown as ErrorHandlerDeps['navigate'],
    queryClient: {
      cancelQueries: vi.fn(),
      clear: vi.fn(),
    } as unknown as ErrorHandlerDeps['queryClient'],
    refreshPrincipal: vi.fn().mockResolvedValue(undefined),
    switchContext: vi.fn().mockResolvedValue(undefined),
    stepUp: vi.fn().mockResolvedValue(true),
    showToast: vi.fn(),
    t: vi.fn((key: string) => `translated:${key}`),
    ...overrides,
  };
}

function makeApiError(status: number, code: string, details?: Record<string, unknown>): ApiError {
  return new ApiError({ status, code, message: `HTTP ${status}`, requestId: null, details });
}

describe('handleApiError (workspace, T-C1.02)', () => {
  it('org_context_expired triggers switch to personal and a translated toast', () => {
    const deps = createDeps();
    handleApiError(makeApiError(403, 'org_context_expired'), deps);

    expect(deps.switchContext).toHaveBeenCalledWith({ kind: 'personal' });
    expect(deps.showToast).toHaveBeenCalledWith(
      'translated:contextSwitcher.error.org_context_expired',
    );
  });

  it('opens the step-up dialog once for step_up_required and does not navigate', () => {
    const deps = createDeps();
    handleApiError(
      makeApiError(403, 'step_up_required', { stepUpClass: 'sensitive', maxAge: 300, method: 'email_otp' }),
      deps,
    );

    expect(deps.stepUp).toHaveBeenCalledTimes(1);
    expect(deps.navigate).not.toHaveBeenCalled();
  });

  it('treats StepUpCancelledError as handled: no re-prompt, no navigation', () => {
    const deps = createDeps();

    handleApiError(new StepUpCancelledError(), deps);

    expect(deps.stepUp).not.toHaveBeenCalled();
    expect(deps.navigate).not.toHaveBeenCalled();
    expect(deps.queryClient.cancelQueries).not.toHaveBeenCalled();
    expect(deps.switchContext).not.toHaveBeenCalled();
  });

  it('401 does NOT switch context', () => {
    const deps = createDeps();
    handleApiError(makeApiError(401, 'unauthenticated'), deps);

    expect(deps.switchContext).not.toHaveBeenCalled();
  });

  it('403 forbidden does NOT switch context', () => {
    const deps = createDeps();
    handleApiError(makeApiError(403, 'forbidden'), deps);

    expect(deps.switchContext).not.toHaveBeenCalled();
  });

  it('non-ApiError is ignored entirely', () => {
    const deps = createDeps();
    handleApiError(new Error('Random'), deps);

    expect(deps.switchContext).not.toHaveBeenCalled();
    expect(deps.showToast).not.toHaveBeenCalled();
  });
});
