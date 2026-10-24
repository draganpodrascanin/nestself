/**
 * Follow-up lifecycle e2e tests (T-CW-1.9, D-CW-37, CALL-35 to CALL-38,
 * CALL-42): the expert proposes a follow-up of a completed consultation, the
 * employee confirms, suggests other windows or declines, the expert picks a
 * suggested window, and the organization's `follow_up_approval_policy`
 * decides what a confirmation does.
 *
 * Principals: `user_nikola` (operations) creates the consultations;
 * `user_milica` is the expert, `user_jovan` the employee; `user_ana` an
 * employee of the same organization who is no participant; `user_ivana` HR
 * (employer owner, hr_admin and employee templates) and `user_stefan` a team
 * manager whose employee grant is revoked, so that he is employer-scoped only.
 *
 * The room events, the emails and the reminder jobs are observed through spies
 * on `RoomEmitter.emit`, `Mailer.send` and `CallsJobSchedulerService`. Every
 * test starts with an empty throttle store: the suite makes more than ten
 * writes a minute on one route (`WRITE_THROTTLE`).
 *
 * Requires TEST_DATABASE_URL (PostgreSQL). Skipped otherwise.
 */
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ThrottlerStorage, type ThrottlerStorageService } from '@nestjs/throttler';
import { and, desc, eq } from 'drizzle-orm';
import { AppointmentResponseSchema, type AppointmentResponse } from '@nestself/contracts';
import { SAMPLE_DEV_PASSWORD, SAMPLE_EXTERNAL_IDENTITIES } from '@nestself/sample-data';
import { IdentityProviderService } from '../src/identity/identity-provider.service.js';
import type { FakeIdentityProvider } from '../src/identity/fake-identity-provider.js';
import { computeTotp } from '../src/identity/totp.js';
import { seed } from '../src/db/seed/seed-lib.js';
import {
  appointments,
  assignments,
  auditEvents,
  callSessions,
  grants,
  memberships,
  organizations,
} from '../src/db/schema/index.js';
import { FOLLOW_UP_APPROVAL, type FollowUpApprovalRequester } from '../src/appointments/follow-up-approval.js';
import { CallsJobSchedulerService } from '../src/jobs/calls-job-scheduler.service.js';
import { Mailer } from '../src/mailer/mailer.js';
import { RoomEmitter } from '../src/ws/room-emitter.js';
import { resetTestDatabase, type TestDatabase } from './db/test-database.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const shouldRun = !!TEST_DB_URL;

const ORG = 'org_sample';
const TOTP_SECRET = 'JBSWY3DPEHPK3PXP';
const STAFF = ['user_milica', 'user_nikola'];
const PEOPLE = ['user_milica', 'user_nikola', 'user_jovan', 'user_ana', 'user_ivana', 'user_stefan'];
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** A whole hour `days` from now, so every proposal is in the future whenever the suite runs. */
function at(days: number, hour = 15): Date {
  const date = new Date(Date.now() + days * DAY);
  date.setUTCHours(hour, 0, 0, 0);
  return date;
}

/** Every key a follow-up audit event may carry (guidelines 7.5). */
const AUDIT_DETAIL_KEYS = new Set([
  'appointmentId',
  'followUpOfId',
  'expertUserId',
  'confirmedByUserId',
  'declinedByUserId',
  'windowCount',
  'policy',
  'orgId',
  'orgUnitId',
]);

interface SignedIn {
  agent: request.Agent;
  csrf: string;
}

