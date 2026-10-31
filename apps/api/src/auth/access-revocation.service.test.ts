import { afterEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { AccessRevocationService } from './access-revocation.service.js';

function setup() {
  const sessions = { destroyAllForUser: vi.fn().mockResolvedValue(undefined) };
  const principalLoader = { invalidateUser: vi.fn().mockResolvedValue(undefined) };
  const idp = { globalSignOut: vi.fn().mockResolvedValue(undefined) };
  // A native pool username is the email address; a federated one is `<provider>_<subject>`.
  const identities = {
    findExternalIdentitiesForUser: vi.fn().mockResolvedValue([
      { cognitoUsername: 'ivana@acme.example', provider: 'cognito' },
      { cognitoUsername: 'org-acme-saml_ivana', provider: 'cognito:org-acme-saml' },
    ]),
  };
  const service = new AccessRevocationService(
    sessions as never,
    principalLoader as never,
    idp as never,
    identities as never,
  );
  return { service, sessions, principalLoader, idp, identities };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AccessRevocationService', () => {
  it('signs every identity out and reports it', async () => {
    const { service, idp } = setup();

    const report = await service.revokeAllAccess('user_ivana');

    expect(idp.globalSignOut).toHaveBeenCalledWith('ivana@acme.example');
    expect(idp.globalSignOut).toHaveBeenCalledWith('org-acme-saml_ivana');
    expect(report).toEqual({ sessionsDestroyed: true, identitiesSignedOut: 2, identitiesFailed: 0, invalidated: true });
  });

  it('keeps going after a failed sign-out and logs the user and the provider, never the pool username', async () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const { service, idp } = setup();
    idp.globalSignOut.mockRejectedValueOnce(new Error('Cognito unavailable'));

    const report = await service.revokeAllAccess('user_ivana');

    expect(report).toEqual({ sessionsDestroyed: true, identitiesSignedOut: 1, identitiesFailed: 1, invalidated: true });
    const lines = error.mock.calls.map((args) => args.map(String).join(' '));
    expect(lines.some((line) => line.includes('globalSignOut failed for user user_ivana (cognito)'))).toBe(true);
    expect(lines.join('\n')).not.toContain('ivana@acme.example');
  });
});
