import { describe, expect, it } from 'vitest';
import { ApiError } from '@nestself/api-client';
import { shouldRetryQuery } from './query-retry';

const apiError = (status: number) =>
  new ApiError({ status, code: 'x', message: 'English x', requestId: null });

describe('shouldRetryQuery', () => {
  it.each([400, 401, 403, 404, 409, 429])('never retries an API %i', (status) => {
    expect(shouldRetryQuery(0, apiError(status))).toBe(false);
  });

  it('retries a 5xx API failure up to three times', () => {
    expect(shouldRetryQuery(0, apiError(500))).toBe(true);
    expect(shouldRetryQuery(2, apiError(503))).toBe(true);
    expect(shouldRetryQuery(3, apiError(500))).toBe(false);
  });

  it('retries network and other errors up to three times', () => {
    expect(shouldRetryQuery(0, new TypeError('Failed to fetch'))).toBe(true);
    expect(shouldRetryQuery(3, new TypeError('Failed to fetch'))).toBe(false);
  });
});
