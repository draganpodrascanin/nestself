import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryKeyValueStore } from '../redis/memory-key-value-store.js';
import {
  mobileFamilyKey,
  revokedFamilyKey,
  userMobileFamiliesKey,
} from '../redis/redis-keys.js';
import { MaintenanceJobsService } from './maintenance-jobs.service.js';

const NOW = new Date('2026-10-23T02:15:00.000Z');

function grant(overrides: Partial<Record<string, unknown>>) {
  return {
    id: 'g',
    subjectUserId: 'user_a',
    templateKey: 'team_manager',
    actions: ['budget.read'],
    scopeType: 'organization',
    scopeOrgId: 'org_1',
    scopeOrgUnitId: null,
    includeDescendants: false,
    scopeRefKind: null,
    scopeRefId: null,
    conditions: null,
    validFrom: new Date('2026-01-01'),
    validUntil: null,
    delegationEnvelope: null,
    parentGrantId: null,
    grantedByUserId: 'user_hr',
    grantedAt: new Date('2026-01-01'),
    revokedAt: null,
    revokedByUserId: null,
    revokedReason: null,
    ...overrides,
  } as never;
}

describe('MaintenanceJobsService', () => {
  let authzRepo: {
    findExpiredUnrevokedGrants: ReturnType<typeof vi.fn>;
    findOrphanedDelegations: ReturnType<typeof vi.fn>;
    findGrantsWithoutActiveMembership: ReturnType<typeof vi.fn>;
    revokeGrants: ReturnType<typeof vi.fn>;
  };
  let auditRepo: { ensurePartitions: ReturnType<typeof vi.fn> };
  let audit: { record: ReturnType<typeof vi.fn> };
  let principals: { invalidateUser: ReturnType<typeof vi.fn> };
  let store: MemoryKeyValueStore;
  let service: MaintenanceJobsService;

  beforeEach(() => {
    authzRepo = {
      findExpiredUnrevokedGrants: vi.fn().mockResolvedValue([]),
      findOrphanedDelegations: vi.fn().mockResolvedValue([]),
      findGrantsWithoutActiveMembership: vi.fn().mockResolvedValue([]),
      revokeGrants: vi.fn().mockResolvedValue(undefined),
    };
    auditRepo = { ensurePartitions: vi.fn().mockResolvedValue(['audit_events_y2026m10', 'audit_events_y2026m11']) };
    audit = { record: vi.fn().mockResolvedValue(undefined) };
    principals = { invalidateUser: vi.fn().mockResolvedValue(undefined) };
    store = new MemoryKeyValueStore();
    service = new MaintenanceJobsService(
      authzRepo as never,
      auditRepo as never,
      audit as never,
      principals as never,
      store,
    );
  });

  it('ensures audit partitions three months ahead', async () => {
    const report = await service.run('audit.ensure-partitions');
    expect(auditRepo.ensurePartitions).toHaveBeenCalledWith(3);
    expect(report).toEqual({ job: 'audit.ensure-partitions', partitions: ['audit_events_y2026m10', 'audit_events_y2026m11'] });
  });

  describe('grants.reconcile', () => {
    it('does nothing when every grant is consistent', async () => {
      const report = await service.reconcileGrants(NOW);
      expect(report).toEqual({ expired: [], orphanedDelegations: [], withoutMembership: [] });
      expect(authzRepo.revokeGrants).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
      expect(principals.invalidateUser).not.toHaveBeenCalled();
    });

    it('closes expired grants with reason expired and audits grant.expired', async () => {
      authzRepo.findExpiredUnrevokedGrants.mockResolvedValue([
        grant({ id: 'g_exp', validUntil: new Date('2026-10-01') }),
      ]);
      const report = await service.reconcileGrants(NOW);
      expect(report.expired).toEqual(['g_exp']);
      expect(authzRepo.revokeGrants).toHaveBeenCalledWith(['g_exp'], { at: NOW, byUserId: null, reason: 'expired' });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'grant.expired',
          actorKind: 'JOB',
          actorUserId: null,
          orgId: 'org_1',
          recordId: 'g_exp',
          details: expect.objectContaining({ reason: 'expired', subjectUserId: 'user_a' }),
        }),
      );
      expect(principals.invalidateUser).toHaveBeenCalledWith('user_a', ['org_1']);
    });

    it('revokes orphaned delegations and grants without an active membership', async () => {
      authzRepo.findOrphanedDelegations.mockResolvedValue([
        grant({ id: 'g_child', parentGrantId: 'g_parent', subjectUserId: 'user_b' }),
      ]);
      authzRepo.findGrantsWithoutActiveMembership.mockResolvedValue([
        grant({ id: 'g_left', subjectUserId: 'user_c', scopeOrgId: 'org_2' }),
      ]);
      const report = await service.reconcileGrants(NOW);
      expect(report.orphanedDelegations).toEqual(['g_child']);
      expect(report.withoutMembership).toEqual(['g_left']);
      expect(authzRepo.revokeGrants).toHaveBeenCalledWith(['g_child'], { at: NOW, byUserId: null, reason: 'parent_revoked' });
      expect(authzRepo.revokeGrants).toHaveBeenCalledWith(['g_left'], { at: NOW, byUserId: null, reason: 'membership_ended' });
      const actions = audit.record.mock.calls.map((c) => (c[0] as { action: string }).action);
      expect(actions).toEqual(['grant.delegation_revoked', 'grant.revoked']);
      expect(principals.invalidateUser).toHaveBeenCalledWith('user_b', ['org_1']);
      expect(principals.invalidateUser).toHaveBeenCalledWith('user_c', ['org_2']);
    });

    it('invalidates each subject once with every affected organization', async () => {
      authzRepo.findExpiredUnrevokedGrants.mockResolvedValue([
        grant({ id: 'g1', scopeOrgId: 'org_1' }),
        grant({ id: 'g2', scopeOrgId: 'org_2' }),
        grant({ id: 'g3', scopeOrgId: null, scopeType: 'platform' }),
      ]);
      await service.reconcileGrants(NOW);
      expect(principals.invalidateUser).toHaveBeenCalledTimes(1);
      expect(principals.invalidateUser).toHaveBeenCalledWith('user_a', ['org_1', 'org_2']);
    });
  });

  describe('mobile.prune-stale-families', () => {
    it('denylists families whose last-seen key expired and keeps live ones', async () => {
      await store.sAdd(userMobileFamiliesKey('user_m'), 'jti_live', 'jti_stale');
      await store.set(mobileFamilyKey('jti_live'), NOW.toISOString());

      const report = await service.pruneStaleMobileFamilies();

      expect(report).toEqual({
        usersScanned: 1,
        familiesChecked: 2,
        revoked: [{ userId: 'user_m', originJti: 'jti_stale' }],
      });
      expect(await store.get(revokedFamilyKey('jti_stale'))).not.toBeNull();
      expect(await store.ttl(revokedFamilyKey('jti_stale'))).toBeGreaterThan(80 * 24 * 3600);
      expect(await store.get(revokedFamilyKey('jti_live'))).toBeNull();
      expect(await store.sMembers(userMobileFamiliesKey('user_m'))).toEqual(['jti_live']);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'auth.mobile_family.revoked',
          actorKind: 'JOB',
          recordType: 'token_family',
          recordId: 'jti_stale',
          details: expect.objectContaining({ userId: 'user_m', reason: 'stale_30d' }),
        }),
      );
    });

    it('reports zero work when no family sets exist', async () => {
      const report = await service.pruneStaleMobileFamilies();
      expect(report).toEqual({ usersScanned: 0, familiesChecked: 0, revoked: [] });
    });
  });
});
