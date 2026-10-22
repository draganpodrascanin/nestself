/**
 * CognitoBearerVerifier — verifies mobile bearer tokens using aws-jwt-verify.
 *
 * After signature verification, checks the revoked_family denylist
 * and updates mobile_family last-seen.
 *
 * @see AUTHZ-R-63, AUTHZ-R-64
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ConfigService } from '@nestjs/config';
import type { BearerVerifier, BearerPayload } from './bearer-verifier.js';
import { ApiHttpException } from '../common/api-error.js';
import {
  KEY_VALUE_STORE,
  type KeyValueStore,
} from '../redis/key-value-store.js';
import {
  revokedFamilyKey,
  mobileFamilyKey,
  MOBILE_FAMILY_TTL,
} from '../redis/redis-keys.js';

@Injectable()
export class CognitoBearerVerifier implements BearerVerifier {
  private readonly logger = new Logger(CognitoBearerVerifier.name);
  private verifier: {
    verify: (token: string) => Promise<Record<string, unknown>>;
  } | null = null;
  private readonly userPoolId: string;
  private readonly clientId: string;

  constructor(
    private readonly config: ConfigService,
    @Inject(KEY_VALUE_STORE) private readonly store: KeyValueStore,
  ) {
    this.userPoolId = config.get<string>('COGNITO_USER_POOL_ID') ?? '';
    this.clientId = config.get<string>('COGNITO_MOBILE_CLIENT_ID') ?? '';
  }

  private async getVerifier() {
    if (!this.verifier) {
      // Dynamic import to avoid loading aws-jwt-verify in stub mode
      const { CognitoJwtVerifier } = await import('aws-jwt-verify');
      this.verifier = CognitoJwtVerifier.create({
        userPoolId: this.userPoolId,
        tokenUse: 'access',
        clientId: this.clientId,
      });
    }
    return this.verifier;
  }

  async verify(token: string): Promise<BearerPayload> {
    let claims: Record<string, unknown>;
    try {
      const v = await this.getVerifier();
      claims = await v.verify(token);
    } catch {
      throw new ApiHttpException({
        status: 401,
        code: 'unauthenticated',
        message: 'Invalid or expired bearer token',
      });
    }

    const sub = claims['sub'] as string;
    const originJti = (claims['origin_jti'] as string) ?? null;
    const authTime =
      (claims['auth_time'] as number) ?? Math.floor(Date.now() / 1000);

    // AUTHZ-R-63: Check revoked family
    if (originJti) {
      const revoked = await this.store.get(revokedFamilyKey(originJti));
      if (revoked) {
        throw new ApiHttpException({
          status: 401,
          code: 'unauthenticated',
          message: 'Token family has been revoked',
        });
      }
    }

    // AUTHZ-R-64: Update mobile family last-seen
    if (originJti) {
      try {
        await this.store.set(
          mobileFamilyKey(originJti),
          new Date().toISOString(),
          { ttlSeconds: MOBILE_FAMILY_TTL },
        );
      } catch (err) {
        this.logger.warn(`Failed to update mobile family: ${String(err)}`);
      }
    }

    return {
      userId: '', // Will be resolved by auth guard via ExternalIdentity lookup
      sub,
      originJti,
      authMethod: 'email_otp',
      authTime,
    };
  }
}
