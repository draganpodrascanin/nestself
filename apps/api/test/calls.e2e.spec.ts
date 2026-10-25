/**
 * Call session e2e tests (T-CW-1.1, NS-CALLS-01): join, end, outcome,
 * feedback, signal, client events and diagnostics over HTTP against the
 * `FakeVideoProvider`, with the authorization golden cases of guidelines
 * 7.1, 7.2 and 17.1 (CW-R-82) and CALL-17 (employer-scoped principals get 404
 * on every route).
 *
 * Principals: `user_milica` is the expert and `user_jovan` the employee of
 * the fixture appointments; `user_ana` another employee of the organization;
 * `user_ivana` HR (employer owner, hr_admin and employee templates);
 * `user_stefan` a team manager whose employee grant is revoked, so that he is
 * employer-scoped only; `user_nikola` operations (support_operator through a
 * SUPPORT_CASE assignment for diagnostics).
 *
 * The fixture appointments are inserted directly with times relative to now,
 * because the join window is (D-CW-07).
 *
 * The API process applies the fake provider's events itself (T-CW-1.2,
 * `CallsModule` on bootstrap), so the event applier runs during this suite:
 * a simulated `MeetingEnded` closes a session as Chime's own end would.
 *
 * Requires TEST_DATABASE_URL (PostgreSQL). Skipped otherwise.
 */
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { and, eq, like } from 'drizzle-orm';
import {
  AppointmentResponseSchema,
  CallJoinResponseSchema,
  CallLocationResponseSchema,
  DIAGNOSTICS_PARTICIPANT_FIELDS,
  DIAGNOSTICS_PROBLEM_REPORT_FIELDS,
  DIAGNOSTICS_RESPONSE_FIELDS,
  DiagnosticsResponseSchema,
  PERMISSION_TEMPLATES,
  ProblemReportListResponseSchema,
  type CallJoinResponse,
} from '@nestself/contracts';
import { SAMPLE_DEV_PASSWORD, SAMPLE_EXTERNAL_IDENTITIES } from '@nestself/sample-data';
import { IdentityProviderService } from '../src/identity/identity-provider.service.js';
import type { FakeIdentityProvider } from '../src/identity/fake-identity-provider.js';
import { computeTotp } from '../src/identity/totp.js';
import { PrincipalLoader } from '../src/principal/principal-loader.js';
import { KEY_VALUE_STORE, type KeyValueStore } from '../src/redis/key-value-store.js';
import { callParticipantCredentialsKey } from '../src/redis/redis-keys.js';
import { VIDEO_PROVIDER } from '../src/video/video-provider.js';
import type { FakeVideoProvider } from '../src/video/fake-video-provider.js';
import { RoomEmitter } from '../src/ws/room-emitter.js';
import { Mailer, type MailInput } from '../src/mailer/mailer.js';
import { seed } from '../src/db/seed/seed-lib.js';
import {
  appointments,
  assignments,
  auditEvents,
  callClientEvents,
  callFeedback,
  callOutcomes,
  callParticipants,
  callSessions,
  grants,
} from '../src/db/schema/index.js';
import { resetTestDatabase, type TestDatabase } from './db/test-database.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const shouldRun = !!TEST_DB_URL;

const ORG = 'org_sample';
const MINUTE = 60_000;
/** Fixed TOTP secret for the staff and expert users of this suite (base32). */
const TOTP_SECRET = 'JBSWY3DPEHPK3PXP';
const STAFF = ['user_milica', 'user_nikola'];
const PEOPLE = ['user_milica', 'user_nikola', 'user_jovan', 'user_ana', 'user_ivana', 'user_stefan'];

/** Inside the join window: starts in 5 minutes. */
const APPT_NOW = 'appt_call_now';
/** Outside the window: starts in 3 days. */
const APPT_LATER = 'appt_call_later';
/** Canceled, inside the window. */
const APPT_CANCELED = 'appt_call_canceled';
/** Inside the window; its meeting is ended by the provider (T-CW-1.2). */
const APPT_PROVIDER = 'appt_call_provider_end';
/** Inside the window; the expert signals running late before the employee joins (T-CW-1.5). */
const APPT_SIGNAL = 'appt_call_pending_signal';
/** Inside the window; canceled while its meeting runs (CALL-27). */
const APPT_CANCEL_LIVE = 'appt_call_cancel_live';

/**
 * Every key set a call audit event may carry (guidelines 7.5). `call.ended`
 * has three: the expert's end, the expert's end after a concurrent close
 * (`closedBy`), and the lifecycle's close on a provider event or job.
 */
const CALL_AUDIT_DETAIL_KEYS: Record<string, string[][]> = {
  'call.session.created': [['appointmentId', 'format', 'sessionId']],
  'call.joined': [['participantId', 'role', 'sessionId']],
  'call.ended': [
    // A cancel ends the live meeting (CALL-27), with or without a concurrent close.
    ['cause', 'endedByUserId', 'sessionId'],
    ['cause', 'closedBy', 'endedByUserId', 'sessionId'],
    ['endedByUserId', 'sessionId'],
    ['closedBy', 'endedByUserId', 'sessionId'],
    ['endReason', 'sessionId'],
  ],
  'call.outcome.recorded': [['outcomeStatus', 'sessionId']],
  'call.feedback.submitted': [['sessionId']],
  'call.diagnostics.viewed': [
    ['sessionId', 'viewedByUserId'],
    ['reportCount', 'sessionIds', 'viewedByUserId'],
  ],
  'call.problem.reported': [['category', 'sessionId']],
};

interface SignedIn {
  agent: request.Agent;
  csrf: string;
}

