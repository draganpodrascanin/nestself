import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MAX_EMAIL_OTP_ATTEMPTS, SignInService } from './sign-in.service.js';
import { IdentityProviderError } from '../identity/identity-provider.service.js';
import { ApiHttpException } from '../common/api-error.js';
import type { ChallengeRecord } from './challenge-store.js';

const META = { ip: '203.0.113.7', userAgent: 'vitest' };

const CHALLENGE: ChallengeRecord = {
  kind: 'email_otp',
  username: 'pool-user',
  email: 'a@b.co',
  session: 'idp-session',
  expiresAt: Date.now() + 300_000,
};

function createMocks() {
  return {
    idp: {
      startEmailOtp: vi.fn().mockResolvedValue({ session: 'idp-session', username: 'pool-user' }),
      respondEmailOtp: vi.fn(),
    },
    challenges: {
      create: vi.fn().mockResolvedValue('challenge-token'),
      consume: vi.fn().mockResolvedValue(CHALLENGE),
      put: vi.fn().mockResolvedValue(undefined),
    },
    throttle: {
      isLocked: vi.fn().mockResolvedValue(false),
      recordFailure: vi.fn().mockResolvedValue(undefined),
    },
    identity: {
      resolveOutcome: vi.fn(),
      auditSignInFailed: vi.fn(),
      mapIdpError: vi.fn(
        (err: IdentityProviderError) =>
          new ApiHttpException({ status: 401, code: err.code === 'invalid_code' ? 'invalid_code' : 'invalid_challenge', message: err.message }),
      ),
    },
  };
}

describe('SignInService', () => {
  let mocks: ReturnType<typeof createMocks>;
  let service: SignInService;

  beforeEach(() => {
    mocks = createMocks();
    service = new SignInService(
      mocks.idp as never,
      mocks.challenges as never,
      mocks.throttle as never,
      mocks.identity as never,
    );
  });

  describe('emailOtpStart', () => {
    it('forwards the locale to the identity provider', async () => {
      await service.emailOtpStart('a@b.co', META, 'hu');
      expect(mocks.idp.startEmailOtp).toHaveBeenCalledWith({ email: 'a@b.co', locale: 'hu' });
    });

    it('leaves the locale out when the caller sent none', async () => {
      await service.emailOtpStart('a@b.co', META);
      expect(mocks.idp.startEmailOtp).toHaveBeenCalledWith({ email: 'a@b.co' });
    });
  });

  describe('emailOtpVerify', () => {
    const wrongCode = () =>
      mocks.idp.respondEmailOtp.mockRejectedValue(new IdentityProviderError('bad code', 'invalid_code'));

    it('a wrong code hands the challenge back with one more attempt and still counts a failure', async () => {
      wrongCode();
      await expect(service.emailOtpVerify('challenge-token', '00000000', 'workspace', META)).rejects.toMatchObject({
        code: 'invalid_code',
      });
      expect(mocks.challenges.put).toHaveBeenCalledWith('challenge-token', { ...CHALLENGE, attempts: 1 });
      expect(mocks.throttle.recordFailure).toHaveBeenCalledWith('a@b.co');
    });

    it(`the wrong code that reaches ${MAX_EMAIL_OTP_ATTEMPTS} attempts lets the token die`, async () => {
      mocks.challenges.consume.mockResolvedValue({ ...CHALLENGE, attempts: MAX_EMAIL_OTP_ATTEMPTS - 1 });
      wrongCode();
      await expect(service.emailOtpVerify('challenge-token', '00000000', 'workspace', META)).rejects.toMatchObject({
        code: 'invalid_code',
      });
      expect(mocks.challenges.put).not.toHaveBeenCalled();
      expect(mocks.throttle.recordFailure).toHaveBeenCalledWith('a@b.co');
    });

    it('a provider error other than a wrong code is not handed back', async () => {
      mocks.idp.respondEmailOtp.mockRejectedValue(new IdentityProviderError('expired', 'expired_session'));
      await expect(service.emailOtpVerify('challenge-token', '00000000', 'workspace', META)).rejects.toMatchObject({
        code: 'invalid_challenge',
      });
      expect(mocks.challenges.put).not.toHaveBeenCalled();
    });

    it('a dummy challenge for an unknown address gets the same retry budget', async () => {
      const dummy: ChallengeRecord = { ...CHALLENGE, username: '', session: '', dummy: true };
      mocks.challenges.consume.mockResolvedValue(dummy);
      await expect(service.emailOtpVerify('challenge-token', '00000000', 'workspace', META)).rejects.toMatchObject({
        code: 'invalid_code',
      });
      expect(mocks.challenges.put).toHaveBeenCalledWith('challenge-token', { ...dummy, attempts: 1 });
      expect(mocks.idp.respondEmailOtp).not.toHaveBeenCalled();
    });
  });
});
