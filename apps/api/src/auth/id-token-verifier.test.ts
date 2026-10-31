/**
 * The ID-token verifiers of `POST /auth/sso/bind-token` (phase 4 design 5.7).
 * Cognito: aws-jwt-verify against the pool's keys, the mobile client as the
 * audience, `token_use: 'id'`. Stub: the stub JWT secret, as the stub bearer
 * verifier checks access tokens, with `token_use: 'id'` required. Both answer
 * the normalised claims (`toIdTokenClaims`).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import type { ConfigService } from '@nestjs/config';
import type { Jwks } from 'aws-jwt-verify/jwk';
import { FetchError } from 'aws-jwt-verify/error';
import { SimpleFetcher } from 'aws-jwt-verify/https';
import { ApiHttpException } from '../common/api-error.js';
import { CognitoIdTokenVerifier, StubIdTokenVerifier } from './id-token-verifier.js';

const POOL_ID = 'eu-central-1_TEST';
const ISSUER = `https://cognito-idp.eu-central-1.amazonaws.com/${POOL_ID}`;
const MOBILE_CLIENT = 'mobile-client-id';
const WEB_CLIENT = 'web-client-id';
const KID = 'test-kid-1';
const PROVIDER = 'org-acme-oidc';

async function refusal(promise: Promise<unknown>): Promise<ApiHttpException> {
  const err = await promise.then(
    () => {
      throw new Error('expected the token to be refused');
    },
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ApiHttpException);
  return err as ApiHttpException;
}

async function expectRefused(promise: Promise<unknown>, status: number, code: string): Promise<void> {
  const err = await refusal(promise);
  expect(err.getStatus()).toBe(status);
  expect(err.code).toBe(code);
}

/** The claims a federated user's ID token carries (Cognito's shape). */
function federatedClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return {
    sub: 'pool-sub-1',
    token_use: 'id',
    auth_time: now - 5,
    email: 'maria@acme.example',
    email_verified: 'false',
    'cognito:username': `${PROVIDER}_idp-maria`,
    identities: [{ userId: 'idp-maria', providerName: PROVIDER, providerType: 'OIDC', primary: 'true' }],
    ...overrides,
  };
}

const NORMALISED = {
  sub: 'pool-sub-1',
  email: 'maria@acme.example',
  emailVerified: false,
  identities: [{ providerName: PROVIDER, userId: 'idp-maria' }],
  username: `${PROVIDER}_idp-maria`,
};

// ---------------------------------------------------------------------------
// Cognito
// ---------------------------------------------------------------------------

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const otherKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const { n, e } = publicKey.export({ format: 'jwk' });
const JWKS: Jwks = { keys: [{ kty: 'RSA', n: n!, e: e!, kid: KID, alg: 'RS256', use: 'sig' }] };

function signRs256(claims: Record<string, unknown>, key: KeyObject = privateKey): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: KID, typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  return `${header}.${payload}.${signer.sign(key).toString('base64url')}`;
}

function poolIdToken(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return federatedClaims({ iss: ISSUER, aud: MOBILE_CLIENT, iat: now - 5, exp: now + 900, ...overrides });
}

const config = {
  get: (key: string) => ({ COGNITO_USER_POOL_ID: POOL_ID, COGNITO_MOBILE_CLIENT_ID: MOBILE_CLIENT })[key],
} as unknown as ConfigService;

describe('CognitoIdTokenVerifier', () => {
  afterEach(() => vi.restoreAllMocks());

  it('accepts an ID token the pool issued to the mobile client and answers its normalised claims', async () => {
    const claims = poolIdToken();
    const verified = await new CognitoIdTokenVerifier(config, JWKS).verify(signRs256(claims));
    expect(verified).toEqual({ ...NORMALISED, authTime: claims['auth_time'] });
  });

  it.each([
    ['issued to the web client', () => signRs256(poolIdToken({ aud: WEB_CLIENT }))],
    ['an access token', () => signRs256(poolIdToken({ token_use: 'access' }))],
    ['signed with another key', () => signRs256(poolIdToken(), otherKeys.privateKey)],
    ['of another pool', () => signRs256(poolIdToken({ iss: 'https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_OTHER' }))],
    ['expired', () => signRs256(poolIdToken({ exp: Math.floor(Date.now() / 1000) - 60 }))],
    ['not a JWT', () => 'not-a-jwt'],
  ])('refuses a token %s with 401 unauthenticated', async (_label, token) => {
    await expectRefused(new CognitoIdTokenVerifier(config, JWKS).verify(token()), 401, 'unauthenticated');
  });

  it("answers 503 unavailable when the pool's signing keys cannot be fetched", async () => {
    vi.spyOn(SimpleFetcher.prototype, 'fetch').mockRejectedValue(new FetchError(`${ISSUER}/.well-known/jwks.json`, 'ECONNRESET'));
    // No key set pre-loaded: the verifier has to download it.
    await expectRefused(new CognitoIdTokenVerifier(config).verify(signRs256(poolIdToken())), 503, 'unavailable');
  });
});

// ---------------------------------------------------------------------------
// Stub
// ---------------------------------------------------------------------------

describe('StubIdTokenVerifier', () => {
  const SECRET = 'stub-secret-'.padEnd(40, 'x');
  const jwt = new JwtService({ secret: SECRET, signOptions: { expiresIn: '1h' } });
  const verifier = new StubIdTokenVerifier(jwt);

  it('accepts an ID token signed with the stub secret and answers its normalised claims', async () => {
    const claims = federatedClaims({ email_verified: true });
    const verified = await verifier.verify(jwt.sign(claims));
    expect(verified).toEqual({ ...NORMALISED, emailVerified: true, authTime: claims['auth_time'] });
  });

  it('keeps an absent email_verified claim absent (null), as Cognito reports an IdP that sent none', async () => {
    const { email_verified: _drop, ...claims } = federatedClaims();
    expect((await verifier.verify(jwt.sign(claims))).emailVerified).toBeNull();
  });

  it.each([
    ['an access token signed with the same secret', () => jwt.sign(federatedClaims({ token_use: 'access' }))],
    ['a token without token_use', () => jwt.sign(federatedClaims({ token_use: undefined }))],
    ['a token signed with another secret', () => new JwtService({ secret: 'z'.repeat(40) }).sign(federatedClaims())],
    [
      'an unsigned token',
      () =>
        `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.` +
        `${Buffer.from(JSON.stringify(federatedClaims())).toString('base64url')}.`,
    ],
    ['an expired token', () => jwt.sign(federatedClaims(), { expiresIn: -60 })],
  ])('refuses %s with 401 unauthenticated', async (_label, token) => {
    await expectRefused(verifier.verify(token()), 401, 'unauthenticated');
  });
});
