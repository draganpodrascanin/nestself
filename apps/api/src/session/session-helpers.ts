/**
 * Pure helper functions for the session service.
 *
 * @see 3.6 Sessions
 */
import { createHash, randomBytes } from 'node:crypto';

// Re-export canonical implementations so existing consumers keep working.
export { hashIp, parseUserAgent } from '../common/request-fingerprint.js';

/** SHA-256 hash of the raw session id, used as the Redis key suffix. */
export function hashSessionId(sessionId: string): string {
  return createHash('sha256').update(sessionId).digest('hex');
}

/** Generate a 256-bit random session id (base64url). */
export function generateSessionId(): string {
  return randomBytes(32).toString('base64url');
}

/** Generate a 256-bit random CSRF token (base64url). */
export function generateCsrfToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Minimum time between activity touches (seconds). */
export const ACTIVITY_TOUCH_INTERVAL = 60;

/** Threshold below which we trigger a token refresh (seconds). */
export const REFRESH_THRESHOLD = 120;

/** If lock cannot be acquired and token has > this many seconds left, use it. */
export const STALE_TOKEN_GRACE = 30;

/** Maximum time to wait for the refresh lock (ms). */
export const LOCK_WAIT_MS = 5_000;
