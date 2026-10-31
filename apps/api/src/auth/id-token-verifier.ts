/**
 * IdTokenVerifier: checks the Cognito ID token the mobile app presents to
 * `POST /auth/sso/bind-token` after its own PKCE exchange against the hosted
 * UI (phase 4 design 5.7), and answers its normalised claims
 * (`toIdTokenClaims`, the shape the web callback's exchange answers).
 *
 * - `CognitoIdTokenVerifier` (AUTH_MODE=cognito): aws-jwt-verify checks the
 *   RS256 signature against the pool's keys, `iss` (the pool), `aud` (the
 *   mobile client, `COGNITO_MOBILE_CLIENT_ID`), `token_use = id` and `exp`.
 *   The web client's ID tokens never leave the API, and are refused here.
 * - `StubIdTokenVerifier` (AUTH_MODE=stub): the signature check the stub
 *   bearer verifier applies to access tokens (the stub JWT secret), with
 *   `token_use: 'id'` required, so nothing unsigned and no access token
 *   passes.
 *
 * A token that fails is 401 `unauthenticated`; pool keys that cannot be
 * fetched are our outage, 503 `unavailable` (`classifyIdTokenError`).
 *
 * @see docs/superpowers/specs/2026-10-30-auth-phase-4-pilot-readiness-design.md section 5.7
 */
import { Injectable } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ConfigService } from '@nestjs/config';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { JwtService } from '@nestjs/jwt';
import type { Jwks } from 'aws-jwt-verify/jwk';
import { ApiHttpException } from '../common/api-error.js';
import type { IdTokenClaims } from '../identity/identity-provider.service.js';
import {
  classifyIdTokenError,
  createCognitoIdTokenVerifier,
  toIdTokenClaims,
  type IdTokenVerifier as PoolIdTokenVerifier,
} from '../identity/cognito-sso-ops.js';

/** Injection token for the active IdTokenVerifier (chosen by AUTH_MODE, like `BEARER_VERIFIER`). */
export const ID_TOKEN_VERIFIER = Symbol('ID_TOKEN_VERIFIER');

export interface IdTokenVerifier {
  /**
   * Verify the mobile app's ID token and answer its claims. Throws 401
   * `unauthenticated` for a token that fails verification, 503 `unavailable`
   * when the pool's signing keys cannot be fetched.
   */
  verify(idToken: string): Promise<IdTokenClaims>;
}

function invalidIdToken(): ApiHttpException {
  return new ApiHttpException({ status: 401, code: 'unauthenticated', message: 'Invalid or expired ID token' });
}

@Injectable()
export class CognitoIdTokenVerifier implements IdTokenVerifier {
  private pool: Promise<PoolIdTokenVerifier> | null = null;
  private readonly userPoolId: string;
  private readonly mobileClientId: string;

  constructor(
    config: ConfigService,
    /** Pre-loads the pool's key set instead of downloading it (tests). */
    private readonly jwks?: Jwks,
  ) {
    this.userPoolId = config.get<string>('COGNITO_USER_POOL_ID') ?? '';
    this.mobileClientId = config.get<string>('COGNITO_MOBILE_CLIENT_ID') ?? '';
  }

  async verify(idToken: string): Promise<IdTokenClaims> {
    let claims: Record<string, unknown>;
    try {
      // Created on first use (aws-jwt-verify is loaded lazily, never in stub mode).
      this.pool ??= createCognitoIdTokenVerifier(this.userPoolId, this.mobileClientId, this.jwks);
      claims = await (await this.pool).verify(idToken);
    } catch (err) {
      if (classifyIdTokenError(err).code === 'unavailable') {
        throw new ApiHttpException({
          status: 503,
          code: 'unavailable',
          message: 'The identity provider is unavailable. Try again later.',
        });
      }
      throw invalidIdToken();
    }
    return toIdTokenClaims(claims);
  }
}

@Injectable()
export class StubIdTokenVerifier implements IdTokenVerifier {
  constructor(private readonly jwt: JwtService) {}

  async verify(idToken: string): Promise<IdTokenClaims> {
    let claims: Record<string, unknown>;
    try {
      claims = await this.jwt.verifyAsync<Record<string, unknown>>(idToken);
    } catch {
      throw invalidIdToken();
    }
    // The stub secret signs access tokens too: only an ID token binds.
    if (claims['token_use'] !== 'id') throw invalidIdToken();
    return toIdTokenClaims(claims);
  }
}
