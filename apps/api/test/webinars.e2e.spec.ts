/**
 * Webinar e2e tests (T-CW-2.1, NS-CALLS-01): the occurrence form,
 * registration, the live session, the chat, hand-raise, the floor, polls
 * and attendance over HTTP against the `FakeVideoProvider`, with the golden
 * cases of the task (05-tasks T-CW-2.1 step 11), guidelines 7.3 and 15, and
 * D-CW-30 (employer-scoped principals get 404 on attendance and every ops
 * route).
 *
 * Principals: `user_nikola` operations (`client_operations` through his
 * CLIENT assignment to `org_sample`: event.manage and event.moderate), the
 * occurrence's moderator; `user_milica` the expert, its presenter (the
 * occurrence form gives her the CASE assignment the `expert` template's
 * `event.present` needs); `user_jovan` and `user_ana` employees;
 * `user_ivana` HR (employer owner, hr_admin and employee templates);
 * `user_stefan` a team manager whose employee grant is revoked, so that he is
 * employer-scoped only.
 *
 * The webinar queue gets Redis under a run-specific prefix when Redis
 * answers (reminders and the recording start job); the rest of the
 * application runs on the in-memory store. Every test starts with an empty
 * throttle store: the suite registers more than ten times a minute from one
 * address.
 *
 * Requires TEST_DATABASE_URL (PostgreSQL). Skipped otherwise.
 */
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { ThrottlerStorage, type ThrottlerStorageService } from '@nestjs/throttler';
import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import { Redis } from 'ioredis';
import {
  OpsOrgUnitsResponseSchema,
  OpsOrganizationsResponseSchema,
  WEBINAR_REPLICATED_CAPACITY,
  WebinarHostCandidatesResponseSchema,
  WebinarPollListResponseSchema,
  WebinarRecordingStatusResponseSchema,
  WebinarAttendanceResponseSchema,
  WebinarJoinResponseSchema,
  WebinarListResponseSchema,
  WebinarMessageListResponseSchema,
  WebinarModerationMessageListResponseSchema,
  WebinarOpsListResponseSchema,
  WebinarOpsResponseSchema,
  WebinarPollResultsSchema,
  WebinarResponseSchema,
  type WebinarJoinResponse,
} from '@nestself/contracts';
import { SAMPLE_DEV_PASSWORD, SAMPLE_EXTERNAL_IDENTITIES } from '@nestself/sample-data';
import { IdentityProviderService } from '../src/identity/identity-provider.service.js';
import type { FakeIdentityProvider } from '../src/identity/fake-identity-provider.js';
import { computeTotp } from '../src/identity/totp.js';
import { AuditWriter, type AuditEventInput } from '../src/audit/audit-writer.js';
import { VIDEO_PROVIDER } from '../src/video/video-provider.js';
import type { FakeVideoProvider } from '../src/video/fake-video-provider.js';
import { RoomEmitter } from '../src/ws/room-emitter.js';
import { WebinarJobSchedulerService, webinarReminderJobIds } from '../src/jobs/webinar-job-scheduler.service.js';
import { WebinarsRepository } from '../src/webinars/webinars.repository.js';
import { WebinarJobsService } from '../src/webinars/webinar-jobs.service.js';
import { seed } from '../src/db/seed/seed-lib.js';
import {
  assignments,
  callSessions,
  grants,
  orgUnits,
  webinarPollResults,
  webinarRecordings,
  webinarRegistrations,
  webinars,
} from '../src/db/schema/index.js';
import { resetTestDatabase, type TestDatabase } from './db/test-database.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const shouldRun = !!TEST_DB_URL;
const REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379';

const ORG = 'org_sample';
const MINUTE = 60_000;
/** Fixed TOTP secret for the staff and expert users of this suite (base32). */
const TOTP_SECRET = 'JBSWY3DPEHPK3PXP';
const STAFF = ['user_milica', 'user_nikola', 'user_admin'];
const PEOPLE = ['user_milica', 'user_nikola', 'user_admin', 'user_jovan', 'user_ana', 'user_ivana', 'user_stefan'];
/** A unit of the sample organisation nobody belongs to: its audience is empty of our employees. */
const ELSEWHERE_UNIT = 'ou_wbn_elsewhere';

/** The keys each webinar audit event may carry (guidelines 7.5, CW-R-33a). */
const WEBINAR_AUDIT_DETAIL_KEYS: Record<string, string[]> = {
  'webinar.created': ['createdByUserId', 'webinarId'],
  'webinar.published': ['webinarId'],
  'webinar.canceled': ['webinarId'],
  'webinar.started': ['sessionId', 'webinarId'],
  'webinar.ended': ['sessionId', 'webinarId'],
  'webinar.registered': ['userId', 'webinarId'],
  'webinar.unregistered': ['userId', 'webinarId'],
  'webinar.joined': ['participantId', 'webinarId'],
  'webinar.message.submitted': ['messageId', 'webinarId'],
  'webinar.message.published': ['messageId', 'webinarId'],
  'webinar.message.answered': ['messageId', 'webinarId'],
  'webinar.message.dismissed': ['messageId', 'webinarId'],
  'webinar.floor.given': ['participantId', 'recordingNoticeShown', 'webinarId'],
  'webinar.floor.taken': ['participantId', 'webinarId'],
  'webinar.floor.muted': ['participantId', 'webinarId'],
  'webinar.floor.unmute_requested': ['participantId', 'webinarId'],
  'webinar.floor.unmuted': ['participantId', 'webinarId'],
  'webinar.poll.opened': ['pollId', 'webinarId'],
  'webinar.poll.closed': ['pollId', 'webinarId'],
  // T-CW-2.5
  'webinar.updated': ['changedFields', 'webinarId'],
  'webinar.attendance.viewed': ['webinarId'],
  'webinar.recording.started': ['recordingId', 'sessionId', 'webinarId'],
  'webinar.recording.stopped': ['reason', 'recordingId', 'sessionId', 'webinarId'],
  'webinar.recording.ready': ['concatenatedKey', 'recordingId', 'sessionId', 'webinarId'],
  'webinar.recording.handed_off': ['handoffStatus', 'recordingId', 'sessionId', 'webinarId'],
  'webinar.recording.failed': ['reason', 'recordingId', 'sessionId', 'webinarId'],
};

/** A worker run of a recording job: first attempt of three, just enqueued. */
const RECORDING_JOB_CONTEXT = () => ({ attempt: 1, maxAttempts: 3, enqueuedAt: new Date() });

interface SignedIn {
  agent: request.Agent;
  csrf: string;
}

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

