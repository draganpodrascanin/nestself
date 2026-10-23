/**
 * Maintenance jobs against the real database: partitions, grant
 * reconciliation and the audit trail they leave (T-2.10, D-17, D-21).
 *
 * Requires TEST_DATABASE_URL (PostgreSQL). Skipped otherwise.
 */
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import { seed } from '../src/db/seed/seed-lib.js';
import { auditEvents, grants, memberships } from '../src/db/schema/index.js';
import { MaintenanceJobsService } from '../src/jobs/maintenance-jobs.service.js';
import { connectAsAppRole, resetTestDatabase, type TestDatabase } from './db/test-database.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const shouldRun = !!TEST_DB_URL;

describe.skipIf(!shouldRun)('Maintenance jobs (e2e)', () => {
  let app: INestApplication;
  let testDb: TestDatabase;
  let jobs: MaintenanceJobsService;
  const now = new Date('2026-10-23T02:15:00.000Z');

  beforeAll(async () => {
    testDb = await resetTestDatabase(TEST_DB_URL!, 'jobs');
    await seed(testDb.db);

    // Fixtures: an expired grant, a delegation whose parent is revoked and a
    // grant whose membership has ended without the cascade.
    await testDb.db.insert(grants).values([
      {
        id: 'job_grant_expired',
        subjectUserId: 'user_ana',
        actions: ['budget.read'],
        scopeType: 'organization',
        scopeOrgId: 'org_sample',
        grantedByUserId: 'user_ivana',
        validFrom: new Date('2026-01-01'),
        validUntil: new Date('2026-06-30'),
      },
      {
        id: 'job_grant_parent',
        subjectUserId: 'user_ivana',
        actions: ['budget.read'],
        scopeType: 'organization',
        scopeOrgId: 'org_sample',
        grantedByUserId: 'user_ivana',
        validFrom: new Date('2026-01-01'),
        revokedAt: new Date('2026-09-01'),
        revokedReason: 'manual',
      },
      {
        id: 'job_grant_child',
        subjectUserId: 'user_ana',
        actions: ['budget.read'],
        scopeType: 'organization',
        scopeOrgId: 'org_sample',
        parentGrantId: 'job_grant_parent',
        grantedByUserId: 'user_ivana',
        validFrom: new Date('2026-01-01'),
      },
    ]);
    // user_stefan's membership ends without revoking his seeded grants.
    await testDb.db
      .update(memberships)
      .set({ status: 'ENDED', endDate: new Date('2026-09-30'), endedReason: 'RESIGNED' })
      .where(eq(memberships.userId, 'user_stefan'));

    process.env.DATABASE_URL = testDb.url;
    process.env.AUTH_MODE = 'stub';
    process.env.JWT_SECRET = randomBytes(32).toString('hex');
    process.env.NODE_ENV = 'test';
    delete process.env.REDIS_URL;

    const { AppModule } = await import('../src/app.module.js');
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    jobs = app.get(MaintenanceJobsService);
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await testDb?.close();
  });

  it('grants.reconcile closes expired, orphaned and membership-less grants and audits each', async () => {
    const report = await jobs.run('grants.reconcile', now);
    expect(report).toMatchObject({ job: 'grants.reconcile' });
    if (report.job !== 'grants.reconcile') throw new Error('unreachable');

    expect(report.expired).toEqual(['job_grant_expired']);
    expect(report.orphanedDelegations).toEqual(['job_grant_child']);
    expect(report.withoutMembership.length).toBeGreaterThan(0);

    const closed = await testDb.db
      .select({ id: grants.id, revokedAt: grants.revokedAt, reason: grants.revokedReason })
      .from(grants)
      .where(inArray(grants.id, ['job_grant_expired', 'job_grant_child']));
    expect(closed.find((g) => g.id === 'job_grant_expired')?.reason).toBe('expired');
    expect(closed.find((g) => g.id === 'job_grant_child')?.reason).toBe('parent_revoked');

    const stefanOpen = await testDb.db
      .select({ id: grants.id })
      .from(grants)
      .where(eq(grants.subjectUserId, 'user_stefan'));
    const stillOpen = await testDb.db
      .select({ id: grants.id, revokedAt: grants.revokedAt })
      .from(grants)
      .where(inArray(grants.id, stefanOpen.map((g) => g.id)));
    expect(stillOpen.every((g) => g.revokedAt !== null)).toBe(true);

    const events = await testDb.db
      .select({ action: auditEvents.action, actorKind: auditEvents.actorKind, recordId: auditEvents.recordId })
      .from(auditEvents)
      .where(inArray(auditEvents.recordId, ['job_grant_expired', 'job_grant_child']));
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'grant.expired', actorKind: 'JOB', recordId: 'job_grant_expired' }),
        expect.objectContaining({ action: 'grant.delegation_revoked', actorKind: 'JOB', recordId: 'job_grant_child' }),
      ]),
    );
  });

  it('grants.reconcile is idempotent', async () => {
    const report = await jobs.run('grants.reconcile', now);
    expect(report).toEqual({ job: 'grants.reconcile', expired: [], orphanedDelegations: [], withoutMembership: [] });
  });

  it('audit.ensure-partitions creates the coming months as the application role', async () => {
    const appRole = await connectAsAppRole(testDb);
    try {
      const { rows: before } = await appRole.pool.query<{ count: string }>(
        `select count(*)::text as count from pg_inherits join pg_class p on p.oid = inhparent where p.relname = 'audit_events'`,
      );
      const report = await jobs.run('audit.ensure-partitions');
      if (report.job !== 'audit.ensure-partitions') throw new Error('unreachable');
      expect(report.partitions.length).toBeGreaterThanOrEqual(Number(before[0]!.count));
      // Callable by nestself_app (SECURITY DEFINER, migration 0002).
      await expect(appRole.pool.query('select audit_events_ensure_partitions(1)')).resolves.toBeDefined();
    } finally {
      await appRole.close();
    }
  });
});
