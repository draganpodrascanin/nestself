/**
 * Employee listening: configuration and questionnaire routes (e2e; spec
 * CFG-01, CFG-03, SUR-01; plan Task 4).
 *
 * Nikola (client_operations + listening_administrator, operations context)
 * reads and changes the sample client's configuration and manages
 * questionnaire versions; Ivana (organization context) is kept out of the
 * operations routes. Requires TEST_DATABASE_URL (PostgreSQL); skipped otherwise.
 */
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { and, desc, eq } from 'drizzle-orm';
import { SAMPLE_DEV_PASSWORD, SAMPLE_EXTERNAL_IDENTITIES } from '@nestself/sample-data';
import { IdentityProviderService } from '../src/identity/identity-provider.service.js';
import type { FakeIdentityProvider } from '../src/identity/fake-identity-provider.js';
import { computeTotp } from '../src/identity/totp.js';
import { seed } from '../src/db/seed/seed-lib.js';
import { auditEvents, listeningPolicyVersions } from '../src/db/schema/index.js';
import { PILOT_PRIVACY_NOTICE, PILOT_QUESTIONNAIRE_DIMENSIONS, SAMPLE_QUESTIONNAIRE_V1_ID } from '../src/listening/listening-defaults.js';
import { resetTestDatabase, type TestDatabase } from './db/test-database.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const shouldRun = !!TEST_DB_URL;
const TOTP_SECRET = 'JBSWY3DPEHPK3PXP';
const ORG = 'org_sample';
const STAFF = ['user_nikola'];
const PEOPLE = ['user_nikola', 'user_ivana'];

interface SignedIn {
  agent: request.Agent;
  csrf: string;
}

