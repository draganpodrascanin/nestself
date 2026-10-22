import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InvitationsService } from './invitations.service.js';

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function createMockDbs() {
  return {
    db: {},
    withOrgScope: vi.fn(async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn({})),
  };
}

function createMockInvitations() {
  return {
    create: vi.fn().mockResolvedValue({
      id: 'inv_1',
      email: 'new@example.com',
      orgId: 'org_sample',
      orgUnitId: null,
      templateKey: 'employee',
      tokenHash: 'hash',
      expiresAt: new Date('2099-01-01'),
      revokedAt: null,
      acceptedAt: null,
      invitedByUserId: 'user_ivana',
      importBatchId: null,
      createdAt: new Date(),
    }),
    findPendingByEmailAndOrg: vi.fn().mockResolvedValue(null),
    findByIdAndOrg: vi.fn(),
    revoke: vi.fn(),
  };
}

function createMockMemberships() {
  return {
    findByUserId: vi.fn().mockResolvedValue([]),
  };
}

function createMockIdentities() {
  return {
    findUserByEmail: vi.fn().mockResolvedValue(null),
  };
}

function createMockAudit() {
  return {
    record: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockMailer() {
  return {
    send: vi.fn().mockResolvedValue(undefined),
  };
}

// Stub for the orgUnits query used in assertOrgUnitBelongsToOrg.
// InvitationsService uses `tx.select(...).from(...).where(...)` which
// requires the real Drizzle query builder. We simulate a passing validation
// by not providing an orgUnitId in the request (optional field).

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('InvitationsService', () => {
  let dbs: ReturnType<typeof createMockDbs>;
  let invitations: ReturnType<typeof createMockInvitations>;
  let membershipRepo: ReturnType<typeof createMockMemberships>;
  let identities: ReturnType<typeof createMockIdentities>;
  let audit: ReturnType<typeof createMockAudit>;
  let mailer: ReturnType<typeof createMockMailer>;
  let service: InvitationsService;

  beforeEach(() => {
    dbs = createMockDbs();
    invitations = createMockInvitations();
    membershipRepo = createMockMemberships();
    identities = createMockIdentities();
    audit = createMockAudit();
    mailer = createMockMailer();

    service = new InvitationsService(
      dbs as never,
      invitations as never,
      membershipRepo as never,
      identities as never,
      audit as never,
      mailer as never,
    );
  });

  // -- create ---------------------------------------------------------------

  describe('create()', () => {
    it('creates an invitation and returns the response', async () => {
      const result = await service.create(
        'org_sample',
        { email: 'new@example.com', templateKey: 'employee' },
        'user_ivana',
        false,
      );

      expect(result).toHaveProperty('id', 'inv_1');
      expect(result).toHaveProperty('email', 'new@example.com');
      expect(invitations.create).toHaveBeenCalledOnce();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'invitation.created' }),
      );
    });

    it('returns devToken in non-production mode', async () => {
      const result = await service.create(
        'org_sample',
        { email: 'new@example.com', templateKey: 'employee' },
        'user_ivana',
        false,
      );

      expect(result).toHaveProperty('devToken');
      expect(typeof result.devToken).toBe('string');
    });

    it('does not return devToken in production mode', async () => {
      const result = await service.create(
        'org_sample',
        { email: 'new@example.com', templateKey: 'employee' },
        'user_ivana',
        true,
      );

      expect(result).not.toHaveProperty('devToken');
    });

    it('rejects invalid template key with 400', async () => {
      await expect(
        service.create(
          'org_sample',
          { email: 'new@example.com', templateKey: 'nonexistent' },
          'user_ivana',
          false,
        ),
      ).rejects.toThrow(expect.objectContaining({ code: 'validation' }));
    });

    it('rejects duplicate pending invitation with 409', async () => {
      invitations.findPendingByEmailAndOrg.mockResolvedValue({
        id: 'existing',
      });

      await expect(
        service.create(
          'org_sample',
          { email: 'existing@example.com', templateKey: 'employee' },
          'user_ivana',
          false,
        ),
      ).rejects.toThrow(expect.objectContaining({ code: 'duplicate_invitation' }));
    });

    it('rejects when user is already an active member with 409', async () => {
      identities.findUserByEmail.mockResolvedValue({ id: 'user_existing' });
      membershipRepo.findByUserId.mockResolvedValue([
        { orgId: 'org_sample', status: 'ACTIVE' },
      ]);

      await expect(
        service.create(
          'org_sample',
          { email: 'member@example.com', templateKey: 'employee' },
          'user_ivana',
          false,
        ),
      ).rejects.toThrow(expect.objectContaining({ code: 'already_member' }));
    });
  });

  // -- revoke ---------------------------------------------------------------

  describe('revoke()', () => {
    it('revokes an invitation and returns the response', async () => {
      const inv = {
        id: 'inv_1',
        email: 'revoked@example.com',
        orgId: 'org_sample',
        orgUnitId: null,
        templateKey: 'employee',
        tokenHash: 'h',
        expiresAt: new Date('2099-01-01'),
        revokedAt: null,
        acceptedAt: null,
        invitedByUserId: 'user_ivana',
        importBatchId: null,
        createdAt: new Date(),
      };
      invitations.findByIdAndOrg.mockResolvedValue(inv);
      invitations.revoke.mockResolvedValue({ ...inv, revokedAt: new Date() });

      const result = await service.revoke('org_sample', 'inv_1', 'user_ivana');

      expect(result).toHaveProperty('id', 'inv_1');
      expect(result.revokedAt).not.toBeNull();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'invitation.revoked' }),
      );
    });

    it('is idempotent on an already revoked invitation (200)', async () => {
      const revokedAt = new Date('2026-10-01');
      const inv = {
        id: 'inv_1',
        email: 'revoked@example.com',
        orgId: 'org_sample',
        orgUnitId: null,
        templateKey: 'employee',
        tokenHash: 'h',
        expiresAt: new Date('2099-01-01'),
        revokedAt,
        acceptedAt: null,
        invitedByUserId: 'user_ivana',
        importBatchId: null,
        createdAt: new Date(),
      };
      invitations.findByIdAndOrg.mockResolvedValue(inv);

      const result = await service.revoke('org_sample', 'inv_1', 'user_ivana');

      expect(result).toHaveProperty('id', 'inv_1');
      // revoke() should not be called again since it's already revoked.
      expect(invitations.revoke).not.toHaveBeenCalled();
    });

    it('returns 404 when invitation is not in this org', async () => {
      invitations.findByIdAndOrg.mockResolvedValue(null);

      await expect(
        service.revoke('org_sample', 'inv_nonexistent', 'user_ivana'),
      ).rejects.toThrow(expect.objectContaining({ code: 'not_found' }));
    });
  });
});
