/**
 * Authentication constants shared by home-realm discovery and SSO domain
 * management.
 */

/**
 * Public email domains that never map to an SSO connection (3.4.3 step 2,
 * SSO-R-05, DR-07). Discovery skips SSO for them and `POST
 * /ops/sso-connections/:id/domains` rejects them with 422
 * `domain_blocklisted`. Extend by adding entries here and redeploying.
 */
export const PUBLIC_EMAIL_DOMAINS: readonly string[] = Object.freeze([
  'gmail.com',
  'yahoo.com',
  'hotmail.com',
  'outlook.com',
  'live.com',
  'icloud.com',
  'aol.com',
  'protonmail.com',
  'mail.com',
  'yandex.com',
  'zoho.com',
  'gmx.com',
  'fastmail.com',
]);

const PUBLIC_EMAIL_DOMAIN_SET: ReadonlySet<string> = new Set(PUBLIC_EMAIL_DOMAINS);

/**
 * True when `domain` (the part after `@`) is a public email domain. Matching
 * is exact after trimming, lowercasing and dropping a trailing root dot;
 * subdomains of a listed domain do not match.
 */
export function isPublicEmailDomain(domain: string): boolean {
  const normalised = domain.trim().toLowerCase().replace(/\.$/, '');
  return PUBLIC_EMAIL_DOMAIN_SET.has(normalised);
}
