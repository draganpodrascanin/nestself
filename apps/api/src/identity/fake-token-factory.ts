/**
 * Token factory for the FakeIdentityProvider.
 *
 * Generates JWT-shaped strings signed with HS256 using a random per-process
 * key. Nobody verifies these tokens; they are realistic enough for
 * integration tests and local development.
 */
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { TokenSet } from './identity-provider.service.js';

const SIGNING_KEY = randomBytes(32);

function base64url(buf: Buffer): string {
  return buf.toString('base64url');
}

function signHs256(headerPayload: string): string {
  return base64url(
    createHmac('sha256', SIGNING_KEY).update(headerPayload).digest(),
  );
}

function buildJwt(claims: Record<string, unknown>): string {
  const header = base64url(
    Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })),
  );
  const payload = base64url(Buffer.from(JSON.stringify(claims)));
  const headerPayload = `${header}.${payload}`;
  return `${headerPayload}.${signHs256(headerPayload)}`;
}

/**
 * Create a realistic-looking TokenSet for local development.
 *
 * @param sub       The user's sub (UUID).
 * @param username  The Cognito username.
 * @param originJti An optional origin JTI for refresh token families.
 * @param idClaims  Extra ID-token claims (federated sign-in: email, identities).
 */
export function createFakeTokenSet(
  sub: string,
  username: string,
  originJti?: string,
  idClaims: Record<string, unknown> = {},
): TokenSet {
  const now = Math.floor(Date.now() / 1000);
  const jti = randomUUID();
  const oJti = originJti ?? jti;

  const accessToken = buildJwt({
    sub,
    username,
    jti,
    origin_jti: oJti,
    token_use: 'access',
    client_id: 'fake-web',
    iat: now,
    exp: now + 900, // 15 min
    auth_time: now,
  });

  const idToken = buildJwt({
    sub,
    username,
    token_use: 'id',
    client_id: 'fake-web',
    iat: now,
    exp: now + 900,
    auth_time: now,
    email: username, // simplification; real ID tokens carry email
    email_verified: true,
    'cognito:username': username,
    ...idClaims,
  });

  const refreshToken = `fake-refresh-${randomUUID()}`;

  return {
    accessToken,
    idToken,
    refreshToken,
    expiresIn: 900,
  };
}
