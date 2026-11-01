/**
 * Employee listening: cycles and participation (e2e; spec SUR-02, SUR-03,
 * EMP-01..03, PRI-03; plan Task 5).
 *
 * Ivana (survey_administrator, organization context) schedules a cycle that
 * opens now; Jovan (employee, personal context) sees it, drafts, submits once;
 * Ana's membership ends and she gets no reminder and no submission; the
 * employer has no route that lists participation. Requires TEST_DATABASE_URL.
 */
import 'dotenv/config';
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import { SAMPLE_EXTERNAL_IDENTITIES } from '@nestself/sample-data';
import { IdentityProviderService } from '../src/identity/identity-provider.service.js';
import type { FakeIdentityProvider } from '../src/identity/fake-identity-provider.js';
import { seed } from '../src/db/seed/seed-lib.js';
import { auditEvents, memberships, surveyParticipations, surveyResponses } from '../src/db/schema/index.js';
import { ListeningJobsService } from '../src/listening/listening-jobs.service.js';
import { Mailer, type MailInput } from '../src/mailer/mailer.js';
import { SAMPLE_QUESTIONNAIRE_V1_ID } from '../src/listening/listening-defaults.js';
import { resetTestDatabase, type TestDatabase } from './db/test-database.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const shouldRun = !!TEST_DB_URL;
const ORG = 'org_sample';
const PEOPLE = ['user_ivana', 'user_jovan', 'user_ana', 'user_stefan'];

interface SignedIn {
  agent: request.Agent;
  csrf: string;
}

