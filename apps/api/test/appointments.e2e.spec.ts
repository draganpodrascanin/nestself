/**
 * Appointment spine e2e tests (T-CW-0.6, NS-CALLS-01): create, list, read and
 * cancel over HTTP, with the authorization golden cases of guidelines 7.1 and
 * CALL-17 (employer-scoped principals get 404 on every appointment route).
 *
 * Principals: `user_jovan` is the employee, `user_milica` the expert (she
 * also gets an `org_sample` membership and an ad hoc organization-scoped
 * `appointment.propose` grant, because `POST /orgs/:orgId/appointments`
 * resolves the organization from the active context and no template reaches
 * it), `user_ana` a non-participant employee, `user_ivana` HR (employer
 * owner, hr_admin and employee templates), `user_stefan` a team manager whose
 * employee grant is revoked so that he is employer-scoped only, and
 * `user_nikola` operations (client_operations with a CLIENT assignment to
 * `org_sample`).
 *
 * Requires TEST_DATABASE_URL (PostgreSQL). Skipped otherwise.
 */
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { and, eq, inArray, like } from 'drizzle-orm';
import { AppointmentListResponseSchema, AppointmentResponseSchema } from '@nestself/contracts';
import { SAMPLE_DEV_PASSWORD, SAMPLE_EXTERNAL_IDENTITIES } from '@nestself/sample-data';
import { IdentityProviderService } from '../src/identity/identity-provider.service.js';
import type { FakeIdentityProvider } from '../src/identity/fake-identity-provider.js';
import { computeTotp } from '../src/identity/totp.js';
import { PrincipalLoader } from '../src/principal/principal-loader.js';
import { seed } from '../src/db/seed/seed-lib.js';
import {
  appointments,
  assignments,
  auditEvents,
  grants,
  memberships,
  organizations,
} from '../src/db/schema/index.js';
import { resetTestDatabase, type TestDatabase } from './db/test-database.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const shouldRun = !!TEST_DB_URL;

const ORG = 'org_sample';
const OTHER_ORG = 'org_appointments_other';
const CREATE = `/api/orgs/${ORG}/appointments`;
const LIST = '/api/appointments';
/** Fixed TOTP secret for the staff and expert users of this suite (base32). */
const TOTP_SECRET = 'JBSWY3DPEHPK3PXP';
const STAFF = ['user_milica', 'user_nikola'];
const PEOPLE = ['user_milica', 'user_nikola', 'user_jovan', 'user_ana', 'user_ivana', 'user_stefan'];
/** Inserted directly: proposing follow-ups is T-CW-1.9. */
const PROPOSED_ID = 'appt_test_proposed';
const OTHER_ORG_ID = 'appt_test_other_org';

const SLOT = { startsAt: '2026-11-10T15:00:00.000Z', endsAt: '2026-11-10T15:50:00.000Z' };
const FOLLOW_UP_SLOT = { startsAt: '2026-11-24T15:00:00.000Z', endsAt: '2026-11-24T15:50:00.000Z' };

/** Every key an appointment audit event may carry (guidelines 7.5). */
const AUDIT_DETAIL_KEYS = new Set([
  'appointmentId',
  'orgId',
  'expertUserId',
  'employeeUserId',
  'format',
  'canceledByUserId',
]);

function createBody(overrides: Record<string, unknown> = {}) {
  return {
    orgId: ORG,
    expertUserId: 'user_milica',
    employeeUserId: 'user_jovan',
    ...SLOT,
    serviceCategory: 'psychological',
    timeZone: 'Europe/Belgrade',
    ...overrides,
  };
}

interface SignedIn {
  agent: request.Agent;
  csrf: string;
}

