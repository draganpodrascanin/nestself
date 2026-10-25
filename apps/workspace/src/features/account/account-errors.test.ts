import { describe, it, expect } from 'vitest';
import { ApiError } from '@nestself/api-client';
import { accountErrorKey } from './account-errors';

const err = (status: number, code: string) =>
  new ApiError({ status, code, message: `English ${code}`, requestId: null });

describe('accountErrorKey', () => {
  it.each([
    [err(503, 'unavailable'), 'auth:error.unavailable'],
    [err(0, 'network'), 'auth:error.network'],
    [err(400, 'invalid_code'), 'auth:error.invalidCode'],
    [err(400, 'expired_code'), 'auth:error.invalidCode'],
    [err(401, 'unauthenticated'), 'auth:error.expired'],
    [err(401, 'session_required'), 'auth:error.expired'],
    [err(429, 'rate_limited'), 'auth:account.errors.rateLimited'],
    [err(429, 'anything'), 'auth:account.errors.rateLimited'],
    [err(400, 'validation'), 'auth:account.errors.validation'],
    [err(404, 'not_found'), 'auth:account.errors.sessionNotFound'],
    [err(409, 'totp_already_enrolled'), 'auth:account.errors.alreadyEnrolled'],
    [err(503, 'something_new'), 'auth:error.unavailable'],
    [err(500, 'internal'), 'auth:error.unknown'],
    [new Error('boom'), 'auth:error.unknown'],
  ])('maps %o to %s', (input, key) => {
    expect(accountErrorKey(input)).toBe(key);
  });
});