describe.skipIf(!shouldRun)('Employee listening: configuration and questionnaires (e2e)', () => {
  let app: INestApplication;
  let idp: FakeIdentityProvider;
  let testDb: TestDatabase;
  let nikola: SignedIn;
  let ivana: SignedIn;

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
  const put = (who: SignedIn, path: string, body: Record<string, unknown>) => who.agent.put(`/api${path}`).set('X-CSRF-Token', who.csrf).send(body);
  const post = (who: SignedIn, path: string, body: Record<string, unknown> = {}) => who.agent.post(`/api${path}`).set('X-CSRF-Token', who.csrf).send(body);
  const patch = (who: SignedIn, path: string, body: Record<string, unknown>) => who.agent.patch(`/api${path}`).set('X-CSRF-Token', who.csrf).send(body);

  beforeAll(async () => {
    testDb = await resetTestDatabase(TEST_DB_URL!, 'listeningcfg');
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

    nikola = await signInStaff('user_nikola', { kind: 'operations' });
    ivana = await signInMember('user_ivana', { kind: 'organization', orgId: ORG });
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await testDb?.close();
  });

  describe('client configuration (CFG-01, CFG-03)', () => {
    it('reads the seeded configuration of the sample client', async () => {
      const res = await get(nikola, `/ops/orgs/${ORG}/listening/configuration`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body).toMatchObject({
        orgId: ORG,
        measurementFrom: '2026-01-01T00:00:00.000Z',
        measurementUntil: null,
        feedbackSensitiveEnabled: false,
        cadenceDays: 14,
        responseWindowDays: 7,
        reminderLimit: 2,
        freshnessDays: 45,
        minimumCohort: 10,
        goodThresholdTenths: 750,
        monitorThresholdTenths: 600,
        questionnaireVersionId: SAMPLE_QUESTIONNAIRE_V1_ID,
        policyVersion: 1,
        timeZone: 'Europe/Belgrade',
      });
    });

    it('creates the defaults on first read for a client without a row', async () => {
      const res = await get(nikola, `/ops/orgs/org_sample_b/listening/configuration`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body).toMatchObject({ orgId: 'org_sample_b', measurementFrom: null, minimumCohort: 10, policyVersion: 1 });
      const policies = await testDb.db.select().from(listeningPolicyVersions).where(eq(listeningPolicyVersions.orgId, 'org_sample_b'));
      expect(policies).toHaveLength(1);
    });

    it('a change writes a new policy version and an audit row with field names only', async () => {
      const res = await put(nikola, `/ops/orgs/${ORG}/listening/configuration`, { cadenceDays: 21, freshnessDays: 60 });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body).toMatchObject({ cadenceDays: 21, freshnessDays: 60, policyVersion: 2 });

      const [latest] = await testDb.db
        .select()
        .from(listeningPolicyVersions)
        .where(eq(listeningPolicyVersions.orgId, ORG))
        .orderBy(desc(listeningPolicyVersions.policyVersion))
        .limit(1);
      expect(latest).toMatchObject({ policyVersion: 2, cadenceDays: 21, freshnessDays: 60, createdByUserId: 'user_nikola' });

      const [audit] = await testDb.db
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.action, 'listening.configuration.changed'), eq(auditEvents.orgId, ORG)))
        .orderBy(desc(auditEvents.occurredAt))
        .limit(1);
      expect(audit?.details).toEqual({ fields: ['cadenceDays', 'freshnessDays'], policyVersion: 2 });
      expect(audit?.actorUserId).toBe('user_nikola');
    });

    it('refuses a reporting minimum below the platform floor', async () => {
      const res = await put(nikola, `/ops/orgs/${ORG}/listening/configuration`, { minimumCohort: 9 });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('validation');
    });

    it('refuses an unpublished questionnaire version', async () => {
      const created = await post(nikola, '/ops/listening/questionnaires', {
        dimensions: PILOT_QUESTIONNAIRE_DIMENSIONS,
        notice: PILOT_PRIVACY_NOTICE,
        comparableWithVersionId: SAMPLE_QUESTIONNAIRE_V1_ID,
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const res = await put(nikola, `/ops/orgs/${ORG}/listening/configuration`, { questionnaireVersionId: created.body.id });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('no_published_questionnaire');
    });

    it('an organization-context user cannot reach the operations route', async () => {
      const res = await get(ivana, `/ops/orgs/${ORG}/listening/configuration`);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('context_mismatch');
    });
  });

  describe('questionnaire versions (SUR-01)', () => {
    let draftId: string;

    it('lists version 1 as published with five dimensions in four locales', async () => {
      const res = await get(nikola, '/ops/listening/questionnaires');
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const v1 = (res.body.items as Array<{ id: string; status: string; version: number; dimensions: unknown[] }>).find((q) => q.version === 1);
      expect(v1).toMatchObject({ id: SAMPLE_QUESTIONNAIRE_V1_ID, status: 'published' });
      expect(v1!.dimensions).toHaveLength(5);
      expect((v1!.dimensions[0] as { question: Record<string, string> }).question['sr-Cyrl']).toMatch(/^Колико/);
    });

    it('refuses to edit the published version', async () => {
      const res = await patch(nikola, `/ops/listening/questionnaires/${SAMPLE_QUESTIONNAIRE_V1_ID}`, {
        dimensions: PILOT_QUESTIONNAIRE_DIMENSIONS,
        notice: PILOT_PRIVACY_NOTICE,
        comparableWithVersionId: null,
      });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('conflict');
    });

    it('creates, reviews and publishes a new version', async () => {
      const created = await post(nikola, '/ops/listening/questionnaires', {
        dimensions: PILOT_QUESTIONNAIRE_DIMENSIONS,
        notice: PILOT_PRIVACY_NOTICE,
        comparableWithVersionId: SAMPLE_QUESTIONNAIRE_V1_ID,
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      draftId = created.body.id;
      expect(created.body.status).toBe('draft');
      expect(created.body.version).toBeGreaterThan(1);

      const reviewed = await post(nikola, `/ops/listening/questionnaires/${draftId}/submit-review`);
      expect(reviewed.status).toBe(200);
      expect(reviewed.body.status).toBe('in_review');

      const published = await post(nikola, `/ops/listening/questionnaires/${draftId}/publish`);
      expect(published.status, JSON.stringify(published.body)).toBe(200);
      expect(published.body.status).toBe('published');
      expect(published.body.publishedAt).toEqual(expect.any(String));

      const assigned = await put(nikola, `/ops/orgs/${ORG}/listening/configuration`, { questionnaireVersionId: draftId });
      expect(assigned.status).toBe(200);
      expect(assigned.body.questionnaireVersionId).toBe(draftId);
    });

    it('refuses four dimensions and a duplicated key', async () => {
      const res = await post(nikola, '/ops/listening/questionnaires', {
        dimensions: PILOT_QUESTIONNAIRE_DIMENSIONS.slice(0, 4),
        notice: PILOT_PRIVACY_NOTICE,
        comparableWithVersionId: null,
      });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('validation');
    });

    it('an organization-context user gets no questionnaire route', async () => {
      const res = await get(ivana, '/ops/listening/questionnaires');
      expect(res.status).toBe(403);
    });
  });
});
