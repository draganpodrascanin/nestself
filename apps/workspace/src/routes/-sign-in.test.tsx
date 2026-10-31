/**
 * `/sign-in` search parameters: the SSO callback's `reason` and the handle of
 * a pending binding (`bind`). The URL never carries an address.
 */
import { describe, it, expect } from 'vitest';
import { Route } from './_public/sign-in';

const parse = (search: Record<string, unknown>) =>
  (Route.options.validateSearch as unknown as { parse: (value: unknown) => Record<string, unknown> }).parse(search);

/** 32 random bytes, base64url: what the API puts on the URL. */
const HANDLE = `${'A'.repeat(42)}_`;

describe('/sign-in search', () => {
  it('keeps the reason and a well-formed bind handle', () => {
    expect(parse({ reason: 'sso_email_unverified', bind: HANDLE })).toEqual({ reason: 'sso_email_unverified', bind: HANDLE });
  });

  it.each(['short', 'x'.repeat(129), `${'x'.repeat(40)}+/=`, `${'x'.repeat(40)} ab`])('drops a malformed handle (%s)', (bind) => {
    expect(parse({ reason: 'sso_email_unverified', bind })).toEqual({ reason: 'sso_email_unverified' });
  });

  it('drops an address, which the API no longer sends', () => {
    expect(parse({ reason: 'sso_email_unverified', email: 'someone@acme.example' })).toEqual({
      reason: 'sso_email_unverified',
    });
  });

  it('drops an unknown reason and keeps a relative return path', () => {
    expect(parse({ reason: 'nope', return: '/people' })).toEqual({ return: '/people' });
  });
});
