/**
 * Sign-in failures as `auth` namespace keys, so the screen shows translated
 * copy for every one of them (never the API's English `message`) and an
 * unknown failure still says something.
 *
 * Errors never reveal whether an address exists (CLIENT-R-18).
 */
import { ApiError } from '@nestself/api-client';
import { CognitoError } from './cognito-public-client';

export type SignInErrorKey =
  | 'error.invalidCode'
  | 'otp.expired'
  | 'lockout.body'
  | 'error.expired'
  | 'error.network'
  | 'error.ssoDenied'
  | 'error.ssoEmailUnverifiedMobile'
  | 'error.unknown';

export function signInErrorKey(err: unknown): SignInErrorKey {
  if (err instanceof CognitoError) {
    switch (err.code) {
      case 'invalid_code':
        return 'error.invalidCode';
      case 'expired_code':
        return 'otp.expired';
      case 'too_many_attempts':
        return 'lockout.body';
      case 'not_authorized':
        // Never reveal whether the email exists
        return 'error.expired';
      default:
        return 'error.unknown';
    }
  }
  if (err instanceof ApiError) {
    if (err.code === 'network' || err.status === 0) return 'error.network';
    // POST /auth/sso/bind-token refused the federated sign-in.
    if (err.code === 'sso_denied') return 'error.ssoDenied';
    // The OIDC provider did not confirm the address: confirm it once on the web.
    if (err.code === 'sso_email_unverified') return 'error.ssoEmailUnverifiedMobile';
  }
  return 'error.unknown';
}
