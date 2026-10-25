import { describe, it, expect } from 'vitest';
import { StepUpCancelledError } from '../../auth';
import { apiError } from '../organizations/ops-test-harness';
import { emergencyErrorKey } from './emergency-errors';

describe('emergencyErrorKey', () => {
  it.each([
    [apiError(403, 'self_approval_denied'), 'selfApprovalDenied'],
    [apiError(409, 'emergency_not_active'), 'notActive'],
    [apiError(403, 'emergency_not_active'), 'notActive'],
    [apiError(409, 'conflict'), 'conflict'],
    [apiError(409, 'something_new'), 'conflict'],
    [apiError(404, 'not_found'), 'notFound'],
    [apiError(403, 'forbidden'), 'forbidden'],
    [apiError(400, 'validation'), 'validation'],
    [apiError(429, 'whatever'), 'rateLimited'],
    [apiError(500, 'internal'), 'unknown'],
    [new Error('network'), 'unknown'],
  ])('maps %s to %s', (err, key) => {
    expect(emergencyErrorKey(err)).toBe(key);
  });

  it('treats a cancelled step-up as nothing to show', () => {
    expect(emergencyErrorKey(new StepUpCancelledError())).toBeNull();
  });
});
