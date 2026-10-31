/**
 * Background jobs against the real database.
 *
 * - Maintenance jobs: partitions, grant reconciliation, the SSO certificate
 *   check with its ops alert mail, and the audit trail they leave (T-2.10,
 *   D-17, D-21, auth phase 4 spec 5.8).
 * - Calls jobs and provider events (T-CW-1.2, D-CW-09, D-CW-12, D-CW-26):
 *   the event applier on the fake provider's events of a real join, its
 *   idempotency and out-of-order rules in SQL (CW-R-39, CW-R-83), the
 *   provider's `MeetingEnded`, the relaxed live-session index of migration
 *   0008, `calls.cleanup` and `calls.reconcile`, reminders on creation and
 *   their removal on cancel, and the no-show follow-up.
 *
 * Requires TEST_DATABASE_URL (PostgreSQL). Skipped otherwise. The BullMQ
 * cases also need Redis (`TEST_REDIS_URL`, default `redis://localhost:6379`)
 * and skip themselves without it; their queue uses a run-specific key prefix
 * and is obliterated afterwards, so a shared Redis is safe. The application
 * itself keeps the in-memory key-value store, as the other suites do.
 */
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { and, eq, inArray } from 'drizzle-orm';
import { Redis } from 'ioredis';
import type { Principal } from '@nestself/contracts';
import { seed } from '../src/db/seed/seed-lib.js';
import {
  appointments,
  assignments,
  auditEvents,
  callEvents,
  callOutcomes,
  callParticipants,
  callSessions,
  grants,
  memberships,
  organizations,
  ssoConnections,
  users,
} from '../src/db/schema/index.js';
import type { AppointmentsService } from '../src/appointments/appointments.service.js';
import type { ChimeEventsConsumer } from '../src/calls/chime-event-consumer.js';
import type { CallsRepository } from '../src/calls/calls.repository.js';
import type { CallsService } from '../src/calls/calls.service.js';
import type { CallProviderEvent, EventApplier } from '../src/calls/event-applier.js';
import { SIGNING_CERT_NOT_AFTER } from '../src/identity/saml-metadata.fixture.js';
import { callsJobId, type CallsJobSchedulerService } from '../src/jobs/calls-job-scheduler.service.js';
import type { CallsJobsService } from '../src/jobs/calls-jobs.service.js';
import { MaintenanceJobsService } from '../src/jobs/maintenance-jobs.service.js';
import type { LoggingMailer } from '../src/mailer/logging-mailer.js';
import { Mailer, type MailInput } from '../src/mailer/mailer.js';
import { KEY_VALUE_STORE, type KeyValueStore } from '../src/redis/key-value-store.js';
import { callParticipantCredentialsKey, SSO_CERT_ALERT_TTL, ssoCertAlertKey } from '../src/redis/redis-keys.js';
import type { FakeMetadataFetcher } from '../src/sso/fake-metadata-fetcher.js';
import { METADATA_FETCHER } from '../src/sso/metadata-fetcher.js';
import type { FakeVideoProvider } from '../src/video/fake-video-provider.js';
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
    // Stub mode: the URL serves the fixture metadata (signing certificate until SIGNING_CERT_NOT_AFTER).
    const fetcher = app.get<FakeMetadataFetcher>(METADATA_FETCHER);
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
        data: {
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
    expect(alerts()[1]!.data['daysLeft']).toBe('5');
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

// ── Calls jobs and provider events (T-CW-1.2) ─────────────────────────────────

const MINUTE = 60_000;
const ORG = 'org_sample';
const REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379';

async function redisAnswers(url: string): Promise<boolean> {
  const client = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 0, connectTimeout: 1_000 });
  client.on('error', () => undefined);
  try {
    await client.connect();
    return (await client.ping()) === 'PONG';
  } catch {
    return false;
  } finally {
    client.disconnect();
  }
}

function principal(userId: string): Principal {
  return { userId } as Principal;
}

