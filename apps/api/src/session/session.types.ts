/**
 * Session record types per 3.6.1.
 *
 * @see SESS-R-09, SESS-R-10, D-06
 */
import type { Population, ActiveContext } from '@nestself/contracts';

/** How the user authenticated. */
export type AuthMethod = 'email_otp' | 'password_totp' | 'sso' | 'passkey';

/** Authentication metadata stored in the session record. */
export interface SessionAuth {
  method: AuthMethod;
  /** ISO 8601 timestamp of the IdP's auth_time or the API's authentication timestamp. */
  time: string;
  /** Whether a second factor was presented. */
  secondFactor: boolean;
}

/**
 * Cognito tokens stored in the session record.
 * `accessToken`, `idToken` and `refreshToken` are AES-256-GCM encrypted at rest.
 *
 * @see SESS-R-09
 */
export interface CognitoSession {
  username: string;
  accessToken: string;
  idToken: string;
  refreshToken: string;
  /** ISO 8601 timestamp of access token expiry. */
  accessExpiresAt: string;
}

/**
 * Full session record stored in Redis as JSON at `session:{sha256(sessionId)}`.
 * Record size is approximately 1 KB.
 *
 * @see 3.6.1 Session record
 */
export interface SessionRecord {
  sessionId: string;
  userId: string;
  surface: 'workspace' | 'admin';
  population: Population;
  context: ActiveContext;
  cognito: CognitoSession;
  auth: SessionAuth;
  lastStepUpAt: string | null;
  createdAt: string;
  lastActivityAt: string;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
  rememberDevice: boolean;
  ipHash: string;
  userAgentFamily: string;
  csrfToken: string;
}

/** Input for creating a new session. */
export interface CreateSessionInput {
  userId: string;
  surface: 'workspace' | 'admin';
  population: Population;
  context: ActiveContext;
  cognitoUsername: string;
  tokens: {
    accessToken: string;
    idToken: string;
    refreshToken: string;
    expiresIn: number;
  };
  auth: SessionAuth;
  rememberDevice: boolean;
  ip: string | null;
  userAgent: string | null;
}
