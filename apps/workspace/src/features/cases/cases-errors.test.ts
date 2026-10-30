import { describe, it, expect } from 'vitest';
import { StepUpCancelledError } from '../../auth';
import { casesErrorKey } from './cases-errors';
import { apiError, t } from './cases-test-harness';

describe('casesErrorKey', () => {
  it.each([
    [apiError(403, 'forbidden'), 'forbidden'],
    [apiError(403, 'org_context_expired'), 'forbidden'],
    [apiError(404, 'not_found'), 'notFound'],
    [apiError(429, 'rate_limited'), 'rateLimited'],
    [apiError(500, 'internal'), 'unknown'],
    [new Error('network'), 'unknown'],
    [new StepUpCancelledError(), 'stepUpCancelled'],
  ])('maps %s to %s', (err, key) => {
    expect(casesErrorKey(err)).toBe(key);
  });

  it('has copy for every key in English', () => {
    for (const key of ['stepUpCancelled', 'forbidden', 'notFound', 'rateLimited', 'unknown']) {
      expect(t(`workspace:cases.errors.${key}`)).not.toBe(`cases.errors.${key}`);
    }
  });
});
