import { createHash, randomInt } from 'node:crypto';
import type * as NodeCrypto from 'node:crypto';
import { Logger } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { EMAIL_OTP_MAX_LENGTH } from '@nestself/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiHttpException } from '../common/api-error.js';
import { EmailModule } from '../email/email.module.js';
import { LoggingMailer } from '../email/logging-mailer.js';
import { MailDeliveryError, Mailer, type MailMessage } from '../email/mailer.js';
import { KEY_VALUE_STORE } from '../redis/key-value-store.js';
import { MemoryKeyValueStore } from '../redis/memory-key-value-store.js';
import {
  CHALLENGE_TTL,
  OTP_RESEND_COOLDOWN_SECONDS,
  otpKey,
  otpResendKey,
} from '../redis/redis-keys.js';
import { NestselfOtpService, type OtpIssueInput } from './nestself-otp.service.js';

// The service draws its codes from `randomInt`. It stays the real thing unless
// a test queues numbers with `drawNext`, which is how a test learns the code
// without reading it from the mail, and how zero-padding is pinned.
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeCrypto>();
  return { ...actual, randomInt: vi.fn(actual.randomInt) };
});

const NOW = new Date('2026-10-31T10:00:00Z');
const EMAIL = 'dragan@intesa.example';

const INPUT: OtpIssueInput = {
  purpose: 'step_up',
  email: EMAIL,
  locale: 'sr-Latn',
  template: 'step_up_code',
  data: { userId: 'user_1', target: 'session_1' },
};

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

function drawNext(...numbers: number[]): void {
  for (const n of numbers) vi.mocked(randomInt).mockReturnValueOnce(n as never);
}

function setup(env: Record<string, string> = {}) {
  const store = new MemoryKeyValueStore();
  const mailer = new LoggingMailer({ keepSent: true });
  const config = { get: (key: string, fallback?: string) => env[key] ?? fallback };
  const service = new NestselfOtpService(store, mailer, config as never);
  return { service, store, mailer };
}

type Ctx = ReturnType<typeof setup>;

/** The code of the n-th mail (the last one by default). */
function mailedCode(ctx: Ctx, index = -1): string {
  return ctx.mailer.sent.at(index)!.params.code!;
}

/** A code that is not `code`. */
function wrongCode(code: string): string {
  return code.slice(0, -1) + (code.endsWith('0') ? '1' : '0');
}

async function refusal(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('expected the call to be refused');
    },
    (error: unknown) => error,
  );
}

async function expectRefused(
  promise: Promise<unknown>,
  status: number,
  code: string,
): Promise<ApiHttpException> {
  const error = await refusal(promise);
  expect(error).toBeInstanceOf(ApiHttpException);
  expect((error as ApiHttpException).getStatus()).toBe(status);
  expect((error as ApiHttpException).code).toBe(code);
  return error as ApiHttpException;
}

const secondsLater = (seconds: number): void => {
  vi.advanceTimersByTime(seconds * 1000);
};

interface HeldSend {
  /** Resolves with the message once the service has handed it to the mailer. */
  handedOver: Promise<MailMessage>;
  /** The provider accepts the mail. */
  accept(): void;
  /** The provider refuses the mail. */
  refuse(error: Error): void;
}

/** Makes the next `send` wait for the test, so the test can act while a mail is in flight. */
function holdNextSend(ctx: Ctx): HeldSend {
  let handOver!: (message: MailMessage) => void;
  const handedOver = new Promise<MailMessage>((resolve) => {
    handOver = resolve;
  });
  let accept!: () => void;
  let refuse!: (error: Error) => void;
  const outcome = new Promise<void>((resolve, reject) => {
    accept = resolve;
    refuse = reject;
  });
  vi.spyOn(ctx.mailer, 'send').mockImplementationOnce(async (message) => {
    handOver(message);
    await outcome;
  });
  return { handedOver, accept, refuse };
}