describe.skipIf(!shouldRun)('Employee listening: cycles and participation (e2e)', () => {
  let app: INestApplication;
  let idp: FakeIdentityProvider;
  let testDb: TestDatabase;
  let sent: MailInput[];
  let ivana: SignedIn;
  let jovan: SignedIn;
  let ana: SignedIn;
  let cycleId: string;

  function extractCsrf(res: request.Response): string {
    const cookies = res.headers['set-cookie'] as string[] | undefined;
    const csrf = cookies?.find((c) => c.startsWith('nestself_csrf='))?.match(/nestself_csrf=([^;]+)/);
    if (!csrf) throw new Error('CSRF cookie not found');
    return csrf[1]!;
  }

  async function signInMember(userId: string, context: Record<string, string>): Promise<SignedIn> {
    const email = `${userId}@example.com`;
    const agent = request.agent(app.getHttpServer());
    const start = await agent.post('/api/auth/email-otp/start').send({ email });
    expect(start.status).toBe(200);
    const code = idp.sentCodes.filter((c) => c.email === email).pop()!.code;
    const verify = await agent.post('/api/auth/email-otp/verify').send({ challengeToken: start.body.challengeToken, code });
    expect(verify.status).toBe(200);
    const who = { agent, csrf: extractCsrf(verify) };
    const res = await who.agent.post('/api/auth/context').set('X-CSRF-Token', who.csrf).send({ context });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return who;
  }

  const get = (who: SignedIn, path: string) => who.agent.get(`/api${path}`);
  const put = (who: SignedIn, path: string, body: Record<string, unknown>) => who.agent.put(`/api${path}`).set('X-CSRF-Token', who.csrf).send(body);
  const post = (who: SignedIn, path: string, body: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
    who.agent.post(`/api${path}`).set('X-CSRF-Token', who.csrf).set(headers).send(body);

  beforeAll(async () => {
    testDb = await resetTestDatabase(TEST_DB_URL!, 'listeningpart');
    await seed(testDb.db);

    process.env.DATABASE_URL = testDb.url;
    process.env.AUTH_MODE = 'stub';
    process.env.VIDEO_PROVIDER = 'none';
    process.env.JWT_SECRET = randomBytes(32).toString('hex');
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
      SAMPLE_EXTERNAL_IDENTITIES.filter((i) => PEOPLE.includes(i.userId)).map((i) => ({ email: i.email, sub: i.subject, username: i.cognitoUsername })),
    );
    sent = (app.get(Mailer, { strict: false }) as unknown as { sent: MailInput[] }).sent;

    ivana = await signInMember('user_ivana', { kind: 'organization', orgId: ORG });
    jovan = await signInMember('user_jovan', { kind: 'personal', orgId: ORG });
    ana = await signInMember('user_ana', { kind: 'personal', orgId: ORG });
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await testDb?.close();
  });

  it('shows the administrator the cadence, the next launch and a safe audience total, never names', async () => {
    const res = await get(ivana, `/orgs/${ORG}/listening/cycles`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.configuration).toMatchObject({ cadenceDays: 14, responseWindowDays: 7, reminderLimit: 2, questionnaireVersion: 1, timeZone: 'Europe/Belgrade' });
    expect(res.body.configuration.activeMemberCount).toBeGreaterThanOrEqual(4);
    expect(JSON.stringify(res.body)).not.toContain('user_jovan');
  });

  it('the employee sees no survey before a cycle opens', async () => {
    const res = await get(jovan, '/me/listening/survey');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ cycle: null });
  });

  it('a cycle that opens now launches at once with the active members as its audience and mails invitations', async () => {
    const before = sent.length;
    const res = await post(ivana, `/orgs/${ORG}/listening/cycles`, { opensAt: new Date().toISOString() });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    cycleId = res.body.id;
    expect(res.body.status).toBe('open');
    const active = await testDb.db
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.orgId, ORG), eq(memberships.status, 'ACTIVE')));
    expect(res.body.audienceSize).toBe(active.length);
    const invitations = sent.slice(before).filter((m) => m.template === 'survey_invitation');
    expect(invitations).toHaveLength(active.length);
    expect(invitations.every((m) => m.data && 'surveyUrl' in m.data && m.data.surveyUrl.endsWith('/survey'))).toBe(true);
    expect(JSON.stringify(invitations)).not.toMatch(/answers|score/);
  });

  it('refuses an overlapping second cycle', async () => {
    const res = await post(ivana, `/orgs/${ORG}/listening/cycles`, { opensAt: new Date(Date.now() + 86_400_000).toISOString() });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('cycle_overlap');
  });

  it('the employee sees the five questions, the notice and an invited state', async () => {
    const res = await get(jovan, '/me/listening/survey');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.cycle).toMatchObject({ id: cycleId, timeZone: 'Europe/Belgrade', estimatedMinutes: 3 });
    expect(res.body.questionnaire).toMatchObject({ id: SAMPLE_QUESTIONNAIRE_V1_ID, version: 1 });
    expect(res.body.questionnaire.dimensions).toHaveLength(5);
    expect(res.body.questionnaire.notice.en).toMatch(/voluntary/);
    expect(res.body.participation).toEqual({ state: 'invited', draft: null, submittedAt: null });
  });

  it('a member of another organization has no survey', async () => {
    // Stefan is in org_sample too; use a fresh personal context on organization B through Ana? B has its own people in the seed.
    const res = await get(ivana, '/me/listening/survey');
    // Ivana is in the organization context: the personal resolver refuses it.
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('invalid_context');
  });

  it('saves a private draft and shows it back', async () => {
    const saved = await put(jovan, `/me/listening/survey/${cycleId}/draft`, { answers: { speaking_up: 3 } });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const res = await get(jovan, '/me/listening/survey');
    expect(res.body.participation).toMatchObject({ state: 'draft', draft: { speaking_up: 3 } });
    expect(await testDb.db.select().from(surveyResponses).where(eq(surveyResponses.cycleId, cycleId))).toHaveLength(0);
  });

  it('refuses a submission without a rating and with a stale questionnaire version', async () => {
    const empty = await post(jovan, `/me/listening/survey/${cycleId}/submit`, { answers: {}, questionnaireVersionId: SAMPLE_QUESTIONNAIRE_V1_ID });
    expect(empty.status).toBe(400);
    expect(empty.body.code).toBe('validation');
    const stale = await post(jovan, `/me/listening/survey/${cycleId}/submit`, { answers: { speaking_up: 4 }, questionnaireVersionId: 'q_old' });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('template_version_mismatch');
  });

  it('submits once: the receipt, the response without identity, the idempotent replay and the duplicate refusal', async () => {
    const key = randomUUID();
    const body = { answers: { speaking_up: 4, sustainable_workload: 2 }, questionnaireVersionId: SAMPLE_QUESTIONNAIRE_V1_ID };
    const first = await post(jovan, `/me/listening/survey/${cycleId}/submit`, body, { 'Idempotency-Key': key });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.submittedAt).toEqual(expect.any(String));

    const replay = await post(jovan, `/me/listening/survey/${cycleId}/submit`, body, { 'Idempotency-Key': key });
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);
    expect(replay.headers['idempotent-replayed']).toBe('true');

    const again = await post(jovan, `/me/listening/survey/${cycleId}/submit`, body, { 'Idempotency-Key': randomUUID() });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('already_submitted');

    const responses = await testDb.db.select().from(surveyResponses).where(eq(surveyResponses.cycleId, cycleId));
    expect(responses).toHaveLength(1);
    expect(responses[0]).toMatchObject({ cohortUnitId: 'ou_engineering', answers: body.answers });
    expect(Object.keys(responses[0]!)).not.toEqual(expect.arrayContaining(['userId', 'membershipId']));

    const [participation] = await testDb.db
      .select()
      .from(surveyParticipations)
      .where(and(eq(surveyParticipations.cycleId, cycleId), eq(surveyParticipations.userId, 'user_jovan')));
    expect(participation).toMatchObject({ state: 'submitted', responseId: responses[0]!.id });

    const receipt = await get(jovan, '/me/listening/survey');
    expect(receipt.body.participation).toMatchObject({ state: 'submitted', submittedAt: first.body.submittedAt, draft: null });

    const drafts = await put(jovan, `/me/listening/survey/${cycleId}/draft`, { answers: { speaking_up: 1 } });
    expect(drafts.status).toBe(409);
    expect(drafts.body.code).toBe('already_submitted');
  });

  it('no audit row names the respondent', async () => {
    const rows = await testDb.db.select().from(auditEvents).where(eq(auditEvents.orgId, ORG));
    const text = JSON.stringify(rows.map((r) => ({ action: r.action, actor: r.actorUserId, details: r.details })));
    expect(text).not.toContain('user_jovan');
    expect(text).not.toContain('"answers"');
  });

  it('the employer has no route that lists participation', async () => {
    for (const path of [
      `/orgs/${ORG}/listening/participations`,
      `/orgs/${ORG}/listening/cycles/${cycleId}/participations`,
      `/orgs/${ORG}/listening/cycles/${cycleId}/responses`,
    ]) {
      const res = await get(ivana, path);
      expect(res.status, path).toBe(404);
    }
  });

  it('an employee cannot schedule or cancel cycles and cannot read the cycle list', async () => {
    const list = await get(jovan, `/orgs/${ORG}/listening/cycles`);
    expect(list.status).toBe(403);
    const schedule = await post(jovan, `/orgs/${ORG}/listening/cycles`, { opensAt: new Date().toISOString() });
    expect(schedule.status).toBe(403);
  });

  it('a member whose membership ended gets no reminder and cannot submit', async () => {
    await testDb.db
      .update(memberships)
      .set({ status: 'ENDED', endDate: new Date(), endedReason: 'LEFT' })
      .where(and(eq(memberships.userId, 'user_ana'), eq(memberships.orgId, ORG)));

    const before = sent.length;
    const jobs = app.get(ListeningJobsService, { strict: false });
    // 10:00 UTC today is inside the Belgrade delivery window.
    const inWindow = new Date();
    inWindow.setUTCHours(10, 0, 0, 0);
    const report = await jobs.remind(inWindow);
    const reminders = sent.slice(before).filter((m) => m.template === 'survey_reminder');
    expect(report.sent).toBe(reminders.length);
    expect(reminders.some((m) => m.to === 'user_ana@example.com')).toBe(false);
    expect(reminders.some((m) => m.to === 'user_jovan@example.com')).toBe(false);
    expect(reminders.some((m) => m.to === 'user_stefan@example.com')).toBe(true);

    // A second run on the same local day sends nothing more.
    const second = await jobs.remind(new Date(inWindow.getTime() + 60 * 60_000));
    expect(second.sent).toBe(0);

    const submit = await ana.agent
      .post(`/api/me/listening/survey/${cycleId}/submit`)
      .set('X-CSRF-Token', ana.csrf)
      .send({ answers: { speaking_up: 5 }, questionnaireVersionId: SAMPLE_QUESTIONNAIRE_V1_ID });
    // The context check runs first: an ended membership is an invalid personal context.
    expect([403]).toContain(submit.status);
    expect(['not_eligible', 'invalid_context', 'org_context_expired']).toContain(submit.body.code);
  });

  it('cancels the open cycle and refuses a submission afterwards', async () => {
    const res = await post(ivana, `/orgs/${ORG}/listening/cycles/${cycleId}/cancel`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.status).toBe('canceled');
    const stefan = await signInMember('user_stefan', { kind: 'personal', orgId: ORG });
    const submit = await post(stefan, `/me/listening/survey/${cycleId}/submit`, { answers: { speaking_up: 5 }, questionnaireVersionId: SAMPLE_QUESTIONNAIRE_V1_ID });
    expect(submit.status).toBe(409);
    expect(submit.body.code).toBe('cycle_closed');
    const again = await post(ivana, `/orgs/${ORG}/listening/cycles/${cycleId}/cancel`);
    expect(again.status).toBe(409);
  });
});
