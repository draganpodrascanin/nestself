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
    ['an organisation that has not enabled the account (sso_denied)', apiError('sso_denied'), 'error.ssoDenied'],
    [
      'an address the OIDC provider did not confirm (sso_email_unverified)',
      apiError('sso_email_unverified'),
      'error.ssoEmailUnverifiedMobile',
    ],
    ['an unreachable server', apiError('network', 0), 'error.network'],
    ['any other API failure', apiError('unavailable', 503), 'error.unknown'],
    ['a wrong code', new CognitoError('invalid_code', 'x'), 'error.invalidCode'],
    ['an expired code', new CognitoError('expired_code', 'x'), 'otp.expired'],
    ['too many attempts', new CognitoError('too_many_attempts', 'x'), 'lockout.body'],
    ['a refused sign-in (never says whether the address exists)', new CognitoError('not_authorized', 'x'), 'error.expired'],
    ['an unknown Cognito failure', new CognitoError('unknown', 'x'), 'error.unknown'],
    ['anything else', new Error('SSO sign-in was cancelled'), 'error.unknown'],
  ])('maps %s to auth:%s', (_label, err, key) => {
    expect(signInErrorKey(err)).toBe(key);
  });

  it.each(['en', 'sr-Latn', 'sr-Cyrl', 'hu'] as const)('has the SSO refusal copy in %s', (locale) => {
    const { error } = resources[locale].auth as { error: Record<string, unknown> };
    expect(error['ssoDenied']).toEqual(expect.any(String));
    expect(error['ssoEmailUnverifiedMobile']).toEqual(expect.any(String));
  });

  it('sends a person whose address was not confirmed to the web first', () => {
    const { error } = resources.en.auth as { error: Record<string, unknown> };
    expect(error['ssoEmailUnverifiedMobile']).toBe(
      'Sign in once on the web to confirm your email address, then sign in here again.',
    );
  });
});
