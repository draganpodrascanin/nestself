/**
 * Employer-anonymous feedback cases (e2e; spec FBK-01..06, PRI-03; plan
 * Task 11).
 *
 * Jovan (employee, personal context) raises a problem through the alternate
 * route; Stefan (the primary handler) never sees it; Ivana (the alternate)
 * handles it with an internal note, a visible reply and a resolution; Jovan's
 * reply reopens it; the owner updates the routes; the hourly escalation moves
 * an overdue case from the primary to the alternate and never the other way.
 * No response, mail or audit row of the module names the reporter. Requires
 * TEST_DATABASE_URL.
 */
import 'dotenv/config';
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { and, eq, inArray } from 'drizzle-orm';
import { SAMPLE_EXTERNAL_IDENTITIES } from '@nestself/sample-data';
import { IdentityProviderService } from '../src/identity/identity-provider.service.js';
import type { FakeIdentityProvider } from '../src/identity/fake-identity-provider.js';
import { seed } from '../src/db/seed/seed-lib.js';
import { auditEvents, feedbackCases } from '../src/db/schema/index.js';
import { FeedbackEscalationService } from '../src/feedback-cases/feedback-escalation.service.js';
import { Mailer, type MailInput } from '../src/mailer/mailer.js';
import { resetTestDatabase, type TestDatabase } from './db/test-database.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const shouldRun = !!TEST_DB_URL;
const ORG = 'org_sample';
const PEOPLE = ['user_ivana', 'user_jovan', 'user_ana', 'user_stefan'];
const FIRST_BODY = 'The rota changes without notice and nobody tells us.';
const REPLY_BODY = 'Thank you. We are looking at the rota process this week.';

interface SignedIn {
  agent: request.Agent;
  csrf: string;
}

