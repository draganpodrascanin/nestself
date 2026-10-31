/**
 * Maintenance jobs against the real database: partitions, grant
 * reconciliation, the SSO certificate check with its ops alert mail, and
 * the audit trail they leave (T-2.10, D-17, D-21, spec 5.8).
 *
 * Requires TEST_DATABASE_URL (PostgreSQL). Skipped otherwise.
 */
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { seed } from '../src/db/seed/seed-lib.js';
import { auditEvents, grants, memberships, organizations, ssoConnections } from '../src/db/schema/index.js';
import type { LoggingMailer } from '../src/email/logging-mailer.js';
import { Mailer } from '../src/email/mailer.js';
import { SAMPLE_SAML_METADATA, SIGNING_CERT_NOT_AFTER } from '../src/identity/saml-metadata.fixture.js';
import { MaintenanceJobsService } from '../src/jobs/maintenance-jobs.service.js';
import { KEY_VALUE_STORE, type KeyValueStore } from '../src/redis/key-value-store.js';
import { SSO_CERT_ALERT_TTL, ssoCertAlertKey } from '../src/redis/redis-keys.js';
import { METADATA_FETCHER, type FakeMetadataFetcher } from '../src/sso/metadata-fetcher.js';
import { connectAsAppRole, resetTestDatabase, type TestDatabase } from './db/test-database.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const shouldRun = !!TEST_DB_URL;

const DAY_MS = 24 * 60 * 60 * 1000;
const CERT_CONNECTION_ID = 'job_sso_metadata_url';
const CERT_METADATA_URL = 'https://idp.jobs.example/saml/metadata';

describe.skipIf(!shouldRun)('Maintenance jobs (e2e)', () => {
  let app: INestApplication;
  let testDb: TestDatabase;
  let jobs: MaintenanceJobsService;
  const now = new Date('2026-10-23T02:15:00.000Z');
  /** 12 days and 4 hours before the metadata fixture's signing certificate expires. */
  const certNow = new Date(SIGNING_CERT_NOT_AFTER.getTime() - 12 * DAY_MS - 4 * 3_600_000);

  beforeAll(async () => {
    testDb = await resetTestDatabase(TEST_DB_URL!, 'jobs');
    await seed(testDb.db);

    // An ACTIVE SAML connection registered from a metadata URL: Cognito reports
    // no certificate for it, so the job reads the metadata itself.
    await testDb.db.insert(ssoConnections).values({
      id: CERT_CONNECTION_ID,
      orgId: 'org_sample',
      protocol: 'SAML',
      cognitoProviderName: 'org-jobs-saml',
      status: 'ACTIVE',
      metadataUrl: CERT_METADATA_URL,
      lastTestedAt: new Date('2026-10-01T00:00:00Z'),
    });

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
    process.env.OPS_ALERT_EMAIL = 'ops@nestself.example';
    // Explicit, so apps/api/.env (dotenv) cannot decide the link in the alert.
    process.env.ADMIN_URL = 'http://admin.jobs.test';
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
    for (const k of ['OPS_ALERT_EMAIL', 'ADMIN_URL']) delete process.env[k];
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
    expect(report).toEqual({ job: 'grants.reconcile', expired: [], orphanedDelegations: [], withoutMembership: [], failed: 0 });
  });

  it('sso.certificate-expiry reads a metadata-URL connection from its metadata and mails the ops alert once in seven days', async () => {
    const fetcher = app.get<FakeMetadataFetcher>(METADATA_FETCHER);
    fetcher.setResponse(CERT_METADATA_URL, SAMPLE_SAML_METADATA);
    const mailer = app.get(Mailer) as LoggingMailer;
    const store = app.get<KeyValueStore>(KEY_VALUE_STORE);
    const alerts = () => mailer.sent.filter((m) => m.template === 'ops_certificate_alert');
    const expiryAudits = () =>
      testDb.db
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.recordId, CERT_CONNECTION_ID), eq(auditEvents.action, 'sso_connection.changed')));
    const [org] = await testDb.db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, 'org_sample'));

    const first = await jobs.run('sso.certificate-expiry', certNow);

    expect(first).toEqual({ job: 'sso.certificate-expiry', scanned: 1, refreshed: 1, expiring: 1, alerted: 1, failed: 0 });
    const [row] = await testDb.db
      .select({ certificateExpiresAt: ssoConnections.certificateExpiresAt })
      .from(ssoConnections)
      .where(eq(ssoConnections.id, CERT_CONNECTION_ID));
    expect(row!.certificateExpiresAt).toEqual(SIGNING_CERT_NOT_AFTER);
    expect(fetcher.fetched).toEqual([CERT_METADATA_URL]);
    expect(alerts()).toEqual([
      {
        to: 'ops@nestself.example',
        locale: 'en',
        template: 'ops_certificate_alert',
        params: {
          organizationName: org!.name,
          providerName: 'org-jobs-saml',
          expiresAt: SIGNING_CERT_NOT_AFTER.toISOString(),
          daysLeft: '12',
          adminUrl: 'http://admin.jobs.test/sso',
        },
      },
    ]);
    const audits = await expiryAudits();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorKind: 'JOB',
      orgId: 'org_sample',
      details: { reason: 'certificate_expiring', connectionId: CERT_CONNECTION_ID, daysLeft: 12 },
    });
    expect(JSON.stringify(audits[0]!.details)).not.toContain('idp.jobs.example');
    expect(await store.ttl(ssoCertAlertKey(CERT_CONNECTION_ID))).toBeGreaterThan(SSO_CERT_ALERT_TTL - 60);

    // The same night again (a retried run): audited and logged, not mailed.
    const second = await jobs.run('sso.certificate-expiry', certNow);
    expect(second).toMatchObject({ expiring: 1, alerted: 0, failed: 0 });
    expect(alerts()).toHaveLength(1);
    expect(await expiryAudits()).toHaveLength(2);

    // Seven days on, the alert key has expired and the alert goes out again.
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + SSO_CERT_ALERT_TTL * 1000 + 1_000);
    try {
      const later = await jobs.run('sso.certificate-expiry', new Date(certNow.getTime() + 7 * DAY_MS));
      expect(later).toMatchObject({ expiring: 1, alerted: 1, failed: 0 });
    } finally {
      clock.mockRestore();
    }
    expect(alerts()).toHaveLength(2);
    expect(alerts()[1]!.params['daysLeft']).toBe('5');
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
