import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Logger } from '@nestjs/common';
import { StepUpService } from './step-up.service.js';
import { MAX_EMAIL_OTP_ATTEMPTS } from './sign-in.service.js';
import { IdentityProviderError } from '../identity/identity-provider.service.js';
import { IdentityResolutionService } from './identity-resolution.service.js';
import type { ChallengeRecord } from './challenge-store.js';

const SESSION_PRINCIPAL = {
  userId: 'user-1',
  displayName: 'Ivana Test',
  initials: 'IT',
  locale: 'sr-Latn' as const,
  memberships: [],
  staffTemplates: [],
  expert: null,
  context: { kind: 'personal' as const },
  auth: {
    method: 'email_otp' as const,
    time: new Date(Date.now() - 40 * 60_000).toISOString(),
    secondFactor: false,
    lastStepUpAt: null,
  },
  sessionId: 'sess-1',
  tokenFamily: null,
};
const BEARER_PRINCIPAL = { ...SESSION_PRINCIPAL, sessionId: null, tokenFamily: 'family-1' };
const META = { ip: '203.0.113.1', userAgent: 'test' };

const STEP_UP_CHALLENGE: ChallengeRecord = {
  kind: 'email_otp',
  username: 'cognito-user-1',
  email: 'user-1@example.com',
  session: 'idp-session',
  surface: 'workspace',
  stepUp: { userId: 'user-1' },
};

const ABSOLUTE = new Date(Date.now() + 3_600_000);

function createMocks() {
  return {
    idp: {
      startEmailOtp: vi.fn().mockResolvedValue({ session: 'idp-session', username: 'cognito-user-1' }),
      respondEmailOtp: vi.fn().mockResolvedValue({
        kind: 'tokens',
        tokens: { accessToken: 'a', idToken: 'i', refreshToken: 'throwaway-refresh', expiresIn: 3600 },
      }),
      revokeRefreshToken: vi.fn().mockResolvedValue(undefined),
    },
    challenges: {
      create: vi.fn().mockResolvedValue('challenge-token'),
      consume: vi.fn().mockResolvedValue(STEP_UP_CHALLENGE),
      put: vi.fn().mockResolvedValue(undefined),
    },
    sessions: {
      markStepUp: vi.fn().mockResolvedValue(undefined),
      regenerate: vi.fn().mockResolvedValue({ sessionId: 'sess-2', csrfToken: 'csrf-2' }),
      get: vi.fn().mockResolvedValue({ absoluteExpiresAt: ABSOLUTE.toISOString() }),
    },
    identities: {
      findExternalIdentitiesForUser: vi.fn().mockResolvedValue([
        { provider: 'cognito:AcmeSaml', cognitoUsername: 'fed', email: 'fed@example.com' },
        { provider: 'cognito', cognitoUsername: 'cognito-user-1', email: 'user-1@example.com' },
      ]),
    },
    audit: { record: vi.fn().mockResolvedValue(undefined) },
    store: { set: vi.fn().mockResolvedValue(true) },
  };
}

