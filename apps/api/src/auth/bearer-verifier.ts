/**
 * BearerVerifier interface and DI token.
 *
 * @see D-36, AUTHZ-R-63, AUTHZ-R-64
 */

/** Result of a successful bearer token verification. */
export interface BearerPayload {
  userId: string;
  sub: string;
  originJti: string | null;
  authMethod: 'email_otp' | 'sso';
  authTime: number;
  email?: string;
}

/** Injection token for the active BearerVerifier. */
export const BEARER_VERIFIER = Symbol('BEARER_VERIFIER');

/** Abstract bearer token verifier. */
export interface BearerVerifier {
  /**
   * Verify a bearer token and return the payload.
   * Throws on invalid, expired, or revoked tokens.
   */
  verify(token: string): Promise<BearerPayload>;
}
