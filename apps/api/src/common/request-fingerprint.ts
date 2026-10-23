/**
 * Shared request fingerprint helpers.
 *
 * Canonical implementations of IP hashing and user-agent parsing,
 * imported by both session-helpers and audit-writer.
 */
import { createHmac } from 'node:crypto';
import { UAParser } from 'ua-parser-js';

/**
 * Keyed hash of the client IP (HMAC-SHA256, 32 hex characters). The key is
 * `IP_HASH_SALT`, falling back to `SESSION_ENCRYPTION_KEY`, so hashes stay
 * comparable within one deployment but cannot be reversed with a precomputed
 * table of the IPv4 space. Read once at module load (D-21).
 */
const IP_HASH_KEY =
  process.env['IP_HASH_SALT'] ||
  process.env['SESSION_ENCRYPTION_KEY'] ||
  'nestself-dev-ip-hash-key';

export function hashIp(ip: string): string {
  return createHmac('sha256', IP_HASH_KEY).update(ip).digest('hex').slice(0, 32);
}

/** Browser name + major version, or 'unknown'. */
export function parseUserAgent(ua: string | null | undefined): string {
  if (!ua) return 'unknown';
  const browser = UAParser(ua).browser;
  if (!browser.name) return 'unknown';
  return browser.major ? `${browser.name} ${browser.major}` : browser.name;
}
