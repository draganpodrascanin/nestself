/**
 * Dependency-free client for the Cognito USER_POOL JSON API
 * used by PUBLIC app clients (no secret, no SigV4).
 *
 * Calls `https://cognito-idp.<region>.amazonaws.com/` with
 * `X-Amz-Target` headers. Maps Cognito error `__type` values
 * to canonical app error codes.
 *
 * @see auth-strategy.md 6.2, Appendix E.3
 */

import type { CognitoConfig } from './config';

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

export type CognitoErrorCode =
  | 'invalid_code'
  | 'expired_code'
  | 'not_authorized'
  | 'too_many_attempts'
  | 'unknown';

const ERROR_MAP: Record<string, CognitoErrorCode> = {
  CodeMismatchException: 'invalid_code',
  ExpiredCodeException: 'expired_code',
  NotAuthorizedException: 'not_authorized',
  TooManyRequestsException: 'too_many_attempts',
  LimitExceededException: 'too_many_attempts',
  // UserNotFoundException is mapped to not_authorized so the UI
  // never reveals whether an email address exists.
  UserNotFoundException: 'not_authorized',
};

export class CognitoError extends Error {
  readonly code: CognitoErrorCode;
  constructor(code: CognitoErrorCode, message: string) {
    super(message);
    this.name = 'CognitoError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export interface InitiateAuthResult {
  session: string;
  challengeName: string;
}

export interface AuthTokens {
  accessToken: string;
  idToken: string;
  refreshToken: string;
}

export interface RefreshResult {
  accessToken: string;
  idToken: string;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function endpoint(region: string): string {
  return `https://cognito-idp.${region}.amazonaws.com/`;
}

/**
 * Parse the `__type` field from a Cognito error response.
 * The value is something like "com.amazonaws.cognito.identity.idp.model#NotAuthorizedException"
 * or just "NotAuthorizedException".
 */
function extractExceptionType(raw: string): string {
  const hash = raw.lastIndexOf('#');
  return hash >= 0 ? raw.slice(hash + 1) : raw;
}

async function callCognito(
  region: string,
  target: string,
  body: Record<string, unknown>,
  fetchFn: typeof fetch,
): Promise<Record<string, unknown>> {
  const url = endpoint(region);
  const response = await fetchFn(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': `AWSCognitoIdentityProviderService.${target}`,
    },
    body: JSON.stringify(body),
  });

  const json = (await response.json()) as Record<string, unknown>;

  if (!response.ok) {
    const rawType = typeof json['__type'] === 'string' ? json['__type'] : '';
    const exceptionType = extractExceptionType(rawType);
    const message = typeof json['message'] === 'string' ? json['message'] : 'Unknown Cognito error';

    // Map NotAuthorizedException on session expiry to expired_code
    if (exceptionType === 'NotAuthorizedException' && /session/i.test(message)) {
      throw new CognitoError('expired_code', message);
    }

    const code: CognitoErrorCode = ERROR_MAP[exceptionType] ?? 'unknown';
    throw new CognitoError(code, message);
  }

  return json;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface CognitoPublicClient {
  /**
   * Start email-OTP sign-in: `InitiateAuth` with `USER_AUTH` flow
   * and `PREFERRED_CHALLENGE: EMAIL_OTP`.
   */
  initiateEmailOtp(email: string): Promise<InitiateAuthResult>;

  /**
   * Complete the email-OTP challenge: `RespondToAuthChallenge`.
   */
  respondToEmailOtp(
    session: string,
    email: string,
    code: string,
  ): Promise<AuthTokens>;

  /**
   * Exchange a refresh token for new access and id tokens.
   */
  refreshTokens(refreshToken: string): Promise<RefreshResult>;

  /**
   * Revoke a refresh token.
   */
  revokeToken(refreshToken: string): Promise<void>;

  /**
   * Global sign-out (invalidates all refresh tokens for the user).
   */
  globalSignOut(accessToken: string): Promise<void>;
}

export function createCognitoPublicClient(
  config: CognitoConfig,
  fetchFn: typeof fetch = fetch,
): CognitoPublicClient {
  const { region, clientId } = config;

  return {
    async initiateEmailOtp(email: string): Promise<InitiateAuthResult> {
      const result = await callCognito(
        region,
        'InitiateAuth',
        {
          AuthFlow: 'USER_AUTH',
          ClientId: clientId,
          AuthParameters: {
            USERNAME: email,
            PREFERRED_CHALLENGE: 'EMAIL_OTP',
          },
        },
        fetchFn,
      );
      return {
        session: result['Session'] as string,
        challengeName: result['ChallengeName'] as string,
      };
    },

    async respondToEmailOtp(
      session: string,
      email: string,
      code: string,
    ): Promise<AuthTokens> {
      const result = await callCognito(
        region,
        'RespondToAuthChallenge',
        {
          ChallengeName: 'EMAIL_OTP',
          ClientId: clientId,
          Session: session,
          ChallengeResponses: {
            USERNAME: email,
            EMAIL_OTP_CODE: code,
          },
        },
        fetchFn,
      );
      const authResult = result['AuthenticationResult'] as Record<string, unknown>;
      return {
        accessToken: authResult['AccessToken'] as string,
        idToken: authResult['IdToken'] as string,
        refreshToken: authResult['RefreshToken'] as string,
      };
    },

    async refreshTokens(refreshToken: string): Promise<RefreshResult> {
      const result = await callCognito(
        region,
        'GetTokensFromRefreshToken',
        {
          ClientId: clientId,
          RefreshToken: refreshToken,
        },
        fetchFn,
      );
      const authResult = result['AuthenticationResult'] as Record<string, unknown>;
      return {
        accessToken: authResult['AccessToken'] as string,
        idToken: authResult['IdToken'] as string,
      };
    },

    async revokeToken(refreshToken: string): Promise<void> {
      await callCognito(
        region,
        'RevokeToken',
        {
          ClientId: clientId,
          Token: refreshToken,
        },
        fetchFn,
      );
    },

    async globalSignOut(accessToken: string): Promise<void> {
      await callCognito(
        region,
        'GlobalSignOut',
        {
          AccessToken: accessToken,
        },
        fetchFn,
      );
    },
  };
}
