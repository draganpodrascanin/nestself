/**
 * CSRF guard combining double-submit token validation with
 * Sec-Fetch-Site / Origin checks.
 *
 * SPIKE-02 finding: NestJS 12.x does not expose `enableCsrfProtection()`.
 * This guard implements the `Sec-Fetch-Site` and `Origin` header check
 * that the built-in would have provided, plus the double-submit token
 * as defence in depth.
 *
 * Exported but NOT registered globally; the HTTP layer applies it selectively.
 *
 * @see D-06, S-163, 3.6.2 Anti-abuse table
 */
import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'node:crypto';
import { ApiHttpException } from '../common/api-error.js';

/** Minimal Express-compatible request shape. */
interface HttpReq {
  method: string;
  protocol: string;
  headers: Record<string, string | string[] | undefined>;
  get(name: string): string | undefined;
}
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { SessionCookies } from './session-cookie.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function reject(reason: string): never {
  throw new ApiHttpException({
    status: 403,
    code: 'csrf_rejected',
    message: `CSRF validation failed: ${reason}`,
  });
}

@Injectable()
export class CsrfGuard implements CanActivate {
  private readonly allowedOrigins: Set<string>;

  constructor(
    private readonly cookies: SessionCookies,
    config: ConfigService,
  ) {
    this.allowedOrigins = new Set<string>(
      [
        config.get<string>('WORKSPACE_URL'),
        config.get<string>('ADMIN_URL'),
        config.get<string>('MARKETING_URL'),
        config.get<string>('API_PUBLIC_URL'),
      ].filter(Boolean) as string[],
    );
  }

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<HttpReq>();
    if (SAFE_METHODS.has(req.method)) return true;

    // Only enforce when the session cookie is present
    const { sessionId } = this.cookies.parse(
      req.headers as Record<string, string | undefined>,
    );
    if (!sessionId) return true;

    // -- Sec-Fetch-Site check --
    const fetchSite = req.headers['sec-fetch-site'] as string | undefined;
    if (fetchSite === 'cross-site') {
      reject('cross-site request');
    }

    // -- Origin check --
    const origin = req.headers['origin'] as string | undefined;
    if (origin) {
      const ownOrigin = `${req.protocol}://${req.get('host')}`;
      if (!this.allowedOrigins.has(origin) && origin !== ownOrigin) {
        reject('origin not allowed');
      }
    }

    // -- Double-submit token --
    const csrfHeader = req.headers['x-csrf-token'] as string | undefined;
    if (!csrfHeader) {
      reject('missing X-CSRF-Token header');
    }

    // The session record's csrfToken must be attached to the request by
    // the authentication layer; if absent we cannot validate and must reject.
    const expectedCsrf = (req as unknown as Record<string, unknown>)['csrfToken'] as
      | string
      | undefined;
    if (!expectedCsrf) {
      reject('session csrf token not resolved');
    }

    if (!safeEqual(csrfHeader, expectedCsrf)) {
      reject('token mismatch');
    }

    return true;
  }
}

/**
 * Constant-time comparison via SHA-256 digest.
 * Hashing both sides produces fixed-length buffers, eliminating the early
 * return on length mismatch that could leak token length information.
 */
function safeEqual(a: string, b: string): boolean {
  const hashA = createHash('sha256').update(a, 'utf8').digest();
  const hashB = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(hashA, hashB);
}