describe.skipIf(!shouldRun)('Calls jobs and provider events (e2e)', () => {
  let app: INestApplication;
  let testDb: TestDatabase;
  let video: FakeVideoProvider;
  let calls: CallsService;
  let consumer: ChimeEventsConsumer;
  let applier: EventApplier;
  let callJobs: CallsJobsService;
  let repo: CallsRepository;
  let appointmentsService: AppointmentsService;
  let kv: KeyValueStore;
  let emit: ReturnType<typeof vi.spyOn>;
  let mail: MailInput[];
  let redisUp = false;
  const prefix = `nestself-test-cw12-${randomBytes(4).toString('hex')}`;
  let scheduler: CallsJobSchedulerService;

  const now = Date.now();
  /** Joinable: starts in 5 minutes. */
  const APPT_LIVE = 'appt_cw12_live';
  /** Ended 40 minutes ago, its meeting still open: for reconcile. */
  const APPT_OVERDUE = 'appt_cw12_overdue';
  /** Ended 20 minutes ago, its meeting still open: for calls.cleanup through BullMQ. */
  const APPT_CLEANUP = 'appt_cw12_cleanup';
  /** In the past: an expert-ended session that must keep blocking a second one. */
  const APPT_BLOCKED = 'appt_cw12_blocked';

  async function insertAppointment(id: string, startsAt: Date, status: 'CONFIRMED' | 'NO_SHOW' = 'CONFIRMED') {
    await testDb.db.insert(appointments).values({
      id,
      orgId: ORG,
      expertUserId: 'user_milica',
      employeeUserId: 'user_jovan',
      startsAt,
      endsAt: new Date(startsAt.getTime() + 50 * MINUTE),
      status,
      serviceCategory: 'psychological',
      timeZone: 'Europe/Belgrade',
    });
    await testDb.db.insert(assignments).values({
      userId: 'user_milica',
      kind: 'CASE',
      targetId: id,
      assignedByUserId: 'user_nikola',
      startAt: new Date(now - 24 * 60 * MINUTE),
    });
  }

  /** An ACTIVE session with a live fake meeting, as a finished join leaves it. */
  async function activeSession(appointmentId: string): Promise<{ sessionId: string; meetingId: string }> {
    const [appointment] = await testDb.db.select().from(appointments).where(eq(appointments.id, appointmentId));
    const [row] = await testDb.db
      .insert(callSessions)
      .values({
        appointmentId,
        orgId: ORG,
        format: 'CONSULTATION',
        status: 'PENDING',
        startsAt: appointment!.startsAt,
        endsAt: appointment!.endsAt,
      })
      .returning();
    const created = await video.createSession({
      sessionId: row!.id,
      format: 'consultation',
      capacity: 2,
      orgId: ORG,
      webinarId: null,
      participant: { participantId: `p-${row!.id}`, role: 'expert' },
    });
    await testDb.db
      .update(callSessions)
      .set({ status: 'ACTIVE', providerMeetingId: created.providerMeetingId, startedAt: appointment!.startsAt })
      .where(eq(callSessions.id, row!.id));
    return { sessionId: row!.id, meetingId: created.providerMeetingId };
  }

  async function sessionRow(id: string) {
    const [row] = await testDb.db.select().from(callSessions).where(eq(callSessions.id, id));
    return row!;
  }

  function emitted(event: string) {
    return (emit.mock.calls as [string, string, Record<string, unknown>][]).filter((call) => call[1] === event);
  }

  beforeAll(async () => {
    testDb = await resetTestDatabase(TEST_DB_URL!, 'calls_jobs');
    await seed(testDb.db);
    await insertAppointment(APPT_LIVE, new Date(now + 5 * MINUTE));
    await insertAppointment(APPT_OVERDUE, new Date(now - 90 * MINUTE));
    await insertAppointment(APPT_CLEANUP, new Date(now - 70 * MINUTE));
    await insertAppointment(APPT_BLOCKED, new Date(now - 120 * MINUTE));

    process.env.DATABASE_URL = testDb.url;
    process.env.AUTH_MODE = 'stub';
    process.env.VIDEO_PROVIDER = 'none';
    process.env.JWT_SECRET = randomBytes(32).toString('hex');
    process.env.NODE_ENV = 'test';
    process.env.WORKSPACE_URL = 'https://app.nestself.test';
    process.env.ADMIN_URL = 'https://admin.nestself.test';
    delete process.env.REDIS_URL;

    // The maintenance suite above already evaluated AppModule (and with it ConfigModule.forRoot)
    // against its own database: load a fresh module graph, and take every DI token from it.
    vi.resetModules();
    const [
      { AppModule },
      { AppointmentsService },
      { ChimeEventsConsumer },
      { CallsRepository },
      { CallsService },
      { EventApplier },
      { CallsJobSchedulerService },
      { CallsJobsService },
      { Mailer },
      { KEY_VALUE_STORE },
      { VIDEO_PROVIDER },
      { RoomEmitter },
      { DbService },
    ] = await Promise.all([
      import('../src/app.module.js'),
      import('../src/appointments/appointments.service.js'),
      import('../src/calls/chime-event-consumer.js'),
      import('../src/calls/calls.repository.js'),
      import('../src/calls/calls.service.js'),
      import('../src/calls/event-applier.js'),
      import('../src/jobs/calls-job-scheduler.service.js'),
      import('../src/jobs/calls-jobs.service.js'),
      import('../src/mailer/mailer.js'),
      import('../src/redis/key-value-store.js'),
      import('../src/video/video-provider.js'),
      import('../src/ws/room-emitter.js'),
      import('../src/db/db.service.js'),
    ]);

    // The calls queue gets Redis on its own, under a run-specific prefix.
    redisUp = await redisAnswers(REDIS_URL);
    const schedulerConfig = { get: (key: string) => (key === 'REDIS_URL' && redisUp ? REDIS_URL : undefined) };

    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CallsJobSchedulerService)
      .useFactory({
        inject: [DbService],
        factory: (dbs: InstanceType<typeof DbService>) => {
          scheduler = new CallsJobSchedulerService(schedulerConfig as unknown as ConfigService, dbs);
          scheduler.prefix = prefix;
          return scheduler;
        },
      })
      .compile();
    app = moduleFixture.createNestApplication();
    await app.init();

    video = app.get<FakeVideoProvider>(VIDEO_PROVIDER);
    calls = app.get(CallsService);
    consumer = app.get(ChimeEventsConsumer);
    applier = app.get(EventApplier);
    callJobs = app.get(CallsJobsService);
    repo = app.get(CallsRepository);
    appointmentsService = app.get(AppointmentsService);
    kv = app.get<KeyValueStore>(KEY_VALUE_STORE);
    emit = vi.spyOn(app.get(RoomEmitter), 'emit');
    mail = [];
    vi.spyOn(app.get(Mailer), 'send').mockImplementation(async (input: MailInput) => void mail.push(input));
    expect(consumer.start()).toBe('fake');
  }, 180_000);

  afterAll(async () => {
    await consumer?.stop();
    if (redisUp) await scheduler?.getQueue()?.obliterate({ force: true });
    await scheduler?.onModuleDestroy();
    await app?.close();
    await testDb?.close();
  });

  let liveSessionId: string;
  let liveMeetingId: string;
  let employeeParticipantId: string;

  it('applies the fake provider events of a real join: call_events, first_joined_at, cleanup scheduled', async () => {
    const expert = await calls.join(APPT_LIVE, principal('user_milica'), {});
    const employee = await calls.join(APPT_LIVE, principal('user_jovan'), { locationText: 'Novi Sad' });
    liveSessionId = expert.sessionId;
    liveMeetingId = expert.meeting.MeetingId;
    employeeParticipantId = employee.participantId;

    await vi.waitFor(async () => {
      const rows = await testDb.db.select().from(callEvents).where(eq(callEvents.sessionId, liveSessionId));
      expect(rows.map((r) => r.eventType).sort()).toEqual(['AttendeeJoined', 'AttendeeJoined', 'MeetingStarted']);
    });
    const participants = await testDb.db
      .select()
      .from(callParticipants)
      .where(eq(callParticipants.sessionId, liveSessionId));
    expect(participants).toHaveLength(2);
    for (const p of participants) expect(p.firstJoinedAt).not.toBeNull();

    if (redisUp) {
      const job = await scheduler.getQueue()!.getJob(callsJobId('calls.cleanup', liveSessionId));
      expect(job?.name).toBe('calls.cleanup');
      expect(job?.data).toEqual({ sessionId: liveSessionId, appointmentId: APPT_LIVE });
      expect(await job?.getState()).toBe('delayed');
      const closesAt = (await sessionRow(liveSessionId)).endsAt.getTime() + 15 * MINUTE;
      expect(Math.abs(job!.timestamp + job!.delay - closesAt)).toBeLessThan(5_000);
    }
  });

  it('stores a repeated event once and changes nothing the second time (CW-R-83)', async () => {
    const dropped: CallProviderEvent = {
      eventType: 'AttendeeDropped',
      providerMeetingId: liveMeetingId,
      providerAttendeeId: `fake-attendee-${employeeParticipantId}`,
      occurredAt: new Date(now + 6 * MINUTE),
      externalMeetingId: liveSessionId,
      externalUserId: employeeParticipantId,
      source: 'notification',
    };
    expect(await applier.apply(dropped)).toBe('applied');
    expect(await applier.apply({ ...dropped, source: 'eventbridge' })).toBe('duplicate');

    const rows = await testDb.db
      .select()
      .from(callEvents)
      .where(and(eq(callEvents.sessionId, liveSessionId), eq(callEvents.eventType, 'AttendeeDropped')));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload).toEqual({ source: 'notification' });
    expect(emitted('call.participant.left')).toEqual([
      [`call:${liveSessionId}`, 'call.participant.left', { participantId: employeeParticipantId, role: 'employee' }],
    ]);
  });

  it('keeps the earliest join and the latest leave in any arrival order (CW-R-39)', async () => {
    const base = {
      providerMeetingId: liveMeetingId,
      providerAttendeeId: `fake-attendee-${employeeParticipantId}`,
      externalMeetingId: liveSessionId,
      externalUserId: employeeParticipantId,
      source: 'notification' as const,
    };
    const leftLate = new Date(now + 40 * MINUTE);
    const joinedEarly = new Date(now - 2 * MINUTE);
    await applier.apply({ ...base, eventType: 'AttendeeLeft', occurredAt: leftLate });
    await applier.apply({ ...base, eventType: 'AttendeeLeft', occurredAt: new Date(now + 20 * MINUTE) });
    await applier.apply({ ...base, eventType: 'AttendeeJoined', occurredAt: joinedEarly });

    const [employee] = await testDb.db
      .select()
      .from(callParticipants)
      .where(eq(callParticipants.id, employeeParticipantId));
    expect(employee!.firstJoinedAt).toEqual(joinedEarly);
    expect(employee!.lastLeftAt).toEqual(leftLate);
  });

  it("closes the session once on the provider's MeetingEnded and frees the appointment for a new session", async () => {
    expect(await kv.get(callParticipantCredentialsKey(liveSessionId, employeeParticipantId))).not.toBeNull();
    const ended = video.simulateEvent('MeetingEnded', liveMeetingId);

    await vi.waitFor(async () => expect((await sessionRow(liveSessionId)).status).toBe('ENDED'));
    const row = await sessionRow(liveSessionId);
    expect(row).toMatchObject({ endReason: 'PROVIDER', locationText: null, endedAt: ended.occurredAt });
    expect(await kv.get(callParticipantCredentialsKey(liveSessionId, employeeParticipantId))).toBeNull();
    await vi.waitFor(() => expect(emitted('call.session.ended')).toHaveLength(1));
    expect(emitted('call.session.ended')[0]).toEqual([
      `call:${liveSessionId}`,
      'call.session.ended',
      { sessionId: liveSessionId, endedAt: ended.occurredAt.toISOString() },
    ]);
    const [audit] = await testDb.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.action, 'call.ended'), eq(auditEvents.recordId, liveSessionId)));
    expect(audit).toMatchObject({ actorKind: 'SYSTEM', actorUserId: null, details: { sessionId: liveSessionId, endReason: 'provider' } });

    // The second copy is dropped: still one room event, one audit event.
    expect(await applier.apply({
      eventType: 'MeetingEnded',
      providerMeetingId: liveMeetingId,
      providerAttendeeId: null,
      occurredAt: ended.occurredAt,
      externalMeetingId: liveSessionId,
      externalUserId: null,
      source: 'eventbridge',
    })).toBe('duplicate');
    expect(emitted('call.session.ended')).toHaveLength(1);

    // Migration 0009: a provider end no longer blocks a second session, which then is the live one.
    const [next] = await testDb.db
      .insert(callSessions)
      .values({ appointmentId: APPT_LIVE, orgId: ORG, format: 'CONSULTATION', startsAt: row.startsAt, endsAt: row.endsAt })
      .returning();
    expect((await repo.findLiveSessionByAppointment(APPT_LIVE))?.id).toBe(next!.id);
    expect((await repo.findLatestSessionByAppointment(APPT_LIVE))?.id).toBe(next!.id);
    // ... but one live session per appointment still holds.
    await expect(
      testDb.db
        .insert(callSessions)
        .values({ appointmentId: APPT_LIVE, orgId: ORG, format: 'CONSULTATION', startsAt: row.startsAt, endsAt: row.endsAt }),
    ).rejects.toThrow();
  });

  it('keeps an expert, cleanup or reconcile end blocking a second session', async () => {
    const { sessionId } = await activeSession(APPT_BLOCKED);
    expect(await repo.stampEndReason(sessionId, 'expert')).toBe(true);
    expect(await repo.stampEndReason(sessionId, 'cleanup')).toBe(false);
    const closed = await repo.closeSession(sessionId, { endedAt: new Date(), reason: 'provider' });
    expect(closed?.endReason).toBe('expert');
    const row = await sessionRow(sessionId);
    await expect(
      testDb.db
        .insert(callSessions)
        .values({ appointmentId: APPT_BLOCKED, orgId: ORG, format: 'CONSULTATION', startsAt: row.startsAt, endsAt: row.endsAt }),
    ).rejects.toThrow();
  });

  it('calls.reconcile deletes the meeting of an ACTIVE session whose room closed and ends it once (CW-R-38)', async () => {
    const { sessionId, meetingId } = await activeSession(APPT_OVERDUE);

    const report = await callJobs.reconcile();
    expect(report.cleaned).toContain(sessionId);
    expect(report.failed).toEqual([]);
    expect(await video.describeSession({ providerMeetingId: meetingId })).toBeNull();
    await vi.waitFor(async () => expect((await sessionRow(sessionId)).status).toBe('ENDED'));
    expect((await sessionRow(sessionId)).endReason).toBe('RECONCILE');

    const again = await callJobs.reconcile();
    expect(again.cleaned).not.toContain(sessionId);
  });

  it('calls.cleanup runs through the nestself-calls queue and ends the meeting', async (ctx) => {
    if (!redisUp) ctx.skip();
    const { sessionId, meetingId } = await activeSession(APPT_CLEANUP);
    expect(await scheduler.start(callJobs)).toBe(true);

    await scheduler.scheduleCleanup({ id: sessionId, endsAt: (await sessionRow(sessionId)).endsAt, appointmentId: APPT_CLEANUP });
    await vi.waitFor(async () => expect((await sessionRow(sessionId)).status).toBe('ENDED'), { timeout: 15_000 });
    expect((await sessionRow(sessionId)).endReason).toBe('CLEANUP');
    expect(await video.describeSession({ providerMeetingId: meetingId })).toBeNull();
    const schedulers = await scheduler.getQueue()!.getJobSchedulers();
    expect(schedulers.map((s) => [s.name, s.pattern])).toEqual([['calls.reconcile', '*/5 * * * *']]);
  });

  it('schedules the reminders when an appointment is created and removes them on cancel (D-CW-26)', async (ctx) => {
    if (!redisUp) ctx.skip();
    const startsAt = new Date(now + 2 * 24 * 60 * MINUTE);
    const created = await appointmentsService.create(
      ORG,
      {
        orgId: ORG,
        expertUserId: 'user_milica',
        employeeUserId: 'user_jovan',
        startsAt: startsAt.toISOString(),
        endsAt: new Date(startsAt.getTime() + 50 * MINUTE).toISOString(),
        serviceCategory: 'psychological',
        timeZone: 'Europe/Belgrade',
      },
      principal('user_nikola'),
    );
    const queue = scheduler.getQueue()!;
    for (const offset of [1440, 60]) {
      const job = await queue.getJob(callsJobId('appointment.remind', created.id, offset));
      expect(job?.data).toEqual({ appointmentId: created.id, offsetMinutes: offset });
      expect(await job?.getState()).toBe('delayed');
      expect(Math.abs(job!.timestamp + job!.delay - (startsAt.getTime() - offset * MINUTE))).toBeLessThan(5_000);
    }

    await appointmentsService.cancel(created.id, principal('user_jovan'));
    for (const offset of [1440, 60]) {
      expect(await queue.getJob(callsJobId('appointment.remind', created.id, offset))).toBeUndefined();
    }
  });

  it('appointment.remind emails both participants in their locale; a canceled appointment gets none', async () => {
    await testDb.db.update(appointments).set({ startsAt: new Date(now + 60 * MINUTE), endsAt: new Date(now + 110 * MINUTE) }).where(eq(appointments.id, APPT_OVERDUE));
    mail.length = 0;
    const updates: unknown[] = [];
    const result = await callJobs.remind(
      { appointmentId: APPT_OVERDUE, offsetMinutes: 60 },
      { updateData: async (data) => void updates.push(data) },
    );
    expect(result.sentTo).toEqual(['employee', 'expert']);
    const people = await testDb.db
      .select({ id: users.id, email: users.email, locale: users.locale })
      .from(users)
      .where(inArray(users.id, ['user_jovan', 'user_milica']));
    const person = (id: string) => people.find((p) => p.id === id)!;
    expect(mail.map((m) => [m.to, m.locale, m.template, m.data])).toEqual([
      [
        person('user_jovan').email,
        person('user_jovan').locale,
        'appointment.reminder',
        expect.objectContaining({ joinUrl: `https://app.nestself.test/appointments/${APPT_OVERDUE}` }),
      ],
      [
        person('user_milica').email,
        person('user_milica').locale,
        'appointment.reminder',
        expect.objectContaining({ joinUrl: `https://admin.nestself.test/consultations/${APPT_OVERDUE}` }),
      ],
    ]);
    expect(updates.at(-1)).toEqual({ appointmentId: APPT_OVERDUE, offsetMinutes: 60, sentTo: ['employee', 'expert'] });

    await testDb.db.update(appointments).set({ status: 'CANCELED' }).where(eq(appointments.id, APPT_OVERDUE));
    mail.length = 0;
    expect(
      await callJobs.remind({ appointmentId: APPT_OVERDUE, offsetMinutes: 60 }, { updateData: async () => undefined }),
    ).toMatchObject({ skipped: 'status' });
    expect(mail).toEqual([]);
  });

  it('calls.no_show_followup emails the employee after an employee no-show and is scheduled 48 hours out', async () => {
    // The BullMQ case leaves an ended session on APPT_CLEANUP; without Redis there is none yet.
    const [existing] = await testDb.db.select().from(callSessions).where(eq(callSessions.appointmentId, APPT_CLEANUP));
    const sessionId = existing?.id ?? (await activeSession(APPT_CLEANUP)).sessionId;
    await testDb.db.update(appointments).set({ status: 'NO_SHOW' }).where(eq(appointments.id, APPT_CLEANUP));
    await testDb.db.insert(callOutcomes).values({
      sessionId,
      orgId: ORG,
      status: 'NO_SHOW_EMPLOYEE',
      recordedByUserId: 'user_milica',
    });
    mail.length = 0;

    expect(await callJobs.noShowFollowUp({ appointmentId: APPT_CLEANUP })).toEqual({
      appointmentId: APPT_CLEANUP,
      sentTo: ['employee'],
    });
    expect(mail).toEqual([
      expect.objectContaining({
        template: 'appointment.no_show_followup',
        data: expect.objectContaining({ reportProblemUrl: `https://app.nestself.test/appointments/${APPT_CLEANUP}` }),
      }),
    ]);

    if (redisUp) {
      expect(await scheduler.scheduleNoShowFollowUp(APPT_CLEANUP)).toBe(true);
      const job = await scheduler.getQueue()!.getJob(callsJobId('calls.no_show_followup', APPT_CLEANUP));
      // 48 hours after the appointment's end, not after the outcome.
      const [appointment] = await testDb.db.select().from(appointments).where(eq(appointments.id, APPT_CLEANUP));
      expect(Math.abs(job!.timestamp + job!.delay - (appointment!.endsAt.getTime() + 48 * 60 * MINUTE))).toBeLessThan(5_000);
      expect(job!.delay).toBeLessThan(48 * 60 * MINUTE);
    }
  });
});