describe.skipIf(!shouldRun)('Call sessions (e2e)', () => {
  let app: INestApplication;
  let idp: FakeIdentityProvider;
  let testDb: TestDatabase;
  let video: FakeVideoProvider;
  let kv: KeyValueStore;
  let emit: ReturnType<typeof vi.spyOn>;
  const jwtSecret = randomBytes(32).toString('hex');

  let milica: SignedIn;
  let jovan: SignedIn;
  let ana: SignedIn;
  let ivana: SignedIn;
  let stefan: SignedIn;
  let nikola: SignedIn;
  let expertJoin: CallJoinResponse;
  let employeeJoin: CallJoinResponse;
  let sessionId: string;

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

  /** Password + TOTP sign-in for staff and experts. */
  async function signInStaff(userId: string, context: Record<string, string>): Promise<SignedIn> {
    const agent = request.agent(app.getHttpServer());
    const pw = await agent
      .post('/api/auth/password')
      .send({ email: `${userId}@example.com`, password: SAMPLE_DEV_PASSWORD });
    expect(pw.status).toBe(200);
    const totp = await agent
      .post('/api/auth/challenge')
      .send({ challengeToken: pw.body.challengeToken, response: computeTotp(TOTP_SECRET) });
    expect(totp.status).toBe(200);
    const who = { agent, csrf: extractCsrf(totp) };
    await switchContext(who, context);
    return who;
  }

  /** Email-OTP sign-in for employees and organization admins, in the organization context. */
  async function signInMember(userId: string): Promise<SignedIn> {
    const email = `${userId}@example.com`;
    const agent = request.agent(app.getHttpServer());
    const start = await agent.post('/api/auth/email-otp/start').send({ email });
    expect(start.status).toBe(200);
    const code = idp.sentCodes.filter((c) => c.email === email).pop()!.code;
    const verify = await agent
      .post('/api/auth/email-otp/verify')
      .send({ challengeToken: start.body.challengeToken, code });
    expect(verify.status).toBe(200);
    const who = { agent, csrf: extractCsrf(verify) };
    await switchContext(who, { kind: 'organization', orgId: ORG });
    return who;
  }

  const post = (who: SignedIn, path: string, body: unknown = {}) =>
    who.agent.post(`/api${path}`).set('X-CSRF-Token', who.csrf).send(body as object);
  const join = (who: SignedIn, id = APPT_NOW, body: unknown = {}) => post(who, `/appointments/${id}/join`, body);
  const diagnostics = (who: SignedIn, id: string) => who.agent.get(`/api/ops/calls/${id}/diagnostics`);
  const location = (who: SignedIn, id = APPT_NOW) => who.agent.get(`/api/appointments/${id}/location`);

  /** A 404 that tells the caller nothing: the bare error envelope. */
  function expectNotFound(res: request.Response) {
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ status: 404, code: 'not_found', message: 'Resource not found' });
    expect(Object.keys(res.body).sort()).toEqual(['code', 'message', 'requestId', 'status']);
  }

  function emitted(event: string): [string, string, Record<string, unknown>][] {
    return (emit.mock.calls as [string, string, Record<string, unknown>][]).filter((call) => call[1] === event);
  }

  async function insertAppointment(id: string, startsAt: Date, status: 'CONFIRMED' | 'CANCELED' = 'CONFIRMED') {
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
    // The expert's CASE assignment, as AppointmentsService.create adds it.
    await testDb.db.insert(assignments).values({
      userId: 'user_milica',
      kind: 'CASE',
      targetId: id,
      assignedByUserId: 'user_nikola',
      startAt: new Date(Date.now() - 60 * MINUTE),
    });
  }

  beforeAll(async () => {
    testDb = await resetTestDatabase(TEST_DB_URL!, 'calls');
    await seed(testDb.db);

    process.env.DATABASE_URL = testDb.url;
    process.env.AUTH_MODE = 'stub';
    process.env.VIDEO_PROVIDER = 'none';
    process.env.JWT_SECRET = jwtSecret;
    process.env.SESSION_COOKIE_INSECURE_DEV = 'true';
    process.env.NODE_ENV = 'test';
    delete process.env.REDIS_URL;

    const { AppModule } = await import('../src/app.module.js');
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const { ApiExceptionFilter } = await import('../src/common/api-exception.filter.js');

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();

    video = app.get<FakeVideoProvider>(VIDEO_PROVIDER);
    kv = app.get<KeyValueStore>(KEY_VALUE_STORE);
    emit = vi.spyOn(app.get(RoomEmitter), 'emit');

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

    const now = Date.now();
    await insertAppointment(APPT_NOW, new Date(now + 5 * MINUTE));
    await insertAppointment(APPT_LATER, new Date(now + 3 * 24 * 60 * MINUTE));
    await insertAppointment(APPT_CANCELED, new Date(now + 5 * MINUTE), 'CANCELED');
    await insertAppointment(APPT_PROVIDER, new Date(now + 5 * MINUTE));
    await insertAppointment(APPT_SIGNAL, new Date(now + 5 * MINUTE));
    await insertAppointment(APPT_CANCEL_LIVE, new Date(now + 5 * MINUTE));

    // Stefan keeps team_manager only: an employer-scoped principal.
    await testDb.db
      .update(grants)
      .set({ revokedAt: new Date('2026-01-02'), revokedReason: 'test_fixture' })
      .where(eq(grants.id, 'grant_user_stefan_employee'));

    nikola = await signInStaff('user_nikola', { kind: 'operations' });
    milica = await signInStaff('user_milica', { kind: 'expert' });
    jovan = await signInMember('user_jovan');
    ana = await signInMember('user_ana');
    ivana = await signInMember('user_ivana');
    stefan = await signInMember('user_stefan');
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await testDb?.close();
  });

  // ── Join (CALL-02, CALL-20, PLT-01, PLT-03, D-CW-07, D-CW-08) ──────────────

  it('concurrent first joins of the expert and the employee create exactly one meeting', async () => {
    // Race-proof: the lock winner is held inside the provider call until the other join has lost the lock.
    const lockResults: boolean[] = [];
    let signalLockLost!: () => void;
    const lockLost = new Promise<void>((resolve) => {
      signalLockLost = resolve;
    });
    const realSet = kv.set.bind(kv);
    const set = vi.spyOn(kv, 'set').mockImplementation(async (key, value, opts) => {
      const result = await realSet(key, value, opts);
      if (key.endsWith(':create') && opts?.onlyIfAbsent) {
        lockResults.push(result);
        if (!result) signalLockLost();
      }
      return result;
    });
    const realCreate = video.createSession.bind(video);
    const create = vi.spyOn(video, 'createSession').mockImplementation(async (input) => {
      await lockLost;
      return realCreate(input);
    });
    const add = vi.spyOn(video, 'createParticipant');
    add.mockClear();

    let expertRes: request.Response;
    let employeeRes: request.Response;
    try {
      [expertRes, employeeRes] = await Promise.all([join(milica), join(jovan)]);
      expect(lockResults.filter((won) => !won)).toHaveLength(1);
      expect(lockResults.filter((won) => won)).toHaveLength(1);
      expect(create).toHaveBeenCalledTimes(1);
    } finally {
      set.mockRestore();
      create.mockRestore();
    }

    for (const res of [expertRes, employeeRes]) {
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      // Chime's EventIngestionUrl never reaches the client (CW-R-48).
      expect(res.body.meeting.MediaPlacement).not.toHaveProperty('EventIngestionUrl');
      expect(res.body.meeting).not.toHaveProperty('MeetingArn');
    }
    expertJoin = CallJoinResponseSchema.parse(expertRes.body);
    employeeJoin = CallJoinResponseSchema.parse(employeeRes.body);
    sessionId = expertJoin.sessionId;

    expect(add).toHaveBeenCalledTimes(1);
    expect(employeeJoin.sessionId).toBe(sessionId);
    expect(employeeJoin.meeting.MeetingId).toBe(expertJoin.meeting.MeetingId);
    expect([expertJoin.role, employeeJoin.role]).toEqual(['expert', 'employee']);
    expect(employeeJoin.participantId).not.toBe(expertJoin.participantId);
    // ExternalUserId is the participant id, never the user id (CW-R-71).
    expect(expertJoin.attendee.ExternalUserId).toBe(expertJoin.participantId);

    const sessions = await testDb.db.select().from(callSessions).where(eq(callSessions.appointmentId, APPT_NOW));
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      id: sessionId,
      orgId: ORG,
      format: 'CONSULTATION',
      status: 'ACTIVE',
      providerMeetingId: expertJoin.meeting.MeetingId,
    });
    expect(sessions[0]!.startedAt).toBeInstanceOf(Date);
    const participants = await testDb.db.select().from(callParticipants).where(eq(callParticipants.sessionId, sessionId));
    expect(participants.map((p) => [p.userId, p.role, p.providerAttendeeId]).sort()).toEqual(
      [
        ['user_jovan', 'EMPLOYEE', employeeJoin.attendee.AttendeeId],
        ['user_milica', 'EXPERT', expertJoin.attendee.AttendeeId],
      ].sort(),
    );

    const created = await testDb.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.action, 'call.session.created'), eq(auditEvents.recordId, sessionId)));
    expect(created.map((e) => e.details)).toEqual([{ sessionId, appointmentId: APPT_NOW, format: 'consultation' }]);
    const joined = await testDb.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.action, 'call.joined'), eq(auditEvents.recordId, sessionId)));
    expect(joined).toHaveLength(2);
    expect(joined.every((e) => e.category === 'SECURITY' && e.orgId === ORG)).toBe(true);

    expect(emitted('call.participant.joined').map((call) => call[0])).toEqual([`call:${sessionId}`, `call:${sessionId}`]);
  });

  // ── Viewer state (T-CW-1.5, CALL-05) ────────────────────────────────────────

  it("the appointment carries the caller's join state and the expert's pending running-late signal", async () => {
    const view = async (who: SignedIn) => {
      const res = await who.agent.get(`/api/appointments/${APPT_SIGNAL}`);
      expect(res.status).toBe(200);
      return AppointmentResponseSchema.parse(res.body);
    };
    expect((await view(jovan)).viewer).toEqual({ hasJoined: false, sessionEnded: false });

    const late = await post(milica, `/appointments/${APPT_SIGNAL}/signal`, { type: 'running_late', etaMinutes: 10 });
    expect(late.status).toBe(204);
    const pending = { type: 'running_late', etaMinutes: 10, sentAt: expect.any(String) };
    expect((await view(jovan)).viewer).toEqual({ hasJoined: false, sessionEnded: false, pendingSignal: pending });
    expect((await view(milica)).viewer).toEqual({ hasJoined: false, sessionEnded: false, pendingSignal: pending });
    // The list rows carry it as well.
    const list = await jovan.agent.get('/api/appointments');
    const row = (list.body.items as { id: string; viewer: unknown }[]).find((item) => item.id === APPT_SIGNAL);
    expect(row?.viewer).toEqual({ hasJoined: false, sessionEnded: false, pendingSignal: pending });

    // The employee joins: joined, and the signal is no longer pending.
    expect((await join(jovan, APPT_SIGNAL)).status).toBe(200);
    expect((await view(jovan)).viewer).toEqual({ hasJoined: true, sessionEnded: false });
    expect((await view(milica)).viewer).toEqual({ hasJoined: false, sessionEnded: false });
  });

  it('a rejoin returns identical credentials', async () => {
    const add = vi.spyOn(video, 'createParticipant');
    add.mockClear();
    const [expertRes, employeeRes] = [await join(milica), await join(jovan)];
    expect(expertRes.status).toBe(200);
    expect(employeeRes.status).toBe(200);
    expect(expertRes.body).toEqual(expertJoin);
    expect(employeeRes.body).toEqual(employeeJoin);
    expect(add).not.toHaveBeenCalled();
  });

  it('after a cache loss on an active session the same participant gets a new attendee', async () => {
    await kv.del(callParticipantCredentialsKey(sessionId, employeeJoin.participantId));
    const res = await join(jovan);
    expect(res.status).toBe(200);
    const again = CallJoinResponseSchema.parse(res.body);
    expect(again.participantId).toBe(employeeJoin.participantId);
    expect(again.meeting.MeetingId).toBe(employeeJoin.meeting.MeetingId);
    expect(await kv.get(callParticipantCredentialsKey(sessionId, employeeJoin.participantId))).not.toBeNull();
  });

  // ── Location (CALL-34, CW-R-80a) ────────────────────────────────────────────

  it('the expert reads the location the employee shared; the employee gets 403, everyone else 404', async () => {
    expect((await location(milica)).body).toEqual({ locationText: null });

    const shared = await join(jovan, APPT_NOW, { locationText: 'Novi Sad, at home' });
    expect(shared.status).toBe(200);
    const [row] = await testDb.db.select().from(callSessions).where(eq(callSessions.id, sessionId));
    expect(row!.locationText).toBe('Novi Sad, at home');

    const read = await location(milica);
    expect(read.status).toBe(200);
    expect(read.headers['cache-control']).toBe('no-store');
    expect(CallLocationResponseSchema.parse(read.body)).toEqual({ locationText: 'Novi Sad, at home' });

    const byEmployee = await location(jovan);
    expect(byEmployee.status).toBe(403);
    expect(byEmployee.body).toMatchObject({ status: 403, code: 'forbidden' });
    for (const who of [ivana, stefan, ana]) expectNotFound(await location(who));

    // Only the employee shares a location.
    const fromExpert = await join(milica, APPT_NOW, { locationText: 'Belgrade' });
    expect(fromExpert.status).toBe(400);
  });

  it('non-participant 404, outside the window 403 join_window_closed, canceled 409 appointment_not_joinable', async () => {
    expectNotFound(await join(ana));
    expectNotFound(await join(jovan, 'appt_missing'));

    const later = await join(jovan, APPT_LATER);
    expect(later.status).toBe(403);
    expect(later.body).toMatchObject({ status: 403, code: 'join_window_closed' });

    const canceled = await join(jovan, APPT_CANCELED);
    expect(canceled.status).toBe(409);
    expect(canceled.body).toMatchObject({ status: 409, code: 'appointment_not_joinable' });

    const anonymous = await request(app.getHttpServer()).post(`/api/appointments/${APPT_NOW}/join`).send({});
    expect(anonymous.status).toBe(401);

    // Neither refusal created a session (the seed's webinar session has no appointment, T-CW-2.1).
    const rows = await testDb.db
      .select({ appointmentId: callSessions.appointmentId })
      .from(callSessions)
      .where(eq(callSessions.format, 'CONSULTATION'));
    expect(rows.map((r) => r.appointmentId).filter((id) => id === APPT_LATER || id === APPT_CANCELED)).toEqual([]);
  });

  // ── Employer isolation golden cases (CALL-17, D-CW-30, CW-R-72) ─────────────

  it('employer-scoped principals get 404 on every call route', async () => {
    const routes = (who: SignedIn) => [
      join(who),
      post(who, `/appointments/${APPT_NOW}/end`),
      post(who, `/appointments/${APPT_NOW}/outcome`, { status: 'completed' }),
      post(who, `/appointments/${APPT_NOW}/feedback`, { score: 1 }),
      post(who, `/appointments/${APPT_NOW}/signal`, { type: 'cannot_hear' }),
      post(who, `/calls/${sessionId}/client-events`, { events: [{ eventName: 'meetingFailed' }] }),
      diagnostics(who, sessionId),
      location(who),
      post(who, `/calls/${sessionId}/problem-report`, { category: 'audio', summary: {} }),
    ];
    for (const who of [ivana, stefan]) {
      for (const res of await Promise.all(routes(who))) expectNotFound(res);
    }

    // Another employee of the organization learns nothing either.
    expectNotFound(await post(ana, `/calls/${sessionId}/client-events`, { events: [{ eventName: 'meetingFailed' }] }));
    expectNotFound(await post(ana, `/appointments/${APPT_NOW}/signal`, { type: 'cannot_hear' }));
    // The expert holds no diagnostics action, and is not in the operations context.
    expectNotFound(await diagnostics(milica, sessionId));

    const sessions = await testDb.db.select().from(callSessions).where(eq(callSessions.id, sessionId));
    expect(sessions[0]!.status).toBe('ACTIVE');
    expect(await testDb.db.select().from(callOutcomes).where(eq(callOutcomes.sessionId, sessionId))).toEqual([]);
    expect(await testDb.db.select().from(callFeedback).where(eq(callFeedback.sessionId, sessionId))).toEqual([]);
  });

  // ── Signal (CALL-05, CALL-11, CALL-19, D-CW-27) ─────────────────────────────

  it('signals go to the call room; only the expert sends running late (403 kept)', async () => {
    const hear = await post(jovan, `/appointments/${APPT_NOW}/signal`, { type: 'cannot_hear' });
    expect(hear.status).toBe(204);
    const late = await post(milica, `/appointments/${APPT_NOW}/signal`, { type: 'running_late', etaMinutes: 5 });
    expect(late.status).toBe(204);
    expect(emitted('call.signal')).toEqual([
      [`call:${sessionId}`, 'call.signal', { type: 'cannot_hear', fromRole: 'employee' }],
      [`call:${sessionId}`, 'call.signal', { type: 'running_late', etaMinutes: 5, fromRole: 'expert' }],
    ]);

    const fromEmployee = await post(jovan, `/appointments/${APPT_NOW}/signal`, { type: 'running_late' });
    expect(fromEmployee.status).toBe(403);
    expect(fromEmployee.body).toMatchObject({ status: 403, code: 'forbidden' });

    const freeText = await post(jovan, `/appointments/${APPT_NOW}/signal`, { type: 'cannot_hear', message: 'hello' });
    expect(freeText.status).toBe(400);
  });

  // ── Client events (D-CW-13, PLT-18) ─────────────────────────────────────────

  it('client events are stored for the caller participant; device labels are refused', async () => {
    const res = await post(jovan, `/calls/${sessionId}/client-events`, {
      events: [
        { eventName: 'meetingStartSucceeded', durationMs: 2100, browser: 'Chrome 130', os: 'macOS 15' },
        { eventName: 'connectionStats', metrics: { rtt: 40, jitter: 4, packetLoss: 0.01, outgoingBitrate: 800_000 } },
        { eventName: 'connectionStats', metrics: { rtt: 60, jitter: 6, packetLoss: 0.03, outgoingBitrate: 1_000_000 } },
        { eventName: 'audioInputFailed', deviceError: 'NotAllowedError' },
        { eventName: 'meetingReconnected' },
      ],
    });
    expect(res.status).toBe(204);

    const rows = await testDb.db.select().from(callClientEvents).where(eq(callClientEvents.sessionId, sessionId));
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.participantId === employeeJoin.participantId && r.orgId === ORG)).toBe(true);

    const label = await post(jovan, `/calls/${sessionId}/client-events`, {
      events: [{ eventName: 'audioInputFailed', deviceLabel: 'MacBook Pro Microphone' }],
    });
    expect(label.status).toBe(400);
    const empty = await post(jovan, `/calls/${sessionId}/client-events`, { events: [] });
    expect(empty.status).toBe(400);
    expect(await testDb.db.select().from(callClientEvents).where(eq(callClientEvents.sessionId, sessionId))).toHaveLength(5);
  });

  // ── Technical problem reports (CALL-16) ─────────────────────────────────────

  it('both participants report a technical problem; a note is refused and anyone else gets 404', async () => {
    const summary = {
      durationMs: 600_000,
      reconnectCount: 1,
      metrics: { rtt: 220, jitter: 31, packetLoss: 0.03, outgoingBitrate: 300_000 },
      browser: 'Chrome 130',
      os: 'macOS 15',
    };
    const byEmployee = await post(jovan, `/calls/${sessionId}/problem-report`, { category: 'audio', summary });
    expect(byEmployee.status).toBe(204);
    const byExpert = await post(milica, `/calls/${sessionId}/problem-report`, { category: 'connection', summary: {} });
    expect(byExpert.status).toBe(204);

    const note = await post(jovan, `/calls/${sessionId}/problem-report`, { category: 'video', summary, note: 'It froze' });
    expect(note.status).toBe(400);
    for (const who of [ivana, stefan, ana]) {
      expectNotFound(await post(who, `/calls/${sessionId}/problem-report`, { category: 'other', summary: {} }));
    }

    // Stored as client-event rows of their own kind, apart from telemetry.
    const rows = await testDb.db
      .select()
      .from(callClientEvents)
      .where(and(eq(callClientEvents.sessionId, sessionId), like(callClientEvents.eventName, 'problem_report:%')));
    expect(rows.map((r) => [r.eventName, r.participantId]).sort()).toEqual(
      [
        ['problem_report:audio', employeeJoin.participantId],
        ['problem_report:connection', expertJoin.participantId],
      ].sort(),
    );
    const audioRow = rows.find((r) => r.eventName === 'problem_report:audio')!;
    expect(audioRow).toMatchObject({ durationMs: 600_000, deviceError: null, browser: 'Chrome 130', os: 'macOS 15' });
    expect(audioRow.metrics).toEqual({ ...summary.metrics, reconnectCount: 1 });

    const reported = await testDb.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.action, 'call.problem.reported'), eq(auditEvents.recordId, sessionId)));
    expect(reported.map((e) => [e.actorUserId, e.category, e.details]).sort()).toEqual(
      [
        ['user_jovan', 'CONTENT_ACCESS', { sessionId, category: 'audio' }],
        ['user_milica', 'CONTENT_ACCESS', { sessionId, category: 'connection' }],
      ].sort(),
    );
  });

  // ── Diagnostics (PLT-05, D-CW-28, CW-R-73, CW-R-86) ─────────────────────────

  it('diagnostics need a support case for the session and return exactly the 4.7.5 fields', async () => {
    // support_operator is assigned_cases: without a SUPPORT_CASE assignment, 404.
    expectNotFound(await diagnostics(nikola, sessionId));

    await testDb.db.insert(assignments).values({
      userId: 'user_nikola',
      kind: 'SUPPORT_CASE',
      targetId: sessionId,
      assignedByUserId: 'user_nikola',
      startAt: new Date(Date.now() - MINUTE),
    });
    await app.get(PrincipalLoader).invalidateUser('user_nikola');

    const res = await diagnostics(nikola, sessionId);
    expect(res.status).toBe(200);
    const body = DiagnosticsResponseSchema.parse(res.body);
    expect(Object.keys(res.body).sort()).toEqual([...DIAGNOSTICS_RESPONSE_FIELDS].sort());
    for (const participant of res.body.participants as Record<string, unknown>[]) {
      expect(Object.keys(participant).sort()).toEqual([...DIAGNOSTICS_PARTICIPANT_FIELDS].sort());
    }
    expect(body).toMatchObject({
      sessionId,
      appointmentId: APPT_NOW,
      webinarId: null,
      status: 'active',
      provider: 'none',
      providerMeetingId: expertJoin.meeting.MeetingId,
      endedAt: null,
    });
    const employee = body.participants.find((p) => p.role === 'employee')!;
    expect(employee).toMatchObject({
      reconnectCount: 1,
      qualityMetrics: { rtt: 50, jitter: 5, packetLoss: expect.closeTo(0.02, 6), outgoingBitrate: 900_000 },
      errorCodes: ['audioInputFailed', 'NotAllowedError'],
      browser: 'Chrome 130',
      os: 'macOS 15',
    });
    // CALL-16: the problem reports, as category, time and role only; telemetry aggregates above ignore them.
    expect(body.problemReports.map((r) => [r.category, r.role])).toEqual([
      ['audio', 'employee'],
      ['connection', 'expert'],
    ]);
    for (const report of res.body.problemReports as Record<string, unknown>[]) {
      expect(Object.keys(report).sort()).toEqual([...DIAGNOSTICS_PROBLEM_REPORT_FIELDS].sort());
    }
    const text = JSON.stringify(res.body);
    for (const leak of ['user_jovan', 'user_milica', employeeJoin.participantId, 'psychological', 'fake-token-']) {
      expect(text).not.toContain(leak);
    }

    const [viewed] = await testDb.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.action, 'call.diagnostics.viewed'), eq(auditEvents.recordId, sessionId)));
    expect(viewed).toMatchObject({ category: 'CONTENT_ACCESS', actorUserId: 'user_nikola', orgId: ORG });
    expect(viewed!.details).toEqual({ sessionId, viewedByUserId: 'user_nikola' });

    expectNotFound(await diagnostics(nikola, 'session_missing'));
  });

  // ── Support queue (T-CW-1.5, CALL-16 criterion 5) ───────────────────────────

  it('support lists the problem reports across sessions with a platform-scoped grant; HR gets 404 (T-CW-1.5)', async () => {
    const queue = (who: SignedIn, query = '') => who.agent.get(`/api/ops/calls/problem-reports${query}`);
    // nikola's support_operator grant is scoped to assigned cases: the queue is a platform view.
    expectNotFound(await queue(nikola));
    expectNotFound(await queue(ivana));

    const supportTemplate = PERMISSION_TEMPLATES.find((t) => t.key === 'support_operator')!;
    await testDb.db.insert(grants).values({
      id: 'grant_test_user_nikola_support_platform',
      subjectUserId: 'user_nikola',
      templateKey: 'support_operator',
      actions: [...supportTemplate.actions],
      scopeType: 'platform',
      scopeOrgId: null,
      includeDescendants: false,
      conditions: [],
      grantedByUserId: 'user_nikola',
      validFrom: new Date('2026-01-01'),
    });
    await app.get(PrincipalLoader).invalidateUser('user_nikola', ['platform']);

    const res = await queue(nikola);
    expect(res.status).toBe(200);
    const page = ProblemReportListResponseSchema.parse(res.body);
    const ours = page.items.filter((item) => item.sessionId === sessionId);
    expect(ours.map((item) => [item.category, item.role, item.appointmentId])).toEqual([
      ['connection', 'expert', APPT_NOW],
      ['audio', 'employee', APPT_NOW],
    ]);
    expect(ours[1]!.summary).toEqual({
      durationMs: 600_000,
      reconnectCount: 1,
      metrics: { rtt: 220, jitter: 31, packetLoss: 0.03, outgoingBitrate: 300_000 },
      browser: 'Chrome 130',
      os: 'macOS 15',
    });
    const text = JSON.stringify(res.body);
    for (const leak of ['user_jovan', 'user_milica', 'Petrović', 'psychological']) expect(text).not.toContain(leak);

    const first = ProblemReportListResponseSchema.parse((await queue(nikola, `?limit=1&orgId=${ORG}`)).body);
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = ProblemReportListResponseSchema.parse(
      (await queue(nikola, `?limit=1&orgId=${ORG}&cursor=${encodeURIComponent(first.nextCursor!)}`)).body,
    );
    expect(second.items[0]!.reportedAt <= first.items[0]!.reportedAt).toBe(true);
    expect(ProblemReportListResponseSchema.parse((await queue(nikola, '?orgId=org_none')).body).items).toEqual([]);

    const pages = await testDb.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.action, 'call.diagnostics.viewed'), eq(auditEvents.recordType, 'call_problem_reports')));
    expect(pages).toHaveLength(4);
    expect(pages.every((event) => event.actorUserId === 'user_nikola' && event.category === 'CONTENT_ACCESS')).toBe(true);
  });

  // ── End (CALL-21, D-CW-09) ──────────────────────────────────────────────────

  it('only the expert ends the session; the employee gets a 403 that stays a 403', async () => {
    const byEmployee = await post(jovan, `/appointments/${APPT_NOW}/end`);
    expect(byEmployee.status).toBe(403);
    expect(byEmployee.body).toMatchObject({ status: 403, code: 'forbidden' });

    const endSession = vi.spyOn(video, 'endSession');
    endSession.mockClear();
    const res = await post(milica, `/appointments/${APPT_NOW}/end`);
    expect(res.status).toBe(204);
    expect(endSession).toHaveBeenCalledWith({ providerMeetingId: expertJoin.meeting.MeetingId });

    // The expert's DeleteMeeting raises MeetingEnded, which the applier in this process may commit first;
    // either closer announces the end exactly once, and the end stays the expert's (T-CW-1.2).
    const [session] = await testDb.db.select().from(callSessions).where(eq(callSessions.id, sessionId));
    expect(session).toMatchObject({ status: 'ENDED', endReason: 'EXPERT', locationText: null });
    expect(session!.endedAt).toBeInstanceOf(Date);
    await vi.waitFor(() =>
      expect(emitted('call.session.ended')).toEqual([
        [`call:${sessionId}`, 'call.session.ended', { sessionId, endedAt: session!.endedAt!.toISOString() }],
      ]),
    );
    expect(await kv.get(callParticipantCredentialsKey(sessionId, expertJoin.participantId))).toBeNull();
    expect(await kv.get(callParticipantCredentialsKey(sessionId, employeeJoin.participantId))).toBeNull();

    const byExpert = await testDb.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.action, 'call.ended'),
          eq(auditEvents.recordId, sessionId),
          eq(auditEvents.actorUserId, 'user_milica'),
        ),
      );
    expect(byExpert).toHaveLength(1);
    expect(byExpert[0]!.details).toMatchObject({ sessionId, endedByUserId: 'user_milica' });

    // The location is gone and no longer readable (CW-R-80a).
    const locationAfterEnd = await location(milica);
    expect(locationAfterEnd.status).toBe(409);
    expect(locationAfterEnd.body.code).toBe('appointment_not_joinable');

    // The room is closed: no rejoin.
    const rejoin = await join(jovan);
    expect(rejoin.status).toBe(409);
    expect(rejoin.body.code).toBe('appointment_not_joinable');
  });

  // ── Cancel while live (CALL-27 criteria 3 and 6) ────────────────────────────

  it('canceling during a live call ends the meeting for both and emails both participants', async () => {
    const expert = CallJoinResponseSchema.parse((await join(milica, APPT_CANCEL_LIVE)).body);
    expect((await join(jovan, APPT_CANCEL_LIVE)).status).toBe(200);
    const send = vi.spyOn(app.get(Mailer), 'send');
    send.mockClear();
    const endSession = vi.spyOn(video, 'endSession');
    endSession.mockClear();

    const res = await post(jovan, `/appointments/${APPT_CANCEL_LIVE}/cancel`);
    expect(res.status).toBe(200);
    expect(AppointmentResponseSchema.parse(res.body).status).toBe('canceled');

    // The meeting is gone at the provider and the room is told, whichever closer won.
    expect(endSession).toHaveBeenCalledWith({ providerMeetingId: expert.meeting.MeetingId });
    expect(await video.describeSession({ providerMeetingId: expert.meeting.MeetingId })).toBeNull();
    const [session] = await testDb.db.select().from(callSessions).where(eq(callSessions.id, expert.sessionId));
    expect(session).toMatchObject({ status: 'ENDED', endReason: 'EXPERT' });
    await vi.waitFor(() =>
      expect(emitted('call.session.ended').filter((call) => call[0] === `call:${expert.sessionId}`)).toHaveLength(1),
    );
    expect(await kv.get(callParticipantCredentialsKey(expert.sessionId, expert.participantId))).toBeNull();

    // Both participants are emailed, each with the calendar's cancellation.
    const mails = send.mock.calls.map((call) => call[0] as MailInput);
    expect(mails.map((m) => [m.template, m.to]).sort()).toEqual([
      ['appointment.canceled', 'user_jovan@example.com'],
      ['appointment.canceled', 'user_milica@example.com'],
    ]);

    const canceled = await testDb.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.action, 'appointment.canceled'), eq(auditEvents.recordId, APPT_CANCEL_LIVE)));
    expect(canceled.map((e) => e.details)).toEqual([{ appointmentId: APPT_CANCEL_LIVE, canceledByUserId: 'user_jovan' }]);
    const ended = await testDb.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.action, 'call.ended'),
          eq(auditEvents.recordId, expert.sessionId),
          eq(auditEvents.actorUserId, 'user_jovan'),
        ),
      );
    expect(ended).toHaveLength(1);
    expect(ended[0]!.details).toMatchObject({ sessionId: expert.sessionId, endedByUserId: 'user_jovan', cause: 'canceled' });
  });

  // ── Provider-side end (T-CW-1.2, D-CW-09, D-CW-12) ──────────────────────────

  it('a MeetingEnded from the provider closes the session, and a join inside the window opens a new meeting', async () => {
    const first = CallJoinResponseSchema.parse((await join(jovan, APPT_PROVIDER)).body);

    // Chime ends an empty meeting on its own (CORE-16): the event reaches the applier in this process.
    video.simulateEvent('MeetingEnded', first.meeting.MeetingId);
    await vi.waitFor(async () => {
      const [row] = await testDb.db.select().from(callSessions).where(eq(callSessions.id, first.sessionId));
      expect(row).toMatchObject({ status: 'ENDED', endReason: 'PROVIDER' });
    });
    await vi.waitFor(() =>
      expect(emitted('call.session.ended').filter((call) => call[0] === `call:${first.sessionId}`)).toHaveLength(1),
    );

    const res = await join(jovan, APPT_PROVIDER);
    expect(res.status).toBe(200);
    const again = CallJoinResponseSchema.parse(res.body);
    expect(again.sessionId).not.toBe(first.sessionId);
    expect(again.meeting.MeetingId).not.toBe(first.meeting.MeetingId);
    expect(again.attendee.JoinToken).not.toBe(first.attendee.JoinToken);
    expect(await kv.get(callParticipantCredentialsKey(first.sessionId, first.participantId))).toBeNull();

    const rows = await testDb.db
      .select({ id: callSessions.id, status: callSessions.status, endReason: callSessions.endReason })
      .from(callSessions)
      .where(eq(callSessions.appointmentId, APPT_PROVIDER));
    expect(rows.sort((a, b) => (a.id === first.sessionId ? -1 : b.id === first.sessionId ? 1 : 0))).toEqual([
      { id: first.sessionId, status: 'ENDED', endReason: 'PROVIDER' },
      { id: again.sessionId, status: 'ACTIVE', endReason: null },
    ]);
  });

  // ── Outcome (CALL-23, CALL-24) ──────────────────────────────────────────────

  it('the expert records the outcome; free text is refused and the employee gets 404', async () => {
    const notes = await post(milica, `/appointments/${APPT_NOW}/outcome`, { status: 'completed', notes: 'x' });
    expect(notes.status).toBe(400);
    expectNotFound(await post(jovan, `/appointments/${APPT_NOW}/outcome`, { status: 'completed' }));

    const res = await post(milica, `/appointments/${APPT_NOW}/outcome`, { status: 'completed' });
    expect(res.status).toBe(200);
    expect(AppointmentResponseSchema.parse(res.body)).toMatchObject({ id: APPT_NOW, status: 'completed' });

    const [appointment] = await testDb.db.select().from(appointments).where(eq(appointments.id, APPT_NOW));
    expect(appointment!.status).toBe('COMPLETED');
    const [outcome] = await testDb.db.select().from(callOutcomes).where(eq(callOutcomes.sessionId, sessionId));
    expect(outcome).toMatchObject({ status: 'COMPLETED', recordedByUserId: 'user_milica', orgId: ORG });
    expect(outcome!.connectionMetrics).toMatchObject({ reconnectCount: 1, rtt: 50, durationSeconds: expect.any(Number) });

    const [recorded] = await testDb.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.action, 'call.outcome.recorded'), eq(auditEvents.recordId, sessionId)));
    expect(recorded).toMatchObject({ category: 'FINANCIAL', details: { sessionId, outcomeStatus: 'completed' } });
    const [completed] = await testDb.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.action, 'appointment.completed'), eq(auditEvents.recordId, APPT_NOW)));
    expect(completed!.details).toEqual({ appointmentId: APPT_NOW });

    const again = await post(milica, `/appointments/${APPT_NOW}/outcome`, { status: 'no_show_employee' });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('appointment_not_joinable');
  });

  // ── Feedback (CALL-15) ──────────────────────────────────────────────────────

  it('the employee gives feedback once; the expert gets a 403 that stays a 403', async () => {
    const byExpert = await post(milica, `/appointments/${APPT_NOW}/feedback`, { score: 5 });
    expect(byExpert.status).toBe(403);
    expect(byExpert.body.code).toBe('forbidden');

    const res = await post(jovan, `/appointments/${APPT_NOW}/feedback`, { score: 5, comment: 'Clear and kind' });
    expect(res.status).toBe(204);
    const rows = await testDb.db.select().from(callFeedback).where(eq(callFeedback.sessionId, sessionId));
    expect(rows).toMatchObject([{ userId: 'user_jovan', score: 5, comment: 'Clear and kind', orgId: ORG }]);

    const again = await post(jovan, `/appointments/${APPT_NOW}/feedback`, { score: 1 });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('conflict');

    const [submitted] = await testDb.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.action, 'call.feedback.submitted'), eq(auditEvents.recordId, sessionId)));
    expect(submitted!.details).toEqual({ sessionId });
  });

  // ── Token and audit hygiene (CW-R-13, CW-R-33a, CW-R-69) ────────────────────

  it('no join token or location text is kept in PostgreSQL, and call audit events carry identifiers only', async () => {
    for (const table of [
      'call_sessions',
      'call_participants',
      'call_events',
      'call_client_events',
      'call_outcomes',
      'call_feedback',
      'call_consents',
      'audit_events',
    ]) {
      const { rows } = await testDb.pool.query<{ dump: string }>(
        `SELECT coalesce(string_agg(row_to_json(t)::text, ''), '') AS dump FROM ${table} t`,
      );
      expect(rows[0]!.dump, table).not.toContain('fake-token-');
      expect(rows[0]!.dump, table).not.toContain('Novi Sad');
      expect(rows[0]!.dump.toLowerCase(), table).not.toContain('jointoken');
    }

    const events = await testDb.db.select().from(auditEvents).where(like(auditEvents.action, 'call.%'));
    expect(new Set(events.map((e) => e.action))).toEqual(new Set(Object.keys(CALL_AUDIT_DETAIL_KEYS)));
    for (const event of events) {
      const keys = Object.keys(event.details as Record<string, unknown>).sort();
      expect(CALL_AUDIT_DETAIL_KEYS[event.action], `${event.action}: ${keys.join(',')}`).toContainEqual(keys);
    }
  });
});
