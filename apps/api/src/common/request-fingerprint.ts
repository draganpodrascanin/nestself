/**
 * Shared request fingerprint helpers.
 *
 * Canonical implementations of IP hashing and user-agent parsing,
 * imported by both session-helpers and audit-writer.
 */
import { createHash } from 'node:crypto';
import { UAParser } from 'ua-parser-js';

/** SHA-256 hex of the raw IP, truncated to 32 characters. */
export function hashIp(ip: string): string {
  return createHash('sha256').update(ip).digest('hex').slice(0, 32);
}

/** Browser name + major version, or 'unknown'. */
export function parseUserAgent(ua: string | null | undefined): string {
  if (!ua) return 'unknown';
  const browser = UAParser(ua).browser;
  if (!browser.name) return 'unknown';
  return browser.major ? `${browser.name} ${browser.major}` : browser.name;
}
