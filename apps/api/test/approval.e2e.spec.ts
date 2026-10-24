/**
 * Follow-up approval items and the organization policy, e2e (T-CW-1.10,
 * D-CW-37, CALL-36, CALL-40, CALL-41, guidelines 7.1, 7.4 and 7.5).
 *
 * Principals: `user_nikola` (operations) creates the consultations;
 * `user_milica` is the expert, `user_jovan` the employee (unit
 * `team_product`); `user_stefan` a team manager whose employee grant is
 * revoked, so that he is employer-scoped, holding the `approver` template and
 * the approval authority of `ou_engineering` and its descendants, with
 * `user_ivana` (HR: employer owner, hr_admin, employee, and here also
 * `approver`) as the alternate; `user_ana` an approver whose authority covers
 * `team_sales` only.
 *
 * Emails, room events and jobs are observed through spies on `Mailer.send`,
 * `RoomEmitter.emit` and `CallsJobSchedulerService`. Every test starts with an
 * empty throttle store.
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
import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  APPOINTMENT_APPROVAL_ITEM_FIELDS,
  APPROVAL_FOLLOW_UP_DESCRIPTION,
  AppointmentApprovalItemSchema,
  AppointmentApprovalListResponseSchema,
  AppointmentResponseSchema,
} from '@nestself/contracts';
import { SAMPLE_DEV_PASSWORD, SAMPLE_EXTERNAL_IDENTITIES } from '@nestself/sample-data';
import { IdentityProviderService } from '../src/identity/identity-provider.service.js';
import type { FakeIdentityProvider } from '../src/identity/fake-identity-provider.js';
import { computeTotp } from '../src/identity/totp.js';
import { seed } from '../src/db/seed/seed-lib.js';
import {
  appointmentApprovals,
  appointments,
  approvalAuthorities,
  auditEvents,
  grants,
  organizations,
} from '../src/db/schema/index.js';
import { ApprovalService } from '../src/appointments/approval.service.js';
import { CallsJobSchedulerService } from '../src/jobs/calls-job-scheduler.service.js';
import { Mailer } from '../src/mailer/mailer.js';
import { PrincipalLoader } from '../src/principal/principal-loader.js';
import { CacheGateway } from '../src/principal/cache-gateway.js';
import { orgTreeKey } from '../src/redis/redis-keys.js';
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
const GRANTED_AT = new Date('2026-01-01T00:00:00.000Z');

/** Every key an approval audit event may carry (guidelines 7.5). */
const APPROVAL_AUDIT_KEYS = new Set(['approvalId', 'appointmentId', 'approverUserId']);

function at(days: number, hour = 15): Date {
  const date = new Date(Date.now() + days * DAY);
  date.setUTCHours(hour, 0, 0, 0);
  return date;
}

interface SignedIn {
  agent: request.Agent;
  csrf: string;
}

