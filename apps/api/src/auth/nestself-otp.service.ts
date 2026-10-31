/**
 * NestselfOtpService: one-time email codes that NestSelf itself issues, for the
 * two flows where Cognito cannot send one: the step-up of a federated user and
 * the confirmation of the mailbox in a pending SSO binding.
 *
 * - `issue` draws a code of `EMAIL_OTP_MAX_LENGTH` digits and mails it through
 *   the `Mailer`. Only when the mail was accepted does it store the challenge,
 *   so a refused mail leaves nothing behind. It answers with the challenge
 *   token and the masked address.
 * - `verify` checks a code. Three tries (`MAX_EMAIL_OTP_ATTEMPTS`), then the
 *   challenge is gone; success consumes it and returns what `issue` was given.
 * - `resend` mails a new code for the same challenge: same token, same
 *   deadline, same attempts (a resend never resets the budget), and at most one
 *   mail per `OTP_RESEND_COOLDOWN_SECONDS`, counted from the last mail, the
 *   first one included.
 *
 * Storage: `otp:{purpose}:{sha256(token)}` holds the record for `CHALLENGE_TTL`.
 * It keeps `sha256(token:code)`, never the code: a copy of the store cannot be
 * read as codes, and the same code on two challenges hashes differently. The
 * purpose is part of the key, so a token only opens the flow it was issued for.
 *
 * `verify` and `resend` take the record out of the store (GETDEL, as
 * `ChallengeStore.consume` does) and put it back for the time it has left, so
 * one request at a time works on a challenge. Parallel guesses cannot spend
 * more than the attempt budget, and a resend cannot bring back a challenge
 * that a verify has just consumed. A request that finds the record taken
 * answers `invalid_challenge`. A resend keeps the record out of the store for
 * as long as its mail is in flight: the renewed record goes in once the mail
 * was accepted, the previous one goes back if it was not. Nothing can change
 * the key in between, so the restore never overwrites a newer state.
 *
 * Failures: 401 `invalid_challenge` (unknown, expired or other purpose),
 * 401 `invalid_code`, 429 `too_many_attempts`, 429 `rate_limited` with
 * `details.retryAfter`, 503 `unavailable` when the provider refuses the mail
 * (`MailDeliveryError`). A resend whose mail fails puts the challenge back as it was.
 *
 * In stub mode (`AUTH_MODE` is not `cognito`) `FAKE_IDP_FIXED_OTP` fixes the
 * code, as it does for the fake identity provider, so Playwright types the
 * same code everywhere.
 *
 * Nothing here logs an address, a code or a token.
 *
 * @see docs/superpowers/specs/2026-10-30-auth-phase-4-pilot-readiness-design.md section 5.3
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EMAIL_OTP_MAX_LENGTH, type Locale } from '@nestself/contracts';
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { ApiHttpException } from '../common/api-error.js';
import { MailDeliveryError, Mailer } from '../email/mailer.js';
import { maskEmail } from '../email/mask-email.js';
import { KEY_VALUE_STORE, type KeyValueStore } from '../redis/key-value-store.js';
import {
  CHALLENGE_TTL,
  OTP_RESEND_COOLDOWN_SECONDS,
  otpKey,
  otpResendKey,
} from '../redis/redis-keys.js';
import { MAX_EMAIL_OTP_ATTEMPTS } from './sign-in.service.js';

export type OtpPurpose = 'step_up' | 'sso_bind';

export interface OtpIssueInput {
  purpose: OtpPurpose;
  email: string;
  /** The language of the mail. */
  locale: Locale;
  template: 'step_up_code' | 'sso_bind_code';
  /** Handed back by `verify` on success: what the caller needs to bind the code to (user, session, ...). */
  data: Record<string, string>;
}

interface OtpRecord {
  /** `sha256(token:code)` as hex. */
  codeHash: string;
  email: string;
  data: Record<string, string>;
  /** Wrong codes answered so far. */
  attempts: number;
  /** Epoch ms after which the challenge is dead. Set by `issue`, never moved. */
  expiresAt: number;
  /** The language of the latest mail. */
  locale: Locale;
  template: OtpIssueInput['template'];
}

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

const codeHash = (token: string, code: string): string => sha256(`${token}:${code}`);

