import { describe, it, expect, vi } from 'vitest';
import { ApiError } from '@nestself/api-client';
import { withStepUp, StepUpCancelledError } from './with-step-up';

function stepUpRequired(): ApiError {
  return new ApiError({
    status: 403,
    code: 'step_up_required',
    message: 'Step-up required',
    requestId: null,
    details: { stepUpClass: 'sensitive', maxAge: 300, method: 'email_otp' },
  });
}

describe('withStepUp', () => {
  it('retries once after step_up_required when stepUp() resolves true', async () => {
    const fn = vi.fn().mockRejectedValueOnce(stepUpRequired()).mockResolvedValueOnce('ok');
    const stepUp = vi.fn().mockResolvedValue(true);

    await expect(withStepUp(stepUp, fn)).resolves.toBe('ok');
    expect(stepUp).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws StepUpCancelledError when stepUp() resolves false', async () => {
    const fn = vi.fn().mockRejectedValue(stepUpRequired());
    const stepUp = vi.fn().mockResolvedValue(false);

    await expect(withStepUp(stepUp, fn)).rejects.toBeInstanceOf(StepUpCancelledError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries only once even if the retry asks for step-up again', async () => {
    const second = stepUpRequired();
    const fn = vi.fn().mockRejectedValueOnce(stepUpRequired()).mockRejectedValueOnce(second);
    const stepUp = vi.fn().mockResolvedValue(true);

    await expect(withStepUp(stepUp, fn)).rejects.toBe(second);
    expect(stepUp).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('passes other errors through untouched without asking for step-up', async () => {
    const err = new ApiError({ status: 403, code: 'forbidden', message: 'no', requestId: null });
    const fn = vi.fn().mockRejectedValue(err);
    const stepUp = vi.fn();

    await expect(withStepUp(stepUp, fn)).rejects.toBe(err);
    expect(stepUp).not.toHaveBeenCalled();
  });
});