describe.skipIf(!shouldRun)('Follow-up approvals (e2e)', () => {
  let app: INestApplication;
  let idp: FakeIdentityProvider;
  let testDb: TestDatabase;
  const jwtSecret = randomBytes(32).toString('hex');

  let nikola: SignedIn;
  let milica: SignedIn;
  let jovan: SignedIn;
  let ana: SignedIn;
  let ivana: SignedIn;
  let stefan: SignedIn;

  let emit: MockInstance<RoomEmitter['emit']>;
  let send: MockInstance<Mailer['send']>;
  let scheduleReminders: MockInstance<CallsJobSchedulerService['scheduleReminders']>;
  let scheduleApprovalJobs: MockInstance<CallsJobSchedulerService['scheduleApprovalJobs']>;
  let cancelApprovalJobs: MockInstance<CallsJobSchedulerService['cancelApprovalJobs']>;
  let cancelAppointmentJobs: MockInstance<CallsJobSchedulerService['cancelAppointmentJobs']>;

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

  const post = (who: SignedIn, path: string, body: Record<string, unknown> = {}) =>
    who.agent.post(`/api${path}`).set('X-CSRF-Token', who.csrf).send(body);
  const patch = (who: SignedIn, path: string, body: Record<string, unknown>) =>
    who.agent.patch(`/api${path}`).set('X-CSRF-Token', who.csrf).send(body);
  const get = (who: SignedIn, path: string) => who.agent.get(`/api${path}`);

  function expectNotFound(res: request.Response) {
    expect(res.status, JSON.stringify(res.body)).toBe(404);
    expect(res.body).toMatchObject({ status: 404, code: 'not_found', message: 'Resource not found' });
  }

  function expectCode(res: request.Response, status: number, code: string) {
    expect(res.status, JSON.stringify(res.body)).toBe(status);
    expect(res.body.code).toBe(code);
  }

  async function auditOf(action: string, recordId: string) {
    return testDb.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.action, action), eq(auditEvents.recordId, recordId)));
  }

  async function appointmentRow(id: string) {
    const [row] = await testDb.db.select().from(appointments).where(eq(appointments.id, id));
    return row!;
  }

  async function approvalsOf(appointmentId: string) {
    return testDb.db
      .select()
      .from(appointmentApprovals)
      .where(eq(appointmentApprovals.appointmentId, appointmentId))
      .orderBy(desc(appointmentApprovals.createdAt));
  }

  async function setPolicy(policy: 'AUTOMATIC' | 'MANAGER_APPROVAL') {
    await testDb.db.update(organizations).set({ followUpApprovalPolicy: policy }).where(eq(organizations.id, ORG));
  }

  async function setSelfApprovalAllowed(allowed: boolean) {
    await testDb.db.update(organizations).set({ selfApprovalAllowed: allowed }).where(eq(organizations.id, ORG));
    const cache = app.get(CacheGateway, { strict: false });
    await cache.del(orgTreeKey(ORG));
    cache.purgeLru(orgTreeKey(ORG));
  }

  async function grantApprover(userId: string) {
    await testDb.db.insert(grants).values({
      id: `grant_test_${userId}_approver`,
      subjectUserId: userId,
      templateKey: 'approver',
      actions: ['approval.decide', 'approval.delegate'],
      scopeType: 'organization',
      scopeOrgId: ORG,
      includeDescendants: false,
      conditions: [],
      validFrom: GRANTED_AT,
      grantedByUserId: 'user_ivana',
    });
    await app.get(PrincipalLoader, { strict: false }).invalidateUser(userId, [ORG]);
  }

  async function revokeApprover(userId: string) {
    await testDb.db
      .update(grants)
      .set({ revokedAt: new Date(), revokedReason: 'test_fixture' })
      .where(eq(grants.id, `grant_test_${userId}_approver`));
    await app.get(PrincipalLoader, { strict: false }).invalidateUser(userId, [ORG]);
  }

  async function addAuthority(values: {
    id: string;
    userId: string;
    orgUnitId: string | null;
    includeDescendants?: boolean;
    alternateUserId?: string | null;
    categories?: string[];
  }) {
    await testDb.db.insert(approvalAuthorities).values({
      orgId: ORG,
      includeDescendants: false,
      categories: [],
      validFrom: GRANTED_AT,
      alternateUserId: null,
      ...values,
    });
  }

  async function setAuthority(id: string, changes: Partial<typeof approvalAuthorities.$inferInsert>) {
    await testDb.db.update(approvalAuthorities).set(changes).where(eq(approvalAuthorities.id, id));
  }

  /** A completed consultation of `user_jovan` with a proposed follow-up. */
  async function proposedFollowUp(days: number): Promise<string> {
    const startsAt = at(days, 9);
    const created = await post(nikola, `/orgs/${ORG}/appointments`, {
      orgId: ORG,
      expertUserId: 'user_milica',
      employeeUserId: 'user_jovan',
      startsAt: startsAt.toISOString(),
      endsAt: new Date(startsAt.getTime() + 50 * 60_000).toISOString(),
      serviceCategory: 'psychological',
      timeZone: 'Europe/Belgrade',
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const consultationId = AppointmentResponseSchema.parse(created.body).id;
    expect((await post(milica, `/appointments/${consultationId}/outcome`, { status: 'completed' })).status).toBe(200);
    const proposal = await post(milica, `/appointments/${consultationId}/follow-up`, {
      startsAt: at(days + 7).toISOString(),
      durationMinutes: 50,
      timeZone: 'Europe/Belgrade',
    });
    expect(proposal.status, JSON.stringify(proposal.body)).toBe(201);
    return AppointmentResponseSchema.parse(proposal.body).id;
  }

  /** A follow-up the employee confirmed under `manager_approval`, and its approval item. */
  async function awaitingApproval(days: number): Promise<{ followUpId: string; approvalId: string }> {
    const followUpId = await proposedFollowUp(days);
    await setPolicy('MANAGER_APPROVAL');
    try {
      const res = await post(jovan, `/appointments/${followUpId}/confirm`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.status).toBe('awaiting_approval');
    } finally {
      await setPolicy('AUTOMATIC');
    }
    const [item] = await approvalsOf(followUpId);
    expect(item).toBeDefined();
    return { followUpId, approvalId: item!.id };
  }

  beforeAll(async () => {
    testDb = await resetTestDatabase(TEST_DB_URL!, 'approval');
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

    // Stefan keeps team_manager only (employer-scoped) and gains the approver template.
    await testDb.db
      .update(grants)
      .set({ revokedAt: new Date('2026-01-02'), revokedReason: 'test_fixture' })
      .where(eq(grants.id, 'grant_user_stefan_employee'));
    await grantApprover('user_stefan');
    await grantApprover('user_ivana');
    await grantApprover('user_ana');
    await addAuthority({
      id: 'aa_stefan',
      userId: 'user_stefan',
      orgUnitId: 'ou_engineering',
      includeDescendants: true,
      alternateUserId: 'user_ivana',
      categories: ['consultation_follow_up'],
    });
    await addAuthority({ id: 'aa_ana_sales', userId: 'user_ana', orgUnitId: 'team_sales' });

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
    scheduleApprovalJobs = vi.spyOn(jobs, 'scheduleApprovalJobs');
    cancelApprovalJobs = vi.spyOn(jobs, 'cancelApprovalJobs');
    cancelAppointmentJobs = vi.spyOn(jobs, 'cancelAppointmentJobs');
  }, 180_000);

  afterAll(async () => {
    vi.restoreAllMocks();
    await app?.close();
    await testDb?.close();
  });

  beforeEach(() => {
    const throttles = app.get<ThrottlerStorageService>(ThrottlerStorage, { strict: false });
    throttles.storage.clear();
    (throttles as unknown as { hitExpirations: Map<string, unknown> }).hitExpirations.clear();
    emit.mockClear();
    send.mockClear();
    scheduleReminders.mockClear();
    scheduleApprovalJobs.mockClear();
    cancelApprovalJobs.mockClear();
    cancelAppointmentJobs.mockClear();
  });

  // ── Policy (CALL-41) ───────────────────────────────────────────────────────

  it('HR reads and sets the policy; the change is audited; everybody else gets 404', async () => {
    const path = `/orgs/${ORG}/settings/follow-up-approval`;
    const read = await get(ivana, path);
    expect(read.status).toBe(200);
    expect(read.body).toEqual({ policy: 'automatic' });

    const set = await patch(ivana, path, { policy: 'manager_approval' });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    expect(set.body).toEqual({ policy: 'manager_approval' });
    expect((await get(ivana, path)).body).toEqual({ policy: 'manager_approval' });
    const [org] = await testDb.db.select().from(organizations).where(eq(organizations.id, ORG));
    expect(org!.followUpApprovalPolicy).toBe('MANAGER_APPROVAL');
    const [event] = await auditOf('org.follow_up_policy.changed', ORG);
    expect(event).toMatchObject({ category: 'ADMIN', actorUserId: 'user_ivana', orgId: ORG });
    expect(event!.details).toEqual({ orgId: ORG, oldPolicy: 'automatic', newPolicy: 'manager_approval' });

    // The same value again changes nothing and audits nothing.
    expect((await patch(ivana, path, { policy: 'manager_approval' })).status).toBe(200);
    expect(await auditOf('org.follow_up_policy.changed', ORG)).toHaveLength(1);

    expect((await patch(ivana, path, { policy: 'MANAGER_APPROVAL' })).status).toBe(400);
    expect((await patch(ivana, path, { policy: 'automatic', note: 'x' })).status).toBe(400);
    for (const who of [stefan, jovan, ana]) {
      expectNotFound(await patch(who, path, { policy: 'automatic' }));
      expectNotFound(await get(who, path));
    }
    expectNotFound(await patch(milica, path, { policy: 'automatic' }));

    expect((await patch(ivana, path, { policy: 'automatic' })).body).toEqual({ policy: 'automatic' });
  });

  it('policy automatic: a confirmation creates no approval item', async () => {
    const followUpId = await proposedFollowUp(1);
    const res = await post(jovan, `/appointments/${followUpId}/confirm`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('confirmed');
    expect(await approvalsOf(followUpId)).toEqual([]);
    expect(await auditOf('appointment.approval.requested', followUpId)).toEqual([]);
  });

  // ── Request (CALL-36, guidelines 7.4) ──────────────────────────────────────

  it('manager approval routes the item to the covering authority with its alternate', async () => {
    const { followUpId, approvalId } = await awaitingApproval(2);
    expect((await appointmentRow(followUpId)).status).toBe('AWAITING_APPROVAL');
    const [item] = await approvalsOf(followUpId);
    expect(item).toMatchObject({
      id: approvalId,
      orgId: ORG,
      orgUnitId: 'team_product',
      approverUserId: 'user_stefan',
      alternateUserId: 'user_ivana',
      status: 'PENDING',
      reason: null,
      decidedAt: null,
    });
  });

  it('after the commit: the requested audit, both deciders emailed with the four facts only, both jobs scheduled', async () => {
    const { followUpId, approvalId } = await awaitingApproval(3);
    const [event] = await auditOf('appointment.approval.requested', approvalId);
    expect(event).toMatchObject({ category: 'ADMIN', actorUserId: 'user_jovan', orgId: ORG });
    expect(event!.details).toEqual({ approvalId, appointmentId: followUpId, approverUserId: 'user_stefan' });

    const requested = send.mock.calls.map((call) => call[0]).filter((mail) => mail.template === 'appointment.approval.requested');
    expect(requested.map((mail) => mail.to).sort()).toEqual(['user_ivana@example.com', 'user_stefan@example.com']);
    for (const mail of requested) {
      expect(Object.keys(mail.data).sort()).toEqual(['appointment', 'approvalsUrl', 'employeeDisplayName']);
      expect(JSON.stringify(mail.data)).not.toMatch(/psychological|user_milica|Milica/);
    }
    expect(scheduleApprovalJobs).toHaveBeenCalledTimes(1);
    const [id, deadlines] = scheduleApprovalJobs.mock.calls[0]!;
    expect(id).toBe(approvalId);
    const days = (d: Date) => Math.round((d.getTime() - Date.now()) / DAY);
    expect(days(deadlines.remindAt)).toBeGreaterThanOrEqual(5);
    expect(days(deadlines.remindAt)).toBeLessThanOrEqual(9);
    expect(days(deadlines.expireAt)).toBeGreaterThanOrEqual(12);
    expect(days(deadlines.expireAt)).toBeLessThanOrEqual(16);
  });

  it('missing approver: a visible 409, the missing approver audited, the follow-up stays proposed', async () => {
    const followUpId = await proposedFollowUp(4);
    await setAuthority('aa_stefan', { validUntil: new Date(Date.now() - DAY) });
    await setPolicy('MANAGER_APPROVAL');
    try {
      send.mockClear();
      expectCode(await post(jovan, `/appointments/${followUpId}/confirm`), 409, 'approver_missing');
      expect((await appointmentRow(followUpId)).status).toBe('PROPOSED');
      expect(await approvalsOf(followUpId)).toEqual([]);
      const [event] = await auditOf('appointment.approval.missing_approver', followUpId);
      expect(event!.details).toEqual({ appointmentId: followUpId, orgId: ORG, orgUnitId: 'team_product' });
      expect(await auditOf('appointment.approval.requested', followUpId)).toEqual([]);
      expect(send).not.toHaveBeenCalled();
    } finally {
      await setPolicy('AUTOMATIC');
      await setAuthority('aa_stefan', { validUntil: null });
    }
  });

  // ── The approver's view (CW-R-119) ─────────────────────────────────────────

  it('the approver and the alternate list the item with exactly the four facts; nobody else sees it', async () => {
    const { followUpId, approvalId } = await awaitingApproval(5);
    for (const who of [stefan, ivana]) {
      const res = await get(who, `/orgs/${ORG}/appointment-approvals`);
      expect(res.status).toBe(200);
      const list = AppointmentApprovalListResponseSchema.parse(res.body);
      const item = list.items.find((i) => i.id === approvalId)!;
      expect(item).toEqual({
        id: approvalId,
        appointmentId: followUpId,
        status: 'pending',
        employeeDisplayName: expect.any(String),
        description: APPROVAL_FOLLOW_UP_DESCRIPTION,
        startsAt: (await appointmentRow(followUpId)).startsAt.toISOString(),
        durationMinutes: 50,
      });
      for (const raw of res.body.items as Record<string, unknown>[]) {
        expect(Object.keys(raw).sort()).toEqual([...APPOINTMENT_APPROVAL_ITEM_FIELDS].sort());
      }
      expect(JSON.stringify(res.body)).not.toMatch(/psychological|user_milica|Milica|team_product/);
    }
    const anaList = await get(ana, `/orgs/${ORG}/appointment-approvals`);
    expect(anaList.status).toBe(200);
    expect(anaList.body.items).toEqual([]);
    expectNotFound(await get(jovan, `/orgs/${ORG}/appointment-approvals`));
    expectNotFound(await get(milica, `/orgs/${ORG}/appointment-approvals`));
  });

  // ── Approve and reject (CW-R-116) ──────────────────────────────────────────

  it('approve: the appointment is confirmed, reminders scheduled, both parties told, audited; a second decision is 409', async () => {
    const { followUpId, approvalId } = await awaitingApproval(6);
    send.mockClear();
    const res = await post(stefan, `/appointment-approvals/${approvalId}/approve`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(AppointmentApprovalItemSchema.parse(res.body)).toMatchObject({ id: approvalId, status: 'approved' });

    expect((await appointmentRow(followUpId)).status).toBe('CONFIRMED');
    const [item] = await approvalsOf(followUpId);
    expect(item).toMatchObject({ status: 'APPROVED', reason: null });
    expect(item!.decidedAt).toBeInstanceOf(Date);
    expect(scheduleReminders).toHaveBeenCalledWith(expect.objectContaining({ id: followUpId }));
    expect(cancelApprovalJobs).toHaveBeenCalledWith(approvalId);

    const mails = send.mock.calls.map((call) => call[0]);
    expect(mails).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          to: 'user_jovan@example.com',
          template: 'appointment.approval.decided',
          data: expect.objectContaining({ decision: 'approved' }),
        }),
        expect.objectContaining({ to: 'user_milica@example.com', template: 'appointment.follow_up.confirmed' }),
      ]),
    );
    const [event] = await auditOf('appointment.approval.approved', approvalId);
    expect(event).toMatchObject({ category: 'ADMIN', actorUserId: 'user_stefan' });
    expect(event!.details).toEqual({ approvalId, appointmentId: followUpId, approverUserId: 'user_stefan' });

    expectCode(await post(ivana, `/appointment-approvals/${approvalId}/approve`), 409, 'approval_not_pending');
    expectCode(
      await post(stefan, `/appointment-approvals/${approvalId}/reject`, { safeReason: 'Too late' }),
      409,
      'approval_not_pending',
    );
  });

  it('reject: the appointment is declined and the employee alone gets the stripped reason; never audited', async () => {
    const { followUpId, approvalId } = await awaitingApproval(7);
    expect((await post(stefan, `/appointment-approvals/${approvalId}/reject`, {})).status).toBe(400);
    expect((await post(stefan, `/appointment-approvals/${approvalId}/reject`, { safeReason: '   ' })).status).toBe(400);
    expect((await post(stefan, `/appointment-approvals/${approvalId}/reject`, { safeReason: 'x'.repeat(301) })).status).toBe(400);
    send.mockClear();

    const res = await post(ivana, `/appointment-approvals/${approvalId}/reject`, {
      safeReason: '  Not this month,\nplease ask again in December.\u0000  ',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ id: approvalId, status: 'rejected' });
    expect(JSON.stringify(res.body)).not.toContain('December');

    const reason = 'Not this month, please ask again in December.';
    expect((await appointmentRow(followUpId)).status).toBe('DECLINED');
    const [item] = await approvalsOf(followUpId);
    expect(item).toMatchObject({ status: 'REJECTED', reason });
    expect(cancelAppointmentJobs).toHaveBeenCalledWith(followUpId);
    expect(cancelApprovalJobs).toHaveBeenCalledWith(approvalId);

    const mails = send.mock.calls.map((call) => call[0]);
    const toEmployee = mails.find((mail) => mail.to === 'user_jovan@example.com');
    expect(toEmployee).toMatchObject({ template: 'appointment.approval.decided', data: { decision: 'rejected', reason } });
    const toExpert = mails.find((mail) => mail.to === 'user_milica@example.com');
    expect(toExpert).toMatchObject({ template: 'appointment.follow_up.declined' });
    expect(JSON.stringify(toExpert)).not.toContain('December');

    const [event] = await auditOf('appointment.approval.rejected', approvalId);
    expect(event!.details).toEqual({ approvalId, appointmentId: followUpId, approverUserId: 'user_ivana' });
    const all = await testDb.db.select().from(auditEvents).where(inArray(auditEvents.recordId, [approvalId, followUpId]));
    for (const row of all) {
      expect(JSON.stringify(row.details)).not.toContain('December');
      if (row.action.startsWith('appointment.approval.')) {
        for (const key of Object.keys(row.details as object)) expect(APPROVAL_AUDIT_KEYS.has(key), key).toBe(true);
      }
    }
  });

  // ── Who may decide ─────────────────────────────────────────────────────────

  it('self-approval is denied when the organization does not allow it; the alternate decides', async () => {
    await grantApprover('user_jovan');
    await addAuthority({ id: 'aa_jovan', userId: 'user_jovan', orgUnitId: 'team_product', alternateUserId: 'user_stefan' });
    try {
      const first = await awaitingApproval(8);
      const [routed] = await approvalsOf(first.followUpId);
      expect(routed).toMatchObject({ approverUserId: 'user_jovan', alternateUserId: 'user_stefan' });

      expectCode(await post(jovan, `/appointment-approvals/${first.approvalId}/approve`), 403, 'self_approval_denied');
      expect((await approvalsOf(first.followUpId))[0]!.status).toBe('PENDING');
      const [denied] = await auditOf('access.denied', first.approvalId);
      expect(denied!.details).toMatchObject({ actionAttempted: 'approval.decide', reason: 'self_approval_denied' });
      expect((await post(stefan, `/appointment-approvals/${first.approvalId}/approve`)).status).toBe(200);

      await setSelfApprovalAllowed(true);
      try {
        const second = await awaitingApproval(9);
        expect((await post(jovan, `/appointment-approvals/${second.approvalId}/approve`)).status).toBe(200);
      } finally {
        await setSelfApprovalAllowed(false);
      }
    } finally {
      await setAuthority('aa_jovan', { validUntil: new Date(Date.now() - DAY) });
      await revokeApprover('user_jovan');
    }
  });

  it('an approver outside the employee’s unit gets 404, also once the authority stops covering it', async () => {
    const { followUpId, approvalId } = await awaitingApproval(10);
    expectNotFound(await post(ana, `/appointment-approvals/${approvalId}/approve`));
    expectNotFound(await post(ana, `/appointment-approvals/${approvalId}/reject`, { safeReason: 'No' }));

    await setAuthority('aa_stefan', { orgUnitId: 'team_sales', includeDescendants: false });
    try {
      expectNotFound(await post(stefan, `/appointment-approvals/${approvalId}/approve`));
      const [denied] = await auditOf('access.denied', approvalId);
      expect(denied!.details).toMatchObject({ reason: 'approval_authority_not_covering' });
    } finally {
      await setAuthority('aa_stefan', { orgUnitId: 'ou_engineering', includeDescendants: true });
    }
    expect((await approvalsOf(followUpId))[0]!.status).toBe('PENDING');
    expectNotFound(await post(stefan, '/appointment-approvals/appr_missing/approve'));
  });

  it('an employer-scoped approver reaches their own items and nothing else about appointments', async () => {
    const { followUpId, approvalId } = await awaitingApproval(11);
    for (const who of [stefan, ivana]) {
      expectNotFound(await get(who, `/appointments/${followUpId}`));
      expectNotFound(await post(who, `/appointments/${followUpId}/confirm`));
      expectNotFound(await post(who, `/appointments/${followUpId}/decline`));
      expectNotFound(await post(who, `/appointments/${followUpId}/cancel`));
    }
    // Stefan holds no consultation.join at all: the list is not his. Ivana's lists her own appointments only.
    expectNotFound(await get(stefan, '/appointments'));
    const list = await get(ivana, '/appointments');
    expect(list.status).toBe(200);
    expect((list.body.items as { id: string }[]).map((a) => a.id)).not.toContain(followUpId);
    expect((await post(stefan, `/appointment-approvals/${approvalId}/approve`)).status).toBe(200);
  });

  // ── Jobs (CALL-40) ─────────────────────────────────────────────────────────

  it('the reminder job emails the approver and the alternate while pending, and nobody once decided', async () => {
    const { approvalId } = await awaitingApproval(12);
    const approvals = app.get(ApprovalService, { strict: false });
    send.mockClear();
    const updates: unknown[] = [];
    const result = await approvals.remindDeciders({ approvalId }, { updateData: async (data) => void updates.push(data) });
    expect(result).toEqual({ approvalId, sentTo: ['approver', 'alternate'] });
    const mails = send.mock.calls.map((call) => call[0]);
    expect(mails.map((mail) => [mail.to, mail.template])).toEqual([
      ['user_stefan@example.com', 'appointment.approval.reminder'],
      ['user_ivana@example.com', 'appointment.approval.reminder'],
    ]);
    expect(updates.at(-1)).toEqual({ approvalId, sentTo: ['approver', 'alternate'] });

    expect((await post(stefan, `/appointment-approvals/${approvalId}/approve`)).status).toBe(200);
    send.mockClear();
    expect(await approvals.remindDeciders({ approvalId }, { updateData: async () => undefined })).toMatchObject({ skipped: 'status' });
    expect(send).not.toHaveBeenCalled();
  });

  it('the expiry job expires a pending item, declines the follow-up, audits and tells the employee', async () => {
    const { followUpId, approvalId } = await awaitingApproval(13);
    const approvals = app.get(ApprovalService, { strict: false });
    send.mockClear();
    expect(await approvals.expire(approvalId)).toEqual({ approvalId, expired: true });
    expect((await approvalsOf(followUpId))[0]).toMatchObject({ status: 'EXPIRED' });
    expect((await appointmentRow(followUpId)).status).toBe('DECLINED');
    const [event] = await auditOf('appointment.approval.expired', approvalId);
    expect(event).toMatchObject({ actorKind: 'JOB', actorUserId: null });
    expect(event!.details).toEqual({ approvalId, appointmentId: followUpId });
    const toEmployee = send.mock.calls.map((call) => call[0]).find((mail) => mail.to === 'user_jovan@example.com');
    expect(toEmployee).toMatchObject({ template: 'appointment.approval.decided', data: { decision: 'expired' } });

    expect(await approvals.expire(approvalId)).toMatchObject({ skipped: 'status', expired: false });
    expectCode(await post(stefan, `/appointment-approvals/${approvalId}/approve`), 409, 'approval_not_pending');
  });
});
