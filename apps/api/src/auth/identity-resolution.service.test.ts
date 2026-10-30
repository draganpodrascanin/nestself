import { describe, it, expect, vi } from 'vitest';
import { IdentityResolutionService, authMethodFromOutcome, federatedProvider } from './identity-resolution.service.js';
import { IdentityProviderError } from '../identity/identity-provider.service.js';
import type { IdentityProviderErrorCode } from '../identity/identity-provider.service.js';

const service = new IdentityResolutionService(
  {} as never,
  {} as never,
  {} as never,
  {} as never,
  {} as never,
  {} as never,
);

function mapped(code: IdentityProviderErrorCode) {
  const ex = service.mapIdpError(new IdentityProviderError('raw message', code));
  return { status: ex.getStatus(), code: ex.code };
}

describe('IdentityResolutionService.mapIdpError', () => {
  it('maps a provider name collision to 409 conflict', () => {
    expect(mapped('provider_exists')).toEqual({ status: 409, code: 'conflict' });
  });

  it('maps a missing identity provider to 404 not_found', () => {
    expect(mapped('provider_not_found')).toEqual({ status: 404, code: 'not_found' });
  });

  it.each<[IdentityProviderErrorCode, number, string]>([
    ['invalid_code', 401, 'invalid_code'],
    ['not_authorized', 401, 'invalid_challenge'],
    ['too_many_attempts', 429, 'too_many_attempts'],
    ['totp_already_enrolled', 409, 'totp_already_enrolled'],
    ['unavailable', 503, 'unavailable'],
  ])('keeps %s -> %i %s', (code, status, apiCode) => {
    expect(mapped(code)).toEqual({ status, code: apiCode });
  });
});

describe('federated identities (D-04, 3.4.9)', () => {
  it('names the provider cognito:<providerName> and the method sso', () => {
    expect(federatedProvider('org-acme-saml')).toBe('cognito:org-acme-saml');
    const outcome = { kind: 'tokens' } as never;
    expect(authMethodFromOutcome(outcome, false, true)).toBe('sso');
    expect(authMethodFromOutcome(outcome, true, true)).toBe('sso');
    expect(authMethodFromOutcome(outcome, true)).toBe('password_totp');
    expect(authMethodFromOutcome(outcome, false)).toBe('email_otp');
  });

  function idToken(claims: Record<string, unknown>): string {
    return `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
  }

  function build(identity: { userId: string } | null) {
    const sessions = { create: vi.fn().mockResolvedValue({ sessionId: 's', csrfToken: 'c', absoluteExpiresAt: new Date() }) };
    const loader = {
      load: vi.fn().mockResolvedValue({
        userId: 'u1', displayName: 'U', initials: 'U', locale: 'en', memberships: [], staffTemplates: [],
        expert: null, isSuspended: false, isDeactivated: false,
      }),
    };
    const audit = { record: vi.fn().mockResolvedValue(undefined) };
    const identities = { findExternalIdentity: vi.fn().mockResolvedValue(identity) };
    const throttle = { reset: vi.fn().mockResolvedValue(undefined) };
    const me = { build: vi.fn().mockResolvedValue({ principal: {}, effectiveActions: [] }) };
    const svc = new IdentityResolutionService(
      sessions as never, loader as never, audit as never, identities as never, throttle as never, me as never,
    );
    return { svc, sessions, identities, throttle };
  }

  const tokens = { accessToken: 'a', idToken: idToken({ sub: 'sub-1', username: 'org-acme-saml_x' }), refreshToken: 'r', expiresIn: 3600 };

  it('looks the identity up under cognito:<providerName> and records sso with the second factor', async () => {
    const { svc, sessions, identities } = build({ userId: 'u1' });
    await svc.resolveIdentityAndCreateSession(tokens, 'a@acme.example', 'workspace', { ip: null, userAgent: null }, false, true, 'org-acme-saml');
    expect(identities.findExternalIdentity).toHaveBeenCalledWith('cognito:org-acme-saml', 'sub-1');
    expect(sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({ auth: expect.objectContaining({ method: 'sso', secondFactor: true }) }),
    );
  });

  it('keeps the native provider for non-federated tokens', async () => {
    const { svc, identities } = build({ userId: 'u1' });
    await svc.resolveIdentityAndCreateSession(tokens, 'a@example.com', 'workspace', { ip: null, userAgent: null }, false);
    expect(identities.findExternalIdentity).toHaveBeenCalledWith('cognito', 'sub-1');
  });

  it('a federated sign-in does not reset the email-code throttle of the IdP-asserted address', async () => {
    const { svc, throttle } = build({ userId: 'u1' });
    await svc.resolveIdentityAndCreateSession(tokens, 'victim@other.example', 'workspace', { ip: null, userAgent: null }, false, true, 'org-acme-saml');
    expect(throttle.reset).not.toHaveBeenCalled();
  });

  it('a native sign-in resets the email-code throttle', async () => {
    const { svc, throttle } = build({ userId: 'u1' });
    await svc.resolveIdentityAndCreateSession(tokens, 'a@example.com', 'workspace', { ip: null, userAgent: null }, false);
    expect(throttle.reset).toHaveBeenCalledWith('a@example.com');
  });
});
