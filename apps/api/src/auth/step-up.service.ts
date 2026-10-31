/**
 * StepUpService: re-authentication before a sensitive action.
 *
 * `start` mails a code and answers with the challenge token and the masked
 * address:
 * - a native user (a `cognito` identity whose pool user still exists) gets
 *   Cognito's EMAIL_OTP in the principal's locale; the challenge lives in the
 *   `ChallengeStore`, bound to the user;
 * - otherwise a federated user gets a code NestSelf issues and mails itself
 *   (`NestselfOtpService`, purpose `step_up`) to the address of the federated
 *   identity (the address the employer's IdP asserted on a verified domain,
 *   never `users.email`), bound to the user and to the session or token family
 *   that asked. With several federated identities, the one bound to an ACTIVE
 *   connection wins, else the most recently seen one, else the first;
 * - anyone else gets 403 `step_up_unavailable`.
 *
 * `verify` checks the per-user lock first (`StepUpThrottle`, 429
 * `too_many_attempts`), then dispatches on the token: a `ChallengeStore`
 * record is the Cognito kind, any other token goes to the NestSelf store. A
 * challenge minted for another user, or a NestSelf challenge minted in
 * another session or token family of the same user, is refused with 401
 * `invalid_challenge`, audited as `foreign_challenge` and spent. Wrong codes
 * of both kinds count toward the lock; a success clears it. The third wrong
 * code on a NestSelf challenge ends that challenge with 401
 * `invalid_challenge`, not the 429 of the lock. The step-up lands on the
 * session (`markStepUp`, then `regenerate`) for web callers, or under
 * `stepUpKey(tokenFamily)` for bearer callers, and is audited with its
 * issuer. The token set a Cognito re-authentication returns is discarded; its
 * refresh token is revoked.
 *
 * `resend` mails a new code at most once per `OTP_RESEND_COOLDOWN_SECONDS`,
 * counted from the previous mail, the first one included (429 `rate_limited`
 * with `details.retryAfter`). The Cognito kind starts a new provider
 * challenge under a new token and spends the old one; the NestSelf kind keeps
 * its token. Neither resets the wrong codes counted on the challenge. Another
 * user's challenge of either kind, and a NestSelf challenge of another session
 * or token family, is refused, audited as `foreign_challenge` and not resent.
 *
 * Every user steps up with an email code, `password_totp` users included
 * (Cognito cannot issue SOFTWARE_TOKEN_MFA without a password). Federated
 * users get a NestSelf code rather than an IdP round trip: Cognito forwards
 * neither `prompt=login` nor SAML `ForceAuthn`, so a fresh `auth_time` would
 * not prove that the user re-authenticated (phase 4 design, 4.1).
 *
 * @see 3.6.9, SESS-R-10, SESS-R-18, SSO-R-17, T-2.6; phase 4 design 5.4
 */
import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { LocaleSchema } from '@nestself/contracts';
import type { Locale, Principal, StepUpStartResponse } from '@nestself/contracts';

import {
  IdentityProviderService,
  IdentityProviderError,
} from '../identity/identity-provider.service.js';

import { ChallengeStore, type ChallengeRecord } from './challenge-store.js';
import { retainAfterWrongCode } from './sign-in.service.js';
import { NestselfOtpService } from './nestself-otp.service.js';
import { StepUpThrottle } from './step-up-throttle.js';

import { SessionService } from '../session/session.service.js';
import { hashSessionId } from '../session/session-helpers.js';

import { IdentityRepository, type ExternalIdentityRow } from '../db/repositories/identity.repository.js';
import { SsoRepository } from '../db/repositories/sso.repository.js';

import { IdentityResolutionService } from './identity-resolution.service.js';

import { AuditWriter } from '../audit/audit-writer.js';
import { maskEmail } from '../email/mask-email.js';
import { KEY_VALUE_STORE, type KeyValueStore } from '../redis/key-value-store.js';
import {
  OTP_RESEND_COOLDOWN_SECONDS,
  otpResendKey,
  stepUpKey,
  STEP_UP_BEARER_TTL,
} from '../redis/redis-keys.js';
import { ApiHttpException, SessionExpiredError } from '../common/api-error.js';

