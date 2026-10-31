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

/** `org-<slug>-saml|oidc`, the slug in the characters a slug may hold; no length bound (see `hasProviderNameShape`). */
const PROVIDER_NAME_SHAPE = /^org-[a-z0-9-]+-(?:saml|oidc)$/;

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
 * Whether `name` has the shape of a provider name: `org-<slug>-saml` or
 * `org-<slug>-oidc`, lowercase letters, digits and hyphens. Only such a name
 * can belong to a connection, so the bearer path looks nothing else up: a
 * native address with an underscore (`ana_maria@...`) costs no query, while
 * one that starts with a real provider name and `_` is still treated as
 * federated and refused (the prefix rule fails safe). The check is looser
 * than {@link buildProviderName} on purpose (no slug length, no 20-character
 * bound): a connection row that predates a creation rule must still resolve,
 * so the guard never depends on those rules.
 */
export function hasProviderNameShape(name: string): boolean {
  return PROVIDER_NAME_SHAPE.test(name);
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