describe('NestselfOtpService', () => {
  let ctx: Ctx;

  beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
    // The logging mailer says what it "sent" at debug level; the tests read `mailer.sent` instead.
    vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    ctx = setup();
  });

  afterEach(async () => {
    await ctx.store.close();
    vi.mocked(randomInt).mockReset();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('issue', () => {
    it('issues an 8-digit code, mails it in the locale and masks the address', async () => {
      const { challengeToken, emailMasked } = await ctx.service.issue(INPUT);

      expect(emailMasked).toBe('d***@intesa.example');
      expect(Buffer.from(challengeToken, 'base64url')).toHaveLength(32);
      expect(ctx.mailer.sent).toHaveLength(1);
      expect(ctx.mailer.sent[0]).toMatchObject({
        to: EMAIL,
        locale: 'sr-Latn',
        template: 'step_up_code',
        params: { minutes: '5' },
      });
      expect(mailedCode(ctx)).toMatch(new RegExp(`^\\d{${EMAIL_OTP_MAX_LENGTH}}$`));
    });

    it('mails the template the caller names', async () => {
      await ctx.service.issue({
        ...INPUT,
        purpose: 'sso_bind',
        template: 'sso_bind_code',
        locale: 'hu',
      });

      expect(ctx.mailer.sent[0]).toMatchObject({ template: 'sso_bind_code', locale: 'hu' });
    });

    it('draws the code from the whole range of EMAIL_OTP_MAX_LENGTH digits and zero-pads it', async () => {
      drawNext(42);

      await ctx.service.issue(INPUT);

      expect(randomInt).toHaveBeenCalledWith(0, 10 ** EMAIL_OTP_MAX_LENGTH);
      expect(mailedCode(ctx)).toBe('0'.repeat(EMAIL_OTP_MAX_LENGTH - 2) + '42');
      expect(mailedCode(ctx)).toHaveLength(EMAIL_OTP_MAX_LENGTH);
    });

    it('stores only a salted hash of the code, under the hashed token, for the challenge time', async () => {
      drawNext(12345678);

      const { challengeToken } = await ctx.service.issue(INPUT);

      const key = otpKey('step_up', sha256(challengeToken));
      const raw = await ctx.store.get(key);
      expect(JSON.parse(raw!)).toEqual({
        codeHash: sha256(`${challengeToken}:12345678`),
        email: EMAIL,
        data: INPUT.data,
        attempts: 0,
        expiresAt: NOW.getTime() + CHALLENGE_TTL * 1000,
        locale: 'sr-Latn',
        template: 'step_up_code',
      });
      expect(raw).not.toContain(challengeToken);
      expect(await ctx.store.ttl(key)).toBe(CHALLENGE_TTL);
    });

    it('salts the hash with the token, so the same code is stored differently on two challenges', async () => {
      drawNext(11111111, 11111111);
      const first = await ctx.service.issue(INPUT);
      const second = await ctx.service.issue(INPUT);

      const stored = async (token: string): Promise<string> =>
        (
          JSON.parse((await ctx.store.get(otpKey('step_up', sha256(token))))!) as {
            codeHash: string;
          }
        ).codeHash;

      expect(await stored(first.challengeToken)).not.toBe(await stored(second.challengeToken));
    });

    it('keeps the purposes apart in the store', async () => {
      const { challengeToken } = await ctx.service.issue({
        ...INPUT,
        purpose: 'sso_bind',
        template: 'sso_bind_code',
      });

      const hash = sha256(challengeToken);
      expect(await ctx.store.get(otpKey('sso_bind', hash))).not.toBeNull();
      expect(await ctx.store.get(otpKey('step_up', hash))).toBeNull();
    });

    it('gives every challenge its own token and its own code', async () => {
      drawNext(1, 2);

      const first = await ctx.service.issue(INPUT);
      const second = await ctx.service.issue(INPUT);

      expect(first.challengeToken).not.toBe(second.challengeToken);
      expect(mailedCode(ctx, 0)).not.toBe(mailedCode(ctx, 1));
    });

    it('starts the resend cooldown with the first mail', async () => {
      const { challengeToken } = await ctx.service.issue(INPUT);

      const cooldown = otpResendKey('step_up', sha256(challengeToken));
      expect(await ctx.store.ttl(cooldown)).toBe(OTP_RESEND_COOLDOWN_SECONDS);
    });

    describe('FAKE_IDP_FIXED_OTP', () => {
      it('uses FAKE_IDP_FIXED_OTP in stub mode', async () => {
        const stub = setup({ AUTH_MODE: 'stub', FAKE_IDP_FIXED_OTP: '123456' });

        const { challengeToken } = await stub.service.issue(INPUT);

        expect(mailedCode(stub)).toBe('123456');
        await expect(
          stub.service.verify('step_up', challengeToken, '123456'),
        ).resolves.toMatchObject({
          email: EMAIL,
        });
      });

      it('uses it when AUTH_MODE is not set at all: the default mode is stub', async () => {
        const unset = setup({ FAKE_IDP_FIXED_OTP: '123456' });

        await unset.service.issue(INPUT);

        expect(mailedCode(unset)).toBe('123456');
      });

      it('ignores FAKE_IDP_FIXED_OTP when AUTH_MODE is cognito', async () => {
        const cognito = setup({ AUTH_MODE: 'cognito', FAKE_IDP_FIXED_OTP: '123456' });
        drawNext(7);

        await cognito.service.issue(INPUT);

        expect(mailedCode(cognito)).toBe('0'.repeat(EMAIL_OTP_MAX_LENGTH - 1) + '7');
      });

      it('draws a random code in stub mode when no fixed code is set', async () => {
        const stub = setup({ AUTH_MODE: 'stub' });
        drawNext(7);

        await stub.service.issue(INPUT);

        expect(mailedCode(stub)).toBe('0'.repeat(EMAIL_OTP_MAX_LENGTH - 1) + '7');
      });
    });

    it('stores nothing until the mail is accepted, then the record and the cooldown', async () => {
      const held = holdNextSend(ctx);

      const issuing = ctx.service.issue(INPUT);
      const message = await held.handedOver;

      // The token is not out yet, and no record or cooldown exists for a code that may not arrive.
      expect(await ctx.store.scan('*')).toEqual([]);
      held.accept();
      const { challengeToken } = await issuing;
      expect(await ctx.store.scan('*')).toHaveLength(2);
      await expect(
        ctx.service.verify('step_up', challengeToken, message.params.code!),
      ).resolves.toMatchObject({ email: EMAIL });
    });

    describe('when the mail cannot be delivered', () => {
      it('answers 503 unavailable and logs the sanitised error, never the address', async () => {
        const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
        vi.spyOn(ctx.mailer, 'send').mockRejectedValue(
          new MailDeliveryError({ name: 'MessageRejected', httpStatus: 400 }),
        );

        await expectRefused(ctx.service.issue(INPUT), 503, 'unavailable');

        expect(warn).toHaveBeenCalledOnce();
        const line = String(warn.mock.calls[0]![0]);
        expect(line).toContain('step_up_code');
        expect(line).toContain('MessageRejected');
        expect(line).not.toContain('dragan');
        // The token never left the service, so nothing may stay behind: no record holding the address.
        expect(await ctx.store.scan('*')).toEqual([]);
      });

      it('lets any other failure through: a bad template param is a bug, not an outage', async () => {
        const bug = new Error('Mail template step_up_code needs the param minutes');
        vi.spyOn(ctx.mailer, 'send').mockRejectedValue(bug);

        await expect(ctx.service.issue(INPUT)).rejects.toBe(bug);

        expect(await ctx.store.scan('*')).toEqual([]);
      });
    });
  });

  describe('verify', () => {
    it('verifies once and deletes the record', async () => {
      const { challengeToken } = await ctx.service.issue(INPUT);

      const result = await ctx.service.verify('step_up', challengeToken, mailedCode(ctx));

      expect(result).toEqual({ email: EMAIL, data: INPUT.data });
      expect(await ctx.store.get(otpKey('step_up', sha256(challengeToken)))).toBeNull();
      await expectRefused(
        ctx.service.verify('step_up', challengeToken, mailedCode(ctx)),
        401,
        'invalid_challenge',
      );
    });

    it('answers 401 invalid_code for a wrong code and still accepts the right one', async () => {
      const { challengeToken } = await ctx.service.issue(INPUT);
      const code = mailedCode(ctx);

      await expectRefused(
        ctx.service.verify('step_up', challengeToken, wrongCode(code)),
        401,
        'invalid_code',
      );

      await expect(ctx.service.verify('step_up', challengeToken, code)).resolves.toMatchObject({
        email: EMAIL,
      });
    });

    it('keeps the record for two wrong codes and locks on the third', async () => {
      const { challengeToken } = await ctx.service.issue(INPUT);
      const code = mailedCode(ctx);
      const wrong = wrongCode(code);

      await expectRefused(
        ctx.service.verify('step_up', challengeToken, wrong),
        401,
        'invalid_code',
      );
      await expectRefused(
        ctx.service.verify('step_up', challengeToken, wrong),
        401,
        'invalid_code',
      );
      await expectRefused(
        ctx.service.verify('step_up', challengeToken, wrong),
        429,
        'too_many_attempts',
      );

      // The record is gone: not even the right code works any more.
      expect(await ctx.store.get(otpKey('step_up', sha256(challengeToken)))).toBeNull();
      await expectRefused(
        ctx.service.verify('step_up', challengeToken, code),
        401,
        'invalid_challenge',
      );
    });

    it('accepts the right code on the last allowed attempt', async () => {
      const { challengeToken } = await ctx.service.issue(INPUT);
      const code = mailedCode(ctx);

      await expectRefused(
        ctx.service.verify('step_up', challengeToken, wrongCode(code)),
        401,
        'invalid_code',
      );
      await expectRefused(
        ctx.service.verify('step_up', challengeToken, wrongCode(code)),
        401,
        'invalid_code',
      );

      await expect(ctx.service.verify('step_up', challengeToken, code)).resolves.toMatchObject({
        email: EMAIL,
      });
    });

    it('never extends the deadline: a wrong code keeps the time the challenge had left', async () => {
      const { challengeToken } = await ctx.service.issue(INPUT);
      const code = mailedCode(ctx);
      const key = otpKey('step_up', sha256(challengeToken));

      secondsLater(100);
      await expectRefused(
        ctx.service.verify('step_up', challengeToken, wrongCode(code)),
        401,
        'invalid_code',
      );

      expect(await ctx.store.ttl(key)).toBe(CHALLENGE_TTL - 100);
      expect(JSON.parse((await ctx.store.get(key))!)).toMatchObject({
        attempts: 1,
        expiresAt: NOW.getTime() + CHALLENGE_TTL * 1000,
      });
    });

    it('refuses the right code once the challenge time is over', async () => {
      const { challengeToken } = await ctx.service.issue(INPUT);

      secondsLater(CHALLENGE_TTL);

      await expectRefused(
        ctx.service.verify('step_up', challengeToken, mailedCode(ctx)),
        401,
        'invalid_challenge',
      );
    });

    it('holds the deadline to the second even when a retry rounds the store lifetime up', async () => {
      const { challengeToken } = await ctx.service.issue(INPUT);
      const code = mailedCode(ctx);

      // 100.5 s in: 199.5 s are left, which the store keeps for 200 s, half a second too long.
      vi.advanceTimersByTime(100_500);
      await expectRefused(
        ctx.service.verify('step_up', challengeToken, wrongCode(code)),
        401,
        'invalid_code',
      );

      vi.advanceTimersByTime(199_700);
      await expectRefused(
        ctx.service.verify('step_up', challengeToken, code),
        401,
        'invalid_challenge',
      );
    });

    it('refuses a token of another purpose and leaves the record alone', async () => {
      const { challengeToken } = await ctx.service.issue(INPUT);
      const code = mailedCode(ctx);

      await expectRefused(
        ctx.service.verify('sso_bind', challengeToken, code),
        401,
        'invalid_challenge',
      );

      await expect(ctx.service.verify('step_up', challengeToken, code)).resolves.toMatchObject({
        email: EMAIL,
      });
    });

    it('refuses a token it never issued', async () => {
      await ctx.service.issue(INPUT);

      await expectRefused(
        ctx.service.verify('step_up', 'a-token-nobody-issued', mailedCode(ctx)),
        401,
        'invalid_challenge',
      );
    });

    it('answers one guess at a time: parallel wrong codes cannot spend more than one attempt', async () => {
      const { challengeToken } = await ctx.service.issue(INPUT);
      const code = mailedCode(ctx);

      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () =>
          ctx.service.verify('step_up', challengeToken, wrongCode(code)),
        ),
      );

      const codes = results.map((r) =>
        r.status === 'rejected' ? (r.reason as ApiHttpException).code : 'accepted',
      );
      expect(codes.filter((c) => c === 'invalid_code')).toHaveLength(1);
      expect(codes.filter((c) => c === 'invalid_challenge')).toHaveLength(4);
      // The one guess was charged; the others never reached the comparison.
      expect(
        JSON.parse((await ctx.store.get(otpKey('step_up', sha256(challengeToken))))!),
      ).toMatchObject({
        attempts: 1,
      });
    });
  });

  describe('resend', () => {
    it('resend is refused inside the cooldown and allowed after it', async () => {
      drawNext(11111111, 22222222);
      const { challengeToken } = await ctx.service.issue(INPUT);

      const early = await expectRefused(
        ctx.service.resend('step_up', challengeToken, 'sr-Latn'),
        429,
        'rate_limited',
      );
      expect(early.details).toEqual({ retryAfter: OTP_RESEND_COOLDOWN_SECONDS });

      secondsLater(20);
      const later = await expectRefused(
        ctx.service.resend('step_up', challengeToken, 'sr-Latn'),
        429,
        'rate_limited',
      );
      expect(later.details).toEqual({ retryAfter: OTP_RESEND_COOLDOWN_SECONDS - 20 });
      expect(ctx.mailer.sent).toHaveLength(1);

      secondsLater(OTP_RESEND_COOLDOWN_SECONDS - 20);
      await expect(ctx.service.resend('step_up', challengeToken, 'sr-Latn')).resolves.toEqual({
        emailMasked: 'd***@intesa.example',
      });

      expect(ctx.mailer.sent).toHaveLength(2);
      expect(mailedCode(ctx)).toBe('22222222');
      // The old code is dead, the new one works.
      await expectRefused(
        ctx.service.verify('step_up', challengeToken, '11111111'),
        401,
        'invalid_code',
      );
      await expect(
        ctx.service.verify('step_up', challengeToken, '22222222'),
      ).resolves.toMatchObject({
        email: EMAIL,
      });
    });

    it('a refused resend leaves the challenge as it was', async () => {
      const { challengeToken } = await ctx.service.issue(INPUT);
      const code = mailedCode(ctx);

      await expectRefused(
        ctx.service.resend('step_up', challengeToken, 'sr-Latn'),
        429,
        'rate_limited',
      );

      await expect(ctx.service.verify('step_up', challengeToken, code)).resolves.toMatchObject({
        email: EMAIL,
      });
    });

    it('starts the cooldown again with every resend', async () => {
      const { challengeToken } = await ctx.service.issue(INPUT);

      secondsLater(OTP_RESEND_COOLDOWN_SECONDS);
      await ctx.service.resend('step_up', challengeToken, 'sr-Latn');

      const early = await expectRefused(
        ctx.service.resend('step_up', challengeToken, 'sr-Latn'),
        429,
        'rate_limited',
      );
      expect(early.details).toEqual({ retryAfter: OTP_RESEND_COOLDOWN_SECONDS });
      secondsLater(OTP_RESEND_COOLDOWN_SECONDS);
      await expect(ctx.service.resend('step_up', challengeToken, 'sr-Latn')).resolves.toBeDefined();
      expect(ctx.mailer.sent).toHaveLength(3);
    });

    it('keeps the token, the deadline and the attempts, so a resend does not reset the budget', async () => {
      drawNext(11111111, 22222222);
      const { challengeToken } = await ctx.service.issue(INPUT);
      const key = otpKey('step_up', sha256(challengeToken));
      await expectRefused(
        ctx.service.verify('step_up', challengeToken, '99999999'),
        401,
        'invalid_code',
      );

      secondsLater(OTP_RESEND_COOLDOWN_SECONDS);
      await ctx.service.resend('step_up', challengeToken, 'sr-Latn');

      expect(await ctx.store.ttl(key)).toBe(CHALLENGE_TTL - OTP_RESEND_COOLDOWN_SECONDS);
      expect(JSON.parse((await ctx.store.get(key))!)).toMatchObject({
        attempts: 1,
        expiresAt: NOW.getTime() + CHALLENGE_TTL * 1000,
        email: EMAIL,
        data: INPUT.data,
        template: 'step_up_code',
      });
      // Two more wrong codes use up the three attempts of the whole challenge.
      await expectRefused(
        ctx.service.verify('step_up', challengeToken, '99999999'),
        401,
        'invalid_code',
      );
      await expectRefused(
        ctx.service.verify('step_up', challengeToken, '99999999'),
        429,
        'too_many_attempts',
      );
    });

    it('does not extend the challenge: the new code dies at the original deadline', async () => {
      drawNext(11111111, 22222222);
      const { challengeToken } = await ctx.service.issue(INPUT);
      secondsLater(OTP_RESEND_COOLDOWN_SECONDS);
      await ctx.service.resend('step_up', challengeToken, 'sr-Latn');

      secondsLater(CHALLENGE_TTL - OTP_RESEND_COOLDOWN_SECONDS);

      await expectRefused(
        ctx.service.verify('step_up', challengeToken, '22222222'),
        401,
        'invalid_challenge',
      );
    });

    it('mails the resend in the locale it was asked for and says how long the code still lives', async () => {
      const { challengeToken } = await ctx.service.issue(INPUT);

      secondsLater(OTP_RESEND_COOLDOWN_SECONDS);
      await ctx.service.resend('step_up', challengeToken, 'hu');

      expect(ctx.mailer.sent[1]).toMatchObject({
        to: EMAIL,
        locale: 'hu',
        template: 'step_up_code',
        params: { minutes: '4' },
      });
      // The record names the language of the latest mail.
      const stored = await ctx.store.get(otpKey('step_up', sha256(challengeToken)));
      expect(JSON.parse(stored!)).toMatchObject({ locale: 'hu' });
    });

    it('mails the same template the challenge was issued with', async () => {
      const { challengeToken } = await ctx.service.issue({
        ...INPUT,
        purpose: 'sso_bind',
        template: 'sso_bind_code',
      });

      secondsLater(OTP_RESEND_COOLDOWN_SECONDS);
      await ctx.service.resend('sso_bind', challengeToken, 'en');

      expect(ctx.mailer.sent[1]).toMatchObject({ template: 'sso_bind_code', locale: 'en' });
    });

    it('refuses a token it never issued without leaving a cooldown behind', async () => {
      await expectRefused(
        ctx.service.resend('step_up', 'a-token-nobody-issued', 'en'),
        401,
        'invalid_challenge',
      );

      expect(await ctx.store.scan('otp_resend:*')).toEqual([]);
      expect(ctx.mailer.sent).toEqual([]);
    });

    it('refuses a token of another purpose and sends nothing', async () => {
      const { challengeToken } = await ctx.service.issue(INPUT);
      secondsLater(OTP_RESEND_COOLDOWN_SECONDS);

      await expectRefused(
        ctx.service.resend('sso_bind', challengeToken, 'en'),
        401,
        'invalid_challenge',
      );

      expect(ctx.mailer.sent).toHaveLength(1);
    });

    it('hands the data the challenge was issued with to the accept check, and resends when it agrees', async () => {
      const { challengeToken } = await ctx.service.issue(INPUT);
      secondsLater(OTP_RESEND_COOLDOWN_SECONDS);
      const accept = vi.fn(() => true);

      await expect(ctx.service.resend('step_up', challengeToken, 'en', accept)).resolves.toEqual({
        emailMasked: 'd***@intesa.example',
      });

      expect(accept).toHaveBeenCalledWith(INPUT.data);
      expect(ctx.mailer.sent).toHaveLength(2);
    });

    it('a resend the accept check refuses changes nothing: invalid_challenge, no mail, the record and the cooldown as they were', async () => {
      drawNext(11111111);
      const { challengeToken } = await ctx.service.issue(INPUT);
      const key = otpKey('step_up', sha256(challengeToken));
      const cooldown = otpResendKey('step_up', sha256(challengeToken));
      await expectRefused(ctx.service.verify('step_up', challengeToken, '99999999'), 401, 'invalid_code');
      const before = await ctx.store.get(key);
      secondsLater(20);

      // Inside the cooldown the check comes first: invalid_challenge, not rate_limited.
      await expectRefused(
        ctx.service.resend('step_up', challengeToken, 'en', () => false),
        401,
        'invalid_challenge',
      );
      expect(ctx.mailer.sent).toHaveLength(1);
      expect(await ctx.store.get(key)).toBe(before);
      expect(await ctx.store.ttl(cooldown)).toBe(OTP_RESEND_COOLDOWN_SECONDS - 20);

      // After the cooldown: refused again, and no cooldown is started.
      secondsLater(OTP_RESEND_COOLDOWN_SECONDS);
      await expectRefused(
        ctx.service.resend('step_up', challengeToken, 'en', () => false),
        401,
        'invalid_challenge',
      );
      expect(ctx.mailer.sent).toHaveLength(1);
      expect(await ctx.store.get(cooldown)).toBeNull();
      // The code sent first still works, with the attempts it had.
      expect(await ctx.store.get(key)).toBe(before);
      await expect(ctx.service.verify('step_up', challengeToken, '11111111')).resolves.toMatchObject({
        email: EMAIL,
      });
    });

    it('refuses a resend after the challenge time is over', async () => {
      const { challengeToken } = await ctx.service.issue(INPUT);

      secondsLater(CHALLENGE_TTL);

      await expectRefused(
        ctx.service.resend('step_up', challengeToken, 'en'),
        401,
        'invalid_challenge',
      );
    });

    it('cannot bring back a challenge that was verified', async () => {
      const { challengeToken } = await ctx.service.issue(INPUT);
      await ctx.service.verify('step_up', challengeToken, mailedCode(ctx));
      secondsLater(OTP_RESEND_COOLDOWN_SECONDS);

      await expectRefused(
        ctx.service.resend('step_up', challengeToken, 'en'),
        401,
        'invalid_challenge',
      );
    });

    describe('when the mail cannot be delivered', () => {
      beforeEach(() => {
        vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      });

      it('answers 503 unavailable and changes nothing: the first code still works', async () => {
        const { challengeToken } = await ctx.service.issue(INPUT);
        const code = mailedCode(ctx);
        secondsLater(OTP_RESEND_COOLDOWN_SECONDS);
        vi.spyOn(ctx.mailer, 'send').mockRejectedValueOnce(
          new MailDeliveryError({ name: 'Throttling', httpStatus: 400 }),
        );

        await expectRefused(
          ctx.service.resend('step_up', challengeToken, 'en'),
          503,
          'unavailable',
        );

        await expect(ctx.service.verify('step_up', challengeToken, code)).resolves.toMatchObject({
          email: EMAIL,
        });
      });

      it('does not spend the cooldown: the user can ask again at once', async () => {
        const { challengeToken } = await ctx.service.issue(INPUT);
        secondsLater(OTP_RESEND_COOLDOWN_SECONDS);
        vi.spyOn(ctx.mailer, 'send').mockRejectedValueOnce(
          new MailDeliveryError({ name: 'Throttling', httpStatus: 400 }),
        );
        await expectRefused(
          ctx.service.resend('step_up', challengeToken, 'en'),
          503,
          'unavailable',
        );

        await expect(ctx.service.resend('step_up', challengeToken, 'en')).resolves.toEqual({
          emailMasked: 'd***@intesa.example',
        });
        await expect(
          ctx.service.verify('step_up', challengeToken, mailedCode(ctx)),
        ).resolves.toMatchObject({ email: EMAIL });
      });

      it('lets any other failure through and still restores the record', async () => {
        const { challengeToken } = await ctx.service.issue(INPUT);
        const code = mailedCode(ctx);
        secondsLater(OTP_RESEND_COOLDOWN_SECONDS);
        const bug = new Error('Mail template step_up_code needs the param minutes');
        vi.spyOn(ctx.mailer, 'send').mockRejectedValueOnce(bug);

        await expect(ctx.service.resend('step_up', challengeToken, 'en')).rejects.toBe(bug);

        expect(await ctx.store.get(otpResendKey('step_up', sha256(challengeToken)))).toBeNull();
        await expect(ctx.service.verify('step_up', challengeToken, code)).resolves.toMatchObject({
          email: EMAIL,
        });
      });
    });

    describe('while its mail is in flight', () => {
      beforeEach(() => {
        vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      });

      /** A challenge with one wrong guess on it, whose resend is stopped at the mailer. */
      async function resendStoppedAtTheMailer() {
        const { challengeToken } = await ctx.service.issue(INPUT);
        const first = mailedCode(ctx);
        await expectRefused(
          ctx.service.verify('step_up', challengeToken, wrongCode(first)),
          401,
          'invalid_code',
        );
        secondsLater(OTP_RESEND_COOLDOWN_SECONDS);
        const held = holdNextSend(ctx);
        const resending = ctx.service.resend('step_up', challengeToken, 'en');
        const second = (await held.handedOver).params.code!;
        return { challengeToken, first, second, held, resending };
      }

      it('counts no guess and locks nothing: the challenge is taken, and a refused mail puts it back as it was', async () => {
        const { challengeToken, first, held, resending } = await resendStoppedAtTheMailer();
        const refusedResend = refusal(resending);

        // Three guesses while the mail is out would lock a challenge that evaluated them.
        for (let guess = 0; guess < 3; guess++) {
          await expectRefused(
            ctx.service.verify('step_up', challengeToken, wrongCode(first)),
            401,
            'invalid_challenge',
          );
        }
        held.refuse(new MailDeliveryError({ name: 'Throttling', httpStatus: 400 }));
        expect(await refusedResend).toMatchObject({ code: 'unavailable' });

        // As it was: the one guess made before the resend still counts, the three in flight did not.
        const stored = await ctx.store.get(otpKey('step_up', sha256(challengeToken)));
        expect(JSON.parse(stored!)).toMatchObject({
          attempts: 1,
          codeHash: sha256(`${challengeToken}:${first}`),
        });
        await expectRefused(
          ctx.service.verify('step_up', challengeToken, wrongCode(first)),
          401,
          'invalid_code',
        );
        await expectRefused(
          ctx.service.verify('step_up', challengeToken, wrongCode(first)),
          429,
          'too_many_attempts',
        );
      });

      it('does not accept the new code before its mail is out, so a refused mail cannot leave a challenge consumed twice', async () => {
        const { challengeToken, first, second, held, resending } = await resendStoppedAtTheMailer();
        const refusedResend = refusal(resending);

        // The new code is in the mailer's hands but not in the store: it opens nothing yet.
        await expectRefused(
          ctx.service.verify('step_up', challengeToken, second),
          401,
          'invalid_challenge',
        );
        held.refuse(new MailDeliveryError({ name: 'Throttling', httpStatus: 400 }));
        expect(await refusedResend).toMatchObject({ code: 'unavailable' });

        // The first code opens the challenge once, and only once.
        await expect(ctx.service.verify('step_up', challengeToken, first)).resolves.toMatchObject({
          email: EMAIL,
        });
        await expectRefused(
          ctx.service.verify('step_up', challengeToken, first),
          401,
          'invalid_challenge',
        );
      });

      it('keeps the old code shut as well, and opens the new one when the mail is accepted', async () => {
        const { challengeToken, first, second, held, resending } = await resendStoppedAtTheMailer();

        await expectRefused(
          ctx.service.verify('step_up', challengeToken, first),
          401,
          'invalid_challenge',
        );
        held.accept();
        await expect(resending).resolves.toEqual({ emailMasked: 'd***@intesa.example' });

        await expectRefused(
          ctx.service.verify('step_up', challengeToken, first),
          401,
          'invalid_code',
        );
        await expect(ctx.service.verify('step_up', challengeToken, second)).resolves.toMatchObject({
          email: EMAIL,
        });
      });
    });
  });

  describe('what the service leaves in the logs', () => {
    it('logs no address, code or token while a challenge runs its course', async () => {
      const spies = (['log', 'warn', 'debug', 'error', 'verbose'] as const).map((level) =>
        vi.spyOn(Logger.prototype, level).mockImplementation(() => undefined),
      );
      const { challengeToken } = await ctx.service.issue(INPUT);
      await refusal(ctx.service.verify('step_up', challengeToken, wrongCode(mailedCode(ctx))));
      secondsLater(OTP_RESEND_COOLDOWN_SECONDS);
      await ctx.service.resend('step_up', challengeToken, 'en');
      await ctx.service.verify('step_up', challengeToken, mailedCode(ctx));

      const lines = spies.flatMap((spy) => spy.mock.calls.map(([line]) => String(line)));
      // The logging mailer's own debug line: the template, the locale and the domain.
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        for (const secret of [challengeToken, mailedCode(ctx, 0), mailedCode(ctx, 1), 'dragan']) {
          expect(line).not.toContain(secret);
        }
      }
    });
  });
});

describe('NestselfOtpService in a Nest module', () => {
  it('is built from the key-value store, the global mailer and the config', async () => {
    vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    const store = new MemoryKeyValueStore();
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), EmailModule],
      providers: [{ provide: KEY_VALUE_STORE, useValue: store }, NestselfOtpService],
    }).compile();

    const service = moduleRef.get(NestselfOtpService);
    const { challengeToken } = await service.issue(INPUT);
    // NODE_ENV=test in the unit test environment: the logging adapter, which keeps what it "sent".
    const code = (moduleRef.get(Mailer) as LoggingMailer).sent[0]!.params.code!;

    await expect(service.verify('step_up', challengeToken, code)).resolves.toEqual({
      email: EMAIL,
      data: INPUT.data,
    });
    await moduleRef.close();
    await store.close();
    vi.restoreAllMocks();
  });
});