describe.skipIf(!shouldRun)('Feedback cases (e2e)', () => {
  let app: INestApplication;
  let idp: FakeIdentityProvider;
  let testDb: TestDatabase;
  let sent: MailInput[];
  let ivana: SignedIn;
  let stefan: SignedIn;
  let jovan: SignedIn;
  let ana: SignedIn;
  let routeId: string;
  let caseId: string;
  let secondId: string;

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
    testDb = await resetTestDatabase(TEST_DB_URL!, 'feedbackcases');
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
    stefan = await signInMember('user_stefan', { kind: 'organization', orgId: ORG });
    jovan = await signInMember('user_jovan', { kind: 'personal', orgId: ORG });
    ana = await signInMember('user_ana', { kind: 'personal', orgId: ORG });
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await testDb?.close();
  });

  it('shows the employee the enabled route with both recipients named by function and never by account', async () => {
    const res = await get(jovan, '/me/feedback/routes');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.feedbackEnabled).toBe(true);
    expect(res.body.sensitiveEnabled).toBe(false);
    expect(res.body.items).toHaveLength(1);
    const route = res.body.items[0];
    routeId = route.id;
    expect(route).toMatchObject({
      kind: 'standard',
      enabled: true,
      responseTargetHours: 72,
      primary: { displayName: 'Stefan Marković', functionLabel: 'primary' },
      alternate: { displayName: 'Ivana Jovanović', functionLabel: 'alternate' },
    });
    expect(route.categories).toContain('workload');
    expect(JSON.stringify(route)).not.toMatch(/user_stefan|user_ivana|@example/);
  });

  it('creates a case through the alternate route: pseudonym and receipt, an idempotent replay, the alternate mailed and the primary not', async () => {
    const before = sent.length;
    const key = randomUUID();
    const body = { routeId, kind: 'problem', category: 'workload', routeChoice: 'alternate', body: FIRST_BODY };
    const first = await post(jovan, '/me/feedback/cases', body, { 'Idempotency-Key': key });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    caseId = first.body.id;
    expect(first.body.pseudonym).toMatch(/^Reporter-[A-Z2-7]{4}$/);
    expect(first.body).toMatchObject({ state: 'submitted', handlerFunction: 'alternate' });
    expect(first.body.dueAt).toEqual(expect.any(String));

    const replay = await post(jovan, '/me/feedback/cases', body, { 'Idempotency-Key': key });
    expect(replay.status).toBe(201);
    expect(replay.body.id).toBe(caseId);
    expect(replay.headers['idempotent-replayed']).toBe('true');

    const assigned = sent.slice(before).filter((m) => m.template === 'feedback_case_assigned');
    expect(assigned).toHaveLength(1);
    expect(assigned[0]!.to).toBe('user_ivana@example.com');
    expect(sent.slice(before).some((m) => m.to === 'user_stefan@example.com')).toBe(false);
    expect(JSON.stringify(sent.slice(before))).not.toMatch(/rota|user_jovan|workload/);

    const rows = await testDb.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.action, 'feedback_case.created'), eq(auditEvents.recordId, caseId)));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actorUserId).toBeNull();
    expect(JSON.stringify(rows[0]!.details)).not.toMatch(/user_jovan|rota/);
  });

  it('the primary recipient neither reads the case nor finds it in the inbox', async () => {
    expect((await get(stefan, `/feedback/cases/${caseId}`)).status).toBe(404);
    const inbox = await get(stefan, '/feedback/inbox');
    expect(inbox.status, JSON.stringify(inbox.body)).toBe(200);
    expect(inbox.body.items).toEqual([]);
  });

  it('the alternate sees the case with no reporter identity, posts an internal note and a visible reply', async () => {
    const inbox = await get(ivana, '/feedback/inbox');
    expect(inbox.status, JSON.stringify(inbox.body)).toBe(200);
    expect(inbox.body.items).toHaveLength(1);
    expect(inbox.body.items[0]).toMatchObject({ id: caseId, state: 'submitted', routeChoice: 'alternate', overdue: false, nextAction: 'acknowledge' });

    const detail = await get(ivana, `/feedback/cases/${caseId}`);
    expect(detail.status, JSON.stringify(detail.body)).toBe(200);
    expect(JSON.stringify(detail.body)).not.toMatch(/user_jovan|reporterUserId|email|Jovan|userId"/);
    expect(detail.body.messages).toHaveLength(1);
    expect(detail.body.messages[0]).toMatchObject({ sender: 'reporter', internal: false, body: FIRST_BODY });

    const note = await post(ivana, `/feedback/cases/${caseId}/messages`, { body: 'Check with scheduling before replying.', internal: true });
    expect(note.status, JSON.stringify(note.body)).toBe(200);
    expect(note.body.state).toBe('submitted');
    expect(note.body.messages).toHaveLength(2);

    const reply = await post(ivana, `/feedback/cases/${caseId}/messages`, { body: REPLY_BODY });
    expect(reply.status).toBe(200);
    expect(reply.body.state).toBe('in_review');
    expect(reply.body.messages).toHaveLength(3);
  });

  it('the reporter reads only the visible thread; another employee gets 404', async () => {
    const mine = await get(jovan, `/me/feedback/cases/${caseId}`);
    expect(mine.status, JSON.stringify(mine.body)).toBe(200);
    expect(mine.body.messages.map((m: { body: string }) => m.body)).toEqual([FIRST_BODY, REPLY_BODY]);
    expect(JSON.stringify(mine.body)).not.toMatch(/scheduling|user_ivana|handlerUserId|orgId/);
    expect(mine.body).toMatchObject({ handlerFunction: 'alternate', routeKind: 'standard', state: 'in_review' });

    const list = await get(jovan, '/me/feedback/cases');
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({ id: caseId, state: 'in_review' });

    expect((await get(ana, `/me/feedback/cases/${caseId}`)).status).toBe(404);
    expect((await get(ana, '/me/feedback/cases')).body.items).toEqual([]);
    expect((await post(ana, `/me/feedback/cases/${caseId}/messages`, { body: 'x' })).status).toBe(404);

    const updates = sent.filter((m) => m.template === 'feedback_case_update' && m.to === 'user_jovan@example.com');
    expect(updates).toHaveLength(1);
    expect(JSON.stringify(updates)).not.toMatch(/rota|in_review/);
  });

  it('resolving needs an explanation that reaches the reporter; a reporter reply reopens the case with a due target', async () => {
    const bad = await post(ivana, `/feedback/cases/${caseId}/state`, { state: 'resolved' });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('validation');

    const ok = await post(ivana, `/feedback/cases/${caseId}/state`, { state: 'resolved', reporterExplanation: 'We agreed a two-week rota notice with the team leads.' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({ state: 'resolved', dueAt: null, nextAction: null });
    expect(ok.body.resolvedAt).toEqual(expect.any(String));

    const mine = await get(jovan, `/me/feedback/cases/${caseId}`);
    expect(mine.body.state).toBe('resolved');
    expect(mine.body.messages.at(-1).body).toContain('two-week rota notice');

    const reply = await post(jovan, `/me/feedback/cases/${caseId}/messages`, { body: 'Thanks, but it happened again on Monday.' }, { 'Idempotency-Key': randomUUID() });
    expect(reply.status, JSON.stringify(reply.body)).toBe(200);
    expect(reply.body.state).toBe('in_review');
    expect(reply.body.dueAt).toEqual(expect.any(String));

    const handler = await get(ivana, `/feedback/cases/${caseId}`);
    expect(handler.body).toMatchObject({ state: 'in_review', nextAction: 'review_reply', resolvedAt: null });

    const closeEarly = await post(ivana, `/feedback/cases/${caseId}/state`, { state: 'closed', outcomeReason: 'done' });
    expect(closeEarly.status).toBe(409);
    expect(closeEarly.body.code).toBe('invalid_state');
  });

  it('the owner reads and updates the routes; the same person twice or an unqualified alternate is refused', async () => {
    const routes = await get(ivana, `/orgs/${ORG}/feedback/routes`);
    expect(routes.status, JSON.stringify(routes.body)).toBe(200);
    expect(routes.body).toMatchObject({ feedbackEnabled: true, sensitiveAllowed: false });
    expect(routes.body.items[0]).toMatchObject({ kind: 'standard', primaryHandlerUserId: 'user_stefan', alternateHandlerUserId: 'user_ivana', enabled: true });

    const base = { kind: 'standard', categories: ['workload', 'management', 'other'], primaryHandlerUserId: 'user_stefan', alternateHandlerUserId: 'user_ivana', enabled: true, responseTargetHours: 48 };
    const same = await put(ivana, `/orgs/${ORG}/feedback/routes`, { routes: [{ ...base, alternateHandlerUserId: 'user_stefan' }] });
    expect(same.status).toBe(409);
    expect(same.body.code).toBe('same_handler');

    const unqualified = await put(ivana, `/orgs/${ORG}/feedback/routes`, { routes: [{ ...base, alternateHandlerUserId: 'user_ana' }] });
    expect(unqualified.status).toBe(409);
    expect(unqualified.body.code).toBe('handler_not_eligible');

    const sensitive = await put(ivana, `/orgs/${ORG}/feedback/routes`, {
      routes: [{ ...base, kind: 'sensitive', categories: ['safety'], operatingHours: 'Mon-Fri 9-17', escalationNote: 'Ethics line' }],
    });
    expect(sensitive.status).toBe(409);
    expect(sensitive.body.code).toBe('sensitive_not_enabled');

    const ok = await put(ivana, `/orgs/${ORG}/feedback/routes`, { routes: [base] });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.items[0]).toMatchObject({ responseTargetHours: 48, categories: ['workload', 'management', 'other'] });

    expect((await get(jovan, `/orgs/${ORG}/feedback/routes`)).status).toBe(403);
  });

  it('the hourly escalation moves an overdue case from the primary to the alternate and never the other way', async () => {
    const created = await post(
      jovan,
      '/me/feedback/cases',
      { routeId, kind: 'suggestion', category: 'management', routeChoice: 'primary', body: 'Weekly stand-ups would help.' },
      { 'Idempotency-Key': randomUUID() },
    );
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    secondId = created.body.id;
    expect((await get(stefan, `/feedback/cases/${secondId}`)).status).toBe(200);

    await testDb.db
      .update(feedbackCases)
      .set({ dueAt: new Date(Date.now() - 3_600_000) })
      .where(inArray(feedbackCases.id, [caseId, secondId]));
    const before = sent.length;
    const report = await app.get(FeedbackEscalationService).escalateOverdue();
    expect(report).toEqual({ escalated: 1, reminded: 1, failed: 0 });

    expect((await get(stefan, `/feedback/cases/${secondId}`)).status).toBe(404);
    const moved = await get(ivana, `/feedback/cases/${secondId}`);
    expect(moved.status).toBe(200);
    expect(moved.body).toMatchObject({ routeChoice: 'alternate', handlerUserId: 'user_ivana', nextAction: 'acknowledge_escalation' });
    expect(moved.body.escalatedAt).toEqual(expect.any(String));

    const first = await get(ivana, `/feedback/cases/${caseId}`);
    expect(first.body).toMatchObject({ routeChoice: 'alternate', handlerUserId: 'user_ivana' });
    expect(first.body.escalatedAt).toEqual(expect.any(String));

    const mails = sent.slice(before);
    expect(mails.filter((m) => m.template === 'feedback_case_assigned').map((m) => m.to)).toEqual(['user_ivana@example.com']);
    expect(mails.some((m) => m.to === 'user_stefan@example.com')).toBe(false);
  });

  it('reassigning to the primary is the handler\'s decision and tells the primary only', async () => {
    const before = sent.length;
    const res = await post(ivana, `/feedback/cases/${secondId}/reassign`, { to: 'primary' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ handlerUserId: 'user_stefan', routeChoice: 'primary', escalatedAt: null });
    expect((await get(stefan, `/feedback/cases/${secondId}`)).status).toBe(200);
    expect((await get(ivana, `/feedback/cases/${secondId}`)).status).toBe(404);
    const again = await post(stefan, `/feedback/cases/${secondId}/reassign`, { to: 'primary' });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('same_handler');
    const mails = sent.slice(before).filter((m) => m.template === 'feedback_case_assigned');
    expect(mails.map((m) => m.to)).toEqual(['user_stefan@example.com']);
  });

  it('no audit row of the module names the reporter and the handler read is recorded as content access', async () => {
    const rows = await testDb.db.select().from(auditEvents).where(eq(auditEvents.orgId, ORG));
    const feedback = rows.filter((r) => r.action.startsWith('feedback_'));
    expect(feedback.length).toBeGreaterThan(5);
    expect(JSON.stringify(feedback.map((r) => r.details))).not.toMatch(/user_jovan|rota|stand-ups/);
    for (const row of feedback.filter((r) => r.action === 'feedback_case.created' || r.action === 'feedback_case.reporter_replied')) {
      expect(row.actorUserId).toBeNull();
    }
    const read = feedback.find((r) => r.action === 'feedback_case.read');
    expect(read?.category).toBe('CONTENT_ACCESS');
  });
});
