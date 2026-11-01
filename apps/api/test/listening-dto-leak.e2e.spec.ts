/**
 * Employee listening disclosure scan (TST-R-05 for ADR 0002; spec PRI-01..04,
 * section 14): every JSON answer of the listening, feedback and workplace
 * review routes is walked for keys that must never leave the API on that
 * surface: account ids, membership and response ids, raw answers, counts
 * below the aggregate, email addresses and the reporter's identity. The
 * journey is the module's own (a published red cycle, a feedback case through
 * the alternate route, a request scoped, accepted, booked, shared and
 * reported) so that every view type is produced at least once. Requires
 * TEST_DATABASE_URL.
 */
import 'dotenv/config';
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { SAMPLE_DEV_PASSWORD, SAMPLE_EXTERNAL_IDENTITIES } from '@nestself/sample-data';
import { IdentityProviderService } from '../src/identity/identity-provider.service.js';
import type { FakeIdentityProvider } from '../src/identity/fake-identity-provider.js';
import { computeTotp } from '../src/identity/totp.js';
import { seed } from '../src/db/seed/seed-lib.js';
import { grants, surveyCycles, surveyResponses, surveySnapshots } from '../src/db/schema/index.js';
import { PrincipalLoader } from '../src/principal/principal-loader.js';
import { ListeningJobsService } from '../src/listening/listening-jobs.service.js';
import { SAMPLE_QUESTIONNAIRE_V1_ID } from '../src/listening/listening-defaults.js';
import { resetTestDatabase, type TestDatabase } from './db/test-database.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const shouldRun = !!TEST_DB_URL;
const TOTP_SECRET = 'JBSWY3DPEHPK3PXP';
const ORG = 'org_sample';
const PEOPLE = ['user_ivana', 'user_jovan', 'user_nikola', 'user_milica', 'user_stefan'];
const STAFF = ['user_nikola', 'user_milica'];
const ENGINEERING = 'ou_engineering';

/** Never on any listening, feedback or review surface. */
const GLOBAL_FORBIDDEN = new Set([
  'userId',
  'membershipId',
  'responseId',
  'participationId',
  'cohortUnitId',
  'answers',
  'validCount',
  'favorableCount',
  'unfavorableCount',
  'neutralCount',
  'reporterUserId',
  'requesterUserId',
  'reviewerUserId',
  'createdByUserId',
  'authorUserId',
  'email',
  'emailNormalised',
  'ipHash',
]);
/** Employer-facing review views: the coordinator's account and the reviewer's notes stay on the NestSelf side. */
const EMPLOYER_REVIEW_FORBIDDEN = new Set([...GLOBAL_FORBIDDEN, 'coordinatorUserId', 'notes', 'noteBody', 'internal']);
/** The reporter's own views: the handler's account and the internal flag of handler notes stay on the handler side. */
const REPORTER_FORBIDDEN = new Set([...GLOBAL_FORBIDDEN, 'handlerUserId', 'primaryHandlerUserId', 'alternateHandlerUserId']);
/** The coordinator's reviewer picker is the one surface that names accounts: staff choosing staff. */
const CANDIDATES_FORBIDDEN = new Set([...GLOBAL_FORBIDDEN].filter((k) => k !== 'userId'));

/** Every forbidden key in the tree, with its path. */
export function leaks(value: unknown, forbidden: ReadonlySet<string>, path = '$'): string[] {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap((item, i) => leaks(item, forbidden, `${path}[${i}]`));
  const found: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (forbidden.has(key)) found.push(`${path}.${key}`);
    found.push(...leaks(child, forbidden, `${path}.${key}`));
  }
  return found;
}

interface SignedIn {
  agent: request.Agent;
  csrf: string;
}

