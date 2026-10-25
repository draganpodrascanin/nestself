/**
 * Maps a failed account or security call to a translation key in the `auth`
 * namespace. The API's own `message` is English and meant for developers, so
 * it is never rendered; an unknown code still gets `error.unknown`.
 */
import { ApiError } from '@nestself/api-client';

export type AccountErrorKey =
  | 'auth:error.unknown'
  | 'auth:error.unavailable'
  | 'auth:error.network'
  | 'auth:error.invalidCode'
  | 'auth:error.expired'
  | 'auth:account.errors.rateLimited'
  | 'auth:account.errors.validation'
  | 'auth:account.errors.sessionNotFound'
  | 'auth:account.errors.alreadyEnrolled';

const BY_CODE: Record<string, AccountErrorKey> = {
  unavailable: 'auth:error.unavailable',
  network: 'auth:error.network',
  invalid_code: 'auth:error.invalidCode',
  expired_code: 'auth:error.invalidCode',
  unauthenticated: 'auth:error.expired',
  session_expired: 'auth:error.expired',
  session_required: 'auth:error.expired',
  rate_limited: 'auth:account.errors.rateLimited',
  too_many_attempts: 'auth:account.errors.rateLimited',
  validation: 'auth:account.errors.validation',
  not_found: 'auth:account.errors.sessionNotFound',
  totp_already_enrolled: 'auth:account.errors.alreadyEnrolled',
};

export function accountErrorKey(err: unknown): AccountErrorKey {
  if (err instanceof ApiError) {
    if (err.status === 429) return 'auth:account.errors.rateLimited';
    const mapped = BY_CODE[err.code];
    if (mapped) return mapped;
    if (err.status === 503) return 'auth:error.unavailable';
  }
  return 'auth:error.unknown';
}
