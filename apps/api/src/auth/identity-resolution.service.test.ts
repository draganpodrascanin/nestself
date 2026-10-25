import { describe, it, expect } from 'vitest';
import { IdentityResolutionService } from './identity-resolution.service.js';
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
