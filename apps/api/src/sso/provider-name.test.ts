import { describe, expect, it } from 'vitest';
import {
  PROVIDER_NAME_MAX_LENGTH,
  ProviderNameTooLongError,
  buildProviderName,
  hasProviderNameShape,
  slugProviderNames,
} from './provider-name.js';

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

describe('slugProviderNames', () => {
  it('returns both protocol names of the slug a provider name was built from', () => {
    expect(slugProviderNames('org-acme-saml')).toEqual(['org-acme-saml', 'org-acme-oidc']);
    expect(slugProviderNames('org-acme-eu-oidc')).toEqual(['org-acme-eu-saml', 'org-acme-eu-oidc']);
  });

  it('returns a name without a protocol suffix unchanged', () => {
    expect(slugProviderNames('legacy')).toEqual(['legacy']);
  });
});

describe('hasProviderNameShape', () => {
  it('accepts every name buildProviderName makes', () => {
    for (const slug of ['ab', 'acme', 'acme-eu', 'abcdefghijk', '0-9']) {
      expect(hasProviderNameShape(buildProviderName(slug, 'SAML'))).toBe(true);
      expect(hasProviderNameShape(buildProviderName(slug, 'OIDC'))).toBe(true);
    }
  });

  it('accepts a name beyond the creation rules too, so a row that predates a rule still resolves', () => {
    expect(hasProviderNameShape('org-other-ssoauth-oidc')).toBe(true);
    expect(hasProviderNameShape('org-a-saml')).toBe(true);
  });

  it.each([
    ['an address local part', 'ana'],
    ['a first name with a hyphen', 'ana-maria'],
    ['no protocol suffix', 'org-acme'],
    ['another protocol', 'org-acme-ldap'],
    ['no org- prefix', 'acme-saml'],
    ['no slug', 'org--saml'],
    ['upper case', 'org-ACME-saml'],
    ['a dot in the slug', 'org-ac.me-oidc'],
    ['the empty string', ''],
  ])('refuses %s', (_label, name) => {
    expect(hasProviderNameShape(name)).toBe(false);
  });
});
