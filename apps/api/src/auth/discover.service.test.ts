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

function setup(findUserByEmail: ReturnType<typeof vi.fn>) {
  const identity = Object.create(IdentityResolutionService.prototype) as IdentityResolutionService;
  return new DiscoverService({ findUserByEmail } as never, identity);
}

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
});
