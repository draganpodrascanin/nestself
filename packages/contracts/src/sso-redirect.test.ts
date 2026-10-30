/**
 * SSO redirect query contracts (API-R-06): the start query and the relative
 * return-path rule.
 */
import { describe, expect, it } from 'vitest';
import {
  SsoStartQuerySchema,
  SsoCallbackQuerySchema,
  isRelativeReturnPath,
  SSO_SIGN_IN_REASONS,
} from './index.ts';

describe('isRelativeReturnPath (API-R-06)', () => {
  it.each(['/', '/people', '/a/b?x=1#y', '/people/%2F'])('accepts %s', (v) => {
    expect(isRelativeReturnPath(v)).toBe(true);
  });

  it.each([
    'https://evil.example/',
    '//evil.example',
    '/\\evil.example',
    '/a//b',
    'people',
    'javascript:alert(1)',
    '/a\nb',
    '',
  ])('rejects %j', (v) => {
    expect(isRelativeReturnPath(v)).toBe(false);
  });
});

const NONCE = 'n'.repeat(43);

describe('SsoStartQuerySchema', () => {
  it('accepts connection, surface, returnPath and the test flag', () => {
    expect(
      SsoStartQuerySchema.parse({ connection: 'org-acme-saml', surface: 'admin', returnPath: '/x', test: NONCE }),
    ).toEqual({ connection: 'org-acme-saml', surface: 'admin', returnPath: '/x', test: NONCE });
  });

  it('requires a known surface and a well-formed connection', () => {
    expect(SsoStartQuerySchema.safeParse({ connection: 'org-acme-saml', surface: 'mobile' }).success).toBe(false);
    expect(SsoStartQuerySchema.safeParse({ connection: 'a b', surface: 'workspace' }).success).toBe(false);
    expect(SsoStartQuerySchema.safeParse({ surface: 'workspace' }).success).toBe(false);
  });

  it('rejects an absolute or protocol-relative returnPath and a test value that is not a nonce', () => {
    const base = { connection: 'org-acme-saml', surface: 'workspace' };
    expect(SsoStartQuerySchema.safeParse({ ...base, returnPath: 'https://evil.example' }).success).toBe(false);
    expect(SsoStartQuerySchema.safeParse({ ...base, returnPath: '//evil.example' }).success).toBe(false);
    expect(SsoStartQuerySchema.safeParse({ ...base, test: 'true' }).success).toBe(false);
    expect(SsoStartQuerySchema.safeParse({ ...base, test: '1' }).success).toBe(false);
  });
});

describe('SsoCallbackQuerySchema', () => {
  it('takes code and state, or the error Cognito returns instead', () => {
    expect(SsoCallbackQuerySchema.parse({ code: 'c', state: 's' })).toEqual({ code: 'c', state: 's' });
    expect(SsoCallbackQuerySchema.parse({ error: 'access_denied', state: 's' })).toEqual({ error: 'access_denied', state: 's' });
  });
});

it('lists the sign-in reasons the SSO routes can send', () => {
  expect(SSO_SIGN_IN_REASONS).toEqual(['sso_denied', 'sso_email_unverified', 'sso_rate_limited']);
});
