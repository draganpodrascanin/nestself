/**
 * The app's global throttler guard: `ThrottlerGuard` plus the browser
 * redirect of the SSO hops. A throttled route marked `@RedirectOnThrottle()`
 * throws `ThrottledRedirect` to the workspace `/sign-in?reason=sso_rate_limited`
 * (the exception filter answers it with a 302); every other route keeps the
 * `ThrottlerException`, a JSON 429 `rate_limited`.
 *
 * The workspace is the target whatever the surface: the callback's surface is
 * known only from its PKCE record, which a refused request never reads.
 *
 * The guard also runs on Socket.IO gateway messages (`@Public()` skips the
 * authentication guards, not this one). There `getRequest()` is the socket,
 * which has no `ip`, so the base tracker would put every client's `subscribe`
 * and `unsubscribe` messages into one bucket per handler; a socket is tracked
 * by its own id instead, so each connection has its own budget.
 *
 * @see 5.9 Throttling and proxies
 */
import { type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  type ThrottlerLimitDetail,
  type ThrottlerModuleOptions,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import type { SsoSignInReason } from '@nestself/contracts';
import { surfaceOrigin } from '../auth/sso-start-url.js';
import { ThrottledRedirect } from './api-error.js';
import { REDIRECT_ON_THROTTLE } from './redirect-on-throttle.decorator.js';

const RATE_LIMITED: SsoSignInReason = 'sso_rate_limited';

@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    @Inject(Reflector) reflector: Reflector,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {
    super(options, storageService, reflector);
  }

  /** A Socket.IO socket (the "request" of a gateway message) is tracked by its id; HTTP keeps the client IP. */
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    if (typeof req.id === 'string' && typeof req.handshake === 'object' && req.handshake !== null) {
      return `ws:${req.id}`;
    }
    return super.getTracker(req);
  }

  protected override async throwThrottlingException(
    context: ExecutionContext,
    throttlerLimitDetail: ThrottlerLimitDetail,
  ): Promise<void> {
    const redirect = this.reflector.getAllAndOverride<boolean | undefined>(REDIRECT_ON_THROTTLE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (redirect) {
      throw new ThrottledRedirect(`${surfaceOrigin(this.config, 'workspace')}/sign-in?reason=${RATE_LIMITED}`);
    }
    return super.throwThrottlingException(context, throttlerLimitDetail);
  }
}
