/**
 * CognitoBearerVerifier: what it answers for a verified pool access token.
 * aws-jwt-verify is replaced by its verified claims; the guard reads the
 * pool `username` to tell a federated mobile user (`<provider>_<subject>`)
 * from a native one (phase 4 design 5.7).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { MemoryKeyValueStore } from '../redis/memory-key-value-store.js';
import { CognitoBearerVerifier } from './cognito-bearer-verifier.js';

const { verify, create } = vi.hoisted(() => {
  const verify = vi.fn();
  return { verify, create: vi.fn((_props: unknown) => ({ verify })) };
});
vi.mock('aws-jwt-verify', () => ({ CognitoJwtVerifier: { create } }));

const config = {
  get: (key: string) =>
    ({ COGNITO_USER_POOL_ID: 'eu-central-1_TEST', COGNITO_MOBILE_CLIENT_ID: 'mobile-client-id' })[key],
} as unknown as ConfigService;

describe('CognitoBearerVerifier', () => {
  beforeEach(() => {
    verify.mockReset();
    create.mockClear();
  });

  it("checks access tokens of the mobile client and passes the pool username of a federated user", async () => {
    verify.mockResolvedValue({ sub: 'pool-sub-1', username: 'org-acme-oidc_idp-ana', origin_jti: 'family-1', auth_time: 1_700_000_000 });

    const payload = await new CognitoBearerVerifier(config, new MemoryKeyValueStore()).verify('access-token');

    expect(create).toHaveBeenCalledWith({ userPoolId: 'eu-central-1_TEST', tokenUse: 'access', clientId: 'mobile-client-id' });
    expect(payload).toEqual({
      userId: '',
      sub: 'pool-sub-1',
      username: 'org-acme-oidc_idp-ana',
      originJti: 'family-1',
      authMethod: 'email_otp',
      authTime: 1_700_000_000,
    });
  });

  it('leaves the username out when the token carries none (or not as a string)', async () => {
    verify.mockResolvedValueOnce({ sub: 'pool-sub-1', auth_time: 1 }).mockResolvedValueOnce({ sub: 'pool-sub-1', username: 42 });
    const verifier = new CognitoBearerVerifier(config, new MemoryKeyValueStore());

    expect((await verifier.verify('a')).username).toBeUndefined();
    expect((await verifier.verify('b')).username).toBeUndefined();
  });
});
