import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { oneTimeCode } from '../mailer/mailer.js';
import { Logger } from '@nestjs/common';
import { StepUpService } from './step-up.service.js';
import { MAX_EMAIL_OTP_ATTEMPTS } from './sign-in.service.js';
import { IdentityProviderError } from '../identity/identity-provider.service.js';
import { IdentityResolutionService } from './identity-resolution.service.js';
import { ChallengeStore, type ChallengeRecord } from './challenge-store.js';
import { NestselfOtpService } from './nestself-otp.service.js';
import { StepUpThrottle } from './step-up-throttle.js';
import { LoggingMailer } from '../mailer/logging-mailer.js';
import { MemoryKeyValueStore } from '../redis/memory-key-value-store.js';
import { hashSessionId } from '../session/session-helpers.js';
import type { ExternalIdentityRow } from '../db/repositories/identity.repository.js';
import type { Principal } from '@nestself/contracts';

const NOW = new Date('2026-10-31T10:00:00Z');

const SESSION_PRINCIPAL = {
  userId: 'user-1',
  displayName: 'Ivana Test',
  initials: 'IT',
  locale: 'sr-Latn',
  memberships: [],
  staffTemplates: [],
  expert: null,
  context: { kind: 'personal' as const },
  auth: {
    method: 'email_otp' as const,
    time: new Date(NOW.getTime() - 40 * 60_000).toISOString(),
    secondFactor: false,
    lastStepUpAt: null,
  },
  sessionId: 'sess-1',
  tokenFamily: null,
};
const BEARER_PRINCIPAL = { ...SESSION_PRINCIPAL, sessionId: null, tokenFamily: 'family-1' };
const OTHER_PRINCIPAL = { ...SESSION_PRINCIPAL, userId: 'user-2', sessionId: 'sess-2' };
const META = { ip: '203.0.113.1', userAgent: 'test' };

const STEP_UP_CHALLENGE: ChallengeRecord = {
  kind: 'email_otp',
  username: 'cognito-user-1',
  email: 'user-1@example.com',
  session: 'idp-session',
  surface: 'workspace',
  stepUp: { userId: 'user-1' },
};

const ABSOLUTE = new Date(NOW.getTime() + 3_600_000);

const NATIVE: ExternalIdentityRow = {
  id: 'ei-native',
  userId: 'user-1',
  provider: 'cognito',
  subject: 'sub-native',
  cognitoUsername: 'cognito-user-1',
  email: 'user-1@example.com',
  emailVerified: true,
  ssoConnectionId: null,
  lastSeenAt: null,
  createdAt: new Date('2026-09-01T00:00:00Z'),
};

function federated(overrides: Partial<ExternalIdentityRow> = {}): ExternalIdentityRow {
  return {
    id: 'ei-federated',
    userId: 'user-1',
    provider: 'cognito:org-acme-saml',
    subject: 'sub-federated',
    cognitoUsername: 'org-acme-saml_sub-federated',
    email: 'ivana@acme.example',
    emailVerified: true,
    ssoConnectionId: 'conn-acme',
    lastSeenAt: new Date('2026-10-30T09:00:00Z'),
    createdAt: new Date('2026-10-01T00:00:00Z'),
    ...overrides,
  };
}

/** Connections by id, as `SsoRepository.findConnection` answers (only `status` is read). */
const CONNECTIONS: Record<string, { id: string; orgId: string; status: string; domains: [] }> = {
  'conn-acme': { id: 'conn-acme', orgId: 'org-1', status: 'ACTIVE', domains: [] },
  'conn-old': { id: 'conn-old', orgId: 'org-1', status: 'SUSPENDED', domains: [] },
};

function setup() {
  const store = new MemoryKeyValueStore();
  const mailer = new LoggingMailer({ keepSent: true });
  const config = { get: (_key: string, fallback?: string) => fallback };
  const challenges = new ChallengeStore(store);
  const otp = new NestselfOtpService(store, mailer, config as never);
  const throttle = new StepUpThrottle(store);
  const idp = {
    startEmailOtp: vi.fn().mockResolvedValue({ session: 'idp-session', username: 'cognito-user-1' }),
    respondEmailOtp: vi.fn().mockResolvedValue({
      kind: 'tokens',
      tokens: { accessToken: 'a', idToken: 'i', refreshToken: 'throwaway-refresh', expiresIn: 3600 },
    }),
    revokeRefreshToken: vi.fn().mockResolvedValue(undefined),
  };
  const sessions = {
    markStepUp: vi.fn().mockResolvedValue(undefined),
    regenerate: vi.fn().mockResolvedValue({ sessionId: 'sess-new', csrfToken: 'csrf-new' }),
    get: vi.fn().mockResolvedValue({ absoluteExpiresAt: ABSOLUTE.toISOString() }),
  };
  const identities = { findExternalIdentitiesForUser: vi.fn().mockResolvedValue([NATIVE]) };
  const sso = { findConnection: vi.fn(async (id: string) => CONNECTIONS[id] ?? null) };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new StepUpService(
    idp as never,
    challenges,
    sessions as never,
    identities as never,
    // Real error mapping; its collaborators are unused by mapIdpError.
    new IdentityResolutionService({} as never, {} as never, {} as never, {} as never, {} as never, {} as never),
    audit as never,
    store,
    otp,
    throttle,
    sso as never,
  );
  return { service, store, mailer, challenges, otp, throttle, idp, sessions, identities, sso, audit };
}

