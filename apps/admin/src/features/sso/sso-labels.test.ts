import { describe, it, expect } from 'vitest';
import { isHttpsUrl } from './sso-labels';

describe('isHttpsUrl', () => {
  it('accepts an absolute https: URL', () => {
    expect(isHttpsUrl('https://idp.acme.example/metadata')).toBe(true);
  });

  it.each([
    'http://idp.acme.example/metadata',
    'HTTPS://idp.acme.example/metadata',
    'https:idp.acme.example/metadata',
    'ftp://idp.acme.example/m',
    'file:///etc/passwd',
    'idp.acme.example',
    'https://',
    '',
  ])(
    'refuses %s, as the contract does',
    (value) => {
      expect(isHttpsUrl(value)).toBe(false);
    },
  );
});
