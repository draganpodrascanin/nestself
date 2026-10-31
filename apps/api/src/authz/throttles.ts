/**
 * Route-level throttles: `@Throttle(X)` replaces the app-wide 60 a minute
 * per client IP on that route (`common/throttler-options.ts`).
 *
 * The trackers run in `AppThrottlerGuard`, the last global guard, so on an
 * authenticated route `req.session` and `req.principal` are already set.
 *
 * @see API-R-22, 5.9 Throttling and proxies
 */
import { createHash } from 'node:crypto';
import { normalizeIp } from '@nestjs/throttler';

/** The request fields the trackers read. */
interface ThrottledRequest {
  ip?: string;
  socket?: { remoteAddress?: string };
  query?: Record<string, unknown>;
  session?: { sessionId?: string };
  principal?: { tokenFamily?: string | null };
}

/**
 * The visitor's address: `req.ip`, which Express takes from `X-Forwarded-For`
 * when `trust proxy` is set (`TRUST_PROXY_HOPS`, main.ts), else the socket
 * address. IPv6 addresses count per /64 and IPv4-mapped ones as IPv4, as the
 * throttler's default tracker counts them.
 */
export function clientIp(req: ThrottledRequest): string {
  return normalizeIp(req.ip ?? req.socket?.remoteAddress ?? 'unknown');
}

/**
 * SSO start: per IP and connection, so employees of two organizations behind
 * one office or VPN address do not share a budget. The raw query value is
 * bounded to 32 characters.
 */
export function ssoStartTracker(req: ThrottledRequest): string {
  return `${clientIp(req)}:${String(req.query?.connection ?? '').slice(0, 32)}`;
}

/**
 * Per session (a bearer: per token family; neither: per IP). Hashed, so the
 * session id never leaves the request as a tracker or a storage key.
 */
export function sessionTracker(req: ThrottledRequest): string {
  const subject = req.session?.sessionId ?? req.principal?.tokenFamily ?? clientIp(req);
  return createHash('sha256').update(subject).digest('hex');
}

/** Access-administration writes (grant, approval-authority, emergency access): 10 a minute. */
export const WRITE_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

/** `GET /auth/sso/start` (API-R-06): 60 a minute per IP and connection. */
export const SSO_START_THROTTLE = { default: { limit: 60, ttl: 60_000, getTracker: ssoStartTracker } };

/** `GET /auth/sso/callback` (API-R-07): 120 a minute per IP (the default tracker). */
export const SSO_CALLBACK_THROTTLE = { default: { limit: 120, ttl: 60_000 } };

/** Routes of a signed-in session (step-up): 10 a minute per session. */
export const SESSION_THROTTLE = { default: { limit: 10, ttl: 60_000, getTracker: sessionTracker } };

/**
 * `POST /auth/sso/bind/start|verify|resend` (the pending binding after an
 * unverified OIDC email): 10 a minute per IP (the default tracker). The
 * caller has no session yet.
 */
export const SSO_BIND_THROTTLE = { default: { limit: 10, ttl: 60_000 } };
