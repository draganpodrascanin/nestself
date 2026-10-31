/**
 * StubBearerVerifier — HS256 JWT verification for AUTH_MODE=stub.
 * Moves the legacy AuthGuard's verification logic into the new system.
 *
 * @see D-36
 */
import { Injectable } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { JwtService } from '@nestjs/jwt';
import type { BearerVerifier, BearerPayload } from './bearer-verifier.js';
import { ApiHttpException } from '../common/api-error.js';

@Injectable()
export class StubBearerVerifier implements BearerVerifier {
  constructor(private readonly jwt: JwtService) {}

  async verify(token: string): Promise<BearerPayload> {
    try {
      const payload = await this.jwt.verifyAsync<{
        userId?: string;
        sub?: string;
        username?: unknown;
        displayName?: string;
        email?: string;
      }>(token);
      const userId = payload.userId ?? payload.sub;
      if (!userId) {
        throw new ApiHttpException({
          status: 401,
          code: 'unauthenticated',
          message: 'Token payload missing userId',
        });
      }
      return {
        userId,
        sub: payload.sub ?? userId,
        // As the Cognito verifier passes it: the guard reads a federated user's provider from it.
        username: typeof payload.username === 'string' ? payload.username : undefined,
        originJti: null,
        authMethod: 'email_otp',
        authTime: Math.floor(Date.now() / 1000),
        email: payload.email,
      };
    } catch (err) {
      if (err instanceof ApiHttpException) throw err;
      throw new ApiHttpException({
        status: 401,
        code: 'unauthenticated',
        message: 'Invalid or expired token',
      });
    }
  }
}