type Meta = { ip: string | null; userAgent: string | null };

export interface StepUpVerifyResult {
  /** Present for session callers: the regenerated session, cookies must be set again. */
  session?: { sessionId: string; csrfToken: string; absoluteExpiresAt: Date };
}

const STEP_UP_METHOD = 'email_otp' as const;

/** The `otpResendKey` purpose of the Cognito kind; NestSelf challenges keep their own (`step_up`). */
const COGNITO_RESEND_PURPOSE = 'step_up_cognito';

/** Mail language for a principal whose stored locale is not one of the four. */
const FALLBACK_LOCALE: Locale = 'sr-Latn';

function invalidChallenge(): ApiHttpException {
  return new ApiHttpException({
    status: 401,
    code: 'invalid_challenge',
    message: 'Challenge expired or invalid',
  });
}

function stepUpUnavailable(): ApiHttpException {
  return new ApiHttpException({
    status: 403,
    code: 'step_up_unavailable',
    message: 'Step-up is not available for this account',
  });
}

function principalLocale(principal: Principal): Locale {
  const parsed = LocaleSchema.safeParse(principal.locale);
  return parsed.success ? parsed.data : FALLBACK_LOCALE;
}

/**
 * Where the step-up was asked for: the session, by the hash the session store
 * keys it with (the raw id is never persisted, 3.6.1), or the token family.
 */
function stepUpTarget(principal: Principal): string {
  return principal.sessionId
    ? `session:${hashSessionId(principal.sessionId)}`
    : `family:${principal.tokenFamily}`;
}

/**
 * A NestSelf step-up challenge belongs to the user it was minted for and to
 * the session or token family that asked (`target`): a code minted in one
 * session never steps up another, even of the same user.
 */
function ownsNestselfChallenge(principal: Principal, data: Record<string, string>): boolean {
  return data.userId === principal.userId && data.target === stepUpTarget(principal);
}

@Injectable()
export class StepUpService {
  private readonly logger = new Logger(StepUpService.name);

  constructor(
    @Inject(forwardRef(() => IdentityProviderService)) private readonly idp: IdentityProviderService,
    @Inject(forwardRef(() => ChallengeStore)) private readonly challenges: ChallengeStore,
    @Inject(forwardRef(() => SessionService)) private readonly sessions: SessionService,
    @Inject(forwardRef(() => IdentityRepository)) private readonly identities: IdentityRepository,
    @Inject(forwardRef(() => IdentityResolutionService)) private readonly identityResolution: IdentityResolutionService,
    @Inject(forwardRef(() => AuditWriter)) private readonly audit: AuditWriter,
    @Inject(KEY_VALUE_STORE) private readonly store: KeyValueStore,
    @Inject(forwardRef(() => NestselfOtpService)) private readonly otp: NestselfOtpService,
    @Inject(forwardRef(() => StepUpThrottle)) private readonly throttle: StepUpThrottle,
    @Inject(forwardRef(() => SsoRepository)) private readonly sso: SsoRepository,
  ) {}

  async start(
    principal: Principal,
    _meta: Meta,
    surface: 'workspace' | 'admin',
  ): Promise<StepUpStartResponse> {
    this.assertRecordable(principal);
    await this.assertNotLocked(principal);
    const locale = principalLocale(principal);

    const identities = await this.identities.findExternalIdentitiesForUser(principal.userId);
    const native = identities.find((i) => i.provider === 'cognito');
    if (native) {
      const started = await this.startCognitoCode(native.email, locale);
      if (started) {
        const challengeToken = await this.challenges.create({
          kind: 'email_otp',
          username: started.username,
          email: native.email,
          session: started.session,
          surface,
          stepUp: { userId: principal.userId },
        });
        await this.startResendCooldown(challengeToken);
        return this.startResponse(challengeToken, native.email);
      }
      // The linked pool user is gone; a federated identity can still take the code.
    }

    const federated = await this.federatedIdentityFor(identities);
    if (!federated) throw stepUpUnavailable();
    const { challengeToken, emailMasked } = await this.otp.issue({
      purpose: 'step_up',
      email: federated.email,
      locale,
      template: 'step_up_code',
      data: { userId: principal.userId, target: stepUpTarget(principal) },
    });
    return { method: STEP_UP_METHOD, challengeToken, ssoStartUrl: null, emailMasked };
  }

