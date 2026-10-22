/**
 * Maps AWS Cognito SDK exceptions to IdentityProviderError codes.
 *
 * Split into its own file to keep cognito-identity-provider.ts under 400 lines.
 *
 * @see D-05, 5.9 Error semantics
 */
import { IdentityProviderError } from './identity-provider.service.js';
import type { IdentityProviderErrorCode } from './identity-provider.service.js';

interface AwsSdkError {
  name?: string;
  message?: string;
  $metadata?: { httpStatusCode?: number };
}

const EXCEPTION_MAP: Record<string, { code: IdentityProviderErrorCode; retryable: boolean }> = {
  CodeMismatchException: { code: 'invalid_code', retryable: false },
  ExpiredCodeException: { code: 'expired_session', retryable: false },
  UserNotFoundException: { code: 'user_not_found', retryable: false },
  UserNotConfirmedException: { code: 'not_authorized', retryable: false },
  TooManyRequestsException: { code: 'too_many_attempts', retryable: true },
  LimitExceededException: { code: 'too_many_attempts', retryable: true },
  InvalidPasswordException: { code: 'password_policy', retryable: false },
  EnableSoftwareTokenMFAException: { code: 'totp_already_enrolled', retryable: false },
  InvalidParameterException: { code: 'not_authorized', retryable: false },
  PasswordResetRequiredException: { code: 'not_authorized', retryable: false },
};

/**
 * Wrap and rethrow a Cognito SDK error as an IdentityProviderError.
 *
 * `NotAuthorizedException` maps differently depending on context:
 * during authentication flows it means invalid credentials; otherwise
 * it is a generic "not authorized" error.
 */
export function mapCognitoError(
  err: unknown,
  context: 'auth' | 'other' = 'other',
): never {
  const sdkErr = err as AwsSdkError;
  const name = sdkErr.name ?? '';
  const message = sdkErr.message ?? 'Unknown Cognito error';

  if (name === 'NotAuthorizedException') {
    const code: IdentityProviderErrorCode =
      context === 'auth' ? 'invalid_credentials' : 'not_authorized';
    throw new IdentityProviderError(message, code, false);
  }

  if (name === 'UserDisabledException') {
    throw new IdentityProviderError(message, 'user_disabled', false);
  }

  const mapped = EXCEPTION_MAP[name];
  if (mapped) {
    throw new IdentityProviderError(message, mapped.code, mapped.retryable);
  }

  throw new IdentityProviderError(message, 'unavailable', true);
}
