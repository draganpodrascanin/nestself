/**
 * Shared helpers for the Cognito identity provider adapter.
 *
 * Extracted to keep cognito-identity-provider.ts under the ~400 line limit.
 */
import type { AuthOutcome } from './identity-provider.service.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CognitoAuthResult {
  ChallengeName?: string;
  Session?: string;
  ChallengeParameters?: Record<string, string>;
  AuthenticationResult?: {
    AccessToken?: string;
    IdToken?: string;
    RefreshToken?: string;
    ExpiresIn?: number;
  };
}

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

/**
 * Map a Cognito auth/challenge response into the domain AuthOutcome type.
 */
export function parseAuthResult(
  result: CognitoAuthResult,
  username: string,
): AuthOutcome {
  if (result.AuthenticationResult) {
    const ar = result.AuthenticationResult;
    return {
      kind: 'tokens',
      tokens: {
        accessToken: ar.AccessToken!,
        idToken: ar.IdToken!,
        refreshToken: ar.RefreshToken ?? null,
        expiresIn: ar.ExpiresIn ?? 3600,
      },
    };
  }

  return {
    kind: 'challenge',
    challenge: result.ChallengeName as
      | 'EMAIL_OTP'
      | 'SOFTWARE_TOKEN_MFA'
      | 'NEW_PASSWORD_REQUIRED'
      | 'MFA_SETUP',
    session: result.Session ?? '',
    username:
      result.ChallengeParameters?.['USER_ID_FOR_SRP'] ?? username,
  };
}

/**
 * Extract a named attribute from a Cognito user's attribute list.
 */
export function getUserAttr(
  attrs: Array<{ Name?: string; Value?: string }> | undefined,
  name: string,
): string | null {
  return attrs?.find((a) => a.Name === name)?.Value ?? null;
}
