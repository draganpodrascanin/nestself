/**
 * Employee listening: finalization and the protected reports (e2e; spec
 * SUR-04, SCO-01..03, PRI-01, PRI-02, REP-01..03, REV-01; plan Tasks 6, 7).
 *
 * A cycle opens, Jovan submits through the API, crafted responses complete
 * the picture (Engineering 20, Commercial 5; one dimension answered by nine
 * only; one dimension in the red), the close passes, the tick finalizes once,
 * and the employer reads cards, heatmap and detail that agree and hide what
 * must be hidden. Requires TEST_DATABASE_URL.
 */
import 'dotenv/config';
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { SAMPLE_EXTERNAL_IDENTITIES } from '@nestself/sample-data';
import { IdentityProviderService } from '../src/identity/identity-provider.service.js';
import type { FakeIdentityProvider } from '../src/identity/fake-identity-provider.js';
import { seed } from '../src/db/seed/seed-lib.js';
import { auditEvents, grants, surveyAggregateCells, surveyCycles, surveyDrafts, surveyParticipations, surveyResponses, surveySnapshots } from '../src/db/schema/index.js';
import { ListeningJobsService } from '../src/listening/listening-jobs.service.js';
import { PrincipalLoader } from '../src/principal/principal-loader.js';
import { SAMPLE_QUESTIONNAIRE_V1_ID } from '../src/listening/listening-defaults.js';
import { resetTestDatabase, type TestDatabase } from './db/test-database.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const shouldRun = !!TEST_DB_URL;
const ORG = 'org_sample';
const PEOPLE = ['user_ivana', 'user_jovan'];
const ENGINEERING = 'ou_engineering';
const COMMERCIAL = 'ou_commercial';

/** Keys that must never appear in an employer report tree (spec PRI-01, PRI-03). */
const FORBIDDEN_KEYS = new Set(['userId', 'membershipId', 'responseId', 'answers', 'validCount', 'favorableCount', 'neutralCount', 'unfavorableCount', 'email', 'participationId']);

function findForbiddenKeys(obj: unknown, path = ''): string[] {
  if (!obj || typeof obj !== 'object') return [];
  const found: string[] = [];
  for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.has(key)) found.push(`${path}.${key}`);
    if (val && typeof val === 'object') found.push(...findForbiddenKeys(val, `${path}.${key}`));
  }
  return found;
}

interface SignedIn {
  agent: request.Agent;
  csrf: string;
}

