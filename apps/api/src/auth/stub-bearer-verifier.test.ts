/**
 * StubBearerVerifier (AUTH_MODE=stub): tokens signed with the stub JWT
 * secret. It passes the pool `username` on, as the Cognito verifier does, so
 * the guard resolves a federated bearer the same way in both modes.
 */
import { describe, it, expect } from 'vitest';
import { JwtService } from '@nestjs/jwt';
import { StubBearerVerifier } from './stub-bearer-verifier.js';

const jwt = new JwtService({ secret: 'stub-jwt-secret-'.padEnd(40, 'x'), signOptions: { expiresIn: '1h' } });
const verifier = new StubBearerVerifier(jwt);

describe('StubBearerVerifier', () => {
  it('passes the username claim on', async () => {
    const payload = await verifier.verify(jwt.sign({ sub: 'pool-sub-1', username: 'org-acme-oidc_idp-ana' }));
    expect(payload).toMatchObject({ userId: 'pool-sub-1', sub: 'pool-sub-1', username: 'org-acme-oidc_idp-ana' });
  });

  it('leaves the username out when the token carries none (or not as a string)', async () => {
    expect((await verifier.verify(jwt.sign({ userId: 'user_nikola' }))).username).toBeUndefined();
    expect((await verifier.verify(jwt.sign({ userId: 'user_nikola', username: ['x'] }))).username).toBeUndefined();
  });
});
