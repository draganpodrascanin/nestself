import { Inject, Injectable, forwardRef } from '@nestjs/common';
 
import {
  IdentityProviderService,
  IdentityProviderError,
} from '../identity/identity-provider.service.js';
 
import { ChallengeStore, type ChallengeRecord } from './challenge-store.js';
 
import { SignInThrottle } from './sign-in-throttle.js';
 
import {
  IdentityResolutionService,
  type SessionCreationResult,
} from './identity-resolution.service.js';
import { neutralDelay } from './neutral-delay.js';
import { ApiHttpException } from '../common/api-error.js';
import type { AuthOutcome } from '../identity/identity-provider.service.js';
import type { Locale } from '@nestself/contracts';

function challengeStep(
  challenge: string,
): 'totp' | 'new_password' | 'totp_enrol' {
  switch (challenge) {
    case 'SOFTWARE_TOKEN_MFA':
      return 'totp';
    case 'NEW_PASSWORD_REQUIRED':
      return 'new_password';
    case 'MFA_SETUP':
      return 'totp_enrol';
    default:
      return 'totp';
  }
}

/**
 * Codes a user may get wrong on one email challenge (sign-in or step-up).
 * The third wrong code ends the challenge; `SignInThrottle` counts every
 * failure independently and locks the address after five, and a locked
 * address cannot finish a challenge it still holds. Step-up does the same per
 * user with `StepUpThrottle`.
 */
export const MAX_EMAIL_OTP_ATTEMPTS = 3;

/**
 * After a wrong email code, hand the consumed record back under the same
 * token so the user can retype it, unless this was the last allowed attempt.
 * The identity provider keeps its own session alive on a mismatch.
 */
export async function retainAfterWrongCode(
  challenges: ChallengeStore,
  token: string,
  record: ChallengeRecord,
): Promise<void> {
  const attempts = (record.attempts ?? 0) + 1;
  if (attempts < MAX_EMAIL_OTP_ATTEMPTS) {
    await challenges.put(token, { ...record, attempts });
  }
}

@Injectable()
export class SignInService {
  constructor(
    @Inject(forwardRef(() => IdentityProviderService)) private readonly idp: IdentityProviderService,
    @Inject(forwardRef(() => ChallengeStore)) private readonly challengeStore: ChallengeStore,
    @Inject(forwardRef(() => SignInThrottle)) private readonly throttle: SignInThrottle,
    @Inject(forwardRef(() => IdentityResolutionService)) private readonly identity: IdentityResolutionService,
  ) {}

  /** `locale` picks the language of the code email; the pool default otherwise. */
  async emailOtpStart(
    email: string,
    _meta: { ip: string | null; userAgent: string | null },
    locale?: Locale,
  ): Promise<{ challengeToken: string; codeDeliveryMedium: 'EMAIL' }> {
    const start = Date.now();

    if (await this.throttle.isLocked(email)) {
      throw new ApiHttpException({
        status: 429,
        code: 'too_many_attempts',
        message: 'Too many failed attempts. Try again later.',
      });
    }

    const result = await this.idp.startEmailOtp(locale ? { email, locale } : { email });

    if (!result) {
      await neutralDelay(start);
      const token = await this.challengeStore.create({
        kind: 'email_otp',
        username: '',
        email,
        session: '',
        dummy: true,
      });
      return { challengeToken: token, codeDeliveryMedium: 'EMAIL' };
    }

    const token = await this.challengeStore.create({
      kind: 'email_otp',
      username: result.username,
      email,
      session: result.session,
    });
    return { challengeToken: token, codeDeliveryMedium: 'EMAIL' };
  }

  async emailOtpVerify(
    challengeToken: string,
    code: string,
    surface: 'workspace' | 'admin',
    meta: { ip: string | null; userAgent: string | null },
  ): Promise<SessionCreationResult> {
    const challenge = await this.challengeStore.consume(challengeToken);
    // A step-up challenge must never mint a new session.
    if (!challenge || challenge.kind !== 'email_otp' || challenge.stepUp) {
      throw new ApiHttpException({
        status: 401,
        code: 'invalid_challenge',
        message: 'Challenge expired or invalid',
      });
    }

    // Checked for dummy and real challenges alike, keyed by the challenge's
    // address, so a lock reads the same whether or not the address exists.
    // The record was consumed above and is not put back.
    if (await this.throttle.isLocked(challenge.email)) {
      throw new ApiHttpException({
        status: 429,
        code: 'too_many_attempts',
        message: 'Too many failed attempts. Try again later.',
      });
    }

    if (challenge.dummy) {
      // Same retry budget as a real challenge, so the answers stay identical.
      await this.countWrongCode(challengeToken, challenge);
      throw new ApiHttpException({
        status: 401,
        code: 'invalid_code',
        message: 'Invalid verification code',
      });
    }

    try {
      const outcome = await this.idp.respondEmailOtp({
        session: challenge.session,
        username: challenge.username,
        code,
      });
      return this.identity.resolveOutcome(outcome, challenge.email, surface, meta, false);
    } catch (err) {
      if (err instanceof IdentityProviderError) {
        if (err.code === 'invalid_code') {
          await this.countWrongCode(challengeToken, challenge);
        } else {
          await this.throttle.recordFailure(challenge.email);
        }
        this.identity.auditSignInFailed(challenge.email, meta);
        throw this.identity.mapIdpError(err);
      }
      throw err;
    }
  }

