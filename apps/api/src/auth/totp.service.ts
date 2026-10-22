/**
 * TOTP enrolment endpoints.
 *
 * Two paths share the same identity-provider calls:
 *
 * - **Sign-in (MFA_SETUP challenge)**: `POST /auth/totp/enrol` with the
 *   `totp_enrol` challengeToken associates a software token and returns a
 *   fresh challengeToken. The client then calls `POST /auth/challenge` with
 *   the authenticator code; `SignInService.respondChallenge` verifies the
 *   token and completes MFA_SETUP (API-R-05).
 * - **Signed-in**: `POST /auth/totp/enrol` and `POST /auth/totp/confirm`
 *   with the session's Cognito access token.
 *
 * @see 3.5.3, API-R-05, D-05
 */
import { Inject, Injectable, forwardRef } from '@nestjs/common';

import {
  IdentityProviderService,
} from '../identity/identity-provider.service.js';

import { ChallengeStore } from './challenge-store.js';
import { ApiHttpException } from '../common/api-error.js';

const ISSUER = 'NestSelf';

export function buildOtpauthUri(secret: string, accountLabel: string | null): string {
  const label = accountLabel
    ? `${encodeURIComponent(ISSUER)}:${encodeURIComponent(accountLabel)}`
    : encodeURIComponent(ISSUER);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(ISSUER)}`;
}

@Injectable()
export class TotpService {
  constructor(
    @Inject(forwardRef(() => IdentityProviderService)) private readonly idp: IdentityProviderService,
    @Inject(forwardRef(() => ChallengeStore)) private readonly challengeStore: ChallengeStore,
  ) {}

  async totpEnrol(
    challengeToken?: string,
    accessToken?: string,
  ): Promise<{ secretUri: string; challengeToken: string | null }> {
    if (challengeToken) {
      // Single-use: consume the MFA_SETUP challenge and re-issue it with the
      // (possibly rotated) identity-provider session.
      const challenge = await this.challengeStore.consume(challengeToken);
      if (!challenge || challenge.kind !== 'totp_enrol') {
        throw new ApiHttpException({
          status: 401,
          code: 'invalid_challenge',
          message: 'Challenge expired or invalid',
        });
      }

      const result = await this.idp.associateSoftwareToken({
        session: challenge.session,
      });
      const newChallengeToken = await this.challengeStore.create({
        ...challenge,
        session: result.session ?? challenge.session,
      });
      return {
        secretUri: buildOtpauthUri(result.secretCode, challenge.email || null),
        challengeToken: newChallengeToken,
      };
    }

    if (!accessToken) {
      throw new ApiHttpException({
        status: 401,
        code: 'invalid_challenge',
        message: 'A challengeToken or an authenticated session is required',
      });
    }

    const result = await this.idp.associateSoftwareToken({ accessToken });
    return {
      secretUri: buildOtpauthUri(result.secretCode, null),
      challengeToken: null,
    };
  }

  /** Signed-in confirmation: verifies the code and makes TOTP the preferred factor. */
  async totpConfirm(code: string, accessToken?: string): Promise<void> {
    if (!accessToken) {
      throw new ApiHttpException({
        status: 401,
        code: 'session_required',
        message: 'TOTP confirmation requires an active session',
      });
    }
    await this.idp.verifySoftwareToken({
      accessToken,
      code,
      friendlyDeviceName: 'NestSelf TOTP',
    });
    await this.idp.setTotpPreferred({ accessToken });
  }
}
