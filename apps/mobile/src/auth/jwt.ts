/**
 * Minimal JWT payload decoder for reading claims from Cognito tokens.
 *
 * This does NOT verify signatures or validate the token. It only
 * base64url-decodes the payload segment so the app can read `exp`,
 * `origin_jti`, `jti` etc. without a crypto dependency.
 */

export interface JwtClaims {
  readonly exp?: number;
  readonly iat?: number;
  readonly jti?: string;
  readonly origin_jti?: string;
  readonly sub?: string;
  readonly token_use?: string;
  readonly [key: string]: unknown;
}

/**
 * Decode the payload of a JWT without verification.
 * Returns `null` if the token is malformed.
 */
export function decodeJwtClaims(token: string): JwtClaims | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1]!;

    // base64url -> base64
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    // Pad to a multiple of 4
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);

    const decoded = atob(padded);
    return JSON.parse(decoded) as JwtClaims;
  } catch {
    return null;
  }
}
