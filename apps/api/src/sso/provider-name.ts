/**
 * Cognito provider names for SSO connections (3.4.1, D-12): `org-<slug>-saml`
 * or `org-<slug>-oidc`, lowercase, at most 20 characters. The name is the
 * `identity_provider` the clients send to Cognito and the `connection` of
 * the SSO start URL, so it is never truncated: a slug that does not fit is
 * refused and staff pick a shorter one.
 *
 * A slug is reserved for one organization: Cognito keeps the federated pool
 * users (`<providerName>_<NameID>`, with their `sub`) after a provider is
 * deleted, so another organization registering the same name, or the other
 * protocol's name of the same slug after a protocol switch, would inherit
 * them. See {@link slugProviderNames}.
 */
import type { SsoProtocol } from '@nestself/contracts';

export const PROVIDER_NAME_MAX_LENGTH = 20;

export class ProviderNameTooLongError extends Error {
  constructor(readonly providerName: string) {
    super(`Provider name ${providerName} exceeds ${PROVIDER_NAME_MAX_LENGTH} characters`);
    this.name = 'ProviderNameTooLongError';
  }
}

/** `org-<slug>-<protocol>`; throws {@link ProviderNameTooLongError} above 20 characters. */
export function buildProviderName(slug: string, protocol: SsoProtocol): string {
  const name = `org-${slug.trim().toLowerCase()}-${protocol.toLowerCase()}`;
  if (name.length > PROVIDER_NAME_MAX_LENGTH) throw new ProviderNameTooLongError(name);
  return name;
}

/**
 * Both names of the slug `name` was built from (`org-<slug>-saml`,
 * `org-<slug>-oidc`), the set an organization reserves; a name without a
 * protocol suffix is returned alone.
 */
export function slugProviderNames(name: string): string[] {
  const match = /^(.*)-(saml|oidc)$/.exec(name);
  if (!match) return [name];
  return [`${match[1]}-saml`, `${match[1]}-oidc`];
}