describe('StepUpService', () => {
  let mocks: ReturnType<typeof createMocks>;
  let service: StepUpService;

  beforeEach(() => {
    mocks = createMocks();
    service = new StepUpService(
      mocks.idp as never,
      mocks.challenges as never,
      mocks.sessions as never,
      mocks.identities as never,
      // Real error mapping; its collaborators are unused by mapIdpError.
      new IdentityResolutionService({} as never, {} as never, {} as never, {} as never, {} as never, {} as never),
      mocks.audit as never,
      mocks.store as never,
    );
  });

  describe('start', () => {
    it('sends an email code to the first cognito identity and binds the challenge to the user', async () => {
      const result = await service.start(SESSION_PRINCIPAL, META, 'workspace');

      expect(result).toEqual({ method: 'email_otp', challengeToken: 'challenge-token', ssoStartUrl: null });
      expect(mocks.idp.startEmailOtp).toHaveBeenCalledWith({ email: 'user-1@example.com' });
      expect(mocks.challenges.create).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'email_otp',
          username: 'cognito-user-1',
          email: 'user-1@example.com',
          session: 'idp-session',
          stepUp: { userId: 'user-1' },
        }),
      );
    });

    it('refuses when the user has no native identity', async () => {
      mocks.identities.findExternalIdentitiesForUser.mockResolvedValue([]);
      await expect(service.start(SESSION_PRINCIPAL, META, 'workspace')).rejects.toMatchObject({
        code: 'forbidden',
      });
      expect(mocks.challenges.create).not.toHaveBeenCalled();
    });
  });

  describe('verify', () => {
    it("refuses another user's challenge with invalid_challenge and never marks the step-up", async () => {
      mocks.challenges.consume.mockResolvedValue({ ...STEP_UP_CHALLENGE, stepUp: { userId: 'user-2' } });

      await expect(service.verify(SESSION_PRINCIPAL, 'challenge-token', '12345678', META)).rejects.toMatchObject({
        status: 401,
        code: 'invalid_challenge',
      });
      expect(mocks.idp.respondEmailOtp).not.toHaveBeenCalled();
      expect(mocks.sessions.markStepUp).not.toHaveBeenCalled();
    });

    it('refuses a sign-in challenge that carries no step-up binding', async () => {
      const { stepUp: _omit, ...signIn } = STEP_UP_CHALLENGE;
      mocks.challenges.consume.mockResolvedValue(signIn);

      await expect(service.verify(SESSION_PRINCIPAL, 'challenge-token', '12345678', META)).rejects.toMatchObject({
        code: 'invalid_challenge',
      });
      expect(mocks.sessions.markStepUp).not.toHaveBeenCalled();
    });

    it('session principal: marks the step-up, then regenerates, revokes the throwaway token and audits', async () => {
      const result = await service.verify(SESSION_PRINCIPAL, 'challenge-token', '12345678', META);

      expect(mocks.idp.respondEmailOtp).toHaveBeenCalledWith({
        session: 'idp-session', username: 'cognito-user-1', code: '12345678',
      });
      expect(mocks.sessions.markStepUp).toHaveBeenCalledWith('sess-1', expect.any(Date));
      expect(mocks.sessions.regenerate).toHaveBeenCalledWith('sess-1');
      expect(mocks.sessions.markStepUp.mock.invocationCallOrder[0]!).toBeLessThan(
        mocks.sessions.regenerate.mock.invocationCallOrder[0]!,
      );
      expect(mocks.idp.revokeRefreshToken).toHaveBeenCalledWith('throwaway-refresh');
      expect(result).toEqual({
        session: { sessionId: 'sess-2', csrfToken: 'csrf-2', absoluteExpiresAt: ABSOLUTE },
      });
      expect(mocks.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'auth.step_up.completed',
          actorUserId: 'user-1',
          result: 'ALLOWED',
          details: expect.objectContaining({ method: 'email_otp' }),
        }),
      );
      expect(mocks.store.set).not.toHaveBeenCalled();
    });

    it('still succeeds when revoking the throwaway token fails', async () => {
      mocks.idp.revokeRefreshToken.mockRejectedValue(new Error('network'));
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const result = await service.verify(SESSION_PRINCIPAL, 'challenge-token', '12345678', META);
      expect(result.session?.sessionId).toBe('sess-2');
      expect(warn).toHaveBeenCalledOnce();
      warn.mockRestore();
    });

    it('bearer principal: stores the step-up under stepup:{tokenFamily} for 1800 s', async () => {
      const result = await service.verify(BEARER_PRINCIPAL, 'challenge-token', '12345678', META);

      expect(result).toEqual({});
      expect(mocks.store.set).toHaveBeenCalledWith(
        'stepup:family-1',
        expect.stringMatching(/"lastStepUpAt":"/),
        { ttlSeconds: 1800 },
      );
      const stored = JSON.parse(mocks.store.set.mock.calls[0]![1] as string) as { lastStepUpAt: string };
      expect(Date.now() - new Date(stored.lastStepUpAt).getTime()).toBeLessThan(5_000);
      expect(mocks.sessions.markStepUp).not.toHaveBeenCalled();
      expect(mocks.sessions.regenerate).not.toHaveBeenCalled();
    });

    it('wrong code: audits auth.step_up.failed and returns 401 invalid_code', async () => {
      mocks.idp.respondEmailOtp.mockRejectedValue(new IdentityProviderError('bad code', 'invalid_code'));

      await expect(service.verify(SESSION_PRINCIPAL, 'challenge-token', '00000000', META)).rejects.toMatchObject({
        status: 401,
        code: 'invalid_code',
      });
      expect(mocks.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'auth.step_up.failed', actorUserId: 'user-1', result: 'DENIED' }),
      );
      const details = (mocks.audit.record.mock.calls[0]![0] as { details: Record<string, unknown> }).details;
      for (const key of Object.keys(details)) {
        expect(key).not.toMatch(/password|^code$|token|secret/i);
      }
      expect(mocks.sessions.markStepUp).not.toHaveBeenCalled();
    });

    it('wrong code: hands the challenge back under the same token with one more attempt', async () => {
      mocks.idp.respondEmailOtp.mockRejectedValue(new IdentityProviderError('bad code', 'invalid_code'));

      await expect(service.verify(SESSION_PRINCIPAL, 'challenge-token', '00000000', META)).rejects.toMatchObject({
        code: 'invalid_code',
      });
      expect(mocks.challenges.put).toHaveBeenCalledWith('challenge-token', { ...STEP_UP_CHALLENGE, attempts: 1 });
    });

    it(`wrong code on attempt ${MAX_EMAIL_OTP_ATTEMPTS}: the challenge is not handed back`, async () => {
      mocks.challenges.consume.mockResolvedValue({ ...STEP_UP_CHALLENGE, attempts: MAX_EMAIL_OTP_ATTEMPTS - 1 });
      mocks.idp.respondEmailOtp.mockRejectedValue(new IdentityProviderError('bad code', 'invalid_code'));

      await expect(service.verify(SESSION_PRINCIPAL, 'challenge-token', '00000000', META)).rejects.toMatchObject({
        code: 'invalid_code',
      });
      expect(mocks.challenges.put).not.toHaveBeenCalled();
    });

    it('an expired provider session is not handed back', async () => {
      mocks.idp.respondEmailOtp.mockRejectedValue(new IdentityProviderError('expired', 'expired_session'));

      await expect(service.verify(SESSION_PRINCIPAL, 'challenge-token', '00000000', META)).rejects.toMatchObject({
        code: 'invalid_challenge',
      });
      expect(mocks.challenges.put).not.toHaveBeenCalled();
    });
  });
});
