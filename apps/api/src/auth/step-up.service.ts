/**
 * StepUpService: re-authentication before a sensitive action.
 *
 * `start` sends an email code to the user's native Cognito identity and stores
 * a challenge bound to the user. `verify` consumes it, re-authenticates with
 * the identity provider and records the step-up: on the session
 * (`markStepUp`, then `regenerate`) for web callers, or under
 * `stepUpKey(tokenFamily)` for bearer callers. The token set the
 * re-authentication returns is discarded; its refresh token is revoked.
 *
 * Every native user steps up with an email code, `password_totp` users
 * included (Cognito cannot issue SOFTWARE_TOKEN_MFA without a password).
 * Federated users get the same until phase 3 adds the IdP round trip.
 *
 * @see 3.6.9, SESS-R-10, SESS-R-18, T-2.6
 */
import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import type { Principal, StepUpStartResponse } from '@nestself/contracts';

import {
  IdentityProviderService,
  IdentityProviderError,
} from '../identity/identity-provider.service.js';

import { ChallengeStore, type ChallengeRecord } from './challenge-store.js';
import { retainAfterWrongCode } from './sign-in.service.js';

import { SessionService } from '../session/session.service.js';

import { IdentityRepository } from '../db/repositories/identity.repository.js';

import { IdentityResolutionService } from './identity-resolution.service.js';

import { AuditWriter } from '../audit/audit-writer.js';
import { KEY_VALUE_STORE, type KeyValueStore } from '../redis/key-value-store.js';
import { stepUpKey, STEP_UP_BEARER_TTL } from '../redis/redis-keys.js';
import { ApiHttpException, SessionExpiredError } from '../common/api-error.js';

type Meta = { ip: string | null; userAgent: string | null };

export interface StepUpVerifyResult {
  /** Present for session callers: the regenerated session, cookies must be set again. */
  session?: { sessionId: string; csrfToken: string; absoluteExpiresAt: Date };
}

const STEP_UP_METHOD = 'email_otp' as const;

function invalidChallenge(): ApiHttpException {
  return new ApiHttpException({
    status: 401,
    code: 'invalid_challenge',
    message: 'Challenge expired or invalid',
  });
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
  ) {}

  async start(
    principal: Principal,
    _meta: Meta,
    surface: 'workspace' | 'admin',
  ): Promise<StepUpStartResponse> {
    this.assertRecordable(principal);

    const identities = await this.identities.findExternalIdentitiesForUser(principal.userId);
    const native = identities.find((i) => i.provider === 'cognito');
    if (!native) {
      throw new ApiHttpException({
        status: 403,
        code: 'forbidden',
        message: 'Step-up is not available for this account',
      });
    }

    const started = await this.idp.startEmailOtp({ email: native.email });
    if (!started) {
      // The linked pool user is gone; same answer as a missing identity.
      throw new ApiHttpException({
        status: 403,
        code: 'forbidden',
        message: 'Step-up is not available for this account',
      });
    }

    const challengeToken = await this.challenges.create({
      kind: 'email_otp',
      username: started.username,
      email: native.email,
      session: started.session,
      surface,
      stepUp: { userId: principal.userId },
    });
    return { method: STEP_UP_METHOD, challengeToken, ssoStartUrl: null };
  }

  async verify(
    principal: Principal,
    challengeToken: string,
    response: string,
    meta: Meta,
  ): Promise<StepUpVerifyResult> {
    this.assertRecordable(principal);

    const challenge = await this.challenges.consume(challengeToken);
    if (challenge?.stepUp && challenge.stepUp.userId !== principal.userId) {
      // A step-up challenge minted for someone else: refuse and record it
      // (never the token or the code).
      await this.record(principal, 'auth.step_up.failed', meta, {
        method: STEP_UP_METHOD, reason: 'foreign_challenge',
      });
      throw invalidChallenge();
    }
    if (
      !challenge ||
      challenge.kind !== 'email_otp' ||
      challenge.stepUp?.userId !== principal.userId
    ) {
      throw invalidChallenge();
    }

    const refreshToken = await this.reauthenticate(principal, challengeToken, challenge, response, meta);
    if (refreshToken) {
      try {
        await this.idp.revokeRefreshToken(refreshToken);
      } catch (err) {
        this.logger.warn(err, 'Failed to revoke the step-up refresh token');
      }
    }

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

    await this.record(principal, 'auth.step_up.completed', meta, { method: STEP_UP_METHOD });
    return result;
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
          await retainAfterWrongCode(this.challenges, challengeToken, challenge);
        }
        await this.record(principal, 'auth.step_up.failed', meta, {
          method: STEP_UP_METHOD, reason: err.code,
        });
        throw this.identityResolution.mapIdpError(err);
      }
      throw err;
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