describe.skipIf(!shouldRun)('Follow-up lifecycle (e2e)', () => {
  let app: INestApplication;
  let idp: FakeIdentityProvider;
  let testDb: TestDatabase;
  const jwtSecret = randomBytes(32).toString('hex');

  let milica: SignedIn;
  let jovan: SignedIn;
  let ana: SignedIn;
  let ivana: SignedIn;
  let stefan: SignedIn;
  let nikola: SignedIn;

  let emit: MockInstance<RoomEmitter['emit']>;
  let send: MockInstance<Mailer['send']>;
  let scheduleReminders: MockInstance<CallsJobSchedulerService['scheduleReminders']>;
  let cancelJobs: MockInstance<CallsJobSchedulerService['cancelAppointmentJobs']>;
  let approvals: FollowUpApprovalRequester;

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

  const post = (who: SignedIn, path: string, body: Record<string, unknown> = {}) =>
    who.agent.post(`/api${path}`).set('X-CSRF-Token', who.csrf).send(body);

  function expectNotFound(res: request.Response) {
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ status: 404, code: 'not_found', message: 'Resource not found' });
    expect(Object.keys(res.body).sort()).toEqual(['code', 'message', 'requestId', 'status']);
  }

  function expectCode(res: request.Response, status: number, code: string) {
    expect(res.status, JSON.stringify(res.body)).toBe(status);
    expect(res.body.code).toBe(code);
  }

  /** A consultation operations created, still `confirmed`. */
  async function consultation(days: number): Promise<string> {
    const startsAt = at(days, 9);
    const res = await post(nikola, `/orgs/${ORG}/appointments`, {
      orgId: ORG,
      expertUserId: 'user_milica',
      employeeUserId: 'user_jovan',
      startsAt: startsAt.toISOString(),
      endsAt: new Date(startsAt.getTime() + 50 * 60_000).toISOString(),
      serviceCategory: 'psychological',
      timeZone: 'Europe/Belgrade',
    });
    expect(res.status).toBe(201);
    return AppointmentResponseSchema.parse(res.body).id;
  }

  /** A consultation whose expert recorded the outcome `completed`. */
  async function completed(days: number): Promise<string> {
    const id = await consultation(days);
    const outcome = await post(milica, `/appointments/${id}/outcome`, { status: 'completed' });
    expect(outcome.status).toBe(200);
    return id;
  }

  function proposalBody(days: number, overrides: Record<string, unknown> = {}) {
    return { startsAt: at(days).toISOString(), durationMinutes: 50, timeZone: 'Europe/Belgrade', ...overrides };
  }

  async function propose(originalId: string, days: number): Promise<AppointmentResponse> {
    const res = await post(milica, `/appointments/${originalId}/follow-up`, proposalBody(days));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return AppointmentResponseSchema.parse(res.body);
  }

  async function sessionIdOf(appointmentId: string): Promise<string> {
    const [row] = await testDb.db
      .select({ id: callSessions.id })
      .from(callSessions)
      .where(eq(callSessions.appointmentId, appointmentId))
      .orderBy(desc(callSessions.createdAt));
    return row!.id;
  }

  async function auditOf(action: string, recordId: string) {
    return testDb.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.action, action), eq(auditEvents.recordId, recordId)));
  }

  async function statusOf(id: string) {
    const [row] = await testDb.db.select().from(appointments).where(eq(appointments.id, id));
    return row!;
  }

  async function setPolicy(policy: 'AUTOMATIC' | 'MANAGER_APPROVAL') {
    await testDb.db.update(organizations).set({ followUpApprovalPolicy: policy }).where(eq(organizations.id, ORG));
  }

  beforeAll(async () => {
    testDb = await resetTestDatabase(TEST_DB_URL!, 'follow_up');
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

    nikola = await signInStaff('user_nikola', { kind: 'operations' });
    milica = await signInStaff('user_milica', { kind: 'expert' });
    jovan = await signInMember('user_jovan');
    ana = await signInMember('user_ana');
    ivana = await signInMember('user_ivana');
    stefan = await signInMember('user_stefan');

    emit = vi.spyOn(app.get(RoomEmitter, { strict: false }), 'emit');
    send = vi.spyOn(app.get(Mailer, { strict: false }), 'send');
    const jobs = app.get(CallsJobSchedulerService, { strict: false });
    scheduleReminders = vi.spyOn(jobs, 'scheduleReminders');
    cancelJobs = vi.spyOn(jobs, 'cancelAppointmentJobs');
    approvals = app.get<FollowUpApprovalRequester>(FOLLOW_UP_APPROVAL, { strict: false });
  }, 180_000);

  afterAll(async () => {
    vi.restoreAllMocks();
    await app?.close();
    await testDb?.close();
  });

  beforeEach(() => {
    // The in-memory store keeps the hit times apart from the counters; both go.
    const throttles = app.get<ThrottlerStorageService>(ThrottlerStorage, { strict: false });
    throttles.storage.clear();
    (throttles as unknown as { hitExpirations: Map<string, unknown> }).hitExpirations.clear();
    emit.mockClear();
    send.mockClear();
    scheduleReminders.mockClear();
    cancelJobs.mockClear();
  });

  // ── Propose (CALL-35) ──────────────────────────────────────────────────────

  it('refuses a proposal before the outcome is completed: 409 follow_up_not_allowed', async () => {
    const confirmed = await consultation(1);
    expectCode(await post(milica, `/appointments/${confirmed}/follow-up`, proposalBody(10)), 409, 'follow_up_not_allowed');

    const noShow = await consultation(2);
    expect((await post(milica, `/appointments/${noShow}/outcome`, { status: 'no_show_employee' })).status).toBe(200);
    expectCode(await post(milica, `/appointments/${noShow}/follow-up`, proposalBody(10)), 409, 'follow_up_not_allowed');

    const rows = await testDb.db.select().from(appointments).where(eq(appointments.followUpOf, confirmed));
    expect(rows).toEqual([]);
  });

  it('only the expert proposes; everybody else gets 404', async () => {
    const original = await completed(3);
    for (const who of [jovan, ana, ivana, stefan]) {
      expectNotFound(await post(who, `/appointments/${original}/follow-up`, proposalBody(10)));
    }
    expectNotFound(await post(milica, '/appointments/appt_missing/follow-up', proposalBody(10)));
  });

  it('refuses a past start, another time zone and an out-of-range duration', async () => {
    const original = await completed(4);
    const past = await post(milica, `/appointments/${original}/follow-up`, proposalBody(-1));
    expect(past.status).toBe(400);
    expect(past.body).toMatchObject({ code: 'validation', details: { field: 'startsAt' } });

    const zone = await post(milica, `/appointments/${original}/follow-up`, proposalBody(10, { timeZone: 'Europe/Budapest' }));
    expect(zone.status).toBe(400);
    expect(zone.body).toMatchObject({ code: 'validation', details: { field: 'timeZone' } });

    expect((await post(milica, `/appointments/${original}/follow-up`, proposalBody(10, { durationMinutes: 121 }))).status).toBe(400);
  });

  it('the expert proposes: a proposed follow-up, the room, the user room, the email, the reminders and the audit', async () => {
    const original = await completed(5);
    const sessionId = await sessionIdOf(original);
    const res = await post(milica, `/appointments/${original}/follow-up`, {
      ...proposalBody(12),
      note: 'free text is never stored',
    });
    expect(res.status).toBe(201);
    const followUp = AppointmentResponseSchema.parse(res.body);
    const startsAt = at(12);
    expect(followUp).toEqual({
      id: expect.any(String),
      orgId: ORG,
      expertUserId: 'user_milica',
      employeeUserId: 'user_jovan',
      startsAt: startsAt.toISOString(),
      endsAt: new Date(startsAt.getTime() + 50 * 60_000).toISOString(),
      status: 'proposed',
      serviceCategory: 'psychological',
      timeZone: 'Europe/Belgrade',
      fundingRef: null,
      followUpOf: original,
      // First names only: never a surname or an address.
      expert: { firstName: 'Milica' },
      employee: { firstName: 'Jovan' },
    });

    const row = await statusOf(followUp.id);
    expect(row).toMatchObject({ status: 'PROPOSED', suggestedWindows: null, respondedAt: null });
    expect(row.proposedAt).toBeInstanceOf(Date);

    // The expert can reach the follow-up later through its own CASE assignment.
    const caseRows = await testDb.db.select().from(assignments).where(eq(assignments.targetId, followUp.id));
    expect(caseRows).toMatchObject([{ userId: 'user_milica', kind: 'CASE', endAt: null }]);

    const payload = { appointmentId: original, followUpId: followUp.id, startsAt: followUp.startsAt, durationMinutes: 50 };
    expect(emit).toHaveBeenCalledWith(`call:${sessionId}`, 'appointment.follow_up.proposed', payload);
    expect(emit).toHaveBeenCalledWith('user:user_jovan', 'appointment.follow_up.proposed', payload);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      to: 'user_jovan@example.com',
      locale: expect.any(String),
      template: 'appointment.follow_up.proposed',
      data: {
        appointment: { id: followUp.id, startsAt: followUp.startsAt, endsAt: followUp.endsAt, timeZone: 'Europe/Belgrade' },
        appointmentUrl: expect.stringMatching(new RegExp(`/appointments/${followUp.id}$`)),
      },
    });
    expect(scheduleReminders).toHaveBeenCalledWith({ id: followUp.id, startsAt: new Date(followUp.startsAt) });

    const [event] = await auditOf('appointment.follow_up.proposed', followUp.id);
    expect(event).toMatchObject({ category: 'ADMIN', actorUserId: 'user_milica', orgId: ORG, result: 'ALLOWED' });
    expect(event!.details).toEqual({ appointmentId: followUp.id, followUpOfId: original, expertUserId: 'user_milica' });

    // CALL-42: the employee finds the proposal in the list and on the appointment page.
    const list = await jovan.agent.get('/api/appointments?status=proposed');
    expect(list.status).toBe(200);
    expect(list.body.items.map((a: AppointmentResponse) => a.id)).toContain(followUp.id);
    const detail = await jovan.agent.get(`/api/appointments/${followUp.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({
      id: followUp.id,
      status: 'proposed',
      followUpOf: original,
      expert: { firstName: 'Milica' },
      employee: { firstName: 'Jovan' },
    });

    // One open follow-up per consultation.
    expectCode(await post(milica, `/appointments/${original}/follow-up`, proposalBody(13)), 409, 'follow_up_not_allowed');
  });

  // ── Confirm (CALL-36) ──────────────────────────────────────────────────────

  it('confirm: 409 appointment_not_proposed for a non-proposed appointment; 404 for anybody but the employee', async () => {
    const original = await completed(6);
    expectCode(await post(jovan, `/appointments/${original}/confirm`), 409, 'appointment_not_proposed');

    const followUp = await propose(original, 14);
    for (const who of [milica, ana, ivana, stefan]) {
      expectNotFound(await post(who, `/appointments/${followUp.id}/confirm`));
    }
    expect((await statusOf(followUp.id)).status).toBe('PROPOSED');
  });

  it('the employee confirms under the automatic policy: confirmed, reminders, calendar emails to both, room, audit', async () => {
    const original = await completed(7);
    const sessionId = await sessionIdOf(original);
    const followUp = await propose(original, 15);
    send.mockClear();
    scheduleReminders.mockClear();

    const res = await post(jovan, `/appointments/${followUp.id}/confirm`);
    expect(res.status).toBe(200);
    expect(AppointmentResponseSchema.parse(res.body)).toMatchObject({ id: followUp.id, status: 'confirmed' });
    const row = await statusOf(followUp.id);
    expect(row.status).toBe('CONFIRMED');
    expect(row.respondedAt).toBeInstanceOf(Date);

    expect(emit).toHaveBeenCalledWith(`call:${sessionId}`, 'appointment.follow_up.confirmed', {
      appointmentId: original,
      followUpId: followUp.id,
      status: 'confirmed',
    });
    expect(scheduleReminders).toHaveBeenCalledWith({ id: followUp.id, startsAt: new Date(followUp.startsAt) });
    expect(send.mock.calls.map(([mail]) => [mail.to, mail.template])).toEqual(
      expect.arrayContaining([
        ['user_jovan@example.com', 'appointment.follow_up.confirmed'],
        ['user_milica@example.com', 'appointment.follow_up.confirmed'],
      ]),
    );
    expect(send).toHaveBeenCalledTimes(2);

    const [event] = await auditOf('appointment.confirmed', followUp.id);
    expect(event!.details).toEqual({ appointmentId: followUp.id, confirmedByUserId: 'user_jovan', policy: 'automatic' });

    expectCode(await post(jovan, `/appointments/${followUp.id}/confirm`), 409, 'appointment_not_proposed');
    expectCode(await post(jovan, `/appointments/${followUp.id}/decline`), 409, 'appointment_not_proposed');
  });

  it('manager approval without an approver fails visibly with approver_missing and leaves the proposal open', async () => {
    const original = await completed(8);
    const followUp = await propose(original, 16);
    await setPolicy('MANAGER_APPROVAL');
    try {
      send.mockClear();
      expectCode(await post(jovan, `/appointments/${followUp.id}/confirm`), 409, 'approver_missing');
      expect((await statusOf(followUp.id)).status).toBe('PROPOSED');
      expect(send).not.toHaveBeenCalled();

      const [membership] = await testDb.db
        .select()
        .from(memberships)
        .where(and(eq(memberships.userId, 'user_jovan'), eq(memberships.orgId, ORG), eq(memberships.status, 'ACTIVE')));
      const [event] = await auditOf('appointment.approval.missing_approver', followUp.id);
      expect(event).toMatchObject({ category: 'ADMIN', actorUserId: 'user_jovan', orgId: ORG });
      expect(event!.details).toEqual({ appointmentId: followUp.id, orgId: ORG, orgUnitId: membership!.orgUnitId });
      expect(await auditOf('appointment.confirmed', followUp.id)).toEqual([]);
    } finally {
      await setPolicy('AUTOMATIC');
    }
  });

  it('manager approval with an approval requester: awaiting_approval, the room says so, no calendar email yet', async () => {
    const original = await completed(9);
    const sessionId = await sessionIdOf(original);
    const followUp = await propose(original, 17);
    const request = vi.spyOn(approvals, 'request').mockResolvedValueOnce(undefined);
    await setPolicy('MANAGER_APPROVAL');
    try {
      send.mockClear();
      const res = await post(jovan, `/appointments/${followUp.id}/confirm`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: followUp.id, status: 'awaiting_approval' });
      expect(request).toHaveBeenCalledTimes(1);
      expect(request.mock.calls[0]![0]).toMatchObject({ id: followUp.id, status: 'awaiting_approval' });
      expect(emit).toHaveBeenCalledWith(`call:${sessionId}`, 'appointment.follow_up.confirmed', {
        appointmentId: original,
        followUpId: followUp.id,
        status: 'awaiting_approval',
      });
      expect(send).not.toHaveBeenCalled();
      const [event] = await auditOf('appointment.confirmed', followUp.id);
      expect(event!.details).toEqual({
        appointmentId: followUp.id,
        confirmedByUserId: 'user_jovan',
        policy: 'manager_approval',
      });
      // Still open: no second proposal.
      expectCode(await post(milica, `/appointments/${original}/follow-up`, proposalBody(18)), 409, 'follow_up_not_allowed');
    } finally {
      request.mockRestore();
      await setPolicy('AUTOMATIC');
    }
  });

  // ── Decline (CALL-38) ──────────────────────────────────────────────────────

  it('the employee declines: declined, jobs removed, the expert is told, audit; a new proposal is then allowed', async () => {
    const original = await completed(10);
    const sessionId = await sessionIdOf(original);
    const followUp = await propose(original, 19);
    for (const who of [milica, ana, ivana, stefan]) {
      expectNotFound(await post(who, `/appointments/${followUp.id}/decline`));
    }
    send.mockClear();

    const res = await post(jovan, `/appointments/${followUp.id}/decline`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: followUp.id, status: 'declined' });
    expect((await statusOf(followUp.id)).status).toBe('DECLINED');
    expect(cancelJobs).toHaveBeenCalledWith(followUp.id);
    expect(emit).toHaveBeenCalledWith(`call:${sessionId}`, 'appointment.follow_up.declined', {
      appointmentId: original,
      followUpId: followUp.id,
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toMatchObject({ to: 'user_milica@example.com', template: 'appointment.follow_up.declined' });
    const [event] = await auditOf('appointment.declined', followUp.id);
    expect(event!.details).toEqual({ appointmentId: followUp.id, declinedByUserId: 'user_jovan' });

    expect((await post(milica, `/appointments/${original}/follow-up`, proposalBody(20))).status).toBe(201);
  });

  // ── Suggest times and schedule (CALL-37) ───────────────────────────────────

  it('the employee suggests windows and the expert schedules one: confirmed at that window, emails and audit', async () => {
    const original = await completed(11);
    const sessionId = await sessionIdOf(original);
    const followUp = await propose(original, 21);
    const windows = [
      { startsAt: at(22, 9).toISOString(), endsAt: at(22, 12).toISOString() },
      { startsAt: at(23, 13).toISOString(), endsAt: at(23, 15).toISOString() },
    ];

    expectCode(
      await post(milica, `/appointments/${followUp.id}/schedule`, { selectedWindowIndex: 0 }),
      400,
      'validation',
    );
    for (const who of [milica, ana, ivana, stefan]) {
      expectNotFound(await post(who, `/appointments/${followUp.id}/suggest-times`, { windows }));
    }
    const short = await post(jovan, `/appointments/${followUp.id}/suggest-times`, {
      windows: [{ startsAt: at(22, 9).toISOString(), endsAt: new Date(at(22, 9).getTime() + 30 * 60_000).toISOString() }],
    });
    expect(short.status).toBe(400);
    expect(short.body).toMatchObject({ code: 'validation', details: { field: 'windows.0.endsAt' } });
    const past = await post(jovan, `/appointments/${followUp.id}/suggest-times`, {
      windows: [{ startsAt: at(-2, 9).toISOString(), endsAt: at(-2, 12).toISOString() }],
    });
    expect(past.status).toBe(400);
    expect(past.body).toMatchObject({ code: 'validation', details: { field: 'windows.0.startsAt' } });
    const four = await post(jovan, `/appointments/${followUp.id}/suggest-times`, {
      windows: [...windows, ...windows],
    });
    expect(four.status).toBe(400);

    const suggested = await post(jovan, `/appointments/${followUp.id}/suggest-times`, { windows });
    expect(suggested.status).toBe(200);
    expect(AppointmentResponseSchema.parse(suggested.body)).toMatchObject({
      id: followUp.id,
      status: 'proposed',
      suggestedWindows: windows,
    });
    const row = await statusOf(followUp.id);
    expect(row).toMatchObject({ status: 'PROPOSED', suggestedWindows: windows });
    expect(row.respondedAt).toBeInstanceOf(Date);
    expect(emit).toHaveBeenCalledWith(`call:${sessionId}`, 'appointment.times_suggested', {
      appointmentId: original,
      followUpId: followUp.id,
      windows,
    });
    const [suggestedEvent] = await auditOf('appointment.times_suggested', followUp.id);
    expect(suggestedEvent!.details).toEqual({ appointmentId: followUp.id, windowCount: 2 });

    // The expert reads the windows on the appointment page.
    const expertView = await milica.agent.get(`/api/appointments/${followUp.id}`);
    expect(expertView.body.suggestedWindows).toEqual(windows);

    for (const who of [jovan, ana, ivana, stefan]) {
      expectNotFound(await post(who, `/appointments/${followUp.id}/schedule`, { selectedWindowIndex: 1 }));
    }
    expectCode(await post(milica, `/appointments/${followUp.id}/schedule`, { selectedWindowIndex: 2 }), 400, 'validation');

    send.mockClear();
    const scheduled = await post(milica, `/appointments/${followUp.id}/schedule`, { selectedWindowIndex: 1 });
    expect(scheduled.status).toBe(200);
    const startsAt = new Date(windows[1]!.startsAt);
    expect(AppointmentResponseSchema.parse(scheduled.body)).toMatchObject({
      id: followUp.id,
      status: 'confirmed',
      startsAt: startsAt.toISOString(),
      endsAt: new Date(startsAt.getTime() + 50 * 60_000).toISOString(),
    });
    expect(cancelJobs).toHaveBeenCalledWith(followUp.id);
    expect(scheduleReminders).toHaveBeenLastCalledWith({ id: followUp.id, startsAt });
    expect(emit).toHaveBeenCalledWith(`call:${sessionId}`, 'appointment.follow_up.confirmed', {
      appointmentId: original,
      followUpId: followUp.id,
      status: 'confirmed',
    });
    expect(send.mock.calls.map(([mail]) => mail.template)).toEqual([
      'appointment.follow_up.confirmed',
      'appointment.follow_up.confirmed',
    ]);
    const [confirmed] = await auditOf('appointment.confirmed', followUp.id);
    expect(confirmed).toMatchObject({ actorUserId: 'user_milica' });
    expect(confirmed!.details).toEqual({ appointmentId: followUp.id, confirmedByUserId: 'user_milica', policy: 'automatic' });

    expectCode(await post(milica, `/appointments/${followUp.id}/schedule`, { selectedWindowIndex: 0 }), 409, 'appointment_not_proposed');
    expectCode(await post(jovan, `/appointments/${followUp.id}/suggest-times`, { windows }), 409, 'appointment_not_proposed');
  });

  // ── Non-disclosure and audit hygiene ───────────────────────────────────────

  it('employer-scoped principals get 404 on every follow-up route', async () => {
    const original = await completed(12);
    const followUp = await propose(original, 24);
    for (const who of [ivana, stefan]) {
      expectNotFound(await post(who, `/appointments/${original}/follow-up`, proposalBody(25)));
      expectNotFound(await post(who, `/appointments/${followUp.id}/confirm`));
      expectNotFound(await post(who, `/appointments/${followUp.id}/decline`));
      expectNotFound(
        await post(who, `/appointments/${followUp.id}/suggest-times`, {
          windows: [{ startsAt: at(25, 9).toISOString(), endsAt: at(25, 12).toISOString() }],
        }),
      );
      expectNotFound(await post(who, `/appointments/${followUp.id}/schedule`, { selectedWindowIndex: 0 }));
    }
    expect((await statusOf(followUp.id)).status).toBe('PROPOSED');
  });

  it('follow-up audit details carry identifiers only', async () => {
    const rows = await testDb.db.select().from(auditEvents);
    const followUpActions = new Set([
      'appointment.follow_up.proposed',
      'appointment.confirmed',
      'appointment.declined',
      'appointment.times_suggested',
      'appointment.approval.missing_approver',
    ]);
    const relevant = rows.filter((row) => followUpActions.has(row.action));
    expect(relevant.length).toBeGreaterThanOrEqual(5);
    for (const row of relevant) {
      for (const key of Object.keys(row.details as Record<string, unknown>)) {
        expect(AUDIT_DETAIL_KEYS.has(key), `${row.action}: ${key}`).toBe(true);
      }
    }
  });

  it('the database refuses an unknown policy and more than three suggested windows', async () => {
    await expect(
      testDb.db.update(organizations).set({ followUpApprovalPolicy: 'NOBODY' }).where(eq(organizations.id, ORG)),
    ).rejects.toThrow();
    const window = { startsAt: at(30).toISOString(), endsAt: at(30, 18).toISOString() };
    const [any] = await testDb.db.select({ id: appointments.id }).from(appointments).limit(1);
    await expect(
      testDb.db
        .update(appointments)
        .set({ suggestedWindows: [window, window, window, window] })
        .where(eq(appointments.id, any!.id)),
    ).rejects.toThrow();
  });
});
