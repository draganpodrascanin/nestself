import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Logger } from '@nestjs/common';
import { MemoryKeyValueStore } from '../redis/memory-key-value-store.js';
import {
  INVALIDATE_CHANNEL,
  mobileFamilyKey,
  revokedFamilyKey,
  sessionKey,
  userMobileFamiliesKey,
  userSessionsKey,
} from '../redis/redis-keys.js';
import { SessionService } from '../session/session.service.js';
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
    findExpiredApprovedEmergencyAccess: ReturnType<typeof vi.fn>;
    revokeEmergencyAccess: ReturnType<typeof vi.fn>;
  };
  let auditRepo: { ensurePartitions: ReturnType<typeof vi.fn> };
  let audit: { record: ReturnType<typeof vi.fn> };
  let principals: { invalidateUser: ReturnType<typeof vi.fn>; invalidateDelegatees: ReturnType<typeof vi.fn> };
  let store: MemoryKeyValueStore;
  let idp: { revokeRefreshToken: ReturnType<typeof vi.fn> };
  let service: MaintenanceJobsService;

  beforeEach(() => {
    authzRepo = {
      findExpiredUnrevokedGrants: vi.fn().mockResolvedValue([]),
      findOrphanedDelegations: vi.fn().mockResolvedValue([]),
      findGrantsWithoutActiveMembership: vi.fn().mockResolvedValue([]),
      revokeGrants: vi.fn().mockResolvedValue(undefined),
      findExpiredApprovedEmergencyAccess: vi.fn().mockResolvedValue([]),
      revokeEmergencyAccess: vi.fn().mockImplementation((id: string) => Promise.resolve({ id })),
    };
    auditRepo = { ensurePartitions: vi.fn().mockResolvedValue(['audit_events_y2026m10', 'audit_events_y2026m11']) };
    audit = { record: vi.fn().mockResolvedValue(undefined) };
    principals = { invalidateUser: vi.fn().mockResolvedValue(undefined), invalidateDelegatees: vi.fn().mockResolvedValue([]) };
    store = new MemoryKeyValueStore();
    idp = { revokeRefreshToken: vi.fn().mockResolvedValue(undefined) };
    const cipher = {
      encrypt: (v: string) => `enc:${v}`,
      decrypt: (v: string) => ({ plaintext: v.replace(/^enc:/, ''), usedPreviousKey: false }),
    };
    const sessions = new SessionService(store, idp as never, cipher as never, { get: () => undefined } as never);
    service = new MaintenanceJobsService(
      authzRepo as never,
      auditRepo as never,
      audit as never,
      principals as never,
      store,
      sessions,
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
      // g_left is closed without its tree: its delegatees hold cached copies.
      expect(principals.invalidateDelegatees).toHaveBeenCalledWith(['g_child']);
      expect(principals.invalidateDelegatees).toHaveBeenCalledWith(['g_left']);
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

  describe('emergency.sweep-expired', () => {
    const emergency = (id: string, userId: string) =>
      ({
        id,
        userId,
        approvedByUserId: 'user_approver',
        approvedAt: new Date('2026-10-23T01:00:00.000Z'),
        purpose: 'Safeguarding concern raised by the assigned expert',
        scopeKind: 'CASE',
        scopeId: 'case_1',
        requestedDurationMinutes: 60,
        grantedAt: new Date('2026-10-23T01:00:00.000Z'),
        expiresAt: new Date('2026-10-23T02:00:00.000Z'),
        revokedAt: null,
        revokedByUserId: null,
      }) as never;

    it('revokes each approved, expired record as the job and audits emergency_access.expired', async () => {
      authzRepo.findExpiredApprovedEmergencyAccess.mockResolvedValue([
        emergency('ema_1', 'user_a'),
        emergency('ema_2', 'user_b'),
      ]);

      const report = await service.run('emergency.sweep-expired', NOW);

      expect(report).toEqual({ job: 'emergency.sweep-expired', expired: ['ema_1', 'ema_2'] });
      expect(authzRepo.findExpiredApprovedEmergencyAccess).toHaveBeenCalledWith(NOW);
      expect(authzRepo.revokeEmergencyAccess).toHaveBeenCalledWith('ema_1', null, NOW);
      expect(authzRepo.revokeEmergencyAccess).toHaveBeenCalledWith('ema_2', null, NOW);
      expect(audit.record).toHaveBeenCalledTimes(2);
      expect(audit.record).toHaveBeenCalledWith({
        action: 'emergency_access.expired',
        actorUserId: null,
        actorKind: 'JOB',
        recordType: 'emergency_access',
        recordId: 'ema_1',
        result: 'ALLOWED',
        details: { userId: 'user_a', scopeKind: 'CASE', scopeId: 'case_1', job: 'emergency.sweep-expired' },
        occurredAt: NOW,
      });
      expect(principals.invalidateUser).toHaveBeenCalledWith('user_a');
      expect(principals.invalidateUser).toHaveBeenCalledWith('user_b');
    });

    it('skips a record revoked in the meantime without auditing it', async () => {
      authzRepo.findExpiredApprovedEmergencyAccess.mockResolvedValue([emergency('ema_1', 'user_a')]);
      authzRepo.revokeEmergencyAccess.mockResolvedValue(null);

      const report = await service.sweepExpiredEmergencyAccess(NOW);

      expect(report).toEqual({ expired: [] });
      expect(audit.record).not.toHaveBeenCalled();
      expect(principals.invalidateUser).not.toHaveBeenCalled();
    });

    it('reports zero work when nothing has expired', async () => {
      expect(await service.sweepExpiredEmergencyAccess(NOW)).toEqual({ expired: [] });
      expect(authzRepo.revokeEmergencyAccess).not.toHaveBeenCalled();
    });
  });

  describe('sessions.reconcile-ttl', () => {
    /** A stored record as SessionService writes it, with the raw session id never persisted. */
    async function storeSession(hash: string, userId: string, absoluteExpiresAt: string): Promise<void> {
      const record = {
        userId,
        surface: 'workspace',
        population: 'employee',
        context: { kind: 'personal' },
        cognito: {
          username: `${userId}@example.test`,
          accessToken: 'enc:access',
          idToken: 'enc:id',
          refreshToken: `enc:refresh_${hash}`,
          accessExpiresAt: absoluteExpiresAt,
        },
        auth: { method: 'email_otp', time: '2026-10-01T08:00:00.000Z', secondFactor: false },
        lastStepUpAt: null,
        createdAt: '2026-10-01T08:00:00.000Z',
        lastActivityAt: '2026-10-01T08:00:00.000Z',
        idleExpiresAt: absoluteExpiresAt,
        absoluteExpiresAt,
        rememberDevice: false,
        ipHash: '',
        userAgentFamily: 'Chrome',
        csrfToken: 'csrf',
      };
      // No TTL: the drift this job exists for is a key that outlived its absolute expiry.
      await store.set(sessionKey(hash), JSON.stringify(record));
      await store.sAdd(userSessionsKey(userId), hash);
    }

    it('destroys sessions past their absolute expiry through SessionService and keeps live ones', async () => {
      await storeSession('hash_expired', 'user_s', '2026-10-23T02:00:00.000Z');
      await storeSession('hash_live', 'user_s', '2026-10-23T09:00:00.000Z');
      const invalidations: string[] = [];
      await store.subscribe(INVALIDATE_CHANNEL, (m) => invalidations.push(m));

      const report = await service.run('sessions.reconcile-ttl', NOW);

      expect(report).toEqual({ job: 'sessions.reconcile-ttl', scanned: 2, destroyed: ['hash_expired'], failed: 0 });
      expect(await store.get(sessionKey('hash_expired'))).toBeNull();
      expect(await store.get(sessionKey('hash_live'))).not.toBeNull();
      expect(await store.sMembers(userSessionsKey('user_s'))).toEqual(['hash_live']);
      expect(idp.revokeRefreshToken).toHaveBeenCalledTimes(1);
      expect(idp.revokeRefreshToken).toHaveBeenCalledWith('refresh_hash_expired');
      expect(invalidations).toHaveLength(1);
      expect(JSON.parse(invalidations[0]!)).toMatchObject({ userId: 'user_s', sessionIdHash: 'hash_expired' });
    });

    it('counts a malformed record as scanned and leaves it alone', async () => {
      await store.set(sessionKey('hash_garbage'), 'not json');
      await store.set(sessionKey('hash_shapeless'), JSON.stringify({ userId: 'user_s' }));

      const report = await service.reconcileSessionTtl(NOW);

      expect(report).toEqual({ job: 'sessions.reconcile-ttl', scanned: 2, destroyed: [], failed: 0 });
      expect(await store.get(sessionKey('hash_garbage'))).toBe('not json');
      expect(idp.revokeRefreshToken).not.toHaveBeenCalled();
    });

    it('continues past a record whose destroy throws and counts it as failed', async () => {
      await storeSession('hash_a', 'user_s', '2026-10-23T01:00:00.000Z');
      await storeSession('hash_b', 'user_t', '2026-10-23T01:30:00.000Z');
      const destroy = vi
        .spyOn(SessionService.prototype, 'destroyOwnedByHash')
        .mockRejectedValueOnce(new Error('Redis connection lost'));
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});

      const report = await service.reconcileSessionTtl(NOW);

      expect(destroy).toHaveBeenCalledTimes(2);
      expect(report.scanned).toBe(2);
      expect(report.failed).toBe(1);
      expect(report.destroyed).toHaveLength(1);
      const [survivor] = report.destroyed;
      expect(await store.get(sessionKey(survivor!))).toBeNull();
      expect(idp.revokeRefreshToken).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]![0]).toMatch(/^session hash_\w+ not reconciled \(Error\)/);
      expect(warn.mock.calls[0]![0]).not.toContain('refresh');
      destroy.mockRestore();
      warn.mockRestore();
    });

    it('reports zero work when no session exists', async () => {
      expect(await service.reconcileSessionTtl(NOW)).toEqual({ job: 'sessions.reconcile-ttl', scanned: 0, destroyed: [], failed: 0 });
    });
  });
});