  async verify(
    principal: Principal,
    challengeToken: string,
    response: string,
    meta: Meta,
  ): Promise<StepUpVerifyResult> {
    this.assertRecordable(principal);
    await this.assertNotLocked(principal);

    const challenge = await this.challenges.consume(challengeToken);
    if (challenge) {
      await this.verifyCognito(principal, challengeToken, challenge, response, meta);
    } else {
      await this.verifyNestself(principal, challengeToken, response, meta);
    }
    await this.throttle.reset(principal.userId);

    const now = new Date();
    let result: StepUpVerifyResult = {};
    if (principal.sessionId) {
      await this.sessions.markStepUp(principal.sessionId, now);
      const regenerated = await this.sessions.regenerate(principal.sessionId);
      const record = await this.sessions.get(regenerated.sessionId);
      if (!record) throw new SessionExpiredError();
      result = {
        session: { ...regenerated, absoluteExpiresAt: new Date(record.absoluteExpiresAt) },
      };
    } else {
      await this.store.set(
        stepUpKey(principal.tokenFamily!),
        JSON.stringify({ lastStepUpAt: now.toISOString() }),
        { ttlSeconds: STEP_UP_BEARER_TTL },
      );
    }

    await this.record(principal, 'auth.step_up.completed', meta, {
      method: STEP_UP_METHOD,
      issuer: challenge ? 'cognito' : 'nestself',
    });
    return result;
  }

  /** A new code for the challenge of an earlier `start`; see the class comment for the two kinds. */
  async resend(principal: Principal, challengeToken: string, meta: Meta): Promise<StepUpStartResponse> {
    this.assertRecordable(principal);
    await this.assertNotLocked(principal);
    const locale = principalLocale(principal);

    const challenge = await this.challenges.consume(challengeToken);
    if (!challenge) return this.resendNestself(principal, challengeToken, locale, meta);
    await this.assertOwnStepUpChallenge(principal, challenge, meta);

    const cooldown = this.resendCooldownKey(challengeToken);
    if (await this.store.get(cooldown)) {
      await this.challenges.put(challengeToken, challenge);
      throw new ApiHttpException({
        status: 429,
        code: 'rate_limited',
        message: 'Wait before asking for another code',
        details: { retryAfter: Math.max(1, await this.store.ttl(cooldown)) },
      });
    }

    let started: { session: string; username: string } | null;
    try {
      started = await this.startCognitoCode(challenge.email, locale);
    } catch (err) {
      // No new code went out: the one sent before keeps working.
      await this.challenges.put(challengeToken, challenge);
      throw err;
    }
    // The pool user is gone: the old challenge cannot complete either.
    if (!started) throw stepUpUnavailable();

    const next = await this.challenges.create({
      kind: 'email_otp',
      username: started.username,
      email: challenge.email,
      session: started.session,
      ...(challenge.surface ? { surface: challenge.surface } : {}),
      stepUp: { userId: principal.userId },
      ...(challenge.attempts ? { attempts: challenge.attempts } : {}),
    });
    await this.startResendCooldown(next);
    return this.startResponse(next, challenge.email);
  }