const PARAGRAPH = (text: string) => ({ type: 'doc', schemaVersion: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

describe.skipIf(!shouldRun)('Employee listening disclosure scan (e2e)', () => {
  let app: INestApplication;
  let idp: FakeIdentityProvider;
  let testDb: TestDatabase;
  let ivana: SignedIn;
  let jovan: SignedIn;
  let stefan: SignedIn;
  let nikola: SignedIn;
  let milica: SignedIn;
  let cycleId: string;
  let snapshotId: string;
  let routeId: string;
  let caseId: string;
  let requestId: string;
  let scopeId: string;
  let engagementId: string;

  function extractCsrf(res: request.Response): string {
    const cookies = res.headers['set-cookie'] as string[] | undefined;
    const csrf = cookies?.find((c) => c.startsWith('nestself_csrf='))?.match(/nestself_csrf=([^;]+)/);
    if (!csrf) throw new Error('CSRF cookie not found');
    return csrf[1]!;
  }

  async function switchContext(who: SignedIn, context: Record<string, string>) {
    const res = await who.agent.post('/api/auth/context').set('X-CSRF-Token', who.csrf).send({ context });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  }

  async function signInStaff(userId: string, context: Record<string, string>): Promise<SignedIn> {
    const agent = request.agent(app.getHttpServer());
    const pw = await agent.post('/api/auth/password').send({ email: `${userId}@example.com`, password: SAMPLE_DEV_PASSWORD });
    expect(pw.status).toBe(200);
    const totp = await agent.post('/api/auth/challenge').send({ challengeToken: pw.body.challengeToken, response: computeTotp(TOTP_SECRET) });
    expect(totp.status).toBe(200);
    const who = { agent, csrf: extractCsrf(totp) };
    await switchContext(who, context);
    return who;
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
    await switchContext(who, context);
    return who;
  }

  const get = (who: SignedIn, path: string) => who.agent.get(`/api${path}`);
  const post = (who: SignedIn, path: string, body: Record<string, unknown> = {}) =>
    who.agent.post(`/api${path}`).set('X-CSRF-Token', who.csrf).set('Idempotency-Key', randomUUID()).send(body);
  const put = (who: SignedIn, path: string, body: Record<string, unknown>) => who.agent.put(`/api${path}`).set('X-CSRF-Token', who.csrf).send(body);

  /** Asserts the status and that the body carries none of the forbidden keys. */
  function clean(res: request.Response, status: number, forbidden: ReadonlySet<string> = GLOBAL_FORBIDDEN): Record<string, unknown> {
    expect(res.status, JSON.stringify(res.body)).toBe(status);
    expect(leaks(res.body, forbidden)).toEqual([]);
    return res.body as Record<string, unknown>;
  }

  beforeAll(async () => {
    testDb = await resetTestDatabase(TEST_DB_URL!, 'listeningleak');
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
    const staffLogin = { password: SAMPLE_DEV_PASSWORD, totpSecret: TOTP_SECRET, totpEnrolled: true };
    idp.seedUsers(
      SAMPLE_EXTERNAL_IDENTITIES.filter((i) => PEOPLE.includes(i.userId)).map((i) => ({
        email: i.email,
        sub: i.subject,
        username: i.cognitoUsername,
        ...(STAFF.includes(i.userId) ? staffLogin : {}),
      })),
    );

    ivana = await signInMember('user_ivana', { kind: 'organization', orgId: ORG });
    jovan = await signInMember('user_jovan', { kind: 'personal', orgId: ORG });
    stefan = await signInMember('user_stefan', { kind: 'organization', orgId: ORG });
    nikola = await signInStaff('user_nikola', { kind: 'operations' });
    milica = await signInStaff('user_milica', { kind: 'expert' });
  }, 240_000);

  afterAll(async () => {
    await app?.close();
    await testDb?.close();
  });

  it('the survey as the employee sees it: cycle, questionnaire and the private draft, never ids of the response or the membership', async () => {
    const opened = await post(ivana, `/orgs/${ORG}/listening/cycles`, { opensAt: new Date().toISOString() });
    clean(opened, 201);
    cycleId = opened.body.id;

    clean(await get(jovan, '/me/listening/survey'), 200);
    clean(await put(jovan, `/me/listening/survey/${cycleId}/draft`, { answers: { speaking_up: 3 } }), 200);
    const submitted = clean(await post(jovan, `/me/listening/survey/${cycleId}/submit`, { answers: { speaking_up: 4, sustainable_workload: 2 }, questionnaireVersionId: SAMPLE_QUESTIONNAIRE_V1_ID }), 200);
    expect(Object.keys(submitted)).toEqual(['submittedAt']);
    clean(await get(jovan, '/me/listening/survey'), 200);
  });

  it('the administrator surfaces: cycles with a safe audience total and the read-only configuration', async () => {
    const cycles = clean(await get(ivana, `/orgs/${ORG}/listening/cycles`), 200);
    expect(JSON.stringify(cycles)).not.toMatch(/user_|@example/);
    clean(await get(ivana, `/orgs/${ORG}/listening/configuration`), 200);
  });

  it('the published reports: overview, heatmap, dimension detail and the CSV carry aggregates only', async () => {
    for (let i = 0; i < 24; i += 1) {
      await testDb.db.insert(surveyResponses).values({
        orgId: ORG,
        cycleId,
        questionnaireVersionId: SAMPLE_QUESTIONNAIRE_V1_ID,
        cohortUnitId: ENGINEERING,
        answers: { job_satisfaction: 5, sustainable_workload: i < 11 ? 5 : 1, manager_support: 4, speaking_up: 4, belonging_respect: 5 },
        acceptedAt: new Date(Date.now() - 3_600_000),
      });
    }
    await testDb.db
      .update(surveyCycles)
      .set({ opensAt: new Date(Date.now() - 8 * 86_400_000), closesAt: new Date(Date.now() - 60_000) })
      .where(eq(surveyCycles.id, cycleId));
    const tick = await app.get(ListeningJobsService, { strict: false }).tick();
    expect(tick.finalized).toEqual([cycleId]);
    const [snapshot] = await testDb.db.select().from(surveySnapshots).where(eq(surveySnapshots.cycleId, cycleId));
    snapshotId = snapshot!.id;

    clean(await get(ivana, `/orgs/${ORG}/listening/overview`), 200);
    clean(await get(ivana, `/orgs/${ORG}/listening/heatmap`), 200);
    clean(await get(ivana, `/orgs/${ORG}/listening/dimensions/sustainable_workload`), 200);
    // The export needs its own grant (REP-04); a direct insert must invalidate the grant cache as the grant routes do.
    await testDb.db.insert(grants).values({
      id: 'grant_leak_ivana_reporting_user',
      subjectUserId: 'user_ivana',
      templateKey: 'reporting_user',
      actions: ['reports.aggregate.read', 'report.export', 'listening.reports.read', 'listening.reports.export'],
      scopeType: 'organization',
      scopeOrgId: ORG,
      grantedByUserId: 'user_ivana',
      validFrom: new Date('2026-01-01T00:00:00.000Z'),
    });
    await app.get(PrincipalLoader, { strict: false }).invalidateUser('user_ivana', [ORG]);
    const exporter = await signInMember('user_ivana', { kind: 'organization', orgId: ORG });
    const csv = await get(exporter, `/orgs/${ORG}/listening/snapshots/${snapshotId}/export.csv`);
    expect(csv.status, csv.text).toBe(200);
    expect(csv.text).not.toMatch(/user_|@example|answers/);
  });

  it('feedback: the routes, the receipt and the reporter views name functions, never accounts; handler notes never reach the reporter', async () => {
    const routes = clean(await get(jovan, '/me/feedback/routes'), 200, REPORTER_FORBIDDEN);
    routeId = (routes.items as Array<{ id: string }>)[0]!.id;
    const created = clean(await post(jovan, '/me/feedback/cases', { routeId, kind: 'problem', category: 'workload', routeChoice: 'alternate', body: 'The rota changes without notice.' }), 201, REPORTER_FORBIDDEN);
    caseId = created.id as string;
    clean(await get(jovan, '/me/feedback/cases'), 200, REPORTER_FORBIDDEN);
    clean(await get(jovan, `/me/feedback/cases/${caseId}`), 200, REPORTER_FORBIDDEN);

    clean(await get(ivana, '/feedback/inbox'), 200);
    clean(await get(ivana, `/feedback/cases/${caseId}`), 200);
    clean(await post(ivana, `/feedback/cases/${caseId}/messages`, { body: 'Check with scheduling first.', internal: true }), 200);
    clean(await post(ivana, `/feedback/cases/${caseId}/messages`, { body: 'Thank you, we are looking into the rota process.' }), 200);

    const mine = clean(await get(jovan, `/me/feedback/cases/${caseId}`), 200, REPORTER_FORBIDDEN);
    const messages = mine.messages as Array<{ body: string; internal: boolean }>;
    expect(messages.map((m) => m.internal)).toEqual([false, false]);
    expect(JSON.stringify(mine)).not.toContain('Check with scheduling first.');

    // The owner's route settings name the handlers by account (they choose them) but never by address.
    const admin = clean(await get(ivana, `/orgs/${ORG}/feedback/routes`), 200);
    expect(JSON.stringify(admin)).not.toMatch(/@example/);
    expect((await get(stefan, `/feedback/cases/${caseId}`)).status).toBe(404);
  });

  it('workplace reviews, employer side: catalogue, request, scopes and the engagement carry first names and functions only', async () => {
    clean(await get(ivana, `/orgs/${ORG}/workplace-reviews/services`), 200, EMPLOYER_REVIEW_FORBIDDEN);
    const created = clean(
      await post(ivana, `/orgs/${ORG}/workplace-reviews/requests`, {
        snapshotIds: [snapshotId],
        scopeCohortKey: 'company',
        dimensionKeys: ['sustainable_workload'],
        shareAggregates: true,
        termsVersion: '2026-11',
        noticeVersion: '2026-11',
        context: 'Workload complaints since the reorganization.',
      }),
      201,
      EMPLOYER_REVIEW_FORBIDDEN,
    );
    requestId = created.id as string;
    clean(await get(ivana, `/orgs/${ORG}/workplace-reviews/requests`), 200, EMPLOYER_REVIEW_FORBIDDEN);
    clean(await get(ivana, `/orgs/${ORG}/workplace-reviews/requests/${requestId}`), 200, EMPLOYER_REVIEW_FORBIDDEN);
  });

  it('workplace reviews, coordinator side: the queue, the request, the catalogue and the engagement; only the reviewer picker names accounts', async () => {
    clean(await get(nikola, '/ops/workplace-reviews/services'), 200);
    const queue = clean(await get(nikola, '/ops/workplace-reviews/requests'), 200);
    expect(JSON.stringify(queue)).not.toMatch(/user_ivana|@example/);
    clean(await get(nikola, `/ops/workplace-reviews/requests/${requestId}`), 200);
    clean(await post(nikola, `/ops/workplace-reviews/requests/${requestId}/triage`, { status: 'in_review' }), 200);
    const scoped = clean(
      await post(nikola, `/ops/workplace-reviews/requests/${requestId}/scopes`, {
        serviceId: 'review_service_workplace_review',
        title: 'Workload review, company scope',
        deliverables: 'A 90-minute assessment meeting and a written report.',
        participants: 'HR lead and the department heads',
        priceMinor: 120000,
        currency: 'EUR',
        termsVersion: '2026-11',
        validUntil: new Date(Date.now() + 86_400_000).toISOString(),
        cancellationPolicy: 'Free cancellation up to 48 hours before the meeting.',
      }),
      201,
    );
    scopeId = (scoped.scopes as Array<{ id: string }>)[0]!.id;
    const candidates = clean(await get(nikola, '/ops/workplace-reviews/reviewers'), 200, CANDIDATES_FORBIDDEN);
    expect((candidates.items as Array<{ userId: string }>).map((c) => c.userId)).toEqual(['user_milica']);

    clean(await get(ivana, `/orgs/${ORG}/workplace-reviews/requests/${requestId}`), 200, EMPLOYER_REVIEW_FORBIDDEN);
    const accepted = clean(await post(ivana, `/orgs/${ORG}/workplace-reviews/scopes/${scopeId}/accept`), 200, EMPLOYER_REVIEW_FORBIDDEN);
    engagementId = accepted.id as string;
    clean(await get(ivana, `/orgs/${ORG}/workplace-reviews/engagements`), 200, EMPLOYER_REVIEW_FORBIDDEN);

    clean(await get(nikola, `/ops/workplace-reviews/engagements/${engagementId}`), 200);
    clean(await post(nikola, `/ops/workplace-reviews/engagements/${engagementId}/assign`, { reviewerUserId: 'user_milica' }), 200);
    const start = new Date(Date.now() + 3 * 86_400_000);
    start.setUTCMinutes(0, 0, 0);
    const windows = [0, 1].map((i) => ({
      startsAt: new Date(start.getTime() + i * 2 * 3_600_000).toISOString(),
      endsAt: new Date(start.getTime() + i * 2 * 3_600_000 + 90 * 60_000).toISOString(),
    }));
    clean(await post(nikola, `/ops/workplace-reviews/engagements/${engagementId}/windows`, { windows, timeZone: 'Europe/Belgrade' }), 200);
    clean(await post(ivana, `/orgs/${ORG}/workplace-reviews/engagements/${engagementId}/book`, { windowIndex: 0 }), 200, EMPLOYER_REVIEW_FORBIDDEN);
  });

  it('workplace reviews, reviewer side: the pack has the heatmap cells and nothing below them; the report and actions cross without notes or accounts', async () => {
    clean(await post(ivana, `/orgs/${ORG}/workplace-reviews/engagements/${engagementId}/sharing`, { snapshotIds: [snapshotId], cohortKeys: ['company', ENGINEERING] }), 201, EMPLOYER_REVIEW_FORBIDDEN);

    clean(await get(milica, '/expert/workplace-reviews/engagements'), 200);
    clean(await get(milica, `/expert/workplace-reviews/engagements/${engagementId}`), 200);
    clean(await get(milica, `/expert/workplace-reviews/engagements/${engagementId}/pack`), 200);

    const sections = {
      context: PARAGRAPH('Mid-size engineering organization after a reorganization.'),
      evidence: PARAGRAPH('Company workload 48.0 percent favorable.'),
      findings: PARAGRAPH('Rota changes arrive with short notice.'),
      uncertainties: PARAGRAPH('Whether the pattern holds outside engineering is unknown.'),
      proposals: PARAGRAPH('Fix the rota two weeks ahead.'),
    };
    clean(await put(milica, `/expert/workplace-reviews/engagements/${engagementId}/report`, { sections, evidenceSnapshotIds: [snapshotId] }), 200);
    clean(await get(milica, `/expert/workplace-reviews/engagements/${engagementId}/report`), 200);
    clean(await post(milica, `/expert/workplace-reviews/engagements/${engagementId}/notes`, { body: 'Ask about the Thursday rota meeting.' }), 201);
    clean(await get(milica, `/expert/workplace-reviews/engagements/${engagementId}/notes`), 200);
    clean(await post(milica, `/expert/workplace-reviews/engagements/${engagementId}/report/share`), 200);
    clean(
      await post(milica, `/expert/workplace-reviews/engagements/${engagementId}/actions`, {
        title: 'Fix the rota two weeks ahead',
        description: 'Publish the rota on the first of the month.',
        intendedCheck: 'Workload favorable share in the next two cycles.',
      }),
      201,
    );
    clean(await get(milica, `/expert/workplace-reviews/engagements/${engagementId}/actions`), 200);

    const report = clean(await get(ivana, `/orgs/${ORG}/workplace-reviews/engagements/${engagementId}/report`), 200, EMPLOYER_REVIEW_FORBIDDEN);
    expect(JSON.stringify(report)).not.toContain('Thursday rota meeting');
    clean(await get(ivana, `/orgs/${ORG}/workplace-reviews/engagements/${engagementId}/actions`), 200, EMPLOYER_REVIEW_FORBIDDEN);
    const engagement = clean(await get(ivana, `/orgs/${ORG}/workplace-reviews/engagements/${engagementId}`), 200, EMPLOYER_REVIEW_FORBIDDEN);
    expect(JSON.stringify(engagement)).not.toMatch(/user_milica|user_nikola|Thursday/);
    expect((await get(jovan, `/orgs/${ORG}/workplace-reviews/engagements/${engagementId}`)).status).toBe(403);
  });
});