function codeMatches(storedHash: string, token: string, code: string): boolean {
  const expected = Buffer.from(storedHash, 'hex');
  const given = Buffer.from(codeHash(token, code), 'hex');
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Whole minutes the code still lives, at least one: what the mail tells the reader. */
function minutesLeft(expiresAt: number): number {
  return Math.max(1, Math.round((expiresAt - Date.now()) / 60_000));
}

function invalidChallenge(): ApiHttpException {
  return new ApiHttpException({
    status: 401,
    code: 'invalid_challenge',
    message: 'Challenge expired or invalid',
  });
}

@Injectable()
export class NestselfOtpService {
  private readonly logger = new Logger(NestselfOtpService.name);

  constructor(
    @Inject(KEY_VALUE_STORE) private readonly store: KeyValueStore,
    @Inject(Mailer) private readonly mailer: Mailer,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  /** Starts a challenge: mails the code, then stores the challenge and starts the resend cooldown. */
  async issue(input: OtpIssueInput): Promise<{ challengeToken: string; emailMasked: string }> {
    const challengeToken = randomBytes(32).toString('base64url');
    const hash = sha256(challengeToken);
    const code = this.generateCode();
    const record: OtpRecord = {
      codeHash: codeHash(challengeToken, code),
      email: input.email,
      data: input.data,
      attempts: 0,
      expiresAt: Date.now() + CHALLENGE_TTL * 1000,
      locale: input.locale,
      template: input.template,
    };

    // Mail first. The token leaves this method only after the mail was accepted, so a
    // refused mail must leave neither a record (it holds the address) nor a cooldown.
    await this.deliver(record, code);
    await this.save(input.purpose, hash, record);
    await this.store.set(otpResendKey(input.purpose, hash), '1', {
      ttlSeconds: OTP_RESEND_COOLDOWN_SECONDS,
    });

    return { challengeToken, emailMasked: maskEmail(input.email) };
  }

  /**
   * Checks a code against the challenge of `purpose`. On success the challenge
   * is consumed and `{ email, data }` is returned. A wrong code keeps the
   * challenge, with the deadline it had, until the last allowed attempt.
   */
  async verify(
    purpose: OtpPurpose,
    challengeToken: string,
    code: string,
  ): Promise<{ email: string; data: Record<string, string> }> {
    const hash = sha256(challengeToken);
    const record = await this.take(purpose, hash);
    if (!record) throw invalidChallenge();

    if (codeMatches(record.codeHash, challengeToken, code)) {
      return { email: record.email, data: record.data };
    }

    const attempts = record.attempts + 1;
    if (attempts >= MAX_EMAIL_OTP_ATTEMPTS) {
      throw new ApiHttpException({
        status: 429,
        code: 'too_many_attempts',
        message: 'Too many failed attempts. Try again later.',
      });
    }
    await this.save(purpose, hash, { ...record, attempts });
    throw new ApiHttpException({
      status: 401,
      code: 'invalid_code',
      message: 'Invalid verification code',
    });
  }

  /**
   * Mails a new code for the same challenge. The old code stops working; the
   * token, the deadline and the attempts are unchanged. Refused with 429
   * `rate_limited` while the cooldown of the previous mail runs.
   */
  async resend(
    purpose: OtpPurpose,
    challengeToken: string,
    locale: Locale,
  ): Promise<{ emailMasked: string }> {
    const hash = sha256(challengeToken);
    const record = await this.take(purpose, hash);
    if (!record) throw invalidChallenge();

    // One atomic step both checks and starts the cooldown, so two resends at
    // once cannot both pass.
    const cooldownKey = otpResendKey(purpose, hash);
    const started = await this.store.set(cooldownKey, '1', {
      ttlSeconds: OTP_RESEND_COOLDOWN_SECONDS,
      onlyIfAbsent: true,
    });
    if (!started) {
      await this.save(purpose, hash, record);
      throw new ApiHttpException({
        status: 429,
        code: 'rate_limited',
        message: 'Wait before asking for another code',
        details: { retryAfter: Math.max(1, await this.store.ttl(cooldownKey)) },
      });
    }

    const code = this.generateCode();
    const renewed: OtpRecord = { ...record, codeHash: codeHash(challengeToken, code), locale };
    try {
      // The record is out of the store while the mail is in flight. A request that arrives
      // meanwhile finds the challenge taken and cannot change what is put back below.
      await this.deliver(renewed, code);
    } catch (error) {
      // The provider refused the mail, or did not answer, and then we cannot tell whether it
      // went out. Put the record back as it was, so the code sent before keeps working, and
      // release the cooldown so the user can ask again at once. A mail that did go out after
      // all carries a code that opens nothing.
      await this.save(purpose, hash, record);
      await this.store.del(cooldownKey);
      throw error;
    }
    await this.save(purpose, hash, renewed);
    return { emailMasked: maskEmail(record.email) };
  }

  /** Takes the record out of the store (GETDEL); null when it is unknown, taken or past its deadline. */
  private async take(purpose: OtpPurpose, hash: string): Promise<OtpRecord | null> {
    const raw = await this.store.getDel(otpKey(purpose, hash));
    if (!raw) return null;
    const record = JSON.parse(raw) as OtpRecord;
    // The store rounds a lifetime up to whole seconds; the deadline is exact.
    return record.expiresAt > Date.now() ? record : null;
  }

  /** Stores the record for the time it has left. A record past its deadline is not stored. */
  private async save(purpose: OtpPurpose, hash: string, record: OtpRecord): Promise<void> {
    const ttlSeconds = Math.min(Math.ceil((record.expiresAt - Date.now()) / 1000), CHALLENGE_TTL);
    if (ttlSeconds <= 0) return;
    await this.store.set(otpKey(purpose, hash), JSON.stringify(record), { ttlSeconds });
  }

  /** Mails the code in the record's locale and template; a refusal by the provider becomes 503. */
  private async deliver(record: OtpRecord, code: string): Promise<void> {
    try {
      await this.mailer.send({
        to: record.email,
        locale: record.locale,
        template: record.template,
        params: { code, minutes: String(minutesLeft(record.expiresAt)) },
      });
    } catch (error) {
      // Any other failure is a bug (a misnamed template param) and must stay one.
      if (!(error instanceof MailDeliveryError)) throw error;
      // The error carries a name and a status only, never the address.
      this.logger.warn(`Code email not delivered: template=${record.template} ${String(error)}`);
      throw new ApiHttpException({
        status: 503,
        code: 'unavailable',
        message: 'The verification code could not be sent. Try again later.',
      });
    }
  }

  private generateCode(): string {
    const fixed = this.config.get<string>('FAKE_IDP_FIXED_OTP');
    if (fixed && this.config.get<string>('AUTH_MODE', 'stub') !== 'cognito') return fixed;
    return randomInt(0, 10 ** EMAIL_OTP_MAX_LENGTH)
      .toString()
      .padStart(EMAIL_OTP_MAX_LENGTH, '0');
  }
}