  /**
   * A NestSelf challenge keeps its token. One minted for another user, or for
   * another session or token family of this user, is not resent (the record
   * goes back untouched) and is recorded like a foreign Cognito challenge.
   */
  private async resendNestself(
    principal: Principal,
    challengeToken: string,
    locale: Locale,
    meta: Meta,
  ): Promise<StepUpStartResponse> {
    let foreign = false;
    const ownChallenge = (data: Record<string, string>): boolean => {
      foreign = !ownsNestselfChallenge(principal, data);
      return !foreign;
    };
    try {
      const { emailMasked } = await this.otp.resend('step_up', challengeToken, locale, ownChallenge);
      return { method: STEP_UP_METHOD, challengeToken, ssoStartUrl: null, emailMasked };
    } catch (err) {
      if (foreign) await this.recordForeignChallenge(principal, meta);
      throw err;
    }
  }

  private async verifyCognito(
    principal: Principal,
    challengeToken: string,
    challenge: ChallengeRecord,
    response: string,
    meta: Meta,
  ): Promise<void> {
    await this.assertOwnStepUpChallenge(principal, challenge, meta);
    const refreshToken = await this.reauthenticate(principal, challengeToken, challenge, response, meta);
    if (refreshToken) {
      try {
        await this.idp.revokeRefreshToken(refreshToken);
      } catch (err) {
        this.logger.warn(err, 'Failed to revoke the step-up refresh token');
      }
    }
  }

  /**
   * A NestSelf code: three tries per challenge (`NestselfOtpService`), bound to
   * the user it was minted for and to the session or token family that asked
   * for it. The third wrong code ends that challenge only, so it answers 401
   * `invalid_challenge` (ask for a new one) rather than the 429 of the
   * per-user lock.
   */
  private async verifyNestself(
    principal: Principal,
    challengeToken: string,
    response: string,
    meta: Meta,
  ): Promise<void> {
    let data: Record<string, string>;
    try {
      ({ data } = await this.otp.verify('step_up', challengeToken, response));
    } catch (err) {
      // `too_many_attempts` from `otp.verify` is the third wrong code on this challenge.
      if (err instanceof ApiHttpException && (err.code === 'invalid_code' || err.code === 'too_many_attempts')) {
        await this.throttle.recordFailure(principal.userId);
        await this.record(principal, 'auth.step_up.failed', meta, { method: STEP_UP_METHOD, reason: err.code });
        if (err.code === 'too_many_attempts') throw invalidChallenge();
      }
      throw err;
    }
    if (!ownsNestselfChallenge(principal, data)) {
      // Another user's challenge, or one minted in another session or token
      // family. The code matched, so the challenge is spent for its owner too.
      await this.recordForeignChallenge(principal, meta);
      throw invalidChallenge();
    }
  }

  /**
   * Only a step-up challenge of this user goes on. One minted for someone else
   * is refused and recorded (never the token or the code); a sign-in challenge
   * is refused as unknown.
   */
  private async assertOwnStepUpChallenge(
    principal: Principal,
    challenge: ChallengeRecord,
    meta: Meta,
  ): Promise<void> {
    if (challenge.stepUp && challenge.stepUp.userId !== principal.userId) {
      await this.recordForeignChallenge(principal, meta);
      throw invalidChallenge();
    }
    if (challenge.kind !== 'email_otp' || challenge.stepUp?.userId !== principal.userId) {
      throw invalidChallenge();
    }
  }

  /**
   * Answer the identity provider's challenge. Returns the throwaway refresh
   * token, or null when the provider issued none.
   */
  private async reauthenticate(
    principal: Principal,
    challengeToken: string,
    challenge: ChallengeRecord,
    response: string,
    meta: Meta,
  ): Promise<string | null> {
    try {
      const outcome = await this.idp.respondEmailOtp({
        session: challenge.session,
        username: challenge.username,
        code: response,
      });
      if (outcome.kind !== 'tokens') {
        await this.record(principal, 'auth.step_up.failed', meta, {
          method: STEP_UP_METHOD, reason: 'unexpected_challenge',
        });
        throw invalidChallenge();
      }
      return outcome.tokens.refreshToken;
    } catch (err) {
      if (err instanceof IdentityProviderError) {
        if (err.code === 'invalid_code') {
          await this.countWrongCode(principal, challengeToken, challenge);
        }
        await this.record(principal, 'auth.step_up.failed', meta, {
          method: STEP_UP_METHOD, reason: err.code,
        });
        throw this.identityResolution.mapIdpError(err);
      }
      throw err;
    }
  }