describe.skipIf(!shouldRun)('Employee listening: finalization and reports (e2e)', () => {
  let app: INestApplication;
  let idp: FakeIdentityProvider;
  let testDb: TestDatabase;
  let ivana: SignedIn;
  let jovan: SignedIn;
  let cycleId: string;
  let snapshotId: string;

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
    expect(res.status).toBe(200);
    return who;
  }

  const get = (who: SignedIn, path: string) => who.agent.get(`/api${path}`);
  const post = (who: SignedIn, path: string, body: Record<string, unknown> = {}) =>
    who.agent.post(`/api${path}`).set('X-CSRF-Token', who.csrf).set('Idempotency-Key', randomUUID()).send(body);

  /** Inserts accepted responses for a cohort: `favorable` of `count` rate the dimension 5, the rest 1; `others` are added to every response. */
  async function insertResponses(cohortUnitId: string | null, count: number, dimension: string, favorable: number, others: (i: number) => Record<string, number>) {
    for (let i = 0; i < count; i += 1) {
      await testDb.db.insert(surveyResponses).values({
        orgId: ORG,
        cycleId,
        questionnaireVersionId: SAMPLE_QUESTIONNAIRE_V1_ID,
        cohortUnitId,
        answers: { [dimension]: i < favorable ? 5 : 1, ...others(i) },
        // Accepted an hour ago: the test later moves the close into the recent past.
        acceptedAt: new Date(Date.now() - 3_600_000),
      });
    }
  }

  beforeAll(async () => {
    testDb = await resetTestDatabase(TEST_DB_URL!, 'listeningrep');
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
    ivana = await signInMember('user_ivana', { kind: 'organization', orgId: ORG });
    jovan = await signInMember('user_jovan', { kind: 'personal', orgId: ORG });
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await testDb?.close();
  });

  it('shows no current result and no offer before any cycle was published', async () => {
    const res = await get(ivana, `/orgs/${ORG}/listening/overview`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ capabilities: { measurement: true, feedback: true, workplaceReviews: true }, current: null, collecting: null, history: [], reviewOffer: null });
  });

  it('opens a cycle, collects Jovan through the API and the rest directly, then finalizes once through the tick', async () => {
    const opened = await post(ivana, `/orgs/${ORG}/listening/cycles`, { opensAt: new Date().toISOString() });
    expect(opened.status, JSON.stringify(opened.body)).toBe(201);
    cycleId = opened.body.id;

    const overview = await get(ivana, `/orgs/${ORG}/listening/overview`);
    expect(overview.body.collecting).toMatchObject({ cycleId });

    const submitted = await post(jovan, `/me/listening/survey/${cycleId}/submit`, {
      answers: { job_satisfaction: 5, sustainable_workload: 5, manager_support: 4, speaking_up: 5, belonging_respect: 5 },
      questionnaireVersionId: SAMPLE_QUESTIONNAIRE_V1_ID,
    });
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
    // Jovan's answer was accepted now; the close moves to a minute ago below, so backdate it like the crafted rows.
    await testDb.db.update(surveyResponses).set({ acceptedAt: new Date(Date.now() - 3_600_000) }).where(eq(surveyResponses.cycleId, cycleId));

    // Engineering: 19 more (20 with Jovan); Commercial: 5. job_satisfaction answered by all 25
    // (20 favorable -> 80.0 good); sustainable_workload by all 25 with 12 favorable -> 48.0 danger;
    // speaking_up by 8 more (9 with Jovan) -> hidden; manager_support by 24 of 25 with 15 favorable -> 62.5 monitor.
    await insertResponses(ENGINEERING, 19, 'job_satisfaction', 15, (i) => ({
      sustainable_workload: i < 8 ? 5 : 1,
      ...(i < 8 ? { speaking_up: 3 } : {}),
      ...(i < 18 ? { manager_support: i < 11 ? 4 : 2 } : {}),
    }));
    await insertResponses(COMMERCIAL, 5, 'job_satisfaction', 4, (i) => ({ sustainable_workload: i < 3 ? 5 : 1, manager_support: i < 3 ? 5 : 1 }));

    await testDb.db
      .update(surveyCycles)
      .set({ opensAt: new Date(Date.now() - 8 * 86_400_000), closesAt: new Date(Date.now() - 60_000) })
      .where(eq(surveyCycles.id, cycleId));

    const jobs = app.get(ListeningJobsService, { strict: false });
    const first = await jobs.tick();
    expect(first.finalized).toEqual([cycleId]);
    const second = await jobs.tick();
    expect(second.finalized).toEqual([]);
    expect(second.failed).toEqual([]);

    const snapshots = await testDb.db.select().from(surveySnapshots).where(eq(surveySnapshots.cycleId, cycleId));
    expect(snapshots).toHaveLength(1);
    snapshotId = snapshots[0]!.id;
    expect(snapshots[0]).toMatchObject({ submittedCount: 25, algorithmVersion: 1 });
    const cells = await testDb.db.select().from(surveyAggregateCells).where(eq(surveyAggregateCells.snapshotId, snapshotId));
    expect(cells).toHaveLength(15); // company + two departments, five dimensions each
  });

  it('refuses a submission after the close', async () => {
    const res = await post(jovan, `/me/listening/survey/${cycleId}/submit`, { answers: { speaking_up: 1 }, questionnaireVersionId: SAMPLE_QUESTIONNAIRE_V1_ID });
    expect(res.status).toBe(409);
    expect(['cycle_closed', 'already_submitted']).toContain(res.body.code);
  });

  it('the overview shows the five company cards with the right bands, one hidden dimension and the review offer', async () => {
    const res = await get(ivana, `/orgs/${ORG}/listening/overview`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const current = res.body.current;
    expect(current).toMatchObject({ snapshotId, cycleId, stale: false, questionnaireVersion: 1, participation: { submittedCount: 25 } });
    const byKey = Object.fromEntries((current.dimensions as Array<{ key: string }>).map((d) => [d.key, d]));
    expect(byKey.job_satisfaction).toMatchObject({ score: '80.0', scoreTenths: 800, status: 'good', grayReason: null, respondentCount: 25, trend: { comparable: false, reason: 'no_previous' } });
    expect(byKey.sustainable_workload).toMatchObject({ score: '48.0', status: 'danger', respondentCount: 25 });
    expect(byKey.manager_support).toMatchObject({ score: '62.5', status: 'monitor', respondentCount: 24 });
    expect(byKey.speaking_up).toMatchObject({ score: null, scoreTenths: null, status: null, grayReason: 'insufficient_responses', respondentCount: null, distribution: null });
    expect(byKey.belonging_respect).toMatchObject({ grayReason: 'insufficient_responses', score: null });
    expect(res.body.reviewOffer).toEqual({ eligible: true, dimensionKeys: ['sustainable_workload'], activeRequestId: null, activeEngagementId: null, dismissed: false });
    expect(res.body.collecting).toBeNull();
    expect(res.body.history).toEqual([{ snapshotId, cycleId, closesAt: current.closesAt }]);
    expect(findForbiddenKeys(res.body)).toEqual([]);
  });

  it('the heatmap hides the 5-person department and the 20-person sibling that would reveal it (PR-01)', async () => {
    const res = await get(ivana, `/orgs/${ORG}/listening/heatmap`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.snapshotId).toBe(snapshotId);
    const rows = res.body.rows as Array<{ cohortKey: string; name: string; kind: string; cells: Array<{ key: string; score: string | null; grayReason: string | null; respondentCount: number | null }> }>;
    expect(rows.map((r) => r.cohortKey)).toEqual(['company', ENGINEERING, COMMERCIAL]);
    expect(rows[1]!.name).toBe('Engineering');
    const company = rows[0]!.cells.find((c) => c.key === 'job_satisfaction')!;
    expect(company).toMatchObject({ score: '80.0', respondentCount: 25 });
    const engineering = rows[1]!.cells.find((c) => c.key === 'job_satisfaction')!;
    const commercial = rows[2]!.cells.find((c) => c.key === 'job_satisfaction')!;
    expect(engineering).toMatchObject({ score: null, grayReason: 'privacy_suppressed', respondentCount: null });
    expect(commercial).toMatchObject({ score: null, grayReason: 'insufficient_responses', respondentCount: null });
    expect(findForbiddenKeys(res.body)).toEqual([]);
    const explicit = await get(ivana, `/orgs/${ORG}/listening/heatmap?snapshotId=${snapshotId}`);
    expect(explicit.body).toEqual(res.body);
    const unknown = await get(ivana, `/orgs/${ORG}/listening/heatmap?snapshotId=nope`);
    expect(unknown.status).toBe(404);
  });

  it('the dimension detail agrees with the card and shows the definition and the series', async () => {
    const res = await get(ivana, `/orgs/${ORG}/listening/dimensions/sustainable_workload`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ key: 'sustainable_workload', snapshotId, stale: false });
    expect(res.body.question.en).toMatch(/reasonable working hours/);
    expect(res.body.cell).toMatchObject({ score: '48.0', status: 'danger', respondentCount: 25, trend: { comparable: false, reason: 'no_previous' } });
    expect(res.body.cell.distribution).toEqual({ favorablePct: 48, neutralPct: 0, unfavorablePct: 52 });
    expect(res.body.series).toEqual([{ snapshotId, closesAt: res.body.closesAt, scoreTenths: 480, status: 'danger', grayReason: null, comparable: true }]);
    const hidden = await get(ivana, `/orgs/${ORG}/listening/dimensions/speaking_up`);
    expect(hidden.body.cell).toMatchObject({ score: null, grayReason: 'insufficient_responses', respondentCount: null, distribution: null });
    expect(findForbiddenKeys(hidden.body)).toEqual([]);
    const bad = await get(ivana, `/orgs/${ORG}/listening/dimensions/happiness`);
    expect(bad.status).toBe(400);
  });

  it('dismissing the offer hides the invitation but not the red card', async () => {
    const dismissed = await post(ivana, `/orgs/${ORG}/listening/offer/dismiss`, { snapshotId });
    expect(dismissed.status, JSON.stringify(dismissed.body)).toBe(200);
    const res = await get(ivana, `/orgs/${ORG}/listening/overview`);
    expect(res.body.reviewOffer).toMatchObject({ eligible: false, dismissed: true, dimensionKeys: ['sustainable_workload'] });
    expect((res.body.current.dimensions as Array<{ key: string; status: string }>).find((d) => d.key === 'sustainable_workload')!.status).toBe('danger');
  });

  it('the CSV export needs its own grant, then agrees with the dashboard cell for cell and is audited (REP-04)', async () => {
    const denied = await get(ivana, `/orgs/${ORG}/listening/snapshots/${snapshotId}/export.csv`);
    expect(denied.status).toBe(403);

    await testDb.db.insert(grants).values({
      id: 'grant_test_ivana_reporting_user',
      subjectUserId: 'user_ivana',
      templateKey: 'reporting_user',
      actions: ['reports.aggregate.read', 'report.export', 'listening.reports.read', 'listening.reports.export'],
      scopeType: 'organization',
      scopeOrgId: ORG,
      grantedByUserId: 'user_ivana',
      validFrom: new Date('2026-01-01T00:00:00.000Z'),
    });
    // The grant cache is per user and organization; a direct insert must invalidate it as the grant routes do.
    await app.get(PrincipalLoader, { strict: false }).invalidateUser('user_ivana', [ORG]);
    const exporter = await signInMember('user_ivana', { kind: 'organization', orgId: ORG });
    const res = await get(exporter, `/orgs/${ORG}/listening/snapshots/${snapshotId}/export.csv`);
    expect(res.status, res.text).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toBe(`attachment; filename="listening-${snapshotId}.csv"`);
    const lines = res.text.trimEnd().split('\r\n');
    expect(lines[0]).toMatch(/^snapshot_id,cycle_opens_at/);
    expect(lines).toHaveLength(1 + 3 * 5);
    const workload = lines.find((l) => l.includes(',company,company,sustainable_workload,'))!;
    expect(workload).toContain(',48.0,danger,25,48,0,52,');
    const speakingUp = lines.find((l) => l.includes(',company,company,speaking_up,'))!;
    expect(speakingUp.endsWith(',speaking_up,,,,,,,insufficient_responses')).toBe(true);
    const engineering = lines.find((l) => l.includes(`,${ENGINEERING},Engineering,job_satisfaction,`))!;
    expect(engineering.endsWith(',job_satisfaction,,,,,,,privacy_suppressed')).toBe(true);
    expect(res.text).not.toMatch(/user_|@example/);

    const [audit] = await testDb.db.select().from(auditEvents).where(eq(auditEvents.action, 'listening.export.generated'));
    expect(audit).toMatchObject({ actorUserId: 'user_ivana', recordId: snapshotId, orgId: ORG });

    const unknown = await get(exporter, `/orgs/${ORG}/listening/snapshots/not-a-snapshot/export.csv`);
    expect(unknown.status).toBe(404);
    const employee = await get(jovan, `/orgs/${ORG}/listening/snapshots/${snapshotId}/export.csv`);
    expect(employee.status).toBe(403);
  });

  it('the nightly purge removes drafts of closed cycles and old participation links, never answers or snapshots', async () => {
    const [participation] = await testDb.db.select().from(surveyParticipations).where(eq(surveyParticipations.cycleId, cycleId));
    await testDb.db.insert(surveyDrafts).values({ participationId: participation!.id, orgId: ORG, answers: { speaking_up: 2 } }).onConflictDoNothing();
    const jobs = app.get(ListeningJobsService, { strict: false });
    const first = await jobs.purge();
    expect(first.draftsDeleted).toBeGreaterThanOrEqual(1);
    expect(first.participationsDeleted).toBe(0);
    await testDb.db.update(surveyCycles).set({ finalizedAt: new Date(Date.now() - 400 * 86_400_000) }).where(eq(surveyCycles.id, cycleId));
    const second = await jobs.purge();
    expect(second.participationsDeleted).toBeGreaterThanOrEqual(1);
    expect(await testDb.db.select().from(surveyResponses).where(eq(surveyResponses.cycleId, cycleId))).toHaveLength(25);
    expect(await testDb.db.select().from(surveySnapshots).where(eq(surveySnapshots.cycleId, cycleId))).toHaveLength(1);
    const third = await jobs.purge();
    expect(third).toEqual({ job: 'listening.purge', draftsDeleted: 0, participationsDeleted: 0 });
  });

  it('an employee cannot read the employer reports and a guessed snapshot id answers 404', async () => {
    const overview = await get(jovan, `/orgs/${ORG}/listening/overview`);
    expect(overview.status).toBe(403);
    const dismiss = await post(jovan, `/orgs/${ORG}/listening/offer/dismiss`, { snapshotId });
    expect(dismiss.status).toBe(403);
    const other = await post(ivana, `/orgs/${ORG}/listening/offer/dismiss`, { snapshotId: 'snapshot_of_someone_else' });
    expect(other.status).toBe(404);
  });

  it('a second published cycle produces trends against the first, and a stale latest result switches the offer off', async () => {
    // Second cycle, far enough from the first window, finalized with every dimension shown and a lower workload score.
    const opensAt = new Date(Date.now() + 30 * 86_400_000);
    const scheduled = await post(ivana, `/orgs/${ORG}/listening/cycles`, { opensAt: opensAt.toISOString() });
    expect(scheduled.status, JSON.stringify(scheduled.body)).toBe(201);
    const secondId = scheduled.body.id as string;
    await testDb.db.update(surveyCycles).set({ status: 'open', opensAt: new Date(Date.now() - 10 * 86_400_000), closesAt: new Date(Date.now() - 60_000), launchedAt: new Date(), audienceSize: 25 }).where(eq(surveyCycles.id, secondId));
    const previousCycleId = cycleId;
    cycleId = secondId;
    await insertResponses(null, 12, 'sustainable_workload', 5, (i) => ({ job_satisfaction: i < 9 ? 5 : 1, speaking_up: 4, manager_support: 4, belonging_respect: 4 }));
    const jobs = app.get(ListeningJobsService, { strict: false });
    const report = await jobs.tick();
    expect(report.finalized).toEqual([secondId]);

    const res = await get(ivana, `/orgs/${ORG}/listening/overview`);
    const byKey = Object.fromEntries((res.body.current.dimensions as Array<{ key: string }>).map((d) => [d.key, d]));
    // 5 of 12 favorable -> 41.7; previous 48.0 -> -6.3 points
    expect(byKey.sustainable_workload).toMatchObject({ score: '41.7', status: 'danger', trend: { comparable: true, deltaTenths: -63, previousSnapshotId: snapshotId } });
    // speaking_up was hidden in the previous snapshot: no trend may reconstruct it
    expect(byKey.speaking_up).toMatchObject({ score: '100.0', trend: { comparable: false, reason: 'suppressed' } });
    expect(res.body.history).toHaveLength(2);
    expect(res.body.history[1].cycleId).toBe(previousCycleId);
    expect(res.body.reviewOffer).toMatchObject({ eligible: true, dismissed: false });

    // Make the latest result stale (and keep the first cycle older than it): the overview says so and
    // the offer goes away while the red card stays.
    await testDb.db.update(surveyCycles).set({ closesAt: new Date(Date.now() - 60 * 86_400_000), opensAt: new Date(Date.now() - 67 * 86_400_000) }).where(eq(surveyCycles.id, previousCycleId));
    await testDb.db.update(surveyCycles).set({ closesAt: new Date(Date.now() - 50 * 86_400_000), opensAt: new Date(Date.now() - 57 * 86_400_000) }).where(eq(surveyCycles.id, secondId));
    const stale = await get(ivana, `/orgs/${ORG}/listening/overview`);
    expect(stale.body.current.stale).toBe(true);
    expect(stale.body.reviewOffer).toMatchObject({ eligible: false });
    expect((stale.body.current.dimensions as Array<{ key: string; status: string }>).find((d) => d.key === 'sustainable_workload')!.status).toBe('danger');
    expect(findForbiddenKeys(stale.body)).toEqual([]);
  });
});
