import { describe, expect, it } from 'vitest';
import { PROVIDER_NAME_MAX_LENGTH, ProviderNameTooLongError, buildProviderName } from './provider-name.js';

describe('buildProviderName', () => {
  it('builds org-<slug>-saml and org-<slug>-oidc in lowercase', () => {
    expect(buildProviderName('acme', 'SAML')).toBe('org-acme-saml');
    expect(buildProviderName('acme-eu', 'OIDC')).toBe('org-acme-eu-oidc');
    expect(buildProviderName(' ACME ', 'SAML')).toBe('org-acme-saml');
  });

  it('accepts a name of exactly 20 characters', () => {
    const name = buildProviderName('abcdefghijk', 'SAML');
    expect(name).toBe('org-abcdefghijk-saml');
    expect(name).toHaveLength(PROVIDER_NAME_MAX_LENGTH);
  });

  it('refuses a name longer than 20 characters instead of truncating it', () => {
    expect(() => buildProviderName('abcdefghijkl', 'SAML')).toThrow(ProviderNameTooLongError);
    expect(() => buildProviderName('abcdefghijkl', 'OIDC')).toThrow(ProviderNameTooLongError);
  });
});