describe.skipIf(!shouldRun)('Webinars (e2e)', () => {
  let app: INestApplication;
  let idp: FakeIdentityProvider;
  let testDb: TestDatabase;
  let video: FakeVideoProvider;
  let scheduler: WebinarJobSchedulerService;
  let redisUp = false;
  let emit: ReturnType<typeof vi.spyOn>;
  let auditRecord: ReturnType<typeof vi.spyOn>;
  const auditLog: AuditEventInput[] = [];
  const jwtSecret = randomBytes(32).toString('hex');
  const queuePrefix = `nestself-test-cw21-${randomBytes(4).toString('hex')}`;

  let nikola: SignedIn;
  let milica: SignedIn;
  let jovan: SignedIn;
  let ana: SignedIn;
  let ivana: SignedIn;
  let stefan: SignedIn;
  /** The platform administrator (platform_owner): manages and moderates occurrences open to all. */
  let admin: SignedIn;

  /** The live webinar of the golden flow: org_sample, capacity 2, starts in 5 minutes. */
  let liveId: string;
  let presenterJoin: WebinarJoinResponse;
  let attendeeJoin: WebinarJoinResponse;

  function extractCsrf(res: request.Response): string {
    const cookies = res.headers['set-cookie'] as string[] | undefined;
    const csrf = cookies?.find((c) => c.startsWith('nestself_csrf='))?.match(/nestself_csrf=([^;]+)/);
    if (!csrf) throw new Error('CSRF cookie not found');
    return csrf[1]!;
  }

  async function switchContext(who: SignedIn, context: Record<string, string>) {
    const res = await who.agent.post('/api/auth/context').set('X-CSRF-Token', who.csrf).send({ context });
    expect(res.status).toBe(200);
  }

  async function signInStaff(userId: string, context: Record<string, string>): Promise<SignedIn> {
    const agent = request.agent(app.getHttpServer());
    const pw = await agent.post('/api/auth/password').send({ email: `${userId}@example.com`, password: SAMPLE_DEV_PASSWORD });
    expect(pw.status).toBe(200);
    const totp = await agent
      .post('/api/auth/challenge')
      .send({ challengeToken: pw.body.challengeToken, response: computeTotp(TOTP_SECRET) });
    expect(totp.status).toBe(200);
    const who = { agent, csrf: extractCsrf(totp) };
    await switchContext(who, context);
    return who;
  }

  async function signInMember(userId: string): Promise<SignedIn> {
    const email = `${userId}@example.com`;
    const agent = request.agent(app.getHttpServer());
    const start = await agent.post('/api/auth/email-otp/start').send({ email });
    expect(start.status).toBe(200);
    const code = idp.sentCodes.filter((c) => c.email === email).pop()!.code;
    const verify = await agent.post('/api/auth/email-otp/verify').send({ challengeToken: start.body.challengeToken, code });
    expect(verify.status).toBe(200);
    const who = { agent, csrf: extractCsrf(verify) };
    await switchContext(who, { kind: 'organization', orgId: ORG });
    return who;
  }

  const post = (who: SignedIn, path: string, body: unknown = {}) =>
    who.agent.post(`/api${path}`).set('X-CSRF-Token', who.csrf).send(body as object);
  const patch = (who: SignedIn, path: string, body: unknown) =>
    who.agent.patch(`/api${path}`).set('X-CSRF-Token', who.csrf).send(body as object);
  const del = (who: SignedIn, path: string) => who.agent.delete(`/api${path}`).set('X-CSRF-Token', who.csrf);
  const get = (who: SignedIn, path: string) => who.agent.get(`/api${path}`);

  function expectNotFound(res: request.Response) {
    expect(res.status, JSON.stringify(res.body)).toBe(404);
    expect(res.body).toMatchObject({ status: 404, code: 'not_found', message: 'Resource not found' });
  }

  function expectCode(res: request.Response, status: number, code: string) {
    expect(res.status, JSON.stringify(res.body)).toBe(status);
    expect(res.body.code).toBe(code);
  }

  function emitted(event: string): [string, string, Record<string, unknown>][] {
    return (emit.mock.calls as [string, string, Record<string, unknown>][]).filter((call) => call[1] === event);
  }

  function occurrence(overrides: Record<string, unknown> = {}) {
    const startsAt = new Date(Date.now() + 5 * MINUTE);
    return {
      title: { en: 'Taking breaks during the working day', 'sr-Latn': 'Pauze tokom radnog dana' },
      description: { en: 'Short, simple breaks.' },
      presenterUserIds: ['user_milica'],
      moderatorUserId: 'user_nikola',
      startsAt: startsAt.toISOString(),
      endsAt: new Date(startsAt.getTime() + 60 * MINUTE).toISOString(),
      timeZone: 'Europe/Belgrade',
      audiencePolicy: { type: 'organization', orgIds: [ORG] },
      capacity: 2,
      ...overrides,
    };
  }

  async function createPublished(overrides: Record<string, unknown> = {}): Promise<string> {
    const created = await post(nikola, '/ops/webinars', occurrence(overrides));
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const published = await post(nikola, `/ops/webinars/${created.body.id}/publish`);
    expect(published.status, JSON.stringify(published.body)).toBe(200);
    return created.body.id as string;
  }

  beforeAll(async () => {
    testDb = await resetTestDatabase(TEST_DB_URL!, 'webinars');
    await seed(testDb.db);

    process.env.DATABASE_URL = testDb.url;
    process.env.AUTH_MODE = 'stub';
    process.env.VIDEO_PROVIDER = 'none';
    process.env.JWT_SECRET = jwtSecret;
    process.env.SESSION_COOKIE_INSECURE_DEV = 'true';
    process.env.NODE_ENV = 'test';
    delete process.env.REDIS_URL;

    redisUp = await redisAnswers(REDIS_URL);
    const schedulerConfig = { get: (key: string) => (key === 'REDIS_URL' && redisUp ? REDIS_URL : undefined) };

    const { AppModule } = await import('../src/app.module.js');
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(WebinarJobSchedulerService)
      .useFactory({
        factory: () => {
          scheduler = new WebinarJobSchedulerService(schedulerConfig as unknown as ConfigService);
          scheduler.prefix = queuePrefix;
          return scheduler;
        },
      })
      .compile();
    const { ApiExceptionFilter } = await import('../src/common/api-exception.filter.js');

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();

    video = app.get<FakeVideoProvider>(VIDEO_PROVIDER);
    emit = vi.spyOn(app.get(RoomEmitter), 'emit');
    // Every audit event of the run, for the hygiene test at the end (spies are cleared between tests).
    const writer = app.get(AuditWriter);
    const record = writer.record.bind(writer);
    writer.record = async (input) => {
      auditLog.push(input);
      return record(input);
    };
    auditRecord = vi.spyOn(writer, 'record');

    idp = app.get(IdentityProviderService) as FakeIdentityProvider;
    const staffLogin = { password: SAMPLE_DEV_PASSWORD, totpSecret: TOTP_SECRET, totpEnrolled: true };
    idp.seedUsers(
      SAMPLE_EXTERNAL_IDENTITIES.filter((i) => PEOPLE.includes(i.userId)).map((i) => ({
        email: i.email,
        sub: i.subject,
        username: i.cognitoUsername,
        ...(STAFF.includes(i.userId) ? staffLogin : {}),
      })),
    );

    // Stefan keeps team_manager only: an employer-scoped principal.
    await testDb.db
      .update(grants)
      .set({ revokedAt: new Date('2026-01-02'), revokedReason: 'test_fixture' })
      .where(eq(grants.id, 'grant_user_stefan_employee'));
    await testDb.db.insert(orgUnits).values({ id: ELSEWHERE_UNIT, orgId: ORG, kind: 'TEAM', name: 'Elsewhere' });

    nikola = await signInStaff('user_nikola', { kind: 'operations' });
    milica = await signInStaff('user_milica', { kind: 'expert' });
    jovan = await signInMember('user_jovan');
    ana = await signInMember('user_ana');
    ivana = await signInMember('user_ivana');
    stefan = await signInMember('user_stefan');
    admin = await signInStaff('user_admin', { kind: 'operations' });
  }, 180_000);

  beforeEach(() => {
    // The in-memory store keeps the hit times apart from the counters; both go.
    const throttles = app.get<ThrottlerStorageService>(ThrottlerStorage, { strict: false });
    throttles.storage.clear();
    (throttles as unknown as { hitExpirations: Map<string, unknown> }).hitExpirations.clear();
  });

  afterAll(async () => {
    if (redisUp) await scheduler?.getQueue()?.obliterate({ force: true }).catch(() => undefined);
    await app?.close();
    await testDb?.close();
  });

  // ── Occurrence form (WBN-30, D-CW-14, D-CW-34, T-CW-3.2) ───────────────────

  it('creation with capacity 1,001 returns 400 capacity_above_limit naming the limit; 300 is accepted (D-CW-14)', async () => {
    const res = await post(nikola, '/ops/webinars', occurrence({ capacity: WEBINAR_REPLICATED_CAPACITY + 1 }));
    expectCode(res, 400, 'capacity_above_limit');
    expect(res.body.details).toEqual({ field: 'capacity', limit: WEBINAR_REPLICATED_CAPACITY });
    const patched = await patch(nikola, '/ops/webinars/webinar_sample_ended', { capacity: WEBINAR_REPLICATED_CAPACITY + 1 });
    expectCode(patched, 400, 'capacity_above_limit');
    // Media replication (T-CW-3.2) takes an audience above one meeting.
    const replicated = await post(nikola, '/ops/webinars', occurrence({ capacity: 300 }));
    expect(replicated.status, JSON.stringify(replicated.body)).toBe(201);
    expect(replicated.body.capacity).toBe(300);
  });

  it('an edit is audited as webinar.updated with the names of the fields it changed (WBN-30, T-CW-2.5)', async () => {
    const created = await post(nikola, '/ops/webinars', occurrence());
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const res = await patch(nikola, `/ops/webinars/${created.body.id}`, { capacity: 3, timeZone: 'Europe/Belgrade' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'webinar.updated',
        actorUserId: 'user_nikola',
        details: { webinarId: created.body.id, changedFields: ['capacity', 'timeZone'] },
      }),
    );
  });

  it('operations create a draft occurrence without a recording switch; the presenter gets her CASE assignment', async () => {
    expectCode(await post(nikola, '/ops/webinars', occurrence({ recordingPolicy: 'off' })), 400, 'validation');

    const res = await post(nikola, '/ops/webinars', occurrence());
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const created = WebinarOpsResponseSchema.parse(res.body);
    expect(created).toMatchObject({ orgId: ORG, status: 'draft', capacity: 2, chatPolicy: 'moderated' });
    expect(created.hosts).toEqual([
      { userId: 'user_milica', role: 'presenter', displayName: 'Milica' },
      { userId: 'user_nikola', role: 'moderator', displayName: 'Nikola' },
    ]);
    liveId = created.id;

    const caseRows = await testDb.db
      .select()
      .from(assignments)
      .where(and(eq(assignments.userId, 'user_milica'), eq(assignments.targetId, liveId)));
    expect(caseRows).toEqual([expect.objectContaining({ kind: 'CASE', reason: 'webinar_presenter', endAt: null })]);
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'webinar.created', details: { webinarId: liveId, createdByUserId: 'user_nikola' } }),
    );
  });

  it('a draft is invisible to employees; publishing makes it visible (WBN-31, WBN-01)', async () => {
    expectNotFound(await get(jovan, `/webinars/${liveId}`));
    expectCode(await post(jovan, `/webinars/${liveId}/register`), 409, 'webinar_not_open');

    const published = await post(nikola, `/ops/webinars/${liveId}/publish`);
    expect(published.body).toEqual({ webinarId: liveId, status: 'published' });

    const list = WebinarListResponseSchema.parse((await get(jovan, '/webinars')).body);
    const item = list.items.find((w) => w.id === liveId)!;
    expect(item).toMatchObject({ status: 'published', capacity: 2, capacityRemaining: 2, registered: false });
    expect(item.presenters).toEqual([{ displayName: 'Milica' }]);
    // The occurrence open to all eligible organisations is listed too; the ended one is not by default.
    expect(list.items.map((w) => w.id)).toContain('webinar_sample_upcoming');
    expect(list.items.map((w) => w.id)).not.toContain('webinar_sample_ended');
  });

  it('employer-scoped principals get 404 on attendance and on every ops route (D-CW-30, CW-R-72)', async () => {
    for (const who of [ivana, stefan]) {
      expectNotFound(await get(who, '/ops/webinars'));
      expectNotFound(await post(who, '/ops/webinars', occurrence()));
      expectNotFound(await patch(who, `/ops/webinars/${liveId}`, { capacity: 3 }));
      expectNotFound(await post(who, `/ops/webinars/${liveId}/publish`));
      expectNotFound(await post(who, `/ops/webinars/${liveId}/cancel`));
      expectNotFound(await get(who, `/ops/webinars/${liveId}/attendance`));
      expectNotFound(await get(who, '/ops/webinars/webinar_sample_ended/attendance'));
    }
    // Stefan holds no event.register: the employee routes are 404 for him as well.
    expectNotFound(await get(stefan, '/webinars'));
    expectNotFound(await get(stefan, `/webinars/${liveId}`));
    expectNotFound(await post(stefan, `/webinars/${liveId}/register`));
  });

  // ── Registration (WBN-02, WBN-03, CW-R-31) ────────────────────────────────

  it('operations read one occurrence; the form looks up host candidates and organisations (T-CW-2.1 additions)', async () => {
    const detail = WebinarOpsResponseSchema.parse((await get(nikola, `/ops/webinars/${liveId}`)).body);
    expect(detail).toMatchObject({ id: liveId, status: 'published', orgId: ORG });
    for (const who of [ivana, stefan, milica, jovan]) expectNotFound(await get(who, `/ops/webinars/${liveId}`));

    const presenters = WebinarHostCandidatesResponseSchema.parse(
      (await get(nikola, '/ops/webinars/host-candidates?role=presenter')).body,
    );
    expect(presenters.items).toContainEqual({ userId: 'user_milica', displayName: 'Milica Ristić' });
    expect(presenters.items.map((c) => c.userId)).not.toContain('user_jovan');
    const moderators = WebinarHostCandidatesResponseSchema.parse(
      (await get(nikola, '/ops/webinars/host-candidates?role=moderator')).body,
    );
    expect(moderators.items.map((c) => c.userId)).toEqual(expect.arrayContaining(['user_nikola', 'user_admin']));
    expect(moderators.items.map((c) => c.userId)).not.toContain('user_milica');
    const named = WebinarHostCandidatesResponseSchema.parse(
      (await get(nikola, '/ops/webinars/host-candidates?role=presenter&q=mil')).body,
    );
    expect(named.items.map((c) => c.userId)).toEqual(['user_milica']);
    expectNotFound(await get(ivana, '/ops/webinars/host-candidates?role=presenter'));
    expectNotFound(await get(milica, '/ops/webinars/host-candidates?role=presenter'));

    // Nikola manages the sample organisation through his CLIENT assignment; the administrator every one.
    const own = OpsOrganizationsResponseSchema.parse((await get(nikola, '/ops/orgs')).body);
    expect(own.items.map((o) => o.id)).toEqual([ORG]);
    const all = OpsOrganizationsResponseSchema.parse((await get(admin, '/ops/orgs?q=a')).body);
    expect(all.items.map((o) => o.id)).toContain(ORG);
    expectNotFound(await get(ivana, '/ops/orgs'));

    // The units of an `org_unit` audience (event.manage on the organisation, operations context).
    const units = OpsOrgUnitsResponseSchema.parse((await get(nikola, `/ops/orgs/${ORG}/units`)).body);
    expect(units.items.map((u) => u.id)).toContain(ELSEWHERE_UNIT);
    expect(units.items.find((u) => u.id === ELSEWHERE_UNIT)).toEqual({ id: ELSEWHERE_UNIT, name: 'Elsewhere', parentId: null });
    expectNotFound(await get(nikola, '/ops/orgs/org_unknown/units'));
    for (const who of [ivana, stefan, milica]) expectNotFound(await get(who, `/ops/orgs/${ORG}/units`));

    // The hosts' own list, from the expert context too (`mine=true`).
    const mine = WebinarOpsListResponseSchema.parse((await get(milica, '/ops/webinars?mine=true')).body);
    expect(mine.items.map((w) => w.id)).toContain(liveId);
    const moderated = WebinarOpsListResponseSchema.parse((await get(nikola, '/ops/webinars?mine=true')).body);
    expect(moderated.items.map((w) => w.id)).toContain(liveId);
    expect(WebinarOpsListResponseSchema.parse((await get(jovan, '/ops/webinars?mine=true')).body).items).toEqual([]);
  });

  it('publishing checks that the engine lets the hosts present and moderate this occurrence (WBN-31)', async () => {
    // An occurrence open to all: Nikola (client_operations) moderates his client organisation only.
    const created = await post(admin, '/ops/webinars', occurrence({ audiencePolicy: { type: 'all_eligible' }, capacity: 50 }));
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.id as string;
    const refused = await post(admin, `/ops/webinars/${id}/publish`);
    expectCode(refused, 400, 'validation');
    expect(refused.body.details).toEqual({ field: 'moderatorUserId' });

    expect((await patch(admin, `/ops/webinars/${id}`, { moderatorUserId: 'user_admin' })).status).toBe(200);
    expect((await post(admin, `/ops/webinars/${id}/publish`)).body).toEqual({ webinarId: id, status: 'published' });

    // While published, an edit re-runs the publish checks (hosts, their rights, the start).
    const noRight = await patch(admin, `/ops/webinars/${id}`, { moderatorUserId: 'user_nikola' });
    expectCode(noRight, 400, 'validation');
    expect(noRight.body.details).toEqual({ field: 'moderatorUserId' });
    const notPresenter = await patch(admin, `/ops/webinars/${id}`, { presenterUserIds: ['user_nikola'] });
    expectCode(notPresenter, 400, 'validation');
    expect(notPresenter.body.details).toEqual({ field: 'presenterUserIds' });
    const noModerator = await patch(admin, `/ops/webinars/${id}`, { moderatorUserId: null });
    expect(noModerator.body.details).toEqual({ field: 'moderatorUserId' });
    const past = new Date(Date.now() - 60 * MINUTE);
    const started = await patch(admin, `/ops/webinars/${id}`, {
      startsAt: past.toISOString(),
      endsAt: new Date(past.getTime() + 120 * MINUTE).toISOString(),
    });
    expect(started.body.details).toEqual({ field: 'startsAt' });

    // The organisation of a published occurrence is fixed (409 not_editable); a draft's may move.
    expectCode(
      await patch(admin, `/ops/webinars/${id}`, { audiencePolicy: { type: 'organization', orgIds: [ORG] } }),
      409,
      'not_editable',
    );
    const draft = await post(admin, '/ops/webinars', occurrence({ audiencePolicy: { type: 'all_eligible' } }));
    const moved = await patch(admin, `/ops/webinars/${draft.body.id}`, { audiencePolicy: { type: 'organization', orgIds: [ORG] } });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect(moved.body.orgId).toBe(ORG);
  });

  it('a presenter acting on an occurrence she does not host is refused (CW-R-31a)', async () => {
    const other = await post(nikola, '/ops/webinars', occurrence({ presenterUserIds: [] }));
    const id = other.body.id as string;
    expectNotFound(await post(milica, `/webinars/${id}/start`));
    expectNotFound(await post(milica, `/webinars/${id}/end`));
    expectNotFound(await post(milica, `/webinars/${id}/join`));
    expectNotFound(await post(milica, `/webinars/${id}/messages`, { kind: 'host', text: 'Hello' }));
    expectNotFound(await get(milica, `/webinars/${id}/messages`));
    expectNotFound(await post(milica, `/webinars/${id}/participants/part_x/give-floor`));
    expectNotFound(await post(milica, `/webinars/${id}/polls`, { question: 'Which?', options: ['A', 'B'] }));
    expectNotFound(await get(milica, `/webinars/${id}/polls`));
  });

  it('registers within capacity, refuses a duplicate with already_registered and a full webinar with webinar_full', async () => {
    const first = await post(jovan, `/webinars/${liveId}/register`);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body).toMatchObject({ webinarId: liveId, registered: true });
    expectCode(await post(jovan, `/webinars/${liveId}/register`), 409, 'already_registered');
    expect((await post(ana, `/webinars/${liveId}/register`)).status).toBe(200);
    // Capacity 2 is reached: Ivana (an eligible employee too) is refused.
    expectCode(await post(ivana, `/webinars/${liveId}/register`), 409, 'webinar_full');

    const detail = WebinarResponseSchema.parse((await get(jovan, `/webinars/${liveId}`)).body);
    expect(detail).toMatchObject({ registered: true, capacityRemaining: 0 });
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'webinar.registered', details: { webinarId: liveId, userId: 'user_jovan' } }),
    );
  });

  it('concurrent registrations never exceed the capacity (SELECT ... FOR UPDATE, CW-R-31)', async () => {
    const id = await createPublished({ capacity: 1 });
    const results = await Promise.all([jovan, ana, ivana].map((who) => post(who, `/webinars/${id}/register`)));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    expect(results.filter((r) => r.status === 409).every((r) => r.body.code === 'webinar_full')).toBe(true);
    const rows = await testDb.db.select().from(webinarRegistrations).where(eq(webinarRegistrations.webinarId, id));
    expect(rows).toHaveLength(1);
  });

  it('an employee outside the audience gets 403 not_eligible and never sees the occurrence (D-CW-17, CW-R-32)', async () => {
    const id = await createPublished({ audiencePolicy: { type: 'org_unit', orgId: ORG, orgUnitIds: [ELSEWHERE_UNIT] } });
    expectCode(await post(jovan, `/webinars/${id}/register`), 403, 'not_eligible');
    expectNotFound(await get(jovan, `/webinars/${id}`));
    const list = WebinarListResponseSchema.parse((await get(jovan, '/webinars')).body);
    expect(list.items.map((w) => w.id)).not.toContain(id);
  });

  it('schedules the reminders at registration and removes them on unregistration (WBN-05, CW-R-37a)', async () => {
    const startsAt = new Date(Date.now() + 3 * 24 * 60 * MINUTE);
    const id = await createPublished({
      startsAt: startsAt.toISOString(),
      endsAt: new Date(startsAt.getTime() + 60 * MINUTE).toISOString(),
    });
    expect((await post(jovan, `/webinars/${id}/register`)).status).toBe(200);
    const [registration] = await testDb.db
      .select()
      .from(webinarRegistrations)
      .where(and(eq(webinarRegistrations.webinarId, id), eq(webinarRegistrations.userId, 'user_jovan')));
    if (redisUp) {
      const delayed = await scheduler.getQueue()!.getDelayed();
      expect(delayed.map((job) => job.id).filter((jobId) => jobId?.includes(registration!.id)).sort()).toEqual(
        webinarReminderJobIds(registration!.id).sort(),
      );
    }

    const unregistered = await del(jovan, `/webinars/${id}/register`);
    expect(unregistered.body).toEqual({ webinarId: id, registered: false, registeredAt: null });
    expectNotFound(await del(jovan, `/webinars/${id}/register`));
    if (redisUp) {
      const delayed = await scheduler.getQueue()!.getDelayed();
      expect(delayed.filter((job) => job.id?.includes(registration!.id))).toEqual([]);
    }
    // Registering again reuses the one row (CW-R-24a).
    expect((await post(jovan, `/webinars/${id}/register`)).status).toBe(200);

    // A canceled occurrence refuses registration with webinar_not_open (WBN-32).
    expect((await post(nikola, `/ops/webinars/${id}/cancel`)).body).toEqual({ webinarId: id, status: 'canceled' });
    expectCode(await post(ana, `/webinars/${id}/register`), 409, 'webinar_not_open');
    // The presenter's CASE assignment on a canceled occurrence ends.
    const caseRows = await testDb.db.select().from(assignments).where(and(eq(assignments.targetId, id), eq(assignments.kind, 'CASE')));
    expect(caseRows.map((row) => row.endAt)).toEqual([expect.any(Date)]);
  });

  // ── Start (WBN-17, CW-R-31a) ──────────────────────────────────────────────

  it('an attendee waits in the lobby before the start (webinar_not_open)', async () => {
    expectCode(await post(jovan, `/webinars/${liveId}/join`), 409, 'webinar_not_open');
  });

  it('an attendee cannot start the webinar: 404, as for anyone who is not a host (CW-R-31a)', async () => {
    expectNotFound(await post(jovan, `/webinars/${liveId}/start`));
    expectNotFound(await post(ivana, `/webinars/${liveId}/start`));
    expectNotFound(await post(stefan, `/webinars/${liveId}/end`));
  });

  it('the presenter can start: published to live, webinar.state, the recording start job (WBN-17, CW-R-107)', async () => {
    const res = await post(milica, `/webinars/${liveId}/start`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ webinarId: liveId, status: 'live' });
    expect(emitted('webinar.state')).toContainEqual([`webinar:${liveId}`, 'webinar.state', { webinarId: liveId, status: 'live' }]);
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'webinar.started', details: { webinarId: liveId, sessionId: null } }),
    );
    if (redisUp) {
      const job = await scheduler.getQueue()!.getJob(`webinar.recording.start/${liveId}`);
      expect(job?.data).toEqual({ webinarId: liveId, sessionId: null });
    }
    // Every webinar is recorded: the status stays SCHEDULED until the pipeline (T-CW-2.5) moves it.
    const webinar = await app.get(WebinarsRepository).findById(liveId);
    expect(webinar).toMatchObject({ status: 'live', recordingStatus: 'scheduled' });
  });

  it('a live occurrence is no longer editable (409 not_editable)', async () => {
    expectCode(await patch(nikola, `/ops/webinars/${liveId}`, { title: { en: 'Renamed' } }), 409, 'not_editable');
  });

  it('registration after the start returns 409 registration_closed (WBN-03)', async () => {
    expectCode(await post(ivana, `/webinars/${liveId}/register`), 409, 'registration_closed');
    expectCode(await del(ana, `/webinars/${liveId}/register`), 409, 'registration_closed');
  });

  // ── Join (WBN-07, WBN-16, D-CW-35) ────────────────────────────────────────

  it('attendees wait until a host opened the meeting; hosts join with send capabilities', async () => {
    expectCode(await post(jovan, `/webinars/${liveId}/join`), 409, 'webinar_not_open');

    const createSession = vi.spyOn(video, 'createSession');
    const res = await post(milica, `/webinars/${liveId}/join`);
    // One seat more than the capacity of 2, for the media capture pipeline (SPIKE-CW-03).
    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({ format: 'webinar', capacity: 3 }));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    presenterJoin = WebinarJoinResponseSchema.parse(res.body);
    expect(presenterJoin).toMatchObject({
      role: 'presenter',
      format: 'webinar',
      capabilities: { audio: 'send_receive', video: 'send_receive', content: 'send_receive' },
    });
    const [session] = await testDb.db.select().from(callSessions).where(eq(callSessions.id, presenterJoin.sessionId));
    expect(session).toMatchObject({ format: 'WEBINAR', webinarId: liveId, orgId: ORG, status: 'ACTIVE' });

    const moderatorJoin = WebinarJoinResponseSchema.parse((await post(nikola, `/webinars/${liveId}/join`)).body);
    expect(moderatorJoin).toMatchObject({ role: 'moderator', sessionId: presenterJoin.sessionId });
  });

  // ── Recording (WBN-28, D-CW-18, D-CW-34, T-CW-2.5) ─────────────────────

  it('the recording cannot be stopped before it started (409 recording_not_allowed)', async () => {
    expectCode(await post(nikola, `/webinars/${liveId}/recording/stop`), 409, 'recording_not_allowed');
  });

  it('the start job captures the presenter only, under raw/{webinarId}/, and shows the REC indicator', async () => {
    const startRecording = vi.spyOn(video, 'startRecording');
    const result = await app
      .get(WebinarJobsService)
      .handle('webinar.recording.start', { webinarId: liveId, sessionId: null }, RECORDING_JOB_CONTEXT());
    expect(result).toMatchObject({ webinarId: liveId, started: true });

    // The presenter's attendee only: the moderator is in the meeting and is not selected (D-CW-18).
    expect(startRecording).toHaveBeenCalledWith({
      sessionId: presenterJoin.sessionId,
      providerMeetingId: presenterJoin.meeting.MeetingId,
      presenterAttendeeIds: [presenterJoin.attendee.AttendeeId],
      s3Prefix: `raw/${liveId}/`,
    });
    const [row] = await testDb.db.select().from(webinarRecordings).where(eq(webinarRecordings.webinarId, liveId));
    expect(row).toMatchObject({
      sessionId: presenterJoin.sessionId,
      orgId: ORG,
      status: 'RECORDING',
      providerPipelineId: `fake-pipeline-${presenterJoin.sessionId}`,
      rawSegmentsPrefix: `raw/${liveId}/`,
      handoffStatus: 'pending',
    });
    expect(emitted('webinar.recording')).toEqual([
      [`webinar:${liveId}`, 'webinar.recording', { webinarId: liveId, status: 'started' }],
    ]);
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'webinar.recording.started', actorKind: 'JOB', actorUserId: null }),
    );
    expect(await app.get(WebinarsRepository).findById(liveId)).toMatchObject({ recordingStatus: 'recording' });

    const status = await get(milica, `/webinars/${liveId}/recording`);
    expect(status.status, JSON.stringify(status.body)).toBe(200);
    expect(WebinarRecordingStatusResponseSchema.parse(status.body)).toMatchObject({ status: 'recording', stoppedAt: null });
    expect((await get(nikola, `/webinars/${liveId}/recording`)).status).toBe(200);
    expectNotFound(await get(jovan, `/webinars/${liveId}/recording`));
    expectNotFound(await get(ivana, `/webinars/${liveId}/recording`));
  });

  it('an attendee joins receive-only on audio, video and content (WBN-07, CW-R-75, CW-R-71)', async () => {
    const res = await post(jovan, `/webinars/${liveId}/join`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    attendeeJoin = WebinarJoinResponseSchema.parse(res.body);
    expect(attendeeJoin).toMatchObject({
      role: 'attendee',
      sessionId: presenterJoin.sessionId,
      capabilities: { audio: 'receive', video: 'receive', content: 'receive' },
    });
    expect(attendeeJoin.attendee.Capabilities).toEqual({ Audio: 'Receive', Video: 'Receive', Content: 'Receive' });
    // The REC indicator's state at join: the session's pipeline is running.
    expect(attendeeJoin.recordingStatus).toBe('recording');
    expect(attendeeJoin.attendee.ExternalUserId).toBe(attendeeJoin.participantId);
    expect(attendeeJoin.attendee.ExternalUserId).not.toBe('user_jovan');
    expect(emitted('webinar.attendance.count')).toContainEqual([
      `webinar:${liveId}:moderation`,
      'webinar.attendance.count',
      { webinarId: liveId, count: 1 },
    ]);
    // A rejoin returns the cached credentials.
    const again = WebinarJoinResponseSchema.parse((await post(jovan, `/webinars/${liveId}/join`)).body);
    expect(again.attendee.AttendeeId).toBe(attendeeJoin.attendee.AttendeeId);
  });

  it('an eligible employee who is not registered cannot join or read the chat (WBN-07)', async () => {
    // Ivana is in the audience and holds event.register, but the webinar was full when she tried.
    expectCode(await post(ivana, `/webinars/${liveId}/join`), 403, 'forbidden');
    expectCode(await get(ivana, `/webinars/${liveId}/messages`), 403, 'forbidden');
    expectCode(await get(ivana, `/webinars/${liveId}/polls`), 403, 'forbidden');
  });

  it('an attendee cannot list the roster: no roster route, no names in the detail, 404 on attendance (WBN-08)', async () => {
    // No such routes exist.
    for (const path of ['participants', 'registrations', 'attendees', 'attendance']) {
      expect((await get(jovan, `/webinars/${liveId}/${path}`)).status).toBe(404);
    }
    expectNotFound(await get(jovan, `/ops/webinars/${liveId}/attendance`));
    const detail = (await get(jovan, `/webinars/${liveId}`)).body as Record<string, unknown>;
    expect(WebinarResponseSchema.safeParse(detail).success).toBe(true);
    expect(JSON.stringify(detail)).not.toMatch(/user_|Petrović|Jovan|Ana|participant/);
  });

  // ── Chat (WBN-09, WBN-20, WBN-23, WBN-24, WBN-37, D-CW-35) ────────────────

  let questionId: string;
  let messageId: string;

  it('attendees write to the hosts, pending and anonymous unless they attach their first name (WBN-09)', async () => {
    const question = await post(jovan, `/webinars/${liveId}/messages`, { kind: 'question', text: 'How long should a break be?' });
    expect(question.status, JSON.stringify(question.body)).toBe(201);
    expect(question.body).toMatchObject({ kind: 'question', status: 'pending', authorFirstName: null });
    questionId = question.body.id;

    const message = await post(ana, `/webinars/${liveId}/messages`, { kind: 'attendee', text: 'Thank you', showFirstName: true });
    expect(message.body).toMatchObject({ status: 'pending', authorFirstName: 'Ana' });
    messageId = message.body.id;

    const submitted = emitted('webinar.message.submitted');
    expect(submitted.map((call) => call[0])).toEqual([`webinar:${liveId}:moderation`, `webinar:${liveId}:moderation`]);
    expect(submitted[0]![2]).toMatchObject({ id: questionId, authorName: 'Jovan Petrović', showFirstName: false });

    // An attendee cannot post to everyone; a host cannot pose as an attendee (CW-R-110).
    expect((await post(jovan, `/webinars/${liveId}/messages`, { kind: 'host', text: 'Hello all' })).status).toBe(403);
    expect((await post(nikola, `/webinars/${liveId}/messages`, { kind: 'attendee', text: 'Hello' })).status).toBe(403);
  });

  it('hosts post to everyone, published at once (WBN-37)', async () => {
    const res = await post(milica, `/webinars/${liveId}/messages`, { kind: 'host', text: 'Welcome, everyone.' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ kind: 'host', status: 'published', authorFirstName: 'Milica' });
    expect(emitted('webinar.message.published').at(-1)![0]).toBe(`webinar:${liveId}`);
  });

  it('an attendee reads only published messages (CW-R-104, WBN-09 criterion 7)', async () => {
    const res = await get(jovan, `/webinars/${liveId}/messages`);
    expect(res.status).toBe(200);
    const list = WebinarMessageListResponseSchema.parse(res.body);
    expect(list.items.map((m) => [m.kind, m.status])).toEqual([['host', 'published']]);
    expect(JSON.stringify(res.body)).not.toMatch(/authorName|authorParticipantId|user_/);
  });

  it('the moderator reads all messages with the registration names (WBN-23); the presenter reads the published ones (WBN-20)', async () => {
    const res = await get(nikola, `/webinars/${liveId}/messages`);
    expect(res.status).toBe(200);
    const list = WebinarModerationMessageListResponseSchema.parse(res.body);
    expect(list.items.map((m) => [m.kind, m.status, m.authorName])).toEqual([
      ['question', 'pending', 'Jovan Petrović'],
      ['attendee', 'pending', 'Ana Nikolić'],
      ['host', 'published', null],
    ]);
    const presenter = WebinarMessageListResponseSchema.parse((await get(milica, `/webinars/${liveId}/messages`)).body);
    expect(presenter.items.map((m) => m.status)).toEqual(['published']);
    expectNotFound(await get(stefan, `/webinars/${liveId}/messages`));
  });

  it('the moderator publishes (editing the text), answers and dismisses (WBN-24)', async () => {
    expectNotFound(await post(jovan, `/webinars/${liveId}/messages/${messageId}/publish`, {}));
    expectNotFound(await post(milica, `/webinars/${liveId}/messages/${messageId}/publish`, {}));

    const published = await post(nikola, `/webinars/${liveId}/messages/${messageId}/publish`, { text: 'Thank you!' });
    expect(published.status, JSON.stringify(published.body)).toBe(200);
    expect(published.body).toMatchObject({ status: 'published', text: 'Thank you!', authorName: 'Ana Nikolić' });
    expect(emitted('webinar.message.published').at(-1)![2]).toMatchObject({ id: messageId, authorFirstName: 'Ana' });
    expectCode(await post(nikola, `/webinars/${liveId}/messages/${messageId}/publish`, {}), 409, 'conflict');

    const answered = await post(nikola, `/webinars/${liveId}/messages/${questionId}/answer`, {
      answerText: 'A few minutes away from the screen.',
    });
    expect(answered.body).toMatchObject({ status: 'answered', answerText: 'A few minutes away from the screen.' });
    expect(emitted('webinar.message.answered')).toHaveLength(1);

    const pending = await post(jovan, `/webinars/${liveId}/messages`, { kind: 'attendee', text: 'Off topic' });
    const dismissed = await post(nikola, `/webinars/${liveId}/messages/${pending.body.id}/dismiss`, {});
    expect(dismissed.body).toMatchObject({ status: 'dismissed' });

    const seen = WebinarMessageListResponseSchema.parse((await get(jovan, `/webinars/${liveId}/messages`)).body);
    expect(seen.items.map((m) => m.status).sort()).toEqual(['answered', 'published', 'published']);
    // A pending message never reached the audience: nothing to remove from the public chat.
    expect(emitted('webinar.message.removed')).toEqual([]);
  });

  it('dismissing a published message removes it from the public chat, by id only (WBN-24.2, T-CW-2.3 addition)', async () => {
    const written = await post(jovan, `/webinars/${liveId}/messages`, { kind: 'attendee', text: 'Published, then removed' });
    const id = written.body.id as string;
    expect((await post(nikola, `/webinars/${liveId}/messages/${id}/publish`, {})).status).toBe(200);
    const dismissed = await post(nikola, `/webinars/${liveId}/messages/${id}/dismiss`, {});
    expect(dismissed.body).toMatchObject({ status: 'dismissed' });
    expect(emitted('webinar.message.removed')).toEqual([[`webinar:${liveId}`, 'webinar.message.removed', { messageId: id }]]);
    const seen = WebinarMessageListResponseSchema.parse((await get(jovan, `/webinars/${liveId}/messages`)).body);
    expect(seen.items.map((m) => m.id)).not.toContain(id);
  });

  // ── Hand-raise and floor (WBN-10, WBN-25, D-CW-35) ────────────────────────

  it('an attendee raises a hand; only the moderation room learns the name (WBN-10)', async () => {
    const res = await post(jovan, `/webinars/${liveId}/hand`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.raised).toBe(true);
    const [room, , payload] = emitted('webinar.hand.raised').at(-1)!;
    expect(room).toBe(`webinar:${liveId}:moderation`);
    expect(payload).toMatchObject({ participantId: attendeeJoin.participantId, participantName: 'Jovan Petrović' });
    // Ana registered but never joined.
    expectCode(await post(ana, `/webinars/${liveId}/hand`), 409, 'conflict');
  });

  it('give-floor sets audio to SendReceive and video stays Receive, for that attendee only (WBN-25, CW-R-108)', async () => {
    const path = `/webinars/${liveId}/participants/${attendeeJoin.participantId}/give-floor`;
    expectNotFound(await post(ana, path));
    expectNotFound(await post(ivana, path));

    const res = await post(nikola, path);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({
      participantId: attendeeJoin.participantId,
      hasFloor: true,
      capabilities: { audio: 'send_receive', video: 'receive', content: 'receive' },
    });
    const meeting = await video.describeSession({ providerMeetingId: presenterJoin.meeting.MeetingId });
    expect(meeting).not.toBeNull();
    const state = (video as unknown as { findAttendee(m: string, a: string): { Capabilities: unknown } }).findAttendee(
      presenterJoin.meeting.MeetingId,
      attendeeJoin.attendee.AttendeeId,
    );
    expect(state.Capabilities).toEqual({ Audio: 'SendReceive', Video: 'Receive', Content: 'Receive' });

    expect(emitted('webinar.floor.given')).toEqual([
      [
        'user:user_jovan',
        'webinar.floor.given',
        { participantId: attendeeJoin.participantId, capabilities: { audio: 'send_receive', video: 'receive', content: 'receive' } },
      ],
    ]);
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'webinar.floor.given',
        details: { webinarId: liveId, participantId: attendeeJoin.participantId, recordingNoticeShown: true },
      }),
    );
    // Giving the floor lowered the hand.
    expect(emitted('webinar.hand.lowered').at(-1)![2]).toEqual({ participantId: attendeeJoin.participantId });
    // A host is not an attendee: there is no floor to give.
    expectCode(
      await post(nikola, `/webinars/${liveId}/participants/${presenterJoin.participantId}/give-floor`),
      409,
      'floor_not_available',
    );
  });

  it('take-floor reverts audio to Receive (WBN-25 criterion 6)', async () => {
    const res = await post(milica, `/webinars/${liveId}/participants/${attendeeJoin.participantId}/take-floor`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({
      participantId: attendeeJoin.participantId,
      hasFloor: false,
      capabilities: { audio: 'receive', video: 'receive', content: 'receive' },
    });
    const state = (video as unknown as { findAttendee(m: string, a: string): { Capabilities: unknown } }).findAttendee(
      presenterJoin.meeting.MeetingId,
      attendeeJoin.attendee.AttendeeId,
    );
    expect(state.Capabilities).toEqual({ Audio: 'Receive', Video: 'Receive', Content: 'Receive' });
    expect(emitted('webinar.floor.taken').at(-1)![0]).toBe('user:user_jovan');

    // The floor does not survive a reconnect: a rejoin with cached credentials is receive-only again (D-CW-35).
    expect((await post(nikola, `/webinars/${liveId}/participants/${attendeeJoin.participantId}/give-floor`)).status).toBe(200);
    const rejoin = WebinarJoinResponseSchema.parse((await post(jovan, `/webinars/${liveId}/join`)).body);
    expect(rejoin.attendee.AttendeeId).toBe(attendeeJoin.attendee.AttendeeId);
    const after = (video as unknown as { findAttendee(m: string, a: string): { Capabilities: unknown } }).findAttendee(
      presenterJoin.meeting.MeetingId,
      attendeeJoin.attendee.AttendeeId,
    );
    expect(after.Capabilities).toEqual({ Audio: 'Receive', Video: 'Receive', Content: 'Receive' });
  });

  it('the audience learns only that someone has the floor: webinar.floor.state on give, take and a rejoin (WBN-25.8)', async () => {
    const floorPath = (action: string) => `/webinars/${liveId}/participants/${attendeeJoin.participantId}/${action}`;
    expect((await post(nikola, floorPath('give-floor'))).status).toBe(200);
    expect((await post(nikola, floorPath('take-floor'))).status).toBe(200);
    expect((await post(nikola, floorPath('give-floor'))).status).toBe(200);
    // The floor does not survive a reconnect (D-CW-35), and the flag follows it.
    expect((await post(jovan, `/webinars/${liveId}/join`)).status).toBe(200);
    const floor = (room: string) => emitted('webinar.floor.state').filter((call) => call[0] === room).map((call) => call[2]);
    expect(floor(`webinar:${liveId}`)).toEqual([{ active: true }, { active: false }, { active: true }, { active: false }]);
    // The hosts' room names the attendee (an id, never a name) so any host can take the floor back after a reload.
    const participantId = attendeeJoin.participantId;
    expect(floor(`webinar:${liveId}:hosts`)).toEqual([
      { active: true, participantId },
      { active: false, participantId },
      { active: true, participantId },
      { active: false, participantId },
    ]);
  });

  it('the hosts room counts raised hands and attendance, never names (T-CW-2.3 hosts room, WBN-19)', async () => {
    expect((await post(jovan, `/webinars/${liveId}/hand`)).status).toBe(200);
    expect((await del(jovan, `/webinars/${liveId}/hand`)).status).toBe(200);
    expect(emitted('webinar.hand.count')).toEqual([
      [`webinar:${liveId}:hosts`, 'webinar.hand.count', { count: 1 }],
      [`webinar:${liveId}:hosts`, 'webinar.hand.count', { count: 0 }],
    ]);
    expect((await post(jovan, `/webinars/${liveId}/join`)).status).toBe(200);
    const counts = emitted('webinar.attendance.count').map((call) => call[0]);
    expect(counts).toEqual([`webinar:${liveId}:moderation`, `webinar:${liveId}:hosts`]);
    expect(JSON.stringify(emitted('webinar.hand.count'))).not.toMatch(/Jovan|user_/);
  });

  it('a host mutes the floor holder and asks to unmute; only the attendee unmutes, while holding the floor (WBN-26)', async () => {
    const path = (action: string) => `/webinars/${liveId}/participants/${attendeeJoin.participantId}/${action}`;
    const capabilities = () =>
      (video as unknown as { findAttendee(m: string, a: string): { Capabilities: unknown } }).findAttendee(
        presenterJoin.meeting.MeetingId,
        attendeeJoin.attendee.AttendeeId,
      ).Capabilities;
    const participantId = attendeeJoin.participantId;
    // Muting needs a floor to mute.
    expectCode(await post(nikola, path('mute')), 409, 'floor_not_available');
    expect((await post(nikola, path('give-floor'))).status).toBe(200);

    const muted = await post(milica, path('mute'));
    expect(muted.status, JSON.stringify(muted.body)).toBe(200);
    expect(muted.body).toEqual({
      participantId,
      hasFloor: true,
      muted: true,
      capabilities: { audio: 'receive', video: 'receive', content: 'receive' },
    });
    expect(capabilities()).toEqual({ Audio: 'Receive', Video: 'Receive', Content: 'Receive' });
    expect(emitted('webinar.floor.muted')).toEqual([
      [`webinar:${liveId}:hosts`, 'webinar.floor.muted', { participantId }],
      ['user:user_jovan', 'webinar.floor.muted', {}],
    ]);
    // The floor itself stays with the attendee.
    const [registration] = await testDb.db
      .select()
      .from(webinarRegistrations)
      .where(and(eq(webinarRegistrations.webinarId, liveId), eq(webinarRegistrations.userId, 'user_jovan')));
    expect(registration!.floorGivenAt).not.toBeNull();

    // Muted by a host, the attendee cannot unmute until a host asks (WBN-26 criterion 3, server-side).
    expectCode(await post(jovan, path('unmute')), 409, 'floor_not_available');
    expect((await post(nikola, path('unmute-request'))).body).toEqual({ participantId, requested: true });
    expect(emitted('webinar.floor.unmute_requested')).toEqual([['user:user_jovan', 'webinar.floor.unmute_requested', {}]]);
    // Nothing changes until the attendee consents.
    expect(capabilities()).toEqual({ Audio: 'Receive', Video: 'Receive', Content: 'Receive' });

    // A host cannot unmute an attendee; another registrant cannot touch this participant.
    expectNotFound(await post(nikola, path('unmute')));
    expectNotFound(await post(ana, path('unmute')));
    const unmuted = await post(jovan, path('unmute'));
    expect(unmuted.status, JSON.stringify(unmuted.body)).toBe(200);
    expect(unmuted.body).toEqual({
      participantId,
      hasFloor: true,
      muted: false,
      capabilities: { audio: 'send_receive', video: 'receive', content: 'receive' },
    });
    expect(capabilities()).toEqual({ Audio: 'SendReceive', Video: 'Receive', Content: 'Receive' });
    expect(emitted('webinar.floor.unmuted')).toEqual([[`webinar:${liveId}:hosts`, 'webinar.floor.unmuted', { participantId }]]);

    // Employer-scoped principals and attendees learn nothing.
    for (const who of [ivana, stefan, jovan]) {
      expectNotFound(await post(who, path('mute')));
      expectNotFound(await post(who, path('unmute-request')));
    }
    expectNotFound(await post(stefan, path('unmute')));

    // Without the floor the attendee cannot unmute.
    expect((await post(nikola, path('take-floor'))).status).toBe(200);
    expectCode(await post(jovan, path('unmute')), 409, 'floor_not_available');
    expectCode(await post(nikola, path('unmute-request')), 409, 'floor_not_available');
    expect(capabilities()).toEqual({ Audio: 'Receive', Video: 'Receive', Content: 'Receive' });
    expect((auditRecord.mock.calls as [AuditEventInput][]).map(([event]) => event.action)).toEqual(
      expect.arrayContaining(['webinar.floor.muted', 'webinar.floor.unmute_requested', 'webinar.floor.unmuted']),
    );
  });

  it('the live attendance count follows joins and leaves; hosts start from it (WBN-19.1, WBN-36.1)', async () => {
    // Jovan is in the meeting; Ana joins: two attendees present.
    const anaJoin = WebinarJoinResponseSchema.parse((await post(ana, `/webinars/${liveId}/join`)).body);
    expect(emitted('webinar.attendance.count')).toEqual([
      [`webinar:${liveId}:moderation`, 'webinar.attendance.count', { webinarId: liveId, count: 2 }],
      [`webinar:${liveId}:hosts`, 'webinar.attendance.count', { webinarId: liveId, count: 2 }],
    ]);
    expect(anaJoin).not.toHaveProperty('attendanceCount');
    const host = WebinarJoinResponseSchema.parse((await post(nikola, `/webinars/${liveId}/join`)).body);
    expect(host).toMatchObject({ role: 'moderator', attendanceCount: 2 });

    // Ana leaves: the provider's AttendeeLeft reaches the applier, which re-announces the count.
    video.simulateEvent('AttendeeLeft', presenterJoin.meeting.MeetingId, anaJoin.attendee.AttendeeId);
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline && emitted('webinar.attendance.count').length < 4) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(emitted('webinar.attendance.count').slice(2)).toEqual([
      [`webinar:${liveId}:moderation`, 'webinar.attendance.count', { webinarId: liveId, count: 1 }],
      [`webinar:${liveId}:hosts`, 'webinar.attendance.count', { webinarId: liveId, count: 1 }],
    ]);
    const after = WebinarJoinResponseSchema.parse((await post(milica, `/webinars/${liveId}/join`)).body);
    expect(after).toMatchObject({ role: 'presenter', attendanceCount: 1 });
  });

  // ── Polls (WBN-11, WBN-27, CW-R-24) ───────────────────────────────────────

  it('polls: created and opened by the moderator, one vote per attendee without a voter, aggregate results', async () => {
    expectNotFound(await post(jovan, `/webinars/${liveId}/polls`, { question: 'Which break?', options: ['Walk', 'Tea'] }));
    const created = await post(nikola, `/webinars/${liveId}/polls`, { question: 'Which break?', options: ['Walk', 'Tea'] });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const pollId = created.body.id as string;
    const [walk, tea] = created.body.options as { id: string }[];
    expectCode(await post(jovan, `/webinars/${liveId}/polls/${pollId}/vote`, { optionId: walk!.id }), 409, 'conflict');

    const opened = await post(nikola, `/webinars/${liveId}/polls/${pollId}/open`);
    expect(opened.body.openedAt).not.toBeNull();
    expect(emitted('webinar.poll.opened').at(-1)![0]).toBe(`webinar:${liveId}`);

    expect((await post(jovan, `/webinars/${liveId}/polls/${pollId}/vote`, { optionId: walk!.id })).body).toEqual({
      pollId,
      voted: true,
    });
    expectCode(await post(jovan, `/webinars/${liveId}/polls/${pollId}/vote`, { optionId: tea!.id }), 409, 'conflict');
    expect((await post(ana, `/webinars/${liveId}/polls/${pollId}/vote`, { optionId: tea!.id, userId: 'x' })).status).toBe(400);

    // A late joiner recovers the poll: opened, voted, no results before the close.
    const open = WebinarPollListResponseSchema.parse((await get(jovan, `/webinars/${liveId}/polls`)).body);
    expect(open.items).toEqual([{ poll: expect.objectContaining({ id: pollId }), results: null, voted: true }]);
    expectNotFound(await get(jovan, `/webinars/${liveId}/polls/${pollId}/results`));
    expectCode(await get(nikola, `/webinars/${liveId}/polls/${pollId}/results`), 409, 'conflict');

    // While the poll is open, the vote row and the voter's marker were written by one transaction (CW-R-24).
    const xmin = async () => {
      const { rows } = await testDb.pool.query<{ vote: string; voter: string }>(
        `SELECT (SELECT xmin::text FROM webinar_poll_results WHERE poll_id = $1) AS vote,
                (SELECT xmin::text FROM webinar_registrations WHERE webinar_id = $2 AND user_id = 'user_jovan') AS voter`,
        [pollId, liveId],
      );
      return rows[0]!;
    };
    const before = await xmin();
    expect(before.voter).toBe(before.vote);

    const closed = await post(nikola, `/webinars/${liveId}/polls/${pollId}/close`);
    // The close rewrote the voter's row: the transaction ids no longer match.
    const after = await xmin();
    expect(after.voter).not.toBe(after.vote);
    const results = WebinarPollResultsSchema.parse(closed.body);
    expect(results).toEqual({
      pollId,
      totalVotes: 1,
      results: [
        { optionId: walk!.id, count: 1 },
        { optionId: tea!.id, count: 0 },
      ],
    });
    expect(emitted('webinar.poll.results').at(-1)![2]).toEqual(results);
    expect((await get(milica, `/webinars/${liveId}/polls/${pollId}/results`)).body).toEqual(results);
    const recovered = WebinarPollListResponseSchema.parse((await get(jovan, `/webinars/${liveId}/polls`)).body);
    expect(recovered.items[0]).toMatchObject({ results, voted: true });

    const votes = await testDb.db.select().from(webinarPollResults).where(eq(webinarPollResults.pollId, pollId));
    expect(votes.map((v) => Object.keys(v).sort())).toEqual([['id', 'optionId', 'orgId', 'pollId']]);
    const [registration] = await testDb.db
      .select()
      .from(webinarRegistrations)
      .where(and(eq(webinarRegistrations.webinarId, liveId), eq(webinarRegistrations.userId, 'user_jovan')));
    expect(registration!.votedPollIds).toEqual([pollId]);
  });

  // ── Attendance and the ops index (WBN-33) ─────────────────────────────────

  it('operations see attendance as counts and registration rows without names or user ids (WBN-33)', async () => {
    const res = await get(nikola, `/ops/webinars/${liveId}/attendance`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const attendance = WebinarAttendanceResponseSchema.parse(res.body);
    expect(attendance).toMatchObject({ webinarId: liveId, registeredCount: 2 });
    expect(attendance.registrants).toHaveLength(2);
    expect(JSON.stringify(res.body)).not.toMatch(/user_|Jovan|Ana|email/);

    const sample = WebinarAttendanceResponseSchema.parse((await get(nikola, '/ops/webinars/webinar_sample_ended/attendance')).body);
    expect(sample).toMatchObject({ registeredCount: 2, joinedCount: 2, peakConcurrent: 2 });

    const index = WebinarOpsListResponseSchema.parse((await get(nikola, `/ops/webinars?orgId=${ORG}`)).body);
    expect(index.items.map((w) => w.id)).toEqual(expect.arrayContaining([liveId, 'webinar_sample_ended']));
  });

  it('viewing the attendance report is audited (WBN-33 criterion 5)', async () => {
    expect((await get(nikola, `/ops/webinars/${liveId}/attendance`)).status).toBe(200);
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'webinar.attendance.viewed', actorUserId: 'user_nikola', details: { webinarId: liveId } }),
    );
  });

  it('only moderating staff stop the recording early; the stop is idempotent and schedules the finalize job', async () => {
    const path = `/webinars/${liveId}/recording/stop`;
    expectNotFound(await post(jovan, path));
    // The presenter holds event.present, not event.moderate.
    expectNotFound(await post(milica, path));

    const res = await post(nikola, path);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(WebinarRecordingStatusResponseSchema.parse(res.body)).toMatchObject({
      webinarId: liveId,
      status: 'processing',
      startedAt: expect.any(String),
      stoppedAt: expect.any(String),
    });
    expect(emitted('webinar.recording')).toEqual([
      [`webinar:${liveId}`, 'webinar.recording', { webinarId: liveId, status: 'stopped' }],
    ]);
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'webinar.recording.stopped',
        actorUserId: 'user_nikola',
        details: expect.objectContaining({ webinarId: liveId, sessionId: presenterJoin.sessionId, reason: 'moderator' }),
      }),
    );
    if (redisUp) {
      const job = await scheduler.getQueue()!.getJob(`webinar.recording.finalize/${presenterJoin.sessionId}`);
      expect(job?.data).toEqual({ webinarId: liveId, sessionId: presenterJoin.sessionId });
    }
    expect((await post(nikola, path)).body).toMatchObject({ status: 'processing' });
    expect(emitted('webinar.recording')).toHaveLength(1);
  });

  // ── End (WBN-21, WBN-29) ──────────────────────────────────────────────────

  it('an attendee cannot end; a host ends for everyone and the room closes (WBN-21, CW-R-36b)', async () => {
    expectNotFound(await post(jovan, `/webinars/${liveId}/end`));
    const res = await post(nikola, `/webinars/${liveId}/end`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ webinarId: liveId, status: 'ended' });
    const ended = emitted('webinar.ended').map((call) => call[0]);
    expect(ended).toEqual([`webinar:${liveId}`, `webinar:${liveId}:moderation`]);
    const [session] = await testDb.db.select().from(callSessions).where(eq(callSessions.id, presenterJoin.sessionId));
    expect(session).toMatchObject({ status: 'ENDED' });
    expect(await video.describeSession({ providerMeetingId: presenterJoin.meeting.MeetingId })).toBeNull();

    expectCode(await post(jovan, `/webinars/${liveId}/join`), 409, 'webinar_not_open');
    // The presenter's CASE assignment ends with the occurrence (her right to act on it goes with it).
    const caseRows = await testDb.db
      .select()
      .from(assignments)
      .where(and(eq(assignments.targetId, liveId), eq(assignments.userId, 'user_milica')));
    expect(caseRows.map((row) => row.endAt)).toEqual([expect.any(Date)]);
    expect((await post(nikola, `/webinars/${liveId}/end`)).body).toEqual({ webinarId: liveId, status: 'ended' });
    expectNotFound(await post(milica, `/webinars/${liveId}/end`));
  });

  it('the finalize job stops the capture, concatenates into final/{webinarId}/ and hands off as pending (WBN-34)', async () => {
    const result = await app
      .get(WebinarJobsService)
      .handle('webinar.recording.finalize', { webinarId: liveId, sessionId: presenterJoin.sessionId }, RECORDING_JOB_CONTEXT());
    expect(result).toMatchObject({ webinarId: liveId, finalized: true });
    expect(video.isRecording(`fake-pipeline-${presenterJoin.sessionId}`)).toBe(false);

    const [row] = await testDb.db.select().from(webinarRecordings).where(eq(webinarRecordings.webinarId, liveId));
    expect(row).toMatchObject({
      status: 'READY',
      concatenationPipelineId: `fake-concat-${presenterJoin.sessionId}-1`,
      concatenatedKey: `final/${liveId}/composited-video/`,
      handoffStatus: 'pending',
      handoffLocation: `s3://fake-recordings/final/${liveId}/composited-video/`,
      readyAt: expect.any(Date),
    });
    expect((auditRecord.mock.calls as [AuditEventInput][]).map(([event]) => event.action)).toEqual([
      'webinar.recording.ready',
      'webinar.recording.handed_off',
    ]);
    expect((await get(nikola, `/webinars/${liveId}/recording`)).body).toMatchObject({ status: 'ready' });
    expect(emitted('webinar.recording')).toEqual([
      [`webinar:${liveId}`, 'webinar.recording', { webinarId: liveId, status: 'ready' }],
    ]);
  });

  it('a webinar whose meeting the provider ended is ended by the session lifecycle, and its recording stops (T-CW-2.5)', async () => {
    const id = await createPublished();
    expect((await post(milica, `/webinars/${id}/start`)).status).toBe(200);
    const host = WebinarJoinResponseSchema.parse((await post(milica, `/webinars/${id}/join`)).body);
    await app.get(WebinarJobsService).handle('webinar.recording.start', { webinarId: id, sessionId: null }, RECORDING_JOB_CONTEXT());

    // Chime ends a meeting on its own, for example once it has been empty for 5 minutes.
    video.simulateEvent('MeetingEnded', host.meeting.MeetingId);
    // The event is applied asynchronously; the end is announced last.
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline && emitted('webinar.ended').length < 2) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const [webinar] = await testDb.db.select().from(webinars).where(eq(webinars.id, id));
    expect(webinar).toMatchObject({ status: 'ENDED', recordingStatus: 'PROCESSING' });
    const [session] = await testDb.db.select().from(callSessions).where(eq(callSessions.id, host.sessionId));
    expect(session).toMatchObject({ status: 'ENDED', endReason: 'PROVIDER' });
    const [row] = await testDb.db.select().from(webinarRecordings).where(eq(webinarRecordings.webinarId, id));
    expect(row).toMatchObject({ status: 'PROCESSING', stoppedAt: expect.any(Date) });

    expect(emitted('webinar.state')).toContainEqual([`webinar:${id}`, 'webinar.state', { webinarId: id, status: 'ended' }]);
    expect(emitted('webinar.ended').map((call) => call[0])).toEqual([`webinar:${id}`, `webinar:${id}:moderation`]);
    expect(emitted('webinar.recording')).toContainEqual([`webinar:${id}`, 'webinar.recording', { webinarId: id, status: 'stopped' }]);
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'webinar.ended', actorUserId: null, actorKind: 'SYSTEM', details: { webinarId: id, sessionId: host.sessionId } }),
    );
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'webinar.recording.stopped', actorKind: 'SYSTEM', details: expect.objectContaining({ reason: 'ended' }) }),
    );
    // A host's end afterwards is a no-op; the presenter's CASE assignment ended with the occurrence.
    expect((await post(nikola, `/webinars/${id}/end`)).body).toEqual({ webinarId: id, status: 'ended' });
    expectNotFound(await post(milica, `/webinars/${id}/end`));
  });

  it('the end stops the capture pipeline before the meeting is deleted (WBN-29.3)', async () => {
    const id = await createPublished();
    expect((await post(milica, `/webinars/${id}/start`)).status).toBe(200);
    const host = WebinarJoinResponseSchema.parse((await post(milica, `/webinars/${id}/join`)).body);
    await app.get(WebinarJobsService).handle('webinar.recording.start', { webinarId: id, sessionId: null }, RECORDING_JOB_CONTEXT());
    const pipelineId = `fake-pipeline-${host.sessionId}`;
    expect(video.isRecording(pipelineId)).toBe(true);

    const stopRecording = vi.spyOn(video, 'stopRecording');
    const endSession = vi.spyOn(video, 'endSession');
    expect((await post(nikola, `/webinars/${id}/end`)).body).toEqual({ webinarId: id, status: 'ended' });
    expect(stopRecording).toHaveBeenCalledWith({ pipelineId });
    expect(endSession).toHaveBeenCalledTimes(1);
    expect(stopRecording.mock.invocationCallOrder[0]!).toBeLessThan(endSession.mock.invocationCallOrder[0]!);
    expect(video.isRecording(pipelineId)).toBe(false);
    const [row] = await testDb.db.select().from(webinarRecordings).where(eq(webinarRecordings.webinarId, id));
    expect(row).toMatchObject({ status: 'PROCESSING', stoppedAt: expect.any(Date) });

    // The finalize job's own stop of the capture is idempotent: the pipeline is already gone.
    const result = await app
      .get(WebinarJobsService)
      .handle('webinar.recording.finalize', { webinarId: id, sessionId: host.sessionId }, RECORDING_JOB_CONTEXT());
    expect(result).toMatchObject({ webinarId: id, finalized: true });
  });

  it('an end before the recording started records it as failed, with no recording to stop', async () => {
    const id = await createPublished();
    expect((await post(milica, `/webinars/${id}/start`)).status).toBe(200);
    expect((await post(nikola, `/webinars/${id}/end`)).status).toBe(200);
    expect(await app.get(WebinarsRepository).findById(id)).toMatchObject({ status: 'ended', recordingStatus: 'failed' });
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'webinar.recording.failed',
        details: { webinarId: id, sessionId: null, recordingId: null, reason: 'ended_before_start' },
      }),
    );
    expect((await get(nikola, `/webinars/${id}/recording`)).body).toMatchObject({ status: 'failed', startedAt: null });
    // The audience's REC state, and the moderators' notice with the reason (CW-R-121).
    expect(emitted('webinar.recording')).toEqual([[`webinar:${id}`, 'webinar.recording', { webinarId: id, status: 'failed' }]]);
    expect(emitted('webinar.recording.failed')).toEqual([
      [`webinar:${id}:moderation`, 'webinar.recording.failed', { webinarId: id, reason: 'ended_before_start' }],
    ]);
  });

  // ── Audit hygiene (CW-R-33a, CW-R-69) ─────────────────────────────────────

  it('every webinar audit event carries identifiers only, never a token or a name', () => {
    const webinarEvents = auditLog.filter((event) => event.action.startsWith('webinar.'));
    expect(new Set(webinarEvents.map((e) => e.action)).size).toBeGreaterThanOrEqual(14);
    for (const event of webinarEvents) {
      const expected = WEBINAR_AUDIT_DETAIL_KEYS[event.action];
      expect(expected, event.action).toBeDefined();
      expect(Object.keys(event.details ?? {}).sort(), event.action).toEqual(expected);
      expect(JSON.stringify(event.details), event.action).not.toMatch(/JoinToken|fake-token|Petrović/);
    }
  });
});
