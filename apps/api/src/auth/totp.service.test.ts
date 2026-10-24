/**
 * TotpService unit tests: the sign-in path needs its challenge; the
 * signed-in path refuses users who already have an authenticator.
 */
import { describe, it, expect, vi } from 'vitest';
import { ApiHttpException } from '../common/api-error.js';
import { TotpService } from './totp.service.js';

function setup(opts: { mfaEnrolled?: boolean | null; challenge?: unknown } = {}) {
  const idp = {
    associateSoftwareToken: vi.fn().mockResolvedValue({ secretCode: 'ABCDEF', session: 'idp-session-2' }),
    findUserByEmail: vi.fn().mockResolvedValue({ email: 'a@example.com', mfaEnrolled: opts.mfaEnrolled ?? false }),
  };
  const challengeStore = {
    consume: vi.fn().mockResolvedValue(opts.challenge ?? null),
    create: vi.fn().mockResolvedValue('next-token'),
  };
  const identities = { findUserById: vi.fn().mockResolvedValue({ id: 'user_a', email: 'a@example.com' }) };
  const service = new TotpService(idp as never, challengeStore as never, identities as never);
  return { idp, challengeStore, identities, service };
}

async function error(p: Promise<unknown>): Promise<ApiHttpException> {
  const err = await p.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(ApiHttpException);
  return err as ApiHttpException;
}

const PRINCIPAL = { userId: 'user_a', auth: { secondFactor: false } };

describe('TotpService', () => {
  it('totpEnrol consumes a totp_enrol challenge and re-issues it', async () => {
    const ctx = setup({ challenge: { kind: 'totp_enrol', session: 'idp-session', email: 'a@example.com' } });
    const res = await ctx.service.totpEnrol('tok');
    expect(ctx.idp.associateSoftwareToken).toHaveBeenCalledWith({ session: 'idp-session' });
    expect(res.challengeToken).toBe('next-token');
    expect(res.secretUri).toContain('secret=ABCDEF');
  });

  it('totpEnrol answers 401 invalid_challenge for an unknown token', async () => {
    const ctx = setup();
    const err = await error(ctx.service.totpEnrol('nope'));
    expect(err.getStatus()).toBe(401);
    expect(ctx.idp.associateSoftwareToken).not.toHaveBeenCalled();
  });

  it('totpEnrolSignedIn associates with the access token when no authenticator exists', async () => {
    const ctx = setup({ mfaEnrolled: false });
    const res = await ctx.service.totpEnrolSignedIn(PRINCIPAL, 'access');
    expect(ctx.idp.findUserByEmail).toHaveBeenCalledWith('a@example.com');
    expect(ctx.idp.associateSoftwareToken).toHaveBeenCalledWith({ accessToken: 'access' });
    expect(res).toEqual({ secretUri: expect.stringContaining('secret=ABCDEF'), challengeToken: null });
  });

  it('totpEnrolSignedIn refuses with 409 totp_already_enrolled when the IdP reports a factor', async () => {
    const ctx = setup({ mfaEnrolled: true });
    const err = await error(ctx.service.totpEnrolSignedIn(PRINCIPAL, 'access'));
    expect(err.getStatus()).toBe(409);
    expect(err.code).toBe('totp_already_enrolled');
    expect(ctx.idp.associateSoftwareToken).not.toHaveBeenCalled();
  });

  it('totpEnrolSignedIn refuses when the session itself was authenticated with a second factor', async () => {
    const ctx = setup({ mfaEnrolled: null });
    const err = await error(ctx.service.totpEnrolSignedIn({ userId: 'user_a', auth: { secondFactor: true } }, 'access'));
    expect(err.getStatus()).toBe(409);
    expect(ctx.idp.associateSoftwareToken).not.toHaveBeenCalled();
  });

  it('totpEnrolSignedIn without an access token is 401 session_required', async () => {
    const ctx = setup();
    const err = await error(ctx.service.totpEnrolSignedIn(PRINCIPAL, undefined));
    expect(err.getStatus()).toBe(401);
  });
});