  /**
   * Count a wrong email code first, then hand the challenge back only when
   * that count did not lock the address.
   */
  private async countWrongCode(token: string, challenge: ChallengeRecord): Promise<void> {
    await this.throttle.recordFailure(challenge.email);
    if (await this.throttle.isLocked(challenge.email)) return;
    await retainAfterWrongCode(this.challengeStore, token, challenge);
  }

  async passwordSignIn(
    email: string,
    password: string,
    surface: 'workspace' | 'admin',
    meta: { ip: string | null; userAgent: string | null },
  ): Promise<
    | SessionCreationResult
    | { step: 'totp' | 'new_password' | 'totp_enrol'; challengeToken: string }
  > {
    const start = Date.now();

    if (await this.throttle.isLocked(email)) {
      throw new ApiHttpException({
        status: 429,
        code: 'too_many_attempts',
        message: 'Too many failed attempts. Try again later.',
      });
    }

    try {
      const outcome = await this.idp.startPassword({ email, password });
      if (outcome.kind === 'challenge') {
        const step = challengeStep(outcome.challenge);
        const token = await this.challengeStore.create({
          kind: step === 'totp' ? 'totp' : step === 'new_password' ? 'new_password' : 'totp_enrol',
          username: outcome.username,
          email,
          session: outcome.session,
          surface,
        });
        return { step, challengeToken: token };
      }
      // Tokens without a challenge: a password only, no second factor presented.
      return this.identity.resolveOutcome(outcome, email, surface, meta, true, false);
    } catch (err) {
      if (err instanceof IdentityProviderError) {
        await this.throttle.recordFailure(email);
        await neutralDelay(start);
        this.identity.auditSignInFailed(email, meta);
        throw this.identity.mapIdpError(err);
      }
      throw err;
    }
  }

  async respondChallenge(
    challengeToken: string,
    response: string,
    surface: 'workspace' | 'admin',
    meta: { ip: string | null; userAgent: string | null },
  ): Promise<
    | SessionCreationResult
    | { step: 'totp' | 'new_password' | 'totp_enrol'; challengeToken: string }
  > {
    const challenge = await this.challengeStore.consume(challengeToken);
    if (!challenge) {
      throw new ApiHttpException({
        status: 401,
        code: 'invalid_challenge',
        message: 'Challenge expired or invalid',
      });
    }

    const effectiveSurface = (challenge.surface as 'workspace' | 'admin') ?? surface;

    try {
      let outcome: AuthOutcome;
      switch (challenge.kind) {
        case 'totp':
          outcome = await this.idp.respondTotp({
            session: challenge.session,
            username: challenge.username,
            code: response,
          });
          break;
        case 'new_password':
          outcome = await this.idp.respondNewPassword({
            session: challenge.session,
            username: challenge.username,
            newPassword: response,
          });
          break;
        case 'totp_enrol': {
          // API-R-05: the response is the enrolment verification code.
          // VerifySoftwareToken binds the authenticator, then MFA_SETUP completes.
          const verified = await this.idp.verifySoftwareToken({
            session: challenge.session,
            code: response,
            friendlyDeviceName: 'NestSelf TOTP',
          });
          outcome = await this.idp.completeMfaSetup({
            session: verified.session ?? challenge.session,
            username: challenge.username,
          });
          break;
        }
        default:
          throw new ApiHttpException({
            status: 400,
            code: 'invalid_challenge',
            message: `Unsupported challenge kind: ${challenge.kind}`,
          });
      }

      if (outcome.kind === 'challenge') {
        const step = challengeStep(outcome.challenge);
        const newToken = await this.challengeStore.create({
          kind: step === 'totp' ? 'totp' : step === 'new_password' ? 'new_password' : 'totp_enrol',
          username: outcome.username,
          email: challenge.email,
          session: outcome.session,
          surface: effectiveSurface,
        });
        // Same shape as POST /auth/password: the client renders the next step.
        return { step, challengeToken: newToken };
      }

      const secondFactor = challenge.kind === 'totp' || challenge.kind === 'totp_enrol';
      return this.identity.resolveOutcome(outcome, challenge.email, effectiveSurface, meta, true, secondFactor);
    } catch (err) {
      if (err instanceof IdentityProviderError) {
        this.identity.auditSignInFailed(challenge.email, meta);
        throw this.identity.mapIdpError(err);
      }
      throw err;
    }
  }
}