describe.skipIf(!shouldRun)('Appointment spine (e2e)', () => {
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
  let confirmedId: string;

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

  const create = (who: SignedIn, body: Record<string, unknown>, path = CREATE) =>
    who.agent.post(path).set('X-CSRF-Token', who.csrf).send(body);
  const cancel = (who: SignedIn, id: string) =>
    who.agent.post(`/api/appointments/${id}/cancel`).set('X-CSRF-Token', who.csrf).send({});
  const listIds = async (who: SignedIn, query = '') => {
    const res = await who.agent.get(`${LIST}${query}`);
    expect(res.status).toBe(200);
    return AppointmentListResponseSchema.parse(res.body).items.map((a) => a.id);
  };

  /** A 404 that tells the caller nothing about the appointment: the bare error envelope. */
  function expectNotFound(res: request.Response) {
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ status: 404, code: 'not_found', message: 'Resource not found' });
    expect(Object.keys(res.body).sort()).toEqual(['code', 'message', 'requestId', 'status']);
  }

  beforeAll(async () => {
    testDb = await resetTestDatabase(TEST_DB_URL!, 'appointments');
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
    idp.seedUsers(
      SAMPLE_EXTERNAL_IDENTITIES.filter((i) => PEOPLE.includes(i.userId)).map((i) => ({
        email: i.email,
        sub: i.subject,
        username: i.cognitoUsername,
        ...(STAFF.includes(i.userId)
          ? { password: SAMPLE_DEV_PASSWORD, totpSecret: TOTP_SECRET, totpEnrolled: true }
          : {}),
      })),
    );

    // A second organization nobody in this suite is assigned to.
    await testDb.db.insert(organizations).values({ id: OTHER_ORG, name: 'Other (fixture)', slug: 'appointments-other' });

    // The expert in the client organization's context: a membership and an
    // ad hoc organization-scoped appointment.propose grant (see header).
    await testDb.db.insert(memberships).values({
      userId: 'user_milica',
      orgId: ORG,
      status: 'ACTIVE',
      startDate: new Date('2026-01-01'),
    });
    await testDb.db.insert(grants).values({
      id: 'grant_test_milica_appointment_propose',
      subjectUserId: 'user_milica',
      templateKey: null,
      actions: ['appointment.propose'],
      scopeType: 'organization',
      scopeOrgId: ORG,
      scopeOrgUnitId: null,
      includeDescendants: false,
      grantedByUserId: 'user_ivana',
      grantedAt: new Date('2026-01-01'),
      validFrom: new Date('2026-01-01'),
    });

    // Stefan keeps team_manager only: an employer-scoped principal.
    await testDb.db
      .update(grants)
      .set({ revokedAt: new Date('2026-01-02'), revokedReason: 'test_fixture' })
      .where(eq(grants.id, 'grant_user_stefan_employee'));

    milica = await signInStaff('user_milica', { kind: 'organization', orgId: ORG });
    nikola = await signInStaff('user_nikola', { kind: 'operations' });
    jovan = await signInMember('user_jovan');
    ana = await signInMember('user_ana');
    ivana = await signInMember('user_ivana');
    stefan = await signInMember('user_stefan');
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await testDb?.close();
  });

  // ── Create (CALL-26) ─────────────────────────────────────────────────────

  it('the expert creates a confirmed appointment for an employee of the organization', async () => {
    const res = await create(milica, createBody());
    expect(res.status).toBe(201);
    const body = AppointmentResponseSchema.parse(res.body);
    expect(body).toEqual({
      id: expect.any(String),
      orgId: ORG,
      expertUserId: 'user_milica',
      employeeUserId: 'user_jovan',
      ...SLOT,
      status: 'confirmed',
      serviceCategory: 'psychological',
      timeZone: 'Europe/Belgrade',
      fundingRef: null,
      followUpOf: null,
    });
    confirmedId = body.id;

    // PostgreSQL stores the UPPER_CASE spelling (CW-R-19a).
    const [row] = await testDb.db.select().from(appointments).where(eq(appointments.id, confirmedId));
    expect(row!.status).toBe('CONFIRMED');

    const [event] = await testDb.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.action, 'appointment.created'), eq(auditEvents.recordId, confirmedId)));
    expect(event).toMatchObject({
      category: 'ADMIN',
      actorUserId: 'user_milica',
      orgId: ORG,
      recordType: 'appointment',
      result: 'ALLOWED',
    });
    expect(event!.details).toEqual({
      appointmentId: confirmedId,
      orgId: ORG,
      expertUserId: 'user_milica',
      employeeUserId: 'user_jovan',
      format: 'consultation',
    });

    // The expert reaches the appointment through her assigned_cases grant.
    const rows = await testDb.db.select().from(assignments).where(eq(assignments.targetId, confirmedId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: 'user_milica', kind: 'CASE', endAt: null });
  });

  it('refuses invalid appointments and creates nothing', async () => {
    const reversed = await create(milica, createBody({ startsAt: SLOT.endsAt, endsAt: SLOT.startsAt }));
    expect(reversed.status).toBe(400);
    expect(reversed.body.code).toBe('validation');

    const lowerCaseZone = await create(milica, createBody({ timeZone: 'europe/belgrade' }));
    expect(lowerCaseZone.status).toBe(400);

    const otherOrgInBody = await create(milica, createBody({ orgId: OTHER_ORG }));
    expect(otherOrgInBody.status).toBe(400);
    expect(otherOrgInBody.body).toMatchObject({ code: 'validation', details: { field: 'orgId' } });

    const notMember = await create(milica, createBody({ employeeUserId: 'user_nikola' }));
    expect(notMember.status).toBe(409);
    expect(notMember.body).toMatchObject({ code: 'subject_not_member', details: { field: 'employeeUserId' } });

    // Ana holds consultation.join through the employee template (own scope),
    // which never reaches somebody else's appointment.
    const notAnExpert = await create(milica, createBody({ expertUserId: 'user_ana' }));
    expect(notAnExpert.status).toBe(400);
    expect(notAnExpert.body).toMatchObject({ code: 'validation', details: { field: 'expertUserId' } });

    const rows = await testDb.db.select({ id: appointments.id }).from(appointments);
    expect(rows.map((r) => r.id)).toEqual([confirmedId]);
  });

  // ── Read (CALL-18, CALL-42) ──────────────────────────────────────────────

  it('both participants list and read the appointment; others get 404', async () => {
    expect(await listIds(jovan)).toEqual([confirmedId]);

    await switchContext(milica, { kind: 'expert' });
    expect(await listIds(milica)).toEqual([confirmedId]);

    // Another employee holds consultation.join but has no appointments.
    expect(await listIds(ana)).toEqual([]);

    for (const who of [jovan, milica]) {
      const res = await who.agent.get(`${LIST}/${confirmedId}`);
      expect(res.status).toBe(200);
      expect(AppointmentResponseSchema.parse(res.body)).toMatchObject({ id: confirmedId, status: 'confirmed' });
    }

    expectNotFound(await ana.agent.get(`${LIST}/${confirmedId}`));
    expectNotFound(await jovan.agent.get(`${LIST}/appt_missing`));

    const anonymous = await request(app.getHttpServer()).get(`${LIST}/${confirmedId}`);
    expect(anonymous.status).toBe(401);
    expect((await request(app.getHttpServer()).get(LIST)).status).toBe(401);
  });

  it('a proposed follow-up shows in the list for both participants (CALL-42)', async () => {
    await testDb.db.insert(appointments).values({
      id: PROPOSED_ID,
      orgId: ORG,
      expertUserId: 'user_milica',
      employeeUserId: 'user_jovan',
      startsAt: new Date(FOLLOW_UP_SLOT.startsAt),
      endsAt: new Date(FOLLOW_UP_SLOT.endsAt),
      status: 'PROPOSED',
      serviceCategory: 'psychological',
      timeZone: 'Europe/Belgrade',
      followUpOf: confirmedId,
    });
    await testDb.db.insert(assignments).values({
      userId: 'user_milica',
      kind: 'CASE',
      targetId: PROPOSED_ID,
      assignedByUserId: 'user_milica',
      startAt: new Date('2026-01-01'),
    });
    await app.get(PrincipalLoader).invalidateUser('user_milica');

    for (const who of [jovan, milica]) {
      const res = await who.agent.get(LIST);
      expect(res.status).toBe(200);
      const items = AppointmentListResponseSchema.parse(res.body).items;
      expect(items.map((a) => [a.id, a.status, a.followUpOf])).toEqual([
        [confirmedId, 'confirmed', null],
        [PROPOSED_ID, 'proposed', confirmedId],
      ]);
      expect(await listIds(who, '?status=proposed')).toEqual([PROPOSED_ID]);
    }
  });

  // ── Employer isolation golden cases (CALL-17, D-CW-30) ──────────────────

  it('employer-scoped principals get 404 on every appointment route', async () => {
    // GET /appointments: Stefan holds team_manager only.
    expectNotFound(await stefan.agent.get(LIST));
    // Ivana also holds the employee template: she sees her own appointments, none of Jovan's.
    expect(await listIds(ivana)).toEqual([]);
    expect(await listIds(ivana, `?orgId=${ORG}`)).toEqual([]);

    for (const who of [ivana, stefan]) {
      // GET /appointments/:id
      expectNotFound(await who.agent.get(`${LIST}/${confirmedId}`));
      // POST /orgs/:orgId/appointments
      expectNotFound(await create(who, createBody()));
      // POST /appointments/:id/cancel
      expectNotFound(await cancel(who, confirmedId));
    }

    const denied = await testDb.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.action, 'access.denied'), eq(auditEvents.actorUserId, 'user_ivana')));
    expect(denied.map((e) => (e.details as { actionAttempted: string }).actionAttempted).sort()).toEqual([
      'appointment.cancel',
      'appointment.propose',
      'consultation.join',
    ]);

    const [row] = await testDb.db.select().from(appointments).where(eq(appointments.id, confirmedId));
    expect(row!.status).toBe('CONFIRMED');
  });

  // ── Cancel (CALL-27, CALL-30) ────────────────────────────────────────────

  it('only the employee cancels, and only a confirmed appointment', async () => {
    // The expert template holds no appointment.cancel; another employee is not a participant.
    expectNotFound(await cancel(milica, confirmedId));
    expectNotFound(await cancel(ana, confirmedId));

    const res = await cancel(jovan, confirmedId);
    expect(res.status).toBe(200);
    expect(AppointmentResponseSchema.parse(res.body)).toMatchObject({ id: confirmedId, status: 'canceled' });

    const [event] = await testDb.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.action, 'appointment.canceled'), eq(auditEvents.recordId, confirmedId)));
    expect(event).toMatchObject({ category: 'ADMIN', actorUserId: 'user_jovan', orgId: ORG });
    expect(event!.details).toEqual({ appointmentId: confirmedId, canceledByUserId: 'user_jovan' });

    const again = await cancel(jovan, confirmedId);
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('appointment_not_joinable');

    const proposed = await cancel(jovan, PROPOSED_ID);
    expect(proposed.status).toBe(409);
    expect(proposed.body.code).toBe('appointment_not_joinable');

    const rows = await testDb.db
      .select({ id: appointments.id, status: appointments.status })
      .from(appointments)
      .where(inArray(appointments.id, [confirmedId, PROPOSED_ID]))
      .orderBy(appointments.startsAt);
    expect(rows).toEqual([
      { id: confirmedId, status: 'CANCELED' },
      { id: PROPOSED_ID, status: 'PROPOSED' },
    ]);
    const canceledEvents = await testDb.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'appointment.canceled'));
    expect(canceledEvents).toHaveLength(1);
  });

  // ── Operations listing (CALL-28) ─────────────────────────────────────────

  it('operations list the appointments of their assigned organizations with filters', async () => {
    await testDb.db.insert(appointments).values({
      id: OTHER_ORG_ID,
      orgId: OTHER_ORG,
      expertUserId: 'user_milica',
      employeeUserId: 'user_ana',
      startsAt: new Date(SLOT.startsAt),
      endsAt: new Date(SLOT.endsAt),
      serviceCategory: 'legal',
    });

    expect(await listIds(nikola)).toEqual([confirmedId, PROPOSED_ID]);
    expect(await listIds(nikola, '?status=canceled')).toEqual([confirmedId]);
    expect(await listIds(nikola, `?orgId=${ORG}&from=2026-11-20T00:00:00.000Z`)).toEqual([PROPOSED_ID]);
    expect(await listIds(nikola, `?to=2026-11-20T00:00:00.000Z`)).toEqual([confirmedId]);

    // No CLIENT assignment to the other organization.
    const other = await nikola.agent.get(`${LIST}?orgId=${OTHER_ORG}`);
    expectNotFound(other);

    const bogus = await nikola.agent.get(`${LIST}?status=bogus`);
    expect(bogus.status).toBe(400);
  });

  // ── Audit hygiene (CW-R-33a) ─────────────────────────────────────────────

  it('appointment audit events carry identifiers only', async () => {
    const events = await testDb.db.select().from(auditEvents).where(like(auditEvents.action, 'appointment.%'));
    expect(events.length).toBeGreaterThanOrEqual(2);
    for (const event of events) {
      for (const key of Object.keys(event.details as Record<string, unknown>)) {
        expect(AUDIT_DETAIL_KEYS.has(key), `${event.action}: ${key}`).toBe(true);
      }
    }
  });
});