type Ctx = ReturnType<typeof setup>;

/** The code of the latest NestSelf mail. */
const mailedCode = (ctx: Ctx): string => oneTimeCode(ctx.mailer.sent.at(-1)!);

/** A code that is not `code`. */
const wrongCode = (code: string): string => code.slice(0, -1) + (code.endsWith('0') ? '1' : '0');

const cognitoWrongCode = (ctx: Ctx) =>
  ctx.idp.respondEmailOtp.mockRejectedValueOnce(new IdentityProviderError('bad code', 'invalid_code'));

/** A federated principal's NestSelf challenge: the token and the mailed code. */
async function startNestself(ctx: Ctx, principal: Principal = SESSION_PRINCIPAL): Promise<{ token: string; code: string }> {
  ctx.identities.findExternalIdentitiesForUser.mockResolvedValueOnce([
    federated({ userId: principal.userId, email: `${principal.userId}@acme.example` }),
  ]);
  const { challengeToken } = await ctx.service.start(principal, META, 'workspace');
  return { token: challengeToken, code: mailedCode(ctx) };
}

const secondsLater = (seconds: number): void => {
  vi.advanceTimersByTime(seconds * 1000);
};

describe('StepUpService', () => {
  let ctx: Ctx;

  beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
    // The logging mailer says what it "sent" at debug level; the tests read `mailer.sent`.
    vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    ctx = setup();
  });

  afterEach(async () => {
    await ctx.store.close();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('start', () => {
    it('native start passes the principal locale and binds the challenge to the user', async () => {
      const result = await ctx.service.start({ ...SESSION_PRINCIPAL, locale: 'hu' }, META, 'workspace');

      expect(ctx.idp.startEmailOtp).toHaveBeenCalledWith({ email: 'user-1@example.com', locale: 'hu' });
      expect(result).toEqual({
        method: 'email_otp',
        challengeToken: expect.any(String),
        ssoStartUrl: null,
        emailMasked: 'u***@example.com',
      });
      expect(await ctx.challenges.consume(result.challengeToken)).toMatchObject({
        kind: 'email_otp',
        username: 'cognito-user-1',
        email: 'user-1@example.com',
        session: 'idp-session',
        surface: 'workspace',
        stepUp: { userId: 'user-1' },
      });
      expect(ctx.mailer.sent).toEqual([]);
    });

    it('a principal locale outside the four falls back to sr-Latn', async () => {
      await ctx.service.start({ ...SESSION_PRINCIPAL, locale: 'de' }, META, 'workspace');
      expect(ctx.idp.startEmailOtp).toHaveBeenCalledWith({ email: 'user-1@example.com', locale: 'sr-Latn' });
    });

    it('a federated-only user gets a NestSelf code to the identity email', async () => {
      ctx.identities.findExternalIdentitiesForUser.mockResolvedValue([federated()]);

      const result = await ctx.service.start({ ...SESSION_PRINCIPAL, locale: 'hu' }, META, 'workspace');

      expect(result).toEqual({
        method: 'email_otp',
        challengeToken: expect.any(String),
        ssoStartUrl: null,
        emailMasked: 'i***@acme.example',
      });
      expect(ctx.mailer.sent).toHaveLength(1);
      expect(ctx.mailer.sent[0]).toMatchObject({ to: 'ivana@acme.example', locale: 'hu', template: 'step_up_code' });
      expect(mailedCode(ctx)).toMatch(/^\d{8}$/);
      expect(ctx.idp.startEmailOtp).not.toHaveBeenCalled();
    });

    it('binds a NestSelf code to the user and the requesting session, never storing the raw session id', async () => {
      const { token, code } = await startNestself(ctx);

      for (const key of await ctx.store.scan('*')) {
        expect(key).not.toContain('sess-1');
        expect(await ctx.store.get(key)).not.toContain('sess-1');
      }
      const { data } = await ctx.otp.verify('step_up', token, code);
      expect(data).toEqual({ userId: 'user-1', target: `session:${hashSessionId('sess-1')}` });
    });

    it('binds a bearer NestSelf code to the token family', async () => {
      const { token, code } = await startNestself(ctx, BEARER_PRINCIPAL);
      const { data } = await ctx.otp.verify('step_up', token, code);
      expect(data).toEqual({ userId: 'user-1', target: 'family:family-1' });
    });

    it('a native identity whose pool user is gone falls back to the federated identity', async () => {
      ctx.identities.findExternalIdentitiesForUser.mockResolvedValue([NATIVE, federated()]);
      ctx.idp.startEmailOtp.mockResolvedValue(null);

      const result = await ctx.service.start(SESSION_PRINCIPAL, META, 'workspace');

      expect(result.emailMasked).toBe('i***@acme.example');
      expect(ctx.mailer.sent.map((m) => m.to)).toEqual(['ivana@acme.example']);
    });

    it('prefers the federated identity of an ACTIVE connection over a more recently seen one', async () => {
      ctx.identities.findExternalIdentitiesForUser.mockResolvedValue([
        federated({ id: 'ei-old', email: 'ivana@old.example', ssoConnectionId: 'conn-old', lastSeenAt: new Date('2026-10-31T09:00:00Z') }),
        federated({ id: 'ei-acme', email: 'ivana@acme.example', ssoConnectionId: 'conn-acme', lastSeenAt: new Date('2026-10-01T09:00:00Z') }),
      ]);

      await ctx.service.start(SESSION_PRINCIPAL, META, 'workspace');

      expect(ctx.mailer.sent.map((m) => m.to)).toEqual(['ivana@acme.example']);
    });

    it('without an ACTIVE connection, takes the most recently seen federated identity', async () => {
      ctx.identities.findExternalIdentitiesForUser.mockResolvedValue([
        federated({ id: 'ei-a', email: 'a@acme.example', ssoConnectionId: null, lastSeenAt: new Date('2026-10-01T09:00:00Z') }),
        federated({ id: 'ei-b', email: 'b@acme.example', ssoConnectionId: 'conn-old', lastSeenAt: new Date('2026-10-30T09:00:00Z') }),
        federated({ id: 'ei-c', email: 'c@acme.example', ssoConnectionId: null, lastSeenAt: null }),
      ]);

      await ctx.service.start(SESSION_PRINCIPAL, META, 'workspace');

      expect(ctx.mailer.sent.map((m) => m.to)).toEqual(['b@acme.example']);
    });

    it('with no connection and no sign-in recorded, takes the first federated identity', async () => {
      ctx.identities.findExternalIdentitiesForUser.mockResolvedValue([
        federated({ id: 'ei-a', email: 'a@acme.example', ssoConnectionId: null, lastSeenAt: null }),
        federated({ id: 'ei-b', email: 'b@acme.example', ssoConnectionId: null, lastSeenAt: null }),
      ]);

      await ctx.service.start(SESSION_PRINCIPAL, META, 'workspace');

      expect(ctx.mailer.sent.map((m) => m.to)).toEqual(['a@acme.example']);
    });

    it('a user without identities gets step_up_unavailable', async () => {
      ctx.identities.findExternalIdentitiesForUser.mockResolvedValue([]);

      await expect(ctx.service.start(SESSION_PRINCIPAL, META, 'workspace')).rejects.toMatchObject({
        status: 403,
        code: 'step_up_unavailable',
      });
      expect(await ctx.store.scan('challenge:*')).toEqual([]);
      expect(ctx.mailer.sent).toEqual([]);
    });

    it('a native identity whose pool user is gone, and nothing federated: step_up_unavailable', async () => {
      ctx.idp.startEmailOtp.mockResolvedValue(null);

      await expect(ctx.service.start(SESSION_PRINCIPAL, META, 'workspace')).rejects.toMatchObject({
        status: 403,
        code: 'step_up_unavailable',
      });
      expect(await ctx.store.scan('challenge:*')).toEqual([]);
    });

    it('a provider outage answers 503 unavailable', async () => {
      ctx.idp.startEmailOtp.mockRejectedValue(new IdentityProviderError('down', 'unavailable'));

      await expect(ctx.service.start(SESSION_PRINCIPAL, META, 'workspace')).rejects.toMatchObject({
        status: 503,
        code: 'unavailable',
      });
    });
  });

  describe('verify (Cognito kind)', () => {
    it("refuses another user's challenge with invalid_challenge and never marks the step-up", async () => {
      const token = await ctx.challenges.create({ ...STEP_UP_CHALLENGE, stepUp: { userId: 'user-2' } });

      await expect(ctx.service.verify(SESSION_PRINCIPAL, token, '12345678', META)).rejects.toMatchObject({
        status: 401,
        code: 'invalid_challenge',
      });
      expect(ctx.idp.respondEmailOtp).not.toHaveBeenCalled();
      expect(ctx.sessions.markStepUp).not.toHaveBeenCalled();
    });

    it("audits another user's challenge as auth.step_up.failed (foreign_challenge) without token or code", async () => {
      const token = await ctx.challenges.create({ ...STEP_UP_CHALLENGE, stepUp: { userId: 'user-2' } });

      await expect(ctx.service.verify(SESSION_PRINCIPAL, token, '12345678', META)).rejects.toMatchObject({
        code: 'invalid_challenge',
      });

      expect(ctx.audit.record).toHaveBeenCalledTimes(1);
      const event = ctx.audit.record.mock.calls[0]![0];
      expect(event).toMatchObject({
        action: 'auth.step_up.failed',
        actorUserId: 'user-1',
        result: 'DENIED',
        details: { method: 'email_otp', reason: 'foreign_challenge' },
      });
      const serialized = JSON.stringify(event);
      expect(serialized).not.toContain(token);
      expect(serialized).not.toContain('12345678');
    });

    it('refuses a sign-in challenge that carries no step-up binding', async () => {
      const { stepUp: _omit, ...signIn } = STEP_UP_CHALLENGE;
      const token = await ctx.challenges.create(signIn);

      await expect(ctx.service.verify(SESSION_PRINCIPAL, token, '12345678', META)).rejects.toMatchObject({
        code: 'invalid_challenge',
      });
      expect(ctx.sessions.markStepUp).not.toHaveBeenCalled();
    });

    it('session principal: marks the step-up, then regenerates, revokes the throwaway token and audits issuer cognito', async () => {
      const token = await ctx.challenges.create(STEP_UP_CHALLENGE);

      const result = await ctx.service.verify(SESSION_PRINCIPAL, token, '12345678', META);

      expect(ctx.idp.respondEmailOtp).toHaveBeenCalledWith({
        session: 'idp-session', username: 'cognito-user-1', code: '12345678',
      });
      expect(ctx.sessions.markStepUp).toHaveBeenCalledWith('sess-1', expect.any(Date));
      expect(ctx.sessions.regenerate).toHaveBeenCalledWith('sess-1');
      expect(ctx.sessions.markStepUp.mock.invocationCallOrder[0]!).toBeLessThan(
        ctx.sessions.regenerate.mock.invocationCallOrder[0]!,
      );
      expect(ctx.idp.revokeRefreshToken).toHaveBeenCalledWith('throwaway-refresh');
      expect(result).toEqual({
        session: { sessionId: 'sess-new', csrfToken: 'csrf-new', absoluteExpiresAt: ABSOLUTE },
      });
      expect(ctx.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'auth.step_up.completed',
          actorUserId: 'user-1',
          result: 'ALLOWED',
          details: { method: 'email_otp', issuer: 'cognito' },
        }),
      );
      expect(await ctx.store.scan('stepup:*')).toEqual([]);
    });

    it('still succeeds when revoking the throwaway token fails', async () => {
      const token = await ctx.challenges.create(STEP_UP_CHALLENGE);
      ctx.idp.revokeRefreshToken.mockRejectedValue(new Error('network'));
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      const result = await ctx.service.verify(SESSION_PRINCIPAL, token, '12345678', META);

      expect(result.session?.sessionId).toBe('sess-new');
      expect(warn).toHaveBeenCalledOnce();
    });

    it('bearer principal: stores the step-up under stepup:{tokenFamily} for 1800 s', async () => {
      const token = await ctx.challenges.create(STEP_UP_CHALLENGE);

      const result = await ctx.service.verify(BEARER_PRINCIPAL, token, '12345678', META);

      expect(result).toEqual({});
      const stored = JSON.parse((await ctx.store.get('stepup:family-1'))!) as { lastStepUpAt: string };
      expect(stored.lastStepUpAt).toBe(NOW.toISOString());
      expect(await ctx.store.ttl('stepup:family-1')).toBe(1800);
      expect(ctx.sessions.markStepUp).not.toHaveBeenCalled();
      expect(ctx.sessions.regenerate).not.toHaveBeenCalled();
    });

    it('wrong code: audits auth.step_up.failed and returns 401 invalid_code', async () => {
      const token = await ctx.challenges.create(STEP_UP_CHALLENGE);
      cognitoWrongCode(ctx);

      await expect(ctx.service.verify(SESSION_PRINCIPAL, token, '00000000', META)).rejects.toMatchObject({
        status: 401,
        code: 'invalid_code',
      });
      expect(ctx.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'auth.step_up.failed', actorUserId: 'user-1', result: 'DENIED' }),
      );
      const details = (ctx.audit.record.mock.calls[0]![0] as { details: Record<string, unknown> }).details;
      for (const key of Object.keys(details)) {
        expect(key).not.toMatch(/password|^code$|token|secret/i);
      }
      expect(ctx.sessions.markStepUp).not.toHaveBeenCalled();
    });

    it('wrong code: hands the challenge back under the same token with one more attempt', async () => {
      const token = await ctx.challenges.create(STEP_UP_CHALLENGE);
      cognitoWrongCode(ctx);

      await expect(ctx.service.verify(SESSION_PRINCIPAL, token, '00000000', META)).rejects.toMatchObject({
        code: 'invalid_code',
      });
      expect(await ctx.challenges.consume(token)).toMatchObject({ ...STEP_UP_CHALLENGE, attempts: 1 });
    });

    it(`wrong code on attempt ${MAX_EMAIL_OTP_ATTEMPTS}: the challenge is not handed back`, async () => {
      const token = await ctx.challenges.create({ ...STEP_UP_CHALLENGE, attempts: MAX_EMAIL_OTP_ATTEMPTS - 1 });
      cognitoWrongCode(ctx);

      await expect(ctx.service.verify(SESSION_PRINCIPAL, token, '00000000', META)).rejects.toMatchObject({
        code: 'invalid_code',
      });
      expect(await ctx.challenges.consume(token)).toBeNull();
    });

    it('an expired provider session is not handed back', async () => {
      const token = await ctx.challenges.create(STEP_UP_CHALLENGE);
      ctx.idp.respondEmailOtp.mockRejectedValue(new IdentityProviderError('expired', 'expired_session'));

      await expect(ctx.service.verify(SESSION_PRINCIPAL, token, '00000000', META)).rejects.toMatchObject({
        code: 'invalid_challenge',
      });
      expect(await ctx.challenges.consume(token)).toBeNull();
    });
  });

  describe('verify (NestSelf kind)', () => {
    it('the mailed code completes the step-up: marks, regenerates and audits issuer nestself', async () => {
      const { token, code } = await startNestself(ctx);

      const result = await ctx.service.verify(SESSION_PRINCIPAL, token, code, META);

      expect(result).toEqual({
        session: { sessionId: 'sess-new', csrfToken: 'csrf-new', absoluteExpiresAt: ABSOLUTE },
      });
      expect(ctx.sessions.markStepUp).toHaveBeenCalledWith('sess-1', expect.any(Date));
      expect(ctx.sessions.regenerate).toHaveBeenCalledWith('sess-1');
      // No identity provider round trip, so no throwaway token to revoke.
      expect(ctx.idp.respondEmailOtp).not.toHaveBeenCalled();
      expect(ctx.idp.revokeRefreshToken).not.toHaveBeenCalled();
      expect(ctx.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'auth.step_up.completed',
          actorUserId: 'user-1',
          result: 'ALLOWED',
          details: { method: 'email_otp', issuer: 'nestself' },
        }),
      );
      // Spent: the same code cannot step up again.
      await expect(ctx.service.verify(SESSION_PRINCIPAL, token, code, META)).rejects.toMatchObject({
        code: 'invalid_challenge',
      });
    });

    it('a wrong code answers invalid_code, is audited, and the right code then works on the same token', async () => {
      const { token, code } = await startNestself(ctx);

      await expect(ctx.service.verify(SESSION_PRINCIPAL, token, wrongCode(code), META)).rejects.toMatchObject({
        status: 401,
        code: 'invalid_code',
      });
      expect(ctx.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'auth.step_up.failed',
          details: { method: 'email_otp', reason: 'invalid_code' },
        }),
      );

      await expect(ctx.service.verify(SESSION_PRINCIPAL, token, code, META)).resolves.toHaveProperty('session');
    });

    it('verify of a NestSelf code minted for another user is foreign_challenge', async () => {
      const { token, code } = await startNestself(ctx, OTHER_PRINCIPAL);

      await expect(ctx.service.verify(SESSION_PRINCIPAL, token, code, META)).rejects.toMatchObject({
        status: 401,
        code: 'invalid_challenge',
      });

      expect(ctx.sessions.markStepUp).not.toHaveBeenCalled();
      expect(ctx.sessions.regenerate).not.toHaveBeenCalled();
      expect(ctx.audit.record).toHaveBeenCalledTimes(1);
      const event = ctx.audit.record.mock.calls[0]![0];
      expect(event).toMatchObject({
        action: 'auth.step_up.failed',
        actorUserId: 'user-1',
        result: 'DENIED',
        details: { method: 'email_otp', reason: 'foreign_challenge' },
      });
      expect(JSON.stringify(event)).not.toContain(token);
      expect(JSON.stringify(event)).not.toContain(code);
      // The presented token is spent: its owner cannot use it either.
      await expect(ctx.service.verify(OTHER_PRINCIPAL, token, code, META)).rejects.toMatchObject({
        code: 'invalid_challenge',
      });
    });

    it('verify of a NestSelf code minted in another session of the same user is foreign_challenge', async () => {
      const { token, code } = await startNestself(ctx, SESSION_PRINCIPAL);
      const otherSession = { ...SESSION_PRINCIPAL, sessionId: 'sess-other' };

      await expect(ctx.service.verify(otherSession, token, code, META)).rejects.toMatchObject({
        status: 401,
        code: 'invalid_challenge',
      });

      expect(ctx.sessions.markStepUp).not.toHaveBeenCalled();
      expect(ctx.sessions.regenerate).not.toHaveBeenCalled();
      expect(ctx.audit.record).toHaveBeenCalledTimes(1);
      const event = ctx.audit.record.mock.calls[0]![0];
      expect(event).toMatchObject({
        action: 'auth.step_up.failed',
        actorUserId: 'user-1',
        result: 'DENIED',
        details: { method: 'email_otp', reason: 'foreign_challenge' },
      });
      expect(JSON.stringify(event)).not.toContain(token);
      expect(JSON.stringify(event)).not.toContain(code);
      expect(JSON.stringify(event)).not.toContain(hashSessionId('sess-1'));
      // The presented token is spent: the session that asked for it cannot use it either.
      await expect(ctx.service.verify(SESSION_PRINCIPAL, token, code, META)).rejects.toMatchObject({
        code: 'invalid_challenge',
      });
    });

    it('a NestSelf code is bound to its token family: another family of the same user, or a session, is refused', async () => {
      const otherFamily = { ...BEARER_PRINCIPAL, tokenFamily: 'family-2' };
      const first = await startNestself(ctx, BEARER_PRINCIPAL);
      await expect(ctx.service.verify(otherFamily, first.token, first.code, META)).rejects.toMatchObject({
        status: 401,
        code: 'invalid_challenge',
      });

      const second = await startNestself(ctx, BEARER_PRINCIPAL);
      await expect(ctx.service.verify(SESSION_PRINCIPAL, second.token, second.code, META)).rejects.toMatchObject({
        status: 401,
        code: 'invalid_challenge',
      });

      expect(ctx.audit.record).toHaveBeenCalledTimes(2);
      for (const [event] of ctx.audit.record.mock.calls) {
        expect(event).toMatchObject({ action: 'auth.step_up.failed', details: { reason: 'foreign_challenge' } });
      }
      expect(await ctx.store.get('stepup:family-2')).toBeNull();
      expect(await ctx.store.get('stepup:family-1')).toBeNull();
      expect(ctx.sessions.markStepUp).not.toHaveBeenCalled();
    });

    it('a bearer NestSelf code verifies from the token family that asked for it', async () => {
      const { token, code } = await startNestself(ctx, BEARER_PRINCIPAL);

      await expect(ctx.service.verify(BEARER_PRINCIPAL, token, code, META)).resolves.toEqual({});

      expect(JSON.parse((await ctx.store.get('stepup:family-1'))!)).toEqual({ lastStepUpAt: NOW.toISOString() });
      expect(ctx.sessions.markStepUp).not.toHaveBeenCalled();
      expect(ctx.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'auth.step_up.completed',
          details: { method: 'email_otp', issuer: 'nestself' },
        }),
      );
    });

    it('a Cognito challenge token is not accepted by the NestSelf path and vice versa', async () => {
      const cognito = await ctx.challenges.create(STEP_UP_CHALLENGE);
      const nestself = await startNestself(ctx);

      // The Cognito token goes to the identity provider, even with the NestSelf code.
      cognitoWrongCode(ctx);
      await expect(ctx.service.verify(SESSION_PRINCIPAL, cognito, nestself.code, META)).rejects.toMatchObject({
        code: 'invalid_code',
      });
      expect(ctx.idp.respondEmailOtp).toHaveBeenCalledWith(expect.objectContaining({ session: 'idp-session' }));

      // A spent Cognito token is unknown to the NestSelf store as well.
      await ctx.challenges.consume(cognito);
      await expect(ctx.service.verify(SESSION_PRINCIPAL, cognito, '12345678', META)).rejects.toMatchObject({
        status: 401,
        code: 'invalid_challenge',
      });

      // The NestSelf token never reaches the identity provider.
      await ctx.service.verify(SESSION_PRINCIPAL, nestself.token, nestself.code, META);
      expect(ctx.idp.respondEmailOtp).toHaveBeenCalledTimes(1);
      expect(ctx.audit.record).toHaveBeenLastCalledWith(
        expect.objectContaining({ details: { method: 'email_otp', issuer: 'nestself' } }),
      );
    });

    it('a code issued for the SSO binding is not a step-up', async () => {
      const { challengeToken } = await ctx.otp.issue({
        purpose: 'sso_bind',
        email: 'ivana@acme.example',
        locale: 'en',
        template: 'sso_bind_code',
        data: { userId: 'user-1', target: `session:${hashSessionId('sess-1')}` },
      });

      await expect(
        ctx.service.verify(SESSION_PRINCIPAL, challengeToken, mailedCode(ctx), META),
      ).rejects.toMatchObject({ status: 401, code: 'invalid_challenge' });
      expect(ctx.sessions.markStepUp).not.toHaveBeenCalled();
    });
  });

  describe('lockout (StepUpThrottle)', () => {
    async function wrongCognitoCodes(times: number): Promise<void> {
      for (let i = 0; i < times; i++) {
        const token = await ctx.challenges.create(STEP_UP_CHALLENGE);
        cognitoWrongCode(ctx);
        await expect(ctx.service.verify(SESSION_PRINCIPAL, token, '00000000', META)).rejects.toMatchObject({
          code: 'invalid_code',
        });
      }
    }

    it('five wrong codes lock the user', async () => {
      await wrongCognitoCodes(5);
      const token = await ctx.challenges.create(STEP_UP_CHALLENGE);

      await expect(ctx.service.verify(SESSION_PRINCIPAL, token, '12345678', META)).rejects.toMatchObject({
        status: 429,
        code: 'too_many_attempts',
      });
      // The lock is checked first: the sixth code never reached the identity provider.
      expect(ctx.idp.respondEmailOtp).toHaveBeenCalledTimes(5);
      expect(ctx.sessions.markStepUp).not.toHaveBeenCalled();
    });

    it('the wrong code that locks the user does not hand its challenge back', async () => {
      await wrongCognitoCodes(4);
      const token = await ctx.challenges.create(STEP_UP_CHALLENGE);
      cognitoWrongCode(ctx);

      await expect(ctx.service.verify(SESSION_PRINCIPAL, token, '00000000', META)).rejects.toMatchObject({
        code: 'invalid_code',
      });
      expect(await ctx.challenges.consume(token)).toBeNull();
    });

    it('wrong NestSelf codes count toward the same lock', async () => {
      await wrongCognitoCodes(3);
      const { token, code } = await startNestself(ctx);
      for (let i = 0; i < 2; i++) {
        await expect(ctx.service.verify(SESSION_PRINCIPAL, token, wrongCode(code), META)).rejects.toMatchObject({
          code: 'invalid_code',
        });
      }

      await expect(ctx.service.verify(SESSION_PRINCIPAL, token, code, META)).rejects.toMatchObject({
        status: 429,
        code: 'too_many_attempts',
      });
      expect(ctx.sessions.markStepUp).not.toHaveBeenCalled();
    });

    it('a NestSelf challenge out of tries answers invalid_challenge, not the lockout, and its wrong codes still count', async () => {
      const { token, code } = await startNestself(ctx);
      for (let i = 0; i < 2; i++) {
        await expect(ctx.service.verify(SESSION_PRINCIPAL, token, wrongCode(code), META)).rejects.toMatchObject({
          code: 'invalid_code',
        });
      }

      // The third wrong code ends this challenge only: a new one can be asked for at once.
      await expect(ctx.service.verify(SESSION_PRINCIPAL, token, wrongCode(code), META)).rejects.toMatchObject({
        status: 401,
        code: 'invalid_challenge',
      });
      expect(ctx.audit.record).toHaveBeenLastCalledWith(
        expect.objectContaining({
          action: 'auth.step_up.failed',
          details: { method: 'email_otp', reason: 'too_many_attempts' },
        }),
      );
      await expect(ctx.service.verify(SESSION_PRINCIPAL, token, code, META)).rejects.toMatchObject({
        code: 'invalid_challenge',
      });

      // Three failures so far: two more lock the user.
      await expect(ctx.service.start(SESSION_PRINCIPAL, META, 'workspace')).resolves.toHaveProperty('challengeToken');
      await wrongCognitoCodes(2);
      await expect(ctx.service.start(SESSION_PRINCIPAL, META, 'workspace')).rejects.toMatchObject({
        status: 429,
        code: 'too_many_attempts',
      });
    });

    it('a locked user cannot start or resend: 429, and nothing is sent', async () => {
      const { token } = await startNestself(ctx);
      await wrongCognitoCodes(5);
      secondsLater(61);

      await expect(ctx.service.start(SESSION_PRINCIPAL, META, 'workspace')).rejects.toMatchObject({
        status: 429,
        code: 'too_many_attempts',
      });
      await expect(ctx.service.resend(SESSION_PRINCIPAL, token, META)).rejects.toMatchObject({
        status: 429,
        code: 'too_many_attempts',
      });
      expect(ctx.idp.startEmailOtp).not.toHaveBeenCalled();
      expect(ctx.mailer.sent).toHaveLength(1);
    });

    it('a completed step-up clears the count', async () => {
      await wrongCognitoCodes(4);
      await ctx.service.verify(SESSION_PRINCIPAL, await ctx.challenges.create(STEP_UP_CHALLENGE), '12345678', META);
      await wrongCognitoCodes(4);

      await expect(
        ctx.service.verify(SESSION_PRINCIPAL, await ctx.challenges.create(STEP_UP_CHALLENGE), '12345678', META),
      ).resolves.toHaveProperty('session');
    });
  });

  describe('resend', () => {
    it('Cognito kind: inside the cooldown answers 429 rate_limited with retryAfter and keeps the challenge', async () => {
      const { challengeToken } = await ctx.service.start(SESSION_PRINCIPAL, META, 'workspace');
      secondsLater(15);

      const refused = await ctx.service.resend(SESSION_PRINCIPAL, challengeToken, META).catch((e: unknown) => e);

      expect(refused).toMatchObject({ status: 429, code: 'rate_limited', details: { retryAfter: 45 } });
      expect(ctx.idp.startEmailOtp).toHaveBeenCalledTimes(1);
      // The code sent first still works.
      await expect(ctx.service.verify(SESSION_PRINCIPAL, challengeToken, '12345678', META)).resolves.toHaveProperty(
        'session',
      );
    });

    it('Cognito kind: after the cooldown a new code arrives under a new token and the old token is dead', async () => {
      const { challengeToken: first } = await ctx.service.start({ ...SESSION_PRINCIPAL, locale: 'hu' }, META, 'admin');
      ctx.idp.startEmailOtp.mockResolvedValueOnce({ session: 'idp-session-2', username: 'cognito-user-1' });
      secondsLater(61);

      const result = await ctx.service.resend({ ...SESSION_PRINCIPAL, locale: 'hu' }, first, META);

      expect(result).toEqual({
        method: 'email_otp',
        challengeToken: expect.any(String),
        ssoStartUrl: null,
        emailMasked: 'u***@example.com',
      });
      expect(result.challengeToken).not.toBe(first);
      expect(ctx.idp.startEmailOtp).toHaveBeenLastCalledWith({ email: 'user-1@example.com', locale: 'hu' });
      await expect(ctx.service.verify(SESSION_PRINCIPAL, first, '12345678', META)).rejects.toMatchObject({
        code: 'invalid_challenge',
      });
      // The new token carries the new provider session and starts its own cooldown.
      await expect(ctx.service.resend(SESSION_PRINCIPAL, result.challengeToken, META)).rejects.toMatchObject({
        code: 'rate_limited',
      });
      expect(await ctx.challenges.consume(result.challengeToken)).toMatchObject({
        session: 'idp-session-2',
        surface: 'admin',
        stepUp: { userId: 'user-1' },
      });
    });

    it('Cognito kind: a resend keeps the wrong codes already counted on the challenge', async () => {
      const token = await ctx.challenges.create({ ...STEP_UP_CHALLENGE, attempts: 2 });

      const { challengeToken } = await ctx.service.resend(SESSION_PRINCIPAL, token, META);

      expect(await ctx.challenges.consume(challengeToken)).toMatchObject({ attempts: 2 });
    });

    it('Cognito kind: a provider failure puts the challenge back, so the code sent before still works', async () => {
      const token = await ctx.challenges.create(STEP_UP_CHALLENGE);
      ctx.idp.startEmailOtp.mockRejectedValueOnce(new IdentityProviderError('down', 'unavailable'));

      await expect(ctx.service.resend(SESSION_PRINCIPAL, token, META)).rejects.toMatchObject({
        status: 503,
        code: 'unavailable',
      });
      await expect(ctx.service.verify(SESSION_PRINCIPAL, token, '12345678', META)).resolves.toHaveProperty('session');
    });

    it('Cognito kind: once the pool user is gone the resend answers step_up_unavailable', async () => {
      const token = await ctx.challenges.create(STEP_UP_CHALLENGE);
      ctx.idp.startEmailOtp.mockResolvedValueOnce(null);

      await expect(ctx.service.resend(SESSION_PRINCIPAL, token, META)).rejects.toMatchObject({
        status: 403,
        code: 'step_up_unavailable',
      });
      expect(await ctx.store.scan('challenge:*')).toEqual([]);
    });

    it("Cognito kind: another user's challenge is refused, audited and not resent", async () => {
      const token = await ctx.challenges.create({ ...STEP_UP_CHALLENGE, stepUp: { userId: 'user-2' } });

      await expect(ctx.service.resend(SESSION_PRINCIPAL, token, META)).rejects.toMatchObject({
        status: 401,
        code: 'invalid_challenge',
      });
      expect(ctx.idp.startEmailOtp).not.toHaveBeenCalled();
      expect(ctx.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'auth.step_up.failed',
          details: { method: 'email_otp', reason: 'foreign_challenge' },
        }),
      );
    });

    it('a sign-in challenge cannot be resent through step-up', async () => {
      const { stepUp: _omit, ...signIn } = STEP_UP_CHALLENGE;
      const token = await ctx.challenges.create(signIn);

      await expect(ctx.service.resend(SESSION_PRINCIPAL, token, META)).rejects.toMatchObject({
        code: 'invalid_challenge',
      });
      expect(ctx.idp.startEmailOtp).not.toHaveBeenCalled();
    });

    it('NestSelf kind: inside the cooldown 429 with retryAfter; after it a new code under the same token', async () => {
      const { token, code: first } = await startNestself(ctx);

      await expect(ctx.service.resend(SESSION_PRINCIPAL, token, META)).rejects.toMatchObject({
        status: 429,
        code: 'rate_limited',
        details: { retryAfter: 60 },
      });

      secondsLater(61);
      const result = await ctx.service.resend({ ...SESSION_PRINCIPAL, locale: 'hu' }, token, META);

      expect(result).toEqual({
        method: 'email_otp',
        challengeToken: token,
        ssoStartUrl: null,
        emailMasked: 'u***@acme.example',
      });
      expect(ctx.mailer.sent).toHaveLength(2);
      expect(ctx.mailer.sent[1]).toMatchObject({ to: 'user-1@acme.example', locale: 'hu', template: 'step_up_code' });
      const second = mailedCode(ctx);
      await expect(ctx.service.verify(SESSION_PRINCIPAL, token, first === second ? wrongCode(first) : first, META))
        .rejects.toMatchObject({ code: 'invalid_code' });
      await expect(ctx.service.verify(SESSION_PRINCIPAL, token, second, META)).resolves.toHaveProperty('session');
    });

    it("NestSelf kind: another user's challenge is refused, audited and not resent; its owner can still verify", async () => {
      const { token, code } = await startNestself(ctx, OTHER_PRINCIPAL);
      secondsLater(61);

      await expect(ctx.service.resend(SESSION_PRINCIPAL, token, META)).rejects.toMatchObject({
        status: 401,
        code: 'invalid_challenge',
      });

      expect(ctx.mailer.sent).toHaveLength(1);
      expect(ctx.audit.record).toHaveBeenCalledTimes(1);
      expect(ctx.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'auth.step_up.failed',
          actorUserId: 'user-1',
          result: 'DENIED',
          details: { method: 'email_otp', reason: 'foreign_challenge' },
        }),
      );
      await expect(ctx.service.verify(OTHER_PRINCIPAL, token, code, META)).resolves.toHaveProperty('session');
    });

    it('NestSelf kind: a challenge of another session of the same user is refused, audited and not resent; its session can still verify', async () => {
      const { token, code } = await startNestself(ctx, SESSION_PRINCIPAL);
      secondsLater(61);

      await expect(
        ctx.service.resend({ ...SESSION_PRINCIPAL, sessionId: 'sess-other' }, token, META),
      ).rejects.toMatchObject({ status: 401, code: 'invalid_challenge' });

      expect(ctx.mailer.sent).toHaveLength(1);
      expect(ctx.audit.record).toHaveBeenCalledTimes(1);
      expect(ctx.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'auth.step_up.failed',
          actorUserId: 'user-1',
          result: 'DENIED',
          details: { method: 'email_otp', reason: 'foreign_challenge' },
        }),
      );
      await expect(ctx.service.verify(SESSION_PRINCIPAL, token, code, META)).resolves.toHaveProperty('session');
    });

    it('an unknown token answers invalid_challenge and is not recorded as foreign', async () => {
      await expect(ctx.service.resend(SESSION_PRINCIPAL, 'a-token-nobody-issued', META)).rejects.toMatchObject({
        status: 401,
        code: 'invalid_challenge',
      });
      expect(ctx.audit.record).not.toHaveBeenCalled();
    });
  });
});
