/**
 * DiscoverService unit tests: the answer stays neutral when the identity
 * provider fails (SESS-R-21); only throttling surfaces, as 429.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IdentityProviderError } from '../identity/identity-provider.service.js';
import { ApiHttpException } from '../common/api-error.js';
import { IdentityResolutionService } from './identity-resolution.service.js';

const neutralDelay = vi.fn().mockResolvedValue(undefined);
vi.mock('./neutral-delay.js', () => ({ neutralDelay: (start: number) => neutralDelay(start) }));

const { DiscoverService } = await import('./discover.service.js');

const NEUTRAL = { method: 'email_otp', ssoStartUrl: null, connection: null };

const config = { get: (key: string) => (key === 'API_PUBLIC_URL' ? 'http://api.test/' : undefined) };

function setup(
  findUserByEmail: ReturnType<typeof vi.fn>,
  findActiveConnectionForDomain: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(null),
) {
  const identity = Object.create(IdentityResolutionService.prototype) as IdentityResolutionService;
  return new DiscoverService({ findUserByEmail } as never, identity, { findActiveConnectionForDomain } as never, config as never);
}

const ACME = { cognitoProviderName: 'org-acme-saml', orgId: 'org_sample', status: 'ACTIVE' };

describe('DiscoverService', () => {
  beforeEach(() => neutralDelay.mockClear());

  it('answers password for a user with a password, after the neutral delay', async () => {
    const service = setup(vi.fn().mockResolvedValue({ hasPassword: true }));
    await expect(service.discover('a@example.com')).resolves.toEqual({ method: 'password', ssoStartUrl: null, connection: null });
    expect(neutralDelay).toHaveBeenCalledTimes(1);
  });

  it('answers the neutral email_otp shape when the provider is unavailable', async () => {
    const service = setup(vi.fn().mockRejectedValue(new IdentityProviderError('down', 'unavailable', true)));
    await expect(service.discover('a@example.com')).resolves.toEqual(NEUTRAL);
    expect(neutralDelay).toHaveBeenCalledTimes(1);
  });

  it('answers neutrally for any other provider error code too', async () => {
    const service = setup(vi.fn().mockRejectedValue(new IdentityProviderError('no', 'not_authorized')));
    await expect(service.discover('a@example.com')).resolves.toEqual(NEUTRAL);
  });

  it('surfaces throttling as 429 too_many_attempts after the neutral delay', async () => {
    const service = setup(vi.fn().mockRejectedValue(new IdentityProviderError('slow', 'too_many_attempts', true)));
    const err = await service.discover('a@example.com').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiHttpException);
    expect((err as ApiHttpException).getStatus()).toBe(429);
    expect((err as ApiHttpException).code).toBe('too_many_attempts');
    expect(neutralDelay).toHaveBeenCalledTimes(1);
  });

  it('rethrows a non-provider error', async () => {
    const service = setup(vi.fn().mockRejectedValue(new TypeError('bug')));
    await expect(service.discover('a@example.com')).rejects.toBeInstanceOf(TypeError);
  });

  describe('home-realm discovery (3.4.3)', () => {
    it('routes a verified domain of an ACTIVE connection to sso with the absolute start URL', async () => {
      const lookup = vi.fn().mockResolvedValue(ACME);
      const findUser = vi.fn();
      const service = setup(findUser, lookup);
      await expect(service.discover(' Someone@ACME.example ', 'admin')).resolves.toEqual({
        method: 'sso',
        ssoStartUrl: 'http://api.test/api/auth/sso/start?connection=org-acme-saml&surface=admin',
        connection: 'org-acme-saml',
      });
      expect(lookup).toHaveBeenCalledWith('acme.example');
      expect(neutralDelay).toHaveBeenCalledTimes(1);
    });

    it('defaults the surface to workspace', async () => {
      const service = setup(vi.fn(), vi.fn().mockResolvedValue(ACME));
      const res = await service.discover('someone@acme.example');
      expect(res.ssoStartUrl).toContain('surface=workspace');
    });

    it('never looks up a public email domain (SSO-R-05)', async () => {
      const lookup = vi.fn().mockResolvedValue(ACME);
      const service = setup(vi.fn().mockResolvedValue(null), lookup);
      await expect(service.discover('someone@gmail.com')).resolves.toEqual(NEUTRAL);
      expect(lookup).not.toHaveBeenCalled();
    });

    it('falls back to the native method when no ACTIVE connection matches', async () => {
      const service = setup(vi.fn().mockResolvedValue({ hasPassword: true }), vi.fn().mockResolvedValue(null));
      await expect(service.discover('expert@acme.example')).resolves.toEqual({ method: 'password', ssoStartUrl: null, connection: null });
    });

    it('answers natively when the connection lookup fails', async () => {
      const service = setup(vi.fn().mockResolvedValue(null), vi.fn().mockRejectedValue(new Error('db down')));
      await expect(service.discover('someone@acme.example')).resolves.toEqual(NEUTRAL);
      expect(neutralDelay).toHaveBeenCalledTimes(1);
    });
  });
});
