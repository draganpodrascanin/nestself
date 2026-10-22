/**
 * Abstract identity provider interface and supporting types.
 *
 * The abstract class serves as both the interface contract and
 * the NestJS DI token (D-12, T-1.15).
 *
 * @see D-12, T-1.15, 3.5.3 Cognito API operations
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TokenSet {
  accessToken: string;
  idToken: string;
  refreshToken: string | null;
  expiresIn: number;
}

export type AuthOutcome =
  | { kind: 'tokens'; tokens: TokenSet }
  | {
      kind: 'challenge';
      challenge:
        | 'EMAIL_OTP'
        | 'SOFTWARE_TOKEN_MFA'
        | 'NEW_PASSWORD_REQUIRED'
        | 'MFA_SETUP';
      session: string;
      username: string;
    };

export interface IdpUser {
  username: string;
  sub: string;
  email: string;
  emailVerified: boolean;
  enabled: boolean;
  status: string;
  hasPassword: boolean | null;
  mfaEnrolled: boolean | null;
  locale: string | null;
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export type IdentityProviderErrorCode =
  | 'invalid_code'
  | 'invalid_credentials'
  | 'expired_session'
  | 'too_many_attempts'
  | 'user_not_found'
  | 'user_disabled'
  | 'not_authorized'
  | 'password_policy'
  | 'totp_already_enrolled'
  | 'unavailable';

export class IdentityProviderError extends Error {
  constructor(
    message: string,
    public readonly code: IdentityProviderErrorCode,
    public readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = 'IdentityProviderError';
  }
}

// ---------------------------------------------------------------------------
// JWT claims (unverified decode)
// ---------------------------------------------------------------------------

export interface JwtClaims {
  sub?: string;
  exp?: number;
  iat?: number;
  jti?: string;
  origin_jti?: string;
  client_id?: string;
  username?: string;
  token_use?: string;
  email?: string;
  email_verified?: boolean;
  auth_time?: number;
}

/**
 * Base64url-decode the JWT payload WITHOUT verification.
 * Used only to read `exp`/`sub` from tokens the API itself received from Cognito.
 */
export function decodeJwtClaims(token: string): JwtClaims {
  const parts = token.split('.');
  if (parts.length < 2) return {};
  const payload = parts[1]!;
  const json = Buffer.from(payload, 'base64url').toString('utf8');
  try {
    return JSON.parse(json) as JwtClaims;
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Abstract service (NestJS DI token)
// ---------------------------------------------------------------------------

/**
 * Identity provider abstraction. Cognito adapter in production,
 * fake in-memory provider for local development and tests.
 *
 * @see D-12, T-1.15
 */
export abstract class IdentityProviderService {
  /**
   * Start email OTP sign-in (USER_AUTH, PREFERRED_CHALLENGE EMAIL_OTP).
   * Returns null when the user does not exist so the caller can run
   * the neutral dummy path (SESS-R-21).
   */
  abstract startEmailOtp(input: {
    email: string;
    locale?: string;
  }): Promise<{ session: string; username: string } | null>;

  /** Respond to the EMAIL_OTP challenge. */
  abstract respondEmailOtp(input: {
    session: string;
    username: string;
    code: string;
  }): Promise<AuthOutcome>;

  /** Password sign-in (ADMIN_USER_PASSWORD_AUTH). */
  abstract startPassword(input: {
    email: string;
    password: string;
  }): Promise<AuthOutcome>;

  /** Respond to SOFTWARE_TOKEN_MFA challenge. */
  abstract respondTotp(input: {
    session: string;
    username: string;
    code: string;
  }): Promise<AuthOutcome>;

  /** Respond to NEW_PASSWORD_REQUIRED challenge. */
  abstract respondNewPassword(input: {
    session: string;
    username: string;
    newPassword: string;
  }): Promise<AuthOutcome>;

  /** Complete MFA_SETUP challenge after TOTP verification. */
  abstract completeMfaSetup(input: {
    session: string;
    username: string;
  }): Promise<AuthOutcome>;

  /** Associate a software token for TOTP enrolment. */
  abstract associateSoftwareToken(input: {
    session?: string;
    accessToken?: string;
  }): Promise<{ secretCode: string; session?: string }>;

  /** Verify the TOTP code during enrolment. */
  abstract verifySoftwareToken(input: {
    session?: string;
    accessToken?: string;
    code: string;
    friendlyDeviceName?: string;
  }): Promise<{ session?: string }>;

  /** Set TOTP as the preferred MFA method. */
  abstract setTotpPreferred(input: { accessToken: string }): Promise<void>;

  /**
   * Refresh tokens via GetTokensFromRefreshToken.
   * The response may omit a new refresh token when rotation is off:
   * the caller keeps the old one.
   */
  abstract refresh(input: {
    refreshToken: string;
    username?: string;
  }): Promise<TokenSet>;

  /** Revoke a single refresh token. */
  abstract revokeRefreshToken(refreshToken: string): Promise<void>;

  /** Global sign-out: revoke all refresh tokens for the user. */
  abstract globalSignOut(username: string): Promise<void>;

  /** Disable a Cognito user. */
  abstract disableUser(username: string): Promise<void>;

  /** Enable a Cognito user. */
  abstract enableUser(username: string): Promise<void>;

  /** Create a new Cognito user. */
  abstract createUser(input: {
    email: string;
    locale: string;
    emailVerified: boolean;
    temporaryPassword?: string;
    suppressMessage: boolean;
  }): Promise<{ username: string; sub: string }>;

  /** Delete a Cognito user. */
  abstract deleteUser(username: string): Promise<void>;

  /** Find a user by email. Returns null if not found. */
  abstract findUserByEmail(email: string): Promise<IdpUser | null>;

  /** Initiate a forgot-password flow (sends code via Cognito). */
  abstract forgotPassword(email: string): Promise<void>;

  /** Confirm a forgot-password flow with the code and new password. */
  abstract confirmForgotPassword(input: {
    email: string;
    code: string;
    newPassword: string;
  }): Promise<void>;
}
