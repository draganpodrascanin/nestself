/**
 * UsersService unit tests — mocked repositories and services.
 *
 * @see T-1.18
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UsersService } from './users.service.js';

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function createMockIdentities() {
  return {
    findUserById: vi.fn(),
    setSuspended: vi.fn().mockResolvedValue(null),
    findExternalIdentitiesForUser: vi.fn().mockResolvedValue([]),
  };
}

function createMockIdp() {
  return {
    disableUser: vi.fn().mockResolvedValue(undefined),
    enableUser: vi.fn().mockResolvedValue(undefined),
    globalSignOut: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockAudit() {
  return {
    record: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockRevocation() {
  return {
    revokeAllAccess: vi.fn().mockResolvedValue({
      sessionsDestroyed: true,
      identitiesSignedOut: 1,
      identitiesFailed: 0,
      invalidated: true,
    }),
  };
}

const ACTIVE_USER = {
  id: 'user-1',
  email: 'user@example.com',
  displayName: 'Test User',
  locale: 'sr-Latn',
  suspendedAt: null,
  deactivatedAt: null,
  lastSignInAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  emailVerifiedAt: null,
};

const SUSPENDED_USER = {
  ...ACTIVE_USER,
  suspendedAt: new Date('2026-06-01'),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('UsersService', () => {
  let identities: ReturnType<typeof createMockIdentities>;
  let idp: ReturnType<typeof createMockIdp>;
  let audit: ReturnType<typeof createMockAudit>;
  let revocation: ReturnType<typeof createMockRevocation>;
  let principalLoader: { invalidateUser: ReturnType<typeof vi.fn> };
  let service: UsersService;

  beforeEach(() => {
    identities = createMockIdentities();
    idp = createMockIdp();
    audit = createMockAudit();
    revocation = createMockRevocation();
    principalLoader = { invalidateUser: vi.fn().mockResolvedValue(undefined) };
    service = new UsersService(
      identities as never,
      idp as never,
      audit as never,
      revocation as never,
      principalLoader as never,
    );
  });

  // ── suspend ─────────────────────────────────────────────────────────────

  describe('suspendUser()', () => {
    it('refuses to suspend the caller\'s own account and changes nothing', async () => {
      identities.findUserById.mockResolvedValue(ACTIVE_USER);

      const err = await service.suspendUser('user-1', { reason: 'Testing myself' }, 'user-1').catch((e: unknown) => e);

      expect(err).toEqual(expect.objectContaining({ code: 'cannot_suspend_self' }));
      expect((err as { getStatus(): number }).getStatus()).toBe(409);
      expect(identities.setSuspended).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
      expect(idp.disableUser).not.toHaveBeenCalled();
      expect(revocation.revokeAllAccess).not.toHaveBeenCalled();
    });

    it('throws 404 when user does not exist', async () => {
      identities.findUserById.mockResolvedValue(null);

      await expect(
        service.suspendUser('no-user', { reason: 'Security concern' }, 'actor-1'),
      ).rejects.toThrow(expect.objectContaining({ code: 'not_found' }));
    });

    it('suspends an active user', async () => {
      identities.findUserById.mockResolvedValue(ACTIVE_USER);
      identities.findExternalIdentitiesForUser.mockResolvedValue([
        { cognitoUsername: 'cog-1' },
      ]);

      const result = await service.suspendUser(
        'user-1', { reason: 'Suspicious activity' }, 'actor-1',
      );

      expect(result.userId).toBe('user-1');
      expect(result.suspendedAt).toBeTruthy();
      expect(identities.setSuspended).toHaveBeenCalledWith('user-1', expect.any(Date));
      expect(idp.disableUser).toHaveBeenCalledWith('cog-1');
      expect(revocation.revokeAllAccess).toHaveBeenCalledWith('user-1');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'user.suspended' }),
      );
    });

    it('keeps original timestamp when already suspended (idempotent)', async () => {
      identities.findUserById.mockResolvedValue(SUSPENDED_USER);

      const result = await service.suspendUser(
        'user-1', { reason: 'Double suspend' }, 'actor-1',
      );

      // Original timestamp preserved.
      expect(result.suspendedAt).toBe('2026-06-01T00:00:00.000Z');
      // setSuspended is NOT called again (original kept).
      expect(identities.setSuspended).not.toHaveBeenCalled();
      // But revocation still runs.
      expect(revocation.revokeAllAccess).toHaveBeenCalledOnce();
    });

    it('still calls revocation when IdP disable fails', async () => {
      identities.findUserById.mockResolvedValue(ACTIVE_USER);
      identities.findExternalIdentitiesForUser.mockResolvedValue([
        { cognitoUsername: 'cog-1' },
      ]);
      idp.disableUser.mockRejectedValue(new Error('Cognito unavailable'));

      const result = await service.suspendUser(
        'user-1', { reason: 'Test IdP failure' }, 'actor-1',
      );

      expect(result.userId).toBe('user-1');
      // revocation still called despite IdP failure.
      expect(revocation.revokeAllAccess).toHaveBeenCalledWith('user-1');
    });

    it('handles findExternalIdentitiesForUser failure gracefully', async () => {
      identities.findUserById.mockResolvedValue(ACTIVE_USER);
      identities.findExternalIdentitiesForUser.mockRejectedValue(
        new Error('DB error'),
      );

      const result = await service.suspendUser(
        'user-1', { reason: 'Test' }, 'actor-1',
      );

      // Still succeeds — IdP disable is skipped but revocation runs.
      expect(result.userId).toBe('user-1');
      expect(idp.disableUser).not.toHaveBeenCalled();
      expect(revocation.revokeAllAccess).toHaveBeenCalledOnce();
    });
  });

  // ── reinstate ───────────────────────────────────────────────────────────

  describe('reinstateUser()', () => {
    it('throws 404 when user does not exist', async () => {
      identities.findUserById.mockResolvedValue(null);

      await expect(
        service.reinstateUser('no-user', 'actor-1'),
      ).rejects.toThrow(expect.objectContaining({ code: 'not_found' }));
    });

    it('reinstates a suspended user', async () => {
      identities.findUserById.mockResolvedValue(SUSPENDED_USER);
      identities.findExternalIdentitiesForUser.mockResolvedValue([
        { cognitoUsername: 'cog-1' },
      ]);

      const result = await service.reinstateUser('user-1', 'actor-1');

      expect(result.userId).toBe('user-1');
      expect(result.reinstatedAt).toBeTruthy();
      expect(identities.setSuspended).toHaveBeenCalledWith('user-1', null);
      expect(principalLoader.invalidateUser).toHaveBeenCalledWith('user-1');
      expect(idp.enableUser).toHaveBeenCalledWith('cog-1');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'user.reactivated' }),
      );
    });

    it('is idempotent for an active user', async () => {
      identities.findUserById.mockResolvedValue(ACTIVE_USER);

      const result = await service.reinstateUser('user-1', 'actor-1');

      expect(result.userId).toBe('user-1');
      expect(identities.setSuspended).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
      expect(principalLoader.invalidateUser).not.toHaveBeenCalled();
    });
  });
});
