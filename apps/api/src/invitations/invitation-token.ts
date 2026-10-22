/**
 * Invitation token generation and hashing utilities [D-03].
 *
 * Tokens are 32 random bytes, hex-encoded. Only the SHA-256 hash is stored;
 * the raw token is handed to the invitee exactly once.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** Generate a cryptographically random 32-byte hex invitation token. */
export function generateToken(): string {
  return randomBytes(32).toString('hex');
}

/** SHA-256 hex digest of a token string. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Constant-time comparison of two hex hash strings.
 * Returns false for mismatched lengths without leaking timing information.
 */
export function constantTimeHashCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}
