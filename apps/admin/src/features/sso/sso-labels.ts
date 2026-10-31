import type { BadgeTone } from '@nestself/ui';
import type { SsoConnectionStatus, SsoProtocol } from '@nestself/contracts';

export const SSO_STATUS_TONE: Record<SsoConnectionStatus, BadgeTone> = {
  DRAFT: 'neutral',
  TESTING: 'info',
  ACTIVE: 'success',
  SUSPENDED: 'warning',
};

/** The Cognito provider name the API builds from the slug: `org-<slug>-saml|oidc`. */
export function providerNamePreview(slug: string, protocol: SsoProtocol): string {
  return `org-${slug}-${protocol.toLowerCase()}`;
}

/** An absolute URL starting with `https://`, as the contract's metadata URL and issuer fields require. */
export function isHttpsUrl(value: string): boolean {
  try {
    return value.startsWith('https://') && new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/** The contract's domain shape: lowercase DNS labels, at least two, no scheme, path or `@`. */
export const DOMAIN_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
