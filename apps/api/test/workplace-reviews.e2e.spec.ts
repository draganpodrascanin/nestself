/**
 * Workplace reviews (e2e; spec REV-01..10, OPS-01; plan Tasks 13 and 14).
 *
 * A published red snapshot makes the invitation eligible; Ivana requests a
 * review; Nikola (review coordinator) triages, scopes and assigns Milica
 * (the qualified reviewer); Ivana accepts within her ceiling and books a
 * window; Ivana shares the snapshot; Milica reads the pack, writes and shares
 * a report, proposes an action; Ivana agrees and completes it; follow-up and
 * completion; the snapshot cells never change. Requires TEST_DATABASE_URL.
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
import { appointments, reviewScopes, surveyAggregateCells, surveyCycles, surveyResponses, surveySnapshots } from '../src/db/schema/index.js';
import { ListeningJobsService } from '../src/listening/listening-jobs.service.js';
import { SAMPLE_QUESTIONNAIRE_V1_ID } from '../src/listening/listening-defaults.js';
import { Mailer, type MailInput } from '../src/mailer/mailer.js';
import { resetTestDatabase, type TestDatabase } from './db/test-database.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const shouldRun = !!TEST_DB_URL;
const TOTP_SECRET = 'JBSWY3DPEHPK3PXP';
const ORG = 'org_sample';
const PEOPLE = ['user_ivana', 'user_jovan', 'user_nikola', 'user_milica', 'user_stefan'];
const STAFF = ['user_nikola', 'user_milica'];
const ENGINEERING = 'ou_engineering';

interface SignedIn {
  agent: request.Agent;
  csrf: string;
}

const PARAGRAPH = (text: string) => ({ type: 'doc', schemaVersion: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

describe.skipIf(!shouldRun)('Workplace reviews (e2e)', () => {
  let app: INestApplication;
  let idp: FakeIdentityProvider;
  let testDb: TestDatabase;
  let sent: MailInput[];
  let ivana: SignedIn;
  let jovan: SignedIn;
  let nikola: SignedIn;
  let milica: SignedIn;
  let stefan: SignedIn;
  let cycleId: string;
  let snapshotId: string;
  let requestId: string;
  let scopeId: string;
  let engagementId: string;
  let cellsBefore: string;

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
  const patch = (who: SignedIn, path: string, body: Record<string, unknown>) => who.agent.patch(`/api${path}`).set('X-CSRF-Token', who.csrf).send(body);

  async function cellsSnapshot(): Promise<string> {
    const rows = await testDb.db.select().from(surveyAggregateCells).where(eq(surveyAggregateCells.snapshotId, snapshotId));
    return JSON.stringify(rows.sort((a, b) => `${a.cohortKey}${a.dimensionKey}`.localeCompare(`${b.cohortKey}${b.dimensionKey}`)));
  }

  beforeAll(async () => {
    testDb = await resetTestDatabase(TEST_DB_URL!, 'reviews');
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
    sent = (app.get(Mailer, { strict: false }) as unknown as { sent: MailInput[] }).sent;

    ivana = await signInMember('user_ivana', { kind: 'organization', orgId: ORG });
    jovan = await signInMember('user_jovan', { kind: 'personal', orgId: ORG });
    stefan = await signInMember('user_stefan', { kind: 'organization', orgId: ORG });
    nikola = await signInStaff('user_nikola', { kind: 'operations' });
    milica = await signInStaff('user_milica', { kind: 'expert' });

    // A published cycle with the company in the red on workload: 25 responses, 12 favorable -> 48.0 danger.
    const opened = await post(ivana, `/orgs/${ORG}/listening/cycles`, { opensAt: new Date().toISOString() });
    expect(opened.status, JSON.stringify(opened.body)).toBe(201);
    cycleId = opened.body.id;
    for (let i = 0; i < 25; i += 1) {
      await testDb.db.insert(surveyResponses).values({
        orgId: ORG,
        cycleId,
        questionnaireVersionId: SAMPLE_QUESTIONNAIRE_V1_ID,
        cohortUnitId: ENGINEERING,
        answers: { job_satisfaction: 5, sustainable_workload: i < 12 ? 5 : 1, manager_support: 4, speaking_up: 4, belonging_respect: 5 },
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
    cellsBefore = await cellsSnapshot();
  }, 240_000);

  afterAll(async () => {
    await app?.close();
    await testDb?.close();
  });

  it('the overview offers a review for the red result and the catalogue shows a quoted service and a free call', async () => {
    const overview = await get(ivana, `/orgs/${ORG}/listening/overview`);
    expect(overview.status, JSON.stringify(overview.body)).toBe(200);
    expect(overview.body.reviewOffer).toMatchObject({ eligible: true, dimensionKeys: ['sustainable_workload'], activeRequestId: null, activeEngagementId: null });

    const services = await get(ivana, `/orgs/${ORG}/workplace-reviews/services`);
    expect(services.status, JSON.stringify(services.body)).toBe(200);
    expect(services.body.workplaceReviewsEnabled).toBe(true);
    expect(services.body.items.map((s: { key: string; pricing: string }) => [s.key, s.pricing])).toEqual([
      ['workplace_review', 'quote'],
      ['introductory_call', 'free'],
    ]);
  });

  it('requests a review once: the offer gives way to the active request and a second request is answered with the same id', async () => {
    const body = { snapshotIds: [snapshotId], scopeCohortKey: 'company', dimensionKeys: ['sustainable_workload'], shareAggregates: true, termsVersion: '2026-11', noticeVersion: '2026-11', context: 'Workload complaints since the reorganization.' };
    const created = await post(ivana, `/orgs/${ORG}/workplace-reviews/requests`, body);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    requestId = created.body.id;
    expect(created.body).toMatchObject({ status: 'submitted', scopeCohortKey: 'company', shareAggregates: true, engagementId: null, coordinatorFirstName: null });

    const again = await post(ivana, `/orgs/${ORG}/workplace-reviews/requests`, body);
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ code: 'active_request_exists', details: { requestId } });

    const overview = await get(ivana, `/orgs/${ORG}/listening/overview`);
    expect(overview.body.reviewOffer).toMatchObject({ eligible: false, activeRequestId: requestId });

    const foreign = await post(ivana, `/orgs/${ORG}/workplace-reviews/requests`, { ...body, scopeCohortKey: 'ou_engineering', snapshotIds: ['snapshot_of_someone_else'] });
    expect(foreign.status).toBe(409);
    expect(foreign.body.code).toBe('snapshot_not_found');

    expect((await get(jovan, `/orgs/${ORG}/workplace-reviews/requests`)).status).toBe(403);
    expect((await get(stefan, `/orgs/${ORG}/workplace-reviews/requests`)).status).toBe(403);
  });

  it('the coordinator sees the queue with a response target, triages and sends a scope; the requester is told without the price', async () => {
    const catalogue = await get(nikola, '/ops/workplace-reviews/services');
    expect(catalogue.status, JSON.stringify(catalogue.body)).toBe(200);
    expect(catalogue.body.items.map((s: { key: string }) => s.key).sort()).toEqual(['introductory_call', 'workplace_review']);

    const queue = await get(nikola, '/ops/workplace-reviews/requests');
    expect(queue.status, JSON.stringify(queue.body)).toBe(200);
    expect(queue.body.items).toHaveLength(1);
    expect(queue.body.items[0]).toMatchObject({ id: requestId, organizationName: 'Example d.o.o.', status: 'submitted', requesterFirstName: 'Ivana', overdue: false });
    expect(JSON.stringify(queue.body)).not.toMatch(/user_ivana|Jovanović/);

    const before = sent.length;
    const triaged = await post(nikola, `/ops/workplace-reviews/requests/${requestId}/triage`, { status: 'in_review' });
    expect(triaged.status, JSON.stringify(triaged.body)).toBe(200);
    expect(triaged.body).toMatchObject({ status: 'in_review', coordinatorFirstName: 'Nikola' });

    const scoped = await post(nikola, `/ops/workplace-reviews/requests/${requestId}/scopes`, {
      serviceId: 'review_service_workplace_review',
      title: 'Workload review, company scope',
      deliverables: 'A 90-minute assessment meeting and a written report with findings and proposals.',
      participants: 'HR lead and the department heads',
      priceMinor: 120000,
      currency: 'EUR',
      termsVersion: '2026-11',
      validUntil: new Date(Date.now() + 86_400_000).toISOString(),
      cancellationPolicy: 'Free cancellation up to 48 hours before the meeting.',
    });
    expect(scoped.status, JSON.stringify(scoped.body)).toBe(201);
    expect(scoped.body.status).toBe('scoped');
    expect(scoped.body.scopes).toHaveLength(1);
    scopeId = scoped.body.scopes[0].id;
    expect(scoped.body.scopes[0]).toMatchObject({ version: 1, status: 'sent', priceMinor: 120000 });

    const mails = sent.slice(before);
    expect(mails.map((m) => m.template)).toEqual(['review_request_update', 'review_scope_sent']);
    expect(mails.every((m) => m.to === 'user_ivana@example.com')).toBe(true);
    expect(JSON.stringify(mails)).not.toMatch(/120000|1200|48\.0/);
  });

  it('the approver accepts within the ceiling; a scope above it is refused; acceptance creates the engagement and no charge', async () => {
    const [tooExpensive] = await testDb.db
      .insert(reviewScopes)
      .values({
        orgId: ORG,
        requestId,
        version: 99,
        serviceId: 'review_service_workplace_review',
        title: 'Too expensive',
        deliverables: 'x',
        participants: 'x',
        priceMinor: 600000,
        currency: 'EUR',
        termsVersion: '2026-11',
        validUntil: new Date(Date.now() + 86_400_000),
        cancellationPolicy: 'x',
        status: 'sent',
        sentAt: new Date(),
        createdByUserId: 'user_nikola',
      })
      .returning();
    const refused = await post(ivana, `/orgs/${ORG}/workplace-reviews/scopes/${tooExpensive!.id}/accept`);
    expect(refused.status).toBe(403);
    await testDb.db.delete(reviewScopes).where(eq(reviewScopes.id, tooExpensive!.id));

    // An open quote (no price yet) binds nothing: it exceeds every ceiling.
    const [openQuote] = await testDb.db
      .insert(reviewScopes)
      .values({
        orgId: ORG,
        requestId,
        version: 98,
        serviceId: 'review_service_workplace_review',
        title: 'Open quote',
        deliverables: 'x',
        participants: 'x',
        priceMinor: null,
        currency: 'EUR',
        termsVersion: '2026-11',
        validUntil: new Date(Date.now() + 86_400_000),
        cancellationPolicy: 'x',
        status: 'sent',
        sentAt: new Date(),
        createdByUserId: 'user_nikola',
      })
      .returning();
    expect((await post(ivana, `/orgs/${ORG}/workplace-reviews/scopes/${openQuote!.id}/accept`)).status).toBe(403);
    await testDb.db.delete(reviewScopes).where(eq(reviewScopes.id, openQuote!.id));

    const accepted = await post(ivana, `/orgs/${ORG}/workplace-reviews/scopes/${scopeId}/accept`);
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    engagementId = accepted.body.id;
    expect(accepted.body).toMatchObject({ status: 'accepted', requestId, scope: { id: scopeId, status: 'accepted' }, appointment: null, reviewerFirstName: null });

    const replay = await post(ivana, `/orgs/${ORG}/workplace-reviews/scopes/${scopeId}/accept`);
    expect(replay.status).toBe(200);
    expect(replay.body.id).toBe(engagementId);

    const requestNow = await get(ivana, `/orgs/${ORG}/workplace-reviews/requests/${requestId}`);
    expect(requestNow.body).toMatchObject({ status: 'converted', engagementId });
    const overview = await get(ivana, `/orgs/${ORG}/listening/overview`);
    expect(overview.body.reviewOffer).toMatchObject({ eligible: false, activeRequestId: null, activeEngagementId: engagementId });
    expect(await testDb.db.select().from(appointments).where(eq(appointments.serviceCategory, 'workplace_review'))).toHaveLength(0);
  });

  it('the coordinator assigns a qualified reviewer only, proposes windows, and the requester books one; a second booking fails', async () => {
    const reviewers = await get(nikola, '/ops/workplace-reviews/reviewers');
    expect(reviewers.status, JSON.stringify(reviewers.body)).toBe(200);
    expect(reviewers.body.items.map((r: { userId: string }) => r.userId)).toEqual(['user_milica']);

    const unqualified = await post(nikola, `/ops/workplace-reviews/engagements/${engagementId}/assign`, { reviewerUserId: 'user_stefan' });
    expect(unqualified.status).toBe(409);
    expect(unqualified.body.code).toBe('reviewer_not_qualified');

    const assigned = await post(nikola, `/ops/workplace-reviews/engagements/${engagementId}/assign`, { reviewerUserId: 'user_milica' });
    expect(assigned.status, JSON.stringify(assigned.body)).toBe(200);
    expect(assigned.body.reviewerFirstName).toBe('Milica');

    const tooEarly = await post(ivana, `/orgs/${ORG}/workplace-reviews/engagements/${engagementId}/book`, { windowIndex: 0 });
    expect(tooEarly.status).toBe(409);
    expect(tooEarly.body.code).toBe('no_windows');

    const start = new Date(Date.now() + 3 * 86_400_000);
    start.setUTCMinutes(0, 0, 0);
    const windows = [0, 1].map((i) => ({ startsAt: new Date(start.getTime() + i * 2 * 3_600_000).toISOString(), endsAt: new Date(start.getTime() + i * 2 * 3_600_000 + 90 * 60_000).toISOString() }));
    const proposed = await post(nikola, `/ops/workplace-reviews/engagements/${engagementId}/windows`, { windows, timeZone: 'Europe/Belgrade' });
    expect(proposed.status, JSON.stringify(proposed.body)).toBe(200);
    expect(proposed.body.proposedWindows).toHaveLength(2);

    const before = sent.length;
    const booked = await post(ivana, `/orgs/${ORG}/workplace-reviews/engagements/${engagementId}/book`, { windowIndex: 0 });
    expect(booked.status, JSON.stringify(booked.body)).toBe(200);
    expect(booked.body).toMatchObject({ status: 'scheduled', proposedWindows: null });
    expect(booked.body.appointment).toMatchObject({ startsAt: windows[0]!.startsAt, endsAt: windows[0]!.endsAt, timeZone: 'Europe/Belgrade', status: 'confirmed' });

    const rows = await testDb.db.select().from(appointments).where(eq(appointments.serviceCategory, 'workplace_review'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ serviceCategory: 'workplace_review', expertUserId: 'user_milica', employeeUserId: 'user_ivana', fundingRef: null });

    const again = await post(ivana, `/orgs/${ORG}/workplace-reviews/engagements/${engagementId}/book`, { windowIndex: 1 });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('invalid_state');

    const mails = sent.slice(before).filter((m) => m.template === 'review_booked');
    expect(mails.map((m) => m.to).sort()).toEqual(['user_ivana@example.com', 'user_milica@example.com']);
  });

  it('the reviewer gets the pack only after the employer shares, with the same hidden cells as the heatmap; revoking closes it', async () => {
    const mine = await get(milica, '/expert/workplace-reviews/engagements');
    expect(mine.status, JSON.stringify(mine.body)).toBe(200);
    expect(mine.body.items.map((e: { id: string }) => e.id)).toEqual([engagementId]);
    expect(JSON.stringify(mine.body)).not.toMatch(/user_ivana|answers/);

    const noGrant = await get(milica, `/expert/workplace-reviews/engagements/${engagementId}/pack`);
    expect(noGrant.status).toBe(409);
    expect(noGrant.body.code).toBe('sharing_revoked');

    const shared = await post(ivana, `/orgs/${ORG}/workplace-reviews/engagements/${engagementId}/sharing`, { snapshotIds: [snapshotId], cohortKeys: ['company', ENGINEERING] });
    expect(shared.status, JSON.stringify(shared.body)).toBe(201);
    expect(shared.body.sharingGrants).toHaveLength(1);
    const grantId = shared.body.sharingGrants[0].id;

    const pack = await get(milica, `/expert/workplace-reviews/engagements/${engagementId}/pack`);
    expect(pack.status, JSON.stringify(pack.body)).toBe(200);
    expect(pack.body.snapshots).toHaveLength(1);
    const heatmap = await get(ivana, `/orgs/${ORG}/listening/heatmap`);
    const heatmapRows = heatmap.body.rows.filter((r: { cohortKey: string }) => ['company', ENGINEERING].includes(r.cohortKey));
    expect(pack.body.snapshots[0].rows).toEqual(heatmapRows);
    expect(JSON.stringify(pack.body)).not.toMatch(/favorableCount|validCount|answers|userId|email/);

    const revoked = await post(ivana, `/orgs/${ORG}/workplace-reviews/engagements/${engagementId}/sharing/${grantId}/revoke`);
    expect(revoked.status).toBe(200);
    expect(revoked.body.sharingGrants[0]).toMatchObject({ active: false });
    expect((await get(milica, `/expert/workplace-reviews/engagements/${engagementId}/pack`)).status).toBe(409);
    await post(ivana, `/orgs/${ORG}/workplace-reviews/engagements/${engagementId}/sharing`, { snapshotIds: [snapshotId], cohortKeys: ['company'] });
  });

  it('the reviewer writes and shares a report; the employer reads the shared version and never the notes; the reporter employee gets 404 everywhere', async () => {
    const sections = {
      context: PARAGRAPH('Mid-size engineering organization after a reorganization.'),
      evidence: PARAGRAPH('Company workload 48.0 percent favorable in the October cycle.'),
      findings: PARAGRAPH('Rota changes arrive with short notice.'),
      uncertainties: PARAGRAPH('Whether the pattern holds outside engineering is unknown.'),
      proposals: PARAGRAPH('Fix the rota two weeks ahead.'),
    };
    const invalid = await put(milica, `/expert/workplace-reviews/engagements/${engagementId}/report`, { sections: { ...sections, findings: { type: 'doc', schemaVersion: 1, content: [{ type: 'bogus' }] } }, evidenceSnapshotIds: [snapshotId] });
    expect(invalid.status).toBe(400);
    expect(invalid.body).toMatchObject({ code: 'validation', details: { section: 'findings' } });

    const draft = await put(milica, `/expert/workplace-reviews/engagements/${engagementId}/report`, { sections, evidenceSnapshotIds: [snapshotId] });
    expect(draft.status, JSON.stringify(draft.body)).toBe(200);
    expect(draft.body).toMatchObject({ version: 1, status: 'draft', authorFirstName: 'Milica' });

    expect((await get(ivana, `/orgs/${ORG}/workplace-reviews/engagements/${engagementId}/report`)).status).toBe(404);
    const note = await post(milica, `/expert/workplace-reviews/engagements/${engagementId}/notes`, { body: 'Ask about the Thursday rota meeting.' });
    expect(note.status).toBe(201);
    expect(note.body.items).toHaveLength(1);

    const before = sent.length;
    const shared = await post(milica, `/expert/workplace-reviews/engagements/${engagementId}/report/share`);
    expect(shared.status, JSON.stringify(shared.body)).toBe(200);
    expect(shared.body).toMatchObject({ version: 1, status: 'shared' });
    expect(sent.slice(before).map((m) => [m.template, m.to])).toEqual([['review_report_shared', 'user_ivana@example.com']]);

    const employer = await get(ivana, `/orgs/${ORG}/workplace-reviews/engagements/${engagementId}/report`);
    expect(employer.status, JSON.stringify(employer.body)).toBe(200);
    expect(employer.body).toMatchObject({ version: 1, status: 'shared' });
    expect(JSON.stringify(employer.body)).not.toContain('Thursday rota meeting');
    expect((await get(ivana, `/orgs/${ORG}/workplace-reviews/engagements/${engagementId}/notes`)).status).toBe(404);
    const engagement = await get(ivana, `/orgs/${ORG}/workplace-reviews/engagements/${engagementId}`);
    expect(engagement.body).toMatchObject({ status: 'report_shared', sharedReport: { version: 1 } });

    // A later save opens version 2; the shared version stays as it is.
    const next = await put(milica, `/expert/workplace-reviews/engagements/${engagementId}/report`, { sections: { ...sections, findings: PARAGRAPH('Revised.') }, evidenceSnapshotIds: [snapshotId] });
    expect(next.body).toMatchObject({ version: 2, status: 'draft' });
    expect((await get(ivana, `/orgs/${ORG}/workplace-reviews/engagements/${engagementId}/report`)).body).toMatchObject({ version: 1, status: 'shared' });

    for (const path of [`/expert/workplace-reviews/engagements/${engagementId}`, `/expert/workplace-reviews/engagements/${engagementId}/pack`, `/orgs/${ORG}/workplace-reviews/engagements/${engagementId}`]) {
      const res = await get(jovan, path);
      expect([403, 404], path).toContain(res.status);
    }
    expect((await get(stefan, `/expert/workplace-reviews/engagements/${engagementId}`)).status).toBe(403);
  });

  it('the reviewer proposes an action, the employer agrees and completes it, plans follow-up and completes the engagement; the cells never changed', async () => {
    const proposed = await post(milica, `/expert/workplace-reviews/engagements/${engagementId}/actions`, {
      title: 'Fix the rota two weeks ahead',
      description: 'Publish the rota on the first of the month for the following month.',
      intendedCheck: 'Workload favorable share in the next two cycles.',
      dimensionKey: 'sustainable_workload',
    });
    expect(proposed.status, JSON.stringify(proposed.body)).toBe(201);
    const actionId = proposed.body.items[0].id;
    expect(proposed.body.items[0]).toMatchObject({ status: 'proposed', proposedBy: 'reviewer' });

    const tooFast = await patch(ivana, `/orgs/${ORG}/workplace-reviews/engagements/${engagementId}/actions/${actionId}`, { status: 'completed' });
    expect(tooFast.status).toBe(409);
    expect(tooFast.body.code).toBe('invalid_state');

    const agreed = await patch(ivana, `/orgs/${ORG}/workplace-reviews/engagements/${engagementId}/actions/${actionId}`, { status: 'agreed', ownerUserId: 'user_stefan' });
    expect(agreed.status, JSON.stringify(agreed.body)).toBe(200);
    expect(agreed.body.items[0]).toMatchObject({ status: 'agreed', ownerFirstName: 'Stefan' });
    const completed = await patch(ivana, `/orgs/${ORG}/workplace-reviews/engagements/${engagementId}/actions/${actionId}`, { status: 'completed' });
    expect(completed.body.items[0].status).toBe('completed');
    expect(completed.body.items[0].completedAt).toEqual(expect.any(String));

    const followUp = await post(milica, `/expert/workplace-reviews/engagements/${engagementId}/follow-up`, { targetDate: new Date(Date.now() + 60 * 86_400_000).toISOString(), ownerUserId: 'user_ivana' });
    expect(followUp.status, JSON.stringify(followUp.body)).toBe(200);
    expect(followUp.body).toMatchObject({ status: 'follow_up', followUp: { ownerFirstName: 'Ivana' } });

    const done = await post(milica, `/expert/workplace-reviews/engagements/${engagementId}/complete`);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.status).toBe('completed');
    expect(done.body.completedAt).toEqual(expect.any(String));

    expect(await cellsSnapshot()).toBe(cellsBefore);
    const overview = await get(ivana, `/orgs/${ORG}/listening/overview`);
    expect(overview.body.current.dimensions.find((d: { key: string }) => d.key === 'sustainable_workload')).toMatchObject({ status: 'danger', score: '48.0' });
    expect(overview.body.reviewOffer).toMatchObject({ eligible: true, activeRequestId: null, activeEngagementId: null });
  });

  it('a second request can be canceled, and canceling a scheduled engagement cancels its meeting and keeps the cells', async () => {
    const created = await post(ivana, `/orgs/${ORG}/workplace-reviews/requests`, {
      snapshotIds: [snapshotId],
      scopeCohortKey: ENGINEERING,
      dimensionKeys: ['sustainable_workload'],
      shareAggregates: false,
      termsVersion: '2026-11',
      noticeVersion: '2026-11',
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const canceled = await post(ivana, `/orgs/${ORG}/workplace-reviews/requests/${created.body.id}/cancel`, { reason: 'Handled internally.' });
    expect(canceled.status).toBe(200);
    expect(canceled.body.status).toBe('canceled');
    expect((await post(ivana, `/orgs/${ORG}/workplace-reviews/requests/${created.body.id}/cancel`)).status).toBe(409);

    // A fresh engagement on the company scope: request, scope, accept, assign, windows, book, then cancel.
    const second = await post(ivana, `/orgs/${ORG}/workplace-reviews/requests`, {
      snapshotIds: [snapshotId],
      scopeCohortKey: 'company',
      dimensionKeys: ['sustainable_workload'],
      shareAggregates: false,
      termsVersion: '2026-11',
      noticeVersion: '2026-11',
    });
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    const scoped = await post(nikola, `/ops/workplace-reviews/requests/${second.body.id}/scopes`, {
      serviceId: 'review_service_introductory_call',
      title: 'Introductory call',
      deliverables: 'A 30-minute call.',
      participants: 'HR lead',
      priceMinor: 0,
      currency: 'EUR',
      termsVersion: '2026-11',
      validUntil: new Date(Date.now() + 86_400_000).toISOString(),
      cancellationPolicy: 'Free.',
    });
    expect(scoped.status, JSON.stringify(scoped.body)).toBe(201);
    const accepted = await post(ivana, `/orgs/${ORG}/workplace-reviews/scopes/${scoped.body.scopes[0].id}/accept`);
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    const id = accepted.body.id;
    expect((await post(nikola, `/ops/workplace-reviews/engagements/${id}/assign`, { reviewerUserId: 'user_milica' })).status).toBe(200);
    const start = new Date(Date.now() + 5 * 86_400_000);
    start.setUTCMinutes(0, 0, 0);
    const window = { startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 30 * 60_000).toISOString() };
    expect((await post(nikola, `/ops/workplace-reviews/engagements/${id}/windows`, { windows: [window], timeZone: 'Europe/Belgrade' })).status).toBe(200);
    const booked = await post(ivana, `/orgs/${ORG}/workplace-reviews/engagements/${id}/book`, { windowIndex: 0 });
    expect(booked.status, JSON.stringify(booked.body)).toBe(200);

    const canceledEngagement = await post(ivana, `/orgs/${ORG}/workplace-reviews/engagements/${id}/cancel`, { reason: 'Postponed to next quarter.' });
    expect(canceledEngagement.status, JSON.stringify(canceledEngagement.body)).toBe(200);
    expect(canceledEngagement.body).toMatchObject({ status: 'canceled', cancelReason: 'Postponed to next quarter.' });
    expect(canceledEngagement.body.appointment).toMatchObject({ status: 'canceled' });
    expect((await get(milica, `/expert/workplace-reviews/engagements/${id}`)).status).toBe(404);
    expect(await cellsSnapshot()).toBe(cellsBefore);
  });
});
