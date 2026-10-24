import { describe, it, expect, vi } from 'vitest';
import type { NavigateFn } from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@nestself/api-client';
import { handleApiError } from './handle-api-error';
import { StepUpCancelledError } from './with-step-up';

function makeDeps() {
  return {
    navigate: vi.fn() as unknown as NavigateFn,
    queryClient: { cancelQueries: vi.fn() } as unknown as QueryClient,
    refreshPrincipal: vi.fn().mockResolvedValue(undefined),
    switchContext: vi.fn().mockResolvedValue(undefined),
    stepUp: vi.fn().mockResolvedValue(true),
  };
}

describe('handleApiError', () => {
  it('opens the step-up dialog once for step_up_required and does not navigate', () => {
    const deps = makeDeps();
    const err = new ApiError({
      status: 403,
      code: 'step_up_required',
      message: 'Step-up required',
      requestId: null,
      details: { stepUpClass: 'sensitive', maxAge: 300, method: 'email_otp' },
    });

    handleApiError(err, deps);

    expect(deps.stepUp).toHaveBeenCalledTimes(1);
    expect(deps.navigate).not.toHaveBeenCalled();
  });

  it('treats StepUpCancelledError as handled: no re-prompt, no navigation', () => {
    const deps = makeDeps();

    handleApiError(new StepUpCancelledError(), deps);

    expect(deps.stepUp).not.toHaveBeenCalled();
    expect(deps.navigate).not.toHaveBeenCalled();
    expect(deps.queryClient.cancelQueries).not.toHaveBeenCalled();
    expect(deps.switchContext).not.toHaveBeenCalled();
  });
});