  /** As the sign-in does: count first, and the wrong code that locks the user does not hand the challenge back. */
  private async countWrongCode(principal: Principal, token: string, challenge: ChallengeRecord): Promise<void> {
    await this.throttle.recordFailure(principal.userId);
    if (await this.throttle.isLocked(principal.userId)) return;
    await retainAfterWrongCode(this.challenges, token, challenge);
  }

  /** Cognito's EMAIL_OTP; null when the pool user is gone. A provider failure maps to its API error (503 `unavailable`). */
  private async startCognitoCode(email: string, locale: Locale): Promise<{ session: string; username: string } | null> {
    try {
      return await this.idp.startEmailOtp({ email, locale });
    } catch (err) {
      if (err instanceof IdentityProviderError) throw this.identityResolution.mapIdpError(err);
      throw err;
    }
  }

  /** The federated identity a NestSelf code goes to: bound to an ACTIVE connection, else the most recently seen, else the first. */
  private async federatedIdentityFor(identities: ExternalIdentityRow[]): Promise<ExternalIdentityRow | null> {
    const federated = identities.filter((i) => i.provider.startsWith('cognito:'));
    for (const identity of federated) {
      if (!identity.ssoConnectionId) continue;
      const connection = await this.sso.findConnection(identity.ssoConnectionId);
      if (connection?.status === 'ACTIVE') return identity;
    }
    const seenAt = (identity: ExternalIdentityRow): number =>
      identity.lastSeenAt?.getTime() ?? Number.NEGATIVE_INFINITY;
    // Strictly later wins, so ties (and identities never seen) keep the first.
    return federated.reduce<ExternalIdentityRow | null>(
      (best, identity) => (best === null || seenAt(identity) > seenAt(best) ? identity : best),
      null,
    );
  }

  /** The resend cooldown of a Cognito challenge, keyed by its token's hash; it starts with the first mail. */
  private resendCooldownKey(challengeToken: string): string {
    return otpResendKey(COGNITO_RESEND_PURPOSE, createHash('sha256').update(challengeToken).digest('hex'));
  }

  private async startResendCooldown(challengeToken: string): Promise<void> {
    await this.store.set(this.resendCooldownKey(challengeToken), '1', {
      ttlSeconds: OTP_RESEND_COOLDOWN_SECONDS,
    });
  }

  private startResponse(challengeToken: string, email: string): StepUpStartResponse {
    return { method: STEP_UP_METHOD, challengeToken, ssoStartUrl: null, emailMasked: maskEmail(email) };
  }

  private async assertNotLocked(principal: Principal): Promise<void> {
    if (await this.throttle.isLocked(principal.userId)) {
      throw new ApiHttpException({
        status: 429,
        code: 'too_many_attempts',
        message: 'Too many failed attempts. Try again later.',
      });
    }
  }

  /** A step-up must land somewhere: the session, or the bearer token family. */
  private assertRecordable(principal: Principal): void {
    if (!principal.sessionId && !principal.tokenFamily) {
      throw new ApiHttpException({
        status: 401,
        code: 'session_required',
        message: 'Step-up requires a session or a token family',
      });
    }
  }

  private recordForeignChallenge(principal: Principal, meta: Meta): Promise<void> {
    return this.record(principal, 'auth.step_up.failed', meta, {
      method: STEP_UP_METHOD, reason: 'foreign_challenge',
    });
  }

  private async record(
    principal: Principal,
    action: 'auth.step_up.completed' | 'auth.step_up.failed',
    meta: Meta,
    details: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.record({
      action,
      actorUserId: principal.userId,
      actorKind: 'USER',
      recordType: 'user',
      recordId: principal.userId,
      result: action === 'auth.step_up.completed' ? 'ALLOWED' : 'DENIED',
      details,
      sessionId: principal.sessionId,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  }
}
