import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { Logger } from '@nestjs/common';
import { LoggingMailer } from '../email/logging-mailer.js';
import { MailDeliveryError } from '../email/mailer.js';
import { SAMPLE_SAML_METADATA, SIGNING_CERT_NOT_AFTER } from '../identity/saml-metadata.fixture.js';
import { MemoryKeyValueStore } from '../redis/memory-key-value-store.js';
import {
  INVALIDATE_CHANNEL,
  SSO_CERT_ALERT_TTL,
  mobileFamilyKey,
  revokedFamilyKey,
  sessionKey,
  ssoCertAlertKey,
  userMobileFamiliesKey,
  userSessionsKey,
} from '../redis/redis-keys.js';
import { SessionService } from '../session/session.service.js';
import { FakeMetadataFetcher } from '../sso/metadata-fetcher.js';
import { MAINTENANCE_SCHEDULES } from './job-scheduler.service.js';
import { MAINTENANCE_JOB_NAMES, MaintenanceJobsService } from './maintenance-jobs.service.js';

const NOW = new Date('2026-10-23T02:15:00.000Z');
/** Executor handed out by the mocked `withTransaction`: one transaction per swept row. */
const TX = { kind: 'job-tx' };

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
  let idp: { revokeRefreshToken: ReturnType<typeof vi.fn>; describeProvider: ReturnType<typeof vi.fn> };
  let ssoRepo: { listActiveConnections: ReturnType<typeof vi.fn>; updateConnection: ReturnType<typeof vi.fn> };
  let dbs: { withTransaction: ReturnType<typeof vi.fn> };
  let organizations: { findById: ReturnType<typeof vi.fn> };
  let fetcher: FakeMetadataFetcher;
  let mailer: LoggingMailer;
  /** What the job reads through ConfigService. */
  let env: Record<string, string | undefined>;
  let service: MaintenanceJobsService;

  beforeEach(() => {
    authzRepo = {
      findExpiredUnrevokedGrants: vi.fn().mockResolvedValue([]),
      findOrphanedDelegations: vi.fn().mockResolvedValue([]),
      findGrantsWithoutActiveMembership: vi.fn().mockResolvedValue([]),
      revokeGrants: vi.fn().mockImplementation((ids: string[]) => Promise.resolve(ids)),
      findExpiredApprovedEmergencyAccess: vi.fn().mockResolvedValue([]),
      revokeEmergencyAccess: vi.fn().mockImplementation((id: string) => Promise.resolve({ id })),
    };
    auditRepo = { ensurePartitions: vi.fn().mockResolvedValue(['audit_events_y2026m10', 'audit_events_y2026m11']) };
    audit = { record: vi.fn().mockResolvedValue(undefined) };
    principals = { invalidateUser: vi.fn().mockResolvedValue(undefined), invalidateDelegatees: vi.fn().mockResolvedValue([]) };
    store = new MemoryKeyValueStore();
    idp = { revokeRefreshToken: vi.fn().mockResolvedValue(undefined), describeProvider: vi.fn().mockResolvedValue(null) };
    ssoRepo = {
      listActiveConnections: vi.fn().mockResolvedValue([]),
      updateConnection: vi.fn().mockImplementation((id: string) => Promise.resolve({ id })),
    };
    dbs = { withTransaction: vi.fn((fn: (tx: unknown) => Promise<unknown>) => fn(TX)) };
    organizations = { findById: vi.fn(async (id: string) => ({ id, name: 'Acme d.o.o.' })) };
    fetcher = new FakeMetadataFetcher(new Map());
    mailer = new LoggingMailer({ keepSent: true });
    env = { OPS_ALERT_EMAIL: 'ops@nestself.example', ADMIN_URL: 'https://admin.nestself.example' };
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
      ssoRepo as never,
      idp as never,
      dbs as never,
      organizations as never,
      fetcher,
      mailer,
      { get: (key: string) => env[key] } as never,
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
      expect(report).toEqual({ expired: [], orphanedDelegations: [], withoutMembership: [], failed: 0 });
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
      expect(authzRepo.revokeGrants).toHaveBeenCalledWith(['g_exp'], { at: NOW, byUserId: null, reason: 'expired' }, TX);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'grant.expired',
          actorKind: 'JOB',
          actorUserId: null,
          orgId: 'org_1',
          recordId: 'g_exp',
          details: expect.objectContaining({ reason: 'expired', subjectUserId: 'user_a' }),
        }),
        { tx: TX },
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
      expect(authzRepo.revokeGrants).toHaveBeenCalledWith(['g_child'], { at: NOW, byUserId: null, reason: 'parent_revoked' }, TX);
      expect(authzRepo.revokeGrants).toHaveBeenCalledWith(['g_left'], { at: NOW, byUserId: null, reason: 'membership_ended' }, TX);
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

    it('closes each grant in its own transaction, with its audit row inside it', async () => {
      authzRepo.findExpiredUnrevokedGrants.mockResolvedValue([grant({ id: 'g1' }), grant({ id: 'g2' })]);
      const order: string[] = [];
      dbs.withTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        order.push('begin');
        const result = await fn(TX);
        order.push('commit');
        return result;
      });
      authzRepo.revokeGrants.mockImplementation((ids: string[]) => {
        order.push(`revoke ${ids.join()}`);
        return Promise.resolve(ids);
      });
      audit.record.mockImplementation((event: { recordId: string }) => {
        order.push(`audit ${event.recordId}`);
        return Promise.resolve();
      });

      await service.reconcileGrants(NOW);

      expect(order).toEqual(['begin', 'revoke g1', 'audit g1', 'commit', 'begin', 'revoke g2', 'audit g2', 'commit']);
    });

    it('continues after one grant fails, counts it as failed and leaves it out of the lists', async () => {
      authzRepo.findExpiredUnrevokedGrants.mockResolvedValue([
        grant({ id: 'g1', subjectUserId: 'user_a' }),
        grant({ id: 'g2', subjectUserId: 'user_b' }),
        grant({ id: 'g3', subjectUserId: 'user_c' }),
      ]);
      authzRepo.revokeGrants.mockImplementation((ids: string[]) =>
        ids.includes('g2') ? Promise.reject(new Error('deadlock detected')) : Promise.resolve(ids),
      );
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});

      const report = await service.reconcileGrants(NOW);

      expect(report).toEqual({ expired: ['g1', 'g3'], orphanedDelegations: [], withoutMembership: [], failed: 1 });
      expect(audit.record.mock.calls.map((c) => (c[0] as { recordId: string }).recordId)).toEqual(['g1', 'g3']);
      expect(principals.invalidateUser).not.toHaveBeenCalledWith('user_b', expect.anything());
      expect(principals.invalidateDelegatees).toHaveBeenCalledWith(['g1', 'g3']);
      // Logged by id only: no subject, template or error message.
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]![0]).toBe('grant g2 not closed (Error); retried on the next run');
      warn.mockRestore();
    });

    it('counts a grant whose audit insert fails as failed: its close rolls back with it', async () => {
      authzRepo.findOrphanedDelegations.mockResolvedValue([
        grant({ id: 'g_child_1', parentGrantId: 'g_parent' }),
        grant({ id: 'g_child_2', parentGrantId: 'g_parent', subjectUserId: 'user_b' }),
      ]);
      audit.record.mockRejectedValueOnce(new Error('permission denied for table audit_events'));
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});

      const report = await service.reconcileGrants(NOW);

      expect(report.orphanedDelegations).toEqual(['g_child_2']);
      expect(report.failed).toBe(1);
      expect(principals.invalidateUser).toHaveBeenCalledTimes(1);
      expect(principals.invalidateUser).toHaveBeenCalledWith('user_b', ['org_1']);
      expect(warn.mock.calls[0]![0]).toBe('grant g_child_1 not closed (Error); retried on the next run');
      warn.mockRestore();
    });

    it('neither audits nor reports a grant that another path revoked in the meantime', async () => {
      authzRepo.findExpiredUnrevokedGrants.mockResolvedValue([grant({ id: 'g_raced' })]);
      authzRepo.revokeGrants.mockResolvedValue([]);

      const report = await service.reconcileGrants(NOW);

      expect(report).toEqual({ expired: [], orphanedDelegations: [], withoutMembership: [], failed: 0 });
      expect(audit.record).not.toHaveBeenCalled();
      expect(principals.invalidateUser).not.toHaveBeenCalled();
      expect(principals.invalidateDelegatees).not.toHaveBeenCalled();
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

      expect(report).toEqual({ job: 'emergency.sweep-expired', expired: ['ema_1', 'ema_2'], failed: 0 });
      expect(authzRepo.findExpiredApprovedEmergencyAccess).toHaveBeenCalledWith(NOW);
      expect(dbs.withTransaction).toHaveBeenCalledTimes(2);
      expect(authzRepo.revokeEmergencyAccess).toHaveBeenCalledWith('ema_1', null, NOW, TX);
      expect(authzRepo.revokeEmergencyAccess).toHaveBeenCalledWith('ema_2', null, NOW, TX);
      expect(audit.record).toHaveBeenCalledTimes(2);
      expect(audit.record).toHaveBeenCalledWith(
        {
          action: 'emergency_access.expired',
          actorUserId: null,
          actorKind: 'JOB',
          recordType: 'emergency_access',
          recordId: 'ema_1',
          result: 'ALLOWED',
          details: { userId: 'user_a', scopeKind: 'CASE', scopeId: 'case_1', job: 'emergency.sweep-expired' },
          occurredAt: NOW,
        },
        { tx: TX },
      );
      expect(principals.invalidateUser).toHaveBeenCalledWith('user_a');
      expect(principals.invalidateUser).toHaveBeenCalledWith('user_b');
    });

    it('skips a record revoked in the meantime without auditing it', async () => {
      authzRepo.findExpiredApprovedEmergencyAccess.mockResolvedValue([emergency('ema_1', 'user_a')]);
      authzRepo.revokeEmergencyAccess.mockResolvedValue(null);

      const report = await service.sweepExpiredEmergencyAccess(NOW);

      expect(report).toEqual({ expired: [], failed: 0 });
      expect(audit.record).not.toHaveBeenCalled();
      expect(principals.invalidateUser).not.toHaveBeenCalled();
    });

    it('emergency sweep continues after one row fails and reports it', async () => {
      authzRepo.findExpiredApprovedEmergencyAccess.mockResolvedValue([
        emergency('ema_1', 'user_a'),
        emergency('ema_2', 'user_b'),
        emergency('ema_3', 'user_c'),
      ]);
      authzRepo.revokeEmergencyAccess.mockImplementation((id: string) =>
        id === 'ema_2' ? Promise.reject(new Error('connection terminated')) : Promise.resolve({ id }),
      );
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});

      const report = await service.sweepExpiredEmergencyAccess(NOW);

      expect(report).toEqual({ expired: ['ema_1', 'ema_3'], failed: 1 });
      expect(dbs.withTransaction).toHaveBeenCalledTimes(3);
      expect(audit.record.mock.calls.map((c) => (c[0] as { recordId: string }).recordId)).toEqual(['ema_1', 'ema_3']);
      expect(principals.invalidateUser).toHaveBeenCalledWith('user_a');
      expect(principals.invalidateUser).toHaveBeenCalledWith('user_c');
      expect(principals.invalidateUser).not.toHaveBeenCalledWith('user_b');
      // Logged by id only: no user, scope or error message.
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]![0]).toBe('emergency access ema_2 not swept (Error); retried on the next run');
      warn.mockRestore();
    });

    it('counts a row whose audit insert fails as failed and leaves its user cached', async () => {
      authzRepo.findExpiredApprovedEmergencyAccess.mockResolvedValue([
        emergency('ema_1', 'user_a'),
        emergency('ema_2', 'user_b'),
      ]);
      audit.record.mockRejectedValueOnce(new Error('permission denied for table audit_events'));
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});

      const report = await service.sweepExpiredEmergencyAccess(NOW);

      expect(report).toEqual({ expired: ['ema_2'], failed: 1 });
      expect(principals.invalidateUser).toHaveBeenCalledTimes(1);
      expect(principals.invalidateUser).toHaveBeenCalledWith('user_b');
      expect(warn.mock.calls[0]![0]).toBe('emergency access ema_1 not swept (Error); retried on the next run');
      warn.mockRestore();
    });

    it('reports zero work when nothing has expired', async () => {
      expect(await service.sweepExpiredEmergencyAccess(NOW)).toEqual({ expired: [], failed: 0 });
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

  describe('sso.certificate-expiry', () => {
    const DAY = 24 * 60 * 60 * 1000;
    const METADATA_URL = 'https://idp.acme.example/metadata';
    /** 12 days and 4 hours before the fixture's signing certificate expires. */
    const LATE = new Date(SIGNING_CERT_NOT_AFTER.getTime() - 12 * DAY - 4 * 3_600_000);
    let warn: MockInstance;

    beforeEach(() => {
      warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
      // The run summary, and the logging mailer's line for every mail.
      vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
      vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => {});
    });
    afterEach(() => {
      vi.restoreAllMocks();
      vi.useRealTimers();
    });

    const warnings = () => warn.mock.calls.map((call) => String(call[0]));

    /** An ACTIVE SAML connection registered from metadata XML, unless overridden. */
    function connection(overrides: Partial<Record<string, unknown>>) {
      return {
        id: 'sso_1',
        orgId: 'org_1',
        protocol: 'SAML',
        cognitoProviderName: 'org-acme-saml',
        status: 'ACTIVE',
        metadataUrl: null,
        metadataXml: '<EntityDescriptor>secret-free but never logged</EntityDescriptor>',
        certificateExpiresAt: null,
        ...overrides,
      } as never;
    }

    /** An ACTIVE SAML connection registered from a metadata URL. */
    function urlConnection(overrides: Partial<Record<string, unknown>> = {}) {
      return connection({ metadataUrl: METADATA_URL, metadataXml: null, ...overrides });
    }

    it('is a maintenance job scheduled nightly at 03:00', () => {
      expect(MAINTENANCE_JOB_NAMES).toContain('sso.certificate-expiry');
      expect(MAINTENANCE_SCHEDULES['sso.certificate-expiry']).toBe('0 3 * * *');
    });

    it('audits and warns about a certificate that expires within 30 days, as a job', async () => {
      const expiresAt = new Date(NOW.getTime() + 12 * DAY + 3_600_000);
      ssoRepo.listActiveConnections.mockResolvedValue([connection({ certificateExpiresAt: expiresAt })]);

      const report = await service.run('sso.certificate-expiry', NOW);

      expect(report).toEqual({ job: 'sso.certificate-expiry', scanned: 1, refreshed: 0, expiring: 1, alerted: 1, failed: 0 });
      expect(audit.record).toHaveBeenCalledTimes(1);
      expect(audit.record).toHaveBeenCalledWith({
        action: 'sso_connection.changed',
        actorUserId: null,
        actorKind: 'JOB',
        orgId: 'org_1',
        recordType: 'sso_connection',
        recordId: 'sso_1',
        result: 'ALLOWED',
        details: {
          reason: 'certificate_expiring',
          expiresAt: expiresAt.toISOString(),
          connectionId: 'sso_1',
          daysLeft: 12,
          job: 'sso.certificate-expiry',
        },
        occurredAt: NOW,
      });
      expect(idp.describeProvider).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]![0]).toContain('org-acme-saml');
      expect(warn.mock.calls[0]![0]).not.toContain('EntityDescriptor');
    });

    it('treats an already expired certificate as expiring with negative days left', async () => {
      const expiresAt = new Date(NOW.getTime() - 2 * DAY);
      ssoRepo.listActiveConnections.mockResolvedValue([connection({ certificateExpiresAt: expiresAt })]);
      const report = await service.checkSsoCertificates(NOW);
      expect(report).toMatchObject({ expiring: 1, alerted: 1 });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ details: expect.objectContaining({ daysLeft: -2 }) }),
      );
      expect(mailer.sent[0]?.params).toMatchObject({ daysLeft: '-2', expiresAt: expiresAt.toISOString() });
    });

    it('does not audit a certificate that expires in more than 30 days', async () => {
      ssoRepo.listActiveConnections.mockResolvedValue([
        connection({ certificateExpiresAt: new Date(NOW.getTime() + 31 * DAY) }),
        connection({ id: 'sso_2', certificateExpiresAt: new Date(NOW.getTime() + 365 * DAY) }),
      ]);
      const report = await service.checkSsoCertificates(NOW);
      expect(report).toEqual({ job: 'sso.certificate-expiry', scanned: 2, refreshed: 0, expiring: 0, alerted: 0, failed: 0 });
      expect(audit.record).not.toHaveBeenCalled();
      expect(mailer.sent).toEqual([]);
    });

    it('refreshes a missing expiry of a metadata-XML connection from the identity provider, then checks it', async () => {
      const expiresAt = new Date(NOW.getTime() + 5 * DAY);
      ssoRepo.listActiveConnections.mockResolvedValue([connection({})]);
      idp.describeProvider.mockResolvedValue({ name: 'org-acme-saml', protocol: 'SAML', certificateExpiresAt: expiresAt });

      const report = await service.checkSsoCertificates(NOW);

      expect(idp.describeProvider).toHaveBeenCalledWith('org-acme-saml');
      expect(ssoRepo.updateConnection).toHaveBeenCalledWith('sso_1', { certificateExpiresAt: expiresAt });
      expect(report).toEqual({ job: 'sso.certificate-expiry', scanned: 1, refreshed: 1, expiring: 1, alerted: 1, failed: 0 });
      expect(fetcher.fetched).toEqual([]);
    });

    it('leaves the expiry unset when the provider reports none, and never asks or fetches for OIDC connections', async () => {
      ssoRepo.listActiveConnections.mockResolvedValue([
        connection({}),
        connection({ id: 'sso_oidc', protocol: 'OIDC', cognitoProviderName: 'org-acme-oidc', metadataUrl: METADATA_URL }),
      ]);
      idp.describeProvider.mockResolvedValue({ name: 'org-acme-saml', protocol: 'SAML', certificateExpiresAt: null });

      const report = await service.checkSsoCertificates(NOW);

      expect(idp.describeProvider).toHaveBeenCalledTimes(1);
      expect(idp.describeProvider).toHaveBeenCalledWith('org-acme-saml');
      expect(fetcher.fetched).toEqual([]);
      expect(ssoRepo.updateConnection).not.toHaveBeenCalled();
      expect(report).toEqual({ job: 'sso.certificate-expiry', scanned: 2, refreshed: 0, expiring: 0, alerted: 0, failed: 0 });
    });

    it('counts a provider failure, warns, and continues with the next connection', async () => {
      const expiresAt = new Date(NOW.getTime() + 3 * DAY);
      ssoRepo.listActiveConnections.mockResolvedValue([
        connection({}),
        connection({ id: 'sso_2', cognitoProviderName: 'org-beta-saml', certificateExpiresAt: expiresAt }),
      ]);
      idp.describeProvider.mockRejectedValue(new Error('Cognito unavailable'));

      const report = await service.checkSsoCertificates(NOW);

      expect(report).toEqual({ job: 'sso.certificate-expiry', scanned: 2, refreshed: 0, expiring: 1, alerted: 1, failed: 1 });
      expect(ssoRepo.updateConnection).not.toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledTimes(1);
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ recordId: 'sso_2' }));
      expect(warnings().some((m) => m.includes('org-acme-saml'))).toBe(true);
    });

    it('reports zero work when no connection is active', async () => {
      expect(await service.checkSsoCertificates(NOW)).toEqual({
        job: 'sso.certificate-expiry',
        scanned: 0,
        refreshed: 0,
        expiring: 0,
        alerted: 0,
        failed: 0,
      });
    });

    describe('metadata-URL connections', () => {
      it('fetches the metadata every run and stores the expiry it carries, never asking the identity provider', async () => {
        fetcher.setResponse(METADATA_URL, SAMPLE_SAML_METADATA);
        ssoRepo.listActiveConnections.mockResolvedValue([urlConnection()]);

        const report = await service.checkSsoCertificates(NOW);

        expect(fetcher.fetched).toEqual([METADATA_URL]);
        expect(ssoRepo.updateConnection).toHaveBeenCalledWith('sso_1', { certificateExpiresAt: SIGNING_CERT_NOT_AFTER });
        expect(idp.describeProvider).not.toHaveBeenCalled();
        expect(report).toEqual({ job: 'sso.certificate-expiry', scanned: 1, refreshed: 1, expiring: 0, alerted: 0, failed: 0 });
      });

      it('replaces a stored expiry with the fetched one (certificates rotate) and rewrites nothing unchanged', async () => {
        fetcher.setResponse(METADATA_URL, SAMPLE_SAML_METADATA);
        ssoRepo.listActiveConnections.mockResolvedValue([
          // The certificate it was registered with expired; the IdP has rotated to the fixture's.
          urlConnection({ certificateExpiresAt: new Date(NOW.getTime() + 3 * DAY) }),
          urlConnection({ id: 'sso_2', cognitoProviderName: 'org-beta-saml', certificateExpiresAt: SIGNING_CERT_NOT_AFTER }),
        ]);

        const report = await service.checkSsoCertificates(NOW);

        expect(fetcher.fetched).toEqual([METADATA_URL, METADATA_URL]);
        expect(ssoRepo.updateConnection).toHaveBeenCalledTimes(1);
        expect(ssoRepo.updateConnection).toHaveBeenCalledWith('sso_1', { certificateExpiresAt: SIGNING_CERT_NOT_AFTER });
        expect(report).toMatchObject({ scanned: 2, refreshed: 1, expiring: 0, alerted: 0, failed: 0 });
        expect(audit.record).not.toHaveBeenCalled();
      });

      it('a fetch that throws counts in failed, warns with the error name only and is not retried in the run', async () => {
        const withQuery = `${METADATA_URL}?tenant=t-123`;
        const fetchXml = vi
          .spyOn(fetcher, 'fetchXml')
          .mockRejectedValue(new TypeError(`fetch failed for ${withQuery}: <md:EntityDescriptor>`));
        ssoRepo.listActiveConnections.mockResolvedValue([
          urlConnection({ metadataUrl: withQuery, certificateExpiresAt: new Date(NOW.getTime() + 40 * DAY) }),
          connection({ id: 'sso_2', cognitoProviderName: 'org-beta-saml', certificateExpiresAt: new Date(NOW.getTime() + 5 * DAY) }),
        ]);

        const report = await service.checkSsoCertificates(NOW);

        expect(fetchXml).toHaveBeenCalledTimes(1);
        expect(fetchXml).toHaveBeenCalledWith(withQuery);
        expect(report).toEqual({ job: 'sso.certificate-expiry', scanned: 2, refreshed: 0, expiring: 1, alerted: 1, failed: 1 });
        expect(ssoRepo.updateConnection).not.toHaveBeenCalled();
        expect(audit.record).toHaveBeenCalledTimes(1);
        expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ recordId: 'sso_2' }));
        const failure = warnings().find((m) => m.includes('org-acme-saml'))!;
        expect(failure).toContain('(TypeError)');
        expect(failure).not.toMatch(/tenant|idp\.acme\.example|https:|EntityDescriptor/);
      });

      it('a host that resolves to a public and a private address is counted in failed and nothing is fetched (Review Focus 4)', async () => {
        const mixed = 'https://idp.mixed.example/metadata';
        fetcher.setAddresses('idp.mixed.example', ['203.0.113.10', '10.0.0.1']);
        fetcher.setResponse(mixed, SAMPLE_SAML_METADATA);
        ssoRepo.listActiveConnections.mockResolvedValue([urlConnection({ metadataUrl: mixed })]);

        const report = await service.checkSsoCertificates(LATE);

        expect(report).toEqual({ job: 'sso.certificate-expiry', scanned: 1, refreshed: 0, expiring: 0, alerted: 0, failed: 1 });
        expect(fetcher.fetched).toEqual([]);
        expect(ssoRepo.updateConnection).not.toHaveBeenCalled();
        expect(mailer.sent).toEqual([]);
        expect(warnings()).toEqual([expect.stringContaining('(MetadataUrlError: private_address)')]);
      });
    });

    describe('ops alert email', () => {
      it('mails one ops_certificate_alert to OPS_ALERT_EMAIL once the audit row is written, for a certificate inside 30 days', async () => {
        fetcher.setResponse(METADATA_URL, SAMPLE_SAML_METADATA);
        ssoRepo.listActiveConnections.mockResolvedValue([urlConnection()]);
        const send = vi.spyOn(mailer, 'send');

        const report = await service.checkSsoCertificates(LATE);

        expect(report).toEqual({ job: 'sso.certificate-expiry', scanned: 1, refreshed: 1, expiring: 1, alerted: 1, failed: 0 });
        expect(mailer.sent).toEqual([
          {
            to: 'ops@nestself.example',
            locale: 'en',
            template: 'ops_certificate_alert',
            params: {
              organizationName: 'Acme d.o.o.',
              providerName: 'org-acme-saml',
              expiresAt: SIGNING_CERT_NOT_AFTER.toISOString(),
              daysLeft: '12',
              adminUrl: 'https://admin.nestself.example/sso',
            },
          },
        ]);
        expect(organizations.findById).toHaveBeenCalledWith('org_1');
        expect(audit.record.mock.invocationCallOrder[0]!).toBeLessThan(send.mock.invocationCallOrder[0]!);
        expect(SSO_CERT_ALERT_TTL).toBe(7 * 24 * 3600);
        expect(await store.ttl(ssoCertAlertKey('sso_1'))).toBeGreaterThan(SSO_CERT_ALERT_TTL - 5);
      });

      it('a second run on the same day audits and warns again but mails nothing', async () => {
        fetcher.setResponse(METADATA_URL, SAMPLE_SAML_METADATA);
        ssoRepo.listActiveConnections.mockResolvedValue([urlConnection()]);

        await service.checkSsoCertificates(LATE);
        const second = await service.checkSsoCertificates(LATE);

        expect(second).toMatchObject({ expiring: 1, alerted: 0, failed: 0 });
        expect(mailer.sent).toHaveLength(1);
        expect(audit.record).toHaveBeenCalledTimes(2);
        expect(warnings().filter((m) => m.includes('signing certificate expires on'))).toHaveLength(2);
      });

      it('mails again once the seven days are over', async () => {
        // The in-memory store expires keys by the clock.
        vi.useFakeTimers({ toFake: ['Date'] });
        ssoRepo.listActiveConnections.mockResolvedValue([connection({ certificateExpiresAt: new Date(NOW.getTime() + 3 * DAY) })]);

        await service.checkSsoCertificates(NOW);
        vi.setSystemTime(Date.now() + SSO_CERT_ALERT_TTL * 1000 - 60_000);
        expect(await service.checkSsoCertificates(NOW)).toMatchObject({ alerted: 0 });
        vi.setSystemTime(Date.now() + 61_000);
        expect(await service.checkSsoCertificates(NOW)).toMatchObject({ alerted: 1 });

        expect(mailer.sent).toHaveLength(2);
      });

      it('a send that fails releases the key, counts the connection in failed, and the next run mails', async () => {
        ssoRepo.listActiveConnections.mockResolvedValue([connection({ certificateExpiresAt: new Date(NOW.getTime() + 3 * DAY) })]);
        vi.spyOn(mailer, 'send').mockRejectedValueOnce(new MailDeliveryError({ name: 'Throttling', httpStatus: 400 }));

        const first = await service.checkSsoCertificates(NOW);

        expect(first).toMatchObject({ expiring: 1, alerted: 0, failed: 1 });
        expect(await store.get(ssoCertAlertKey('sso_1'))).toBeNull();
        expect(warnings()).toContainEqual(expect.stringMatching(/org-acme-saml: expiry alert not sent \(Throttling\)/));

        const second = await service.checkSsoCertificates(NOW);
        expect(second).toMatchObject({ alerted: 1, failed: 0 });
        expect(mailer.sent).toHaveLength(1);
      });

      it('an audit row that is not written sends no mail', async () => {
        ssoRepo.listActiveConnections.mockResolvedValue([connection({ certificateExpiresAt: new Date(NOW.getTime() + 3 * DAY) })]);
        audit.record.mockRejectedValueOnce(new Error('insert failed'));

        const report = await service.checkSsoCertificates(NOW);

        expect(report).toMatchObject({ expiring: 0, alerted: 0, failed: 1 });
        expect(mailer.sent).toEqual([]);
        expect(await store.get(ssoCertAlertKey('sso_1'))).toBeNull();
      });

      it('without OPS_ALERT_EMAIL: audits as before, says once per run that alerts are off, and sets no key', async () => {
        delete env['OPS_ALERT_EMAIL'];
        ssoRepo.listActiveConnections.mockResolvedValue([
          connection({ certificateExpiresAt: new Date(NOW.getTime() + 3 * DAY) }),
          connection({ id: 'sso_2', cognitoProviderName: 'org-beta-saml', certificateExpiresAt: new Date(NOW.getTime() + 5 * DAY) }),
        ]);

        const report = await service.checkSsoCertificates(NOW);

        expect(report).toEqual({ job: 'sso.certificate-expiry', scanned: 2, refreshed: 0, expiring: 2, alerted: 0, failed: 0 });
        expect(audit.record).toHaveBeenCalledTimes(2);
        expect(mailer.sent).toEqual([]);
        expect(warnings().filter((m) => m.includes('OPS_ALERT_EMAIL'))).toEqual([
          'SSO certificate alert mail is off (OPS_ALERT_EMAIL is not set): 2 expiring connection(s) audited and logged only',
        ]);
        expect(await store.get(ssoCertAlertKey('sso_1'))).toBeNull();
        expect(await store.get(ssoCertAlertKey('sso_2'))).toBeNull();
      });

      it('without OPS_ALERT_EMAIL and nothing expiring, says nothing about alerts', async () => {
        delete env['OPS_ALERT_EMAIL'];
        ssoRepo.listActiveConnections.mockResolvedValue([connection({ certificateExpiresAt: new Date(NOW.getTime() + 90 * DAY) })]);
        await service.checkSsoCertificates(NOW);
        expect(warn).not.toHaveBeenCalled();
      });
    });
  });
});
