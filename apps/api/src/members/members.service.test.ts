/**
 * MembersService unit tests — mocked repositories and services.
 *
 * @see T-1.16
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MembersService } from './members.service.js';

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function createMockDbService() {
  return {
    db: {},
    withOrgScope: vi.fn((_orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn('tx')),
  };
}

function createMockMembershipsRepo() {
  return {
    findByIdAndOrg: vi.fn(),
    endMembership: vi.fn(),
    findByUserId: vi.fn(),
  };
}

function createMockAuthzRepo() {
  return {
    findActiveGrantsScopedToOrg: vi.fn().mockResolvedValue([]),
    revokeGrantTree: vi.fn().mockResolvedValue({ roots: [], children: [] }),
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

const ACTIVE_MEMBERSHIP = {
  id: 'mem-1',
  userId: 'user-target',
  orgId: 'org-1',
  status: 'ACTIVE',
  startDate: new Date('2026-01-01'),
  endDate: null,
  endedReason: null,
  orgUnitId: null,
  costCenterUnitId: null,
  lineManagerUserId: null,
  teamId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const ENDED_MEMBERSHIP = {
  ...ACTIVE_MEMBERSHIP,
  status: 'ENDED',
  endDate: new Date('2026-06-01'),
  endedReason: 'LEFT',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MembersService', () => {
  let dbs: ReturnType<typeof createMockDbService>;
  let memberships: ReturnType<typeof createMockMembershipsRepo>;
  let authz: ReturnType<typeof createMockAuthzRepo>;
  let audit: ReturnType<typeof createMockAudit>;
  let revocation: ReturnType<typeof createMockRevocation>;
  let service: MembersService;

  beforeEach(() => {
    dbs = createMockDbService();
    memberships = createMockMembershipsRepo();
    authz = createMockAuthzRepo();
    audit = createMockAudit();
    revocation = createMockRevocation();
    service = new MembersService(
      dbs as never,
      memberships as never,
      authz as never,
      audit as never,
      revocation as never,
    );
  });

  // ── 404 for missing or foreign-org membership ─────────────────────────

  it('throws 404 when membership is not found in the org', async () => {
    memberships.findByIdAndOrg.mockResolvedValue(null);

    await expect(
      service.endMembership('org-1', 'mem-missing', { reason: 'LEFT' }, 'actor-1'),
    ).rejects.toThrow(expect.objectContaining({ code: 'not_found' }));
  });

  // ── Idempotent re-end ─────────────────────────────────────────────────

  it('returns existing result for already-ended membership (idempotent)', async () => {
    memberships.findByIdAndOrg.mockResolvedValue(ENDED_MEMBERSHIP);

    const result = await service.endMembership(
      'org-1', 'mem-1', { reason: 'DEACTIVATED_BY_HR' }, 'actor-1',
    );

    expect(result.status).toBe('ENDED');
    expect(result.endedReason).toBe('LEFT'); // original reason preserved
    expect(result.revokedGrantIds).toEqual([]);
    expect(memberships.endMembership).not.toHaveBeenCalled();
    expect(revocation.revokeAllAccess).not.toHaveBeenCalled();
  });

  // ── Successful end with grants ────────────────────────────────────────

  it('ends membership and revokes direct grants', async () => {
    memberships.findByIdAndOrg.mockResolvedValue(ACTIVE_MEMBERSHIP);
    memberships.endMembership.mockResolvedValue({ ...ACTIVE_MEMBERSHIP, status: 'ENDED' });

    const directGrant = {
      id: 'g-1',
      subjectUserId: 'user-target',
      scopeOrgId: 'org-1',
      parentGrantId: null,
      revokedAt: null,
    };
    authz.findActiveGrantsScopedToOrg.mockResolvedValue([directGrant]);
    authz.revokeGrantTree.mockResolvedValue({ roots: ['g-1'], children: [] });

    const result = await service.endMembership(
      'org-1', 'mem-1', { reason: 'DEACTIVATED_BY_HR' }, 'actor-1',
    );

    expect(result.status).toBe('ENDED');
    expect(result.revokedGrantIds).toContain('g-1');
    expect(memberships.endMembership).toHaveBeenCalledOnce();
    expect(authz.revokeGrantTree).toHaveBeenCalledWith(
      ['g-1'],
      expect.objectContaining({ reason: 'membership_ended' }),
      'tx',
    );
    expect(revocation.revokeAllAccess).toHaveBeenCalledWith('user-target', {
      sessionsForOrgId: 'org-1',
      orgIds: ['org-1'],
    });
  });

  // ── Grant cascade: parent → child → grandchild ────────────────────────

  it('revokes the grant tree and audits roots and delegations', async () => {
    memberships.findByIdAndOrg.mockResolvedValue(ACTIVE_MEMBERSHIP);
    memberships.endMembership.mockResolvedValue({ ...ACTIVE_MEMBERSHIP, status: 'ENDED' });

    const parentGrant = {
      id: 'g-parent', subjectUserId: 'user-target',
      scopeOrgId: 'org-1', parentGrantId: null, revokedAt: null,
    };
    const delegatedToTarget = {
      id: 'g-received', subjectUserId: 'user-target',
      scopeOrgId: 'org-1', parentGrantId: 'g-other', revokedAt: null,
    };

    authz.findActiveGrantsScopedToOrg.mockResolvedValue([parentGrant, delegatedToTarget]);
    authz.revokeGrantTree.mockResolvedValue({
      roots: ['g-parent', 'g-received'],
      children: ['g-child', 'g-grandchild'],
    });

    const result = await service.endMembership(
      'org-1', 'mem-1', { reason: 'DEACTIVATED_BY_HR' }, 'actor-1',
    );

    expect(result.revokedGrantIds).toEqual(['g-parent', 'g-received', 'g-child', 'g-grandchild']);
    expect(authz.revokeGrantTree).toHaveBeenCalledOnce();
    expect(authz.revokeGrantTree).toHaveBeenCalledWith(
      ['g-parent', 'g-received'],
      expect.objectContaining({ byUserId: 'actor-1', reason: 'membership_ended' }),
      'tx',
    );

    const grantEvents = audit.record.mock.calls
      .map(([e]) => e as { action: string; recordId: string; details: { reason: string } })
      .filter((e) => e.action.startsWith('grant.'))
      .map((e) => [e.action, e.recordId, e.details.reason]);
    expect(grantEvents).toEqual([
      ['grant.revoked', 'g-parent', 'membership_ended'],
      ['grant.delegation_revoked', 'g-received', 'membership_ended'],
      ['grant.delegation_revoked', 'g-child', 'parent_revoked'],
      ['grant.delegation_revoked', 'g-grandchild', 'parent_revoked'],
    ]);
  });

  // ── Audit recorded before revocation ──────────────────────────────────

  it('records audit events before access revocation', async () => {
    memberships.findByIdAndOrg.mockResolvedValue(ACTIVE_MEMBERSHIP);
    memberships.endMembership.mockResolvedValue({ ...ACTIVE_MEMBERSHIP, status: 'ENDED' });
    authz.findActiveGrantsScopedToOrg.mockResolvedValue([]);

    const callOrder: string[] = [];
    audit.record.mockImplementation(async () => {
      callOrder.push('audit');
    });
    revocation.revokeAllAccess.mockImplementation(async () => {
      callOrder.push('revocation');
      return { sessionsDestroyed: true, identitiesSignedOut: 0, identitiesFailed: 0, invalidated: true };
    });

    await service.endMembership('org-1', 'mem-1', { reason: 'LEFT' }, 'actor-1');

    expect(callOrder).toEqual(['audit', 'revocation']);
  });

  // ── Access revocation called with org scope ───────────────────────────

  it('calls revokeAllAccess with sessionsForOrgId', async () => {
    memberships.findByIdAndOrg.mockResolvedValue(ACTIVE_MEMBERSHIP);
    memberships.endMembership.mockResolvedValue({ ...ACTIVE_MEMBERSHIP, status: 'ENDED' });
    authz.findActiveGrantsScopedToOrg.mockResolvedValue([]);

    await service.endMembership('org-1', 'mem-1', { reason: 'LEFT' }, 'actor-1');

    expect(revocation.revokeAllAccess).toHaveBeenCalledWith('user-target', {
      sessionsForOrgId: 'org-1',
      orgIds: ['org-1'],
    });
  });
});
