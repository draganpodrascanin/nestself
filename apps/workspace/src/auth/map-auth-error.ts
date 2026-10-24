/**
 * Maps an API error to a user-facing message string.
 *
 * Used by every sign-in step screen so API errors surface in the
 * screen's own FormErrorSummary (CLIENT-R-35).
 */
import { ApiError } from '@nestself/api-client';
import type { TFunction } from 'i18next';

export interface MappedError {
  message: string;
  /** True when the error is a 429 rate-limit. */
  isLockout: boolean;
  /** Seconds until the lockout expires (from `details.retryAfter`). */
  retryAfter?: number;
}

export function mapAuthError(err: unknown, t: TFunction<'auth'>): MappedError {
  if (err instanceof ApiError) {
    if (err.status === 429) {
      const retryAfter = err.details?.retryAfter as number | undefined;
      return {
        message: retryAfter
          ? t('lockout.retryAfter', { minutes: Math.ceil(retryAfter / 60) })
          : t('lockout.body'),
        isLockout: true,
        retryAfter,
      };
    }
    if (err.code === 'invalid_code' || err.code === 'expired_code') {
      return { message: t('error.invalidCode'), isLockout: false };
    }
    // The challenge expired or its three attempts are spent: ask for a new code.
    if (err.code === 'invalid_challenge') {
      return { message: t('error.challengeExpired'), isLockout: false };
    }
    if (err.code === 'invalid_credentials') {
      return { message: t('error.invalidCredentials'), isLockout: false };
    }
    if (err.code === 'network') {
      return { message: t('error.network'), isLockout: false };
    }
    // Never the API's own message: it is English and written for developers.
    return { message: t('error.unknown'), isLockout: false };
  }
  return { message: t('error.unknown'), isLockout: false };
}
