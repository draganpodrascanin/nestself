import { describe, it, expect } from 'vitest';
import { ApiError } from '@nestself/api-client';
import { resources } from '@nestself/i18n';
import { CognitoError } from './cognito-public-client';
import { signInErrorKey } from './sign-in-error';

function apiError(code: string, status = 403): ApiError {
  return new ApiError({ status, code, message: 'English text for developers', requestId: null });
}

describe('signInErrorKey', () => {
  it.each([
    ['an organisation that has not enabled the account (sso_denied)', 'error.ssoDenied', apiError('sso_denied')],
    [
      'an address the OIDC provider did not confirm (sso_email_unverified)',
      'error.ssoEmailUnverifiedMobile',
      apiError('sso_email_unverified'),
    ],
    ['an unreachable server', 'error.network', apiError('network', 0)],
    ['the sign-in throttle of the network (rate_limited)', 'error.ssoRateLimited', apiError('rate_limited', 429)],
    ['a sign-in service that is not responding (unavailable)', 'error.unavailable', apiError('unavailable', 503)],
    ['any other API failure', 'error.unknown', apiError('validation', 400)],
    ['a wrong code', 'error.invalidCode', new CognitoError('invalid_code', 'x')],
    ['an expired code', 'otp.expired', new CognitoError('expired_code', 'x')],
    ['too many attempts', 'lockout.body', new CognitoError('too_many_attempts', 'x')],
    ['a refused sign-in (never says whether the address exists)', 'error.expired', new CognitoError('not_authorized', 'x')],
    ['an unknown Cognito failure', 'error.unknown', new CognitoError('unknown', 'x')],
    ['anything else', 'error.unknown', new Error('SSO sign-in was cancelled')],
  ])('maps %s to auth:%s', (_label, key, err) => {
    expect(signInErrorKey(err)).toBe(key);
  });

  it.each(['en', 'sr-Latn', 'sr-Cyrl', 'hu'] as const)('has the copy of the API failures in %s', (locale) => {
    const { error } = resources[locale].auth as { error: Record<string, unknown> };
    for (const key of ['ssoDenied', 'ssoEmailUnverifiedMobile', 'ssoRateLimited', 'unavailable']) {
      expect(error[key]).toEqual(expect.any(String));
    }
  });

  it('sends a person whose address was not confirmed to the web first', () => {
    const { error } = resources.en.auth as { error: Record<string, unknown> };
    expect(error['ssoEmailUnverifiedMobile']).toBe(
      'Sign in once on the web to confirm your email address, then sign in here again.',
    );
  });
});
