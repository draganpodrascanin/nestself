/**
 * Confidential professional-domain e2e tests (T-2.4, T-2.3): the assigned
 * expert and the participant read the sample conversation; employees,
 * organization admins and platform staff are denied, and a denial is
 * audited without any message or intake content.
 *
 * Requires TEST_DATABASE_URL (PostgreSQL). Skipped otherwise.
 */
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import { PERMISSION_TEMPLATES } from '@nestself/contracts';
import { SAMPLE_CASE, SAMPLE_DEV_PASSWORD, SAMPLE_EXTERNAL_IDENTITIES } from '@nestself/sample-data';
import { IdentityProviderService } from '../src/identity/identity-provider.service.js';
import type { FakeIdentityProvider } from '../src/identity/fake-identity-provider.js';
import { computeTotp } from '../src/identity/totp.js';
import { PrincipalLoader } from '../src/principal/principal-loader.js';
import { seed } from '../src/db/seed/seed-lib.js';
import { auditEvents, conversations, grants } from '../src/db/schema/index.js';
import { KEY_VALUE_STORE, type KeyValueStore } from '../src/redis/key-value-store.js';
import { sessionKey } from '../src/redis/redis-keys.js';
import { hashSessionId } from '../src/session/session-helpers.js';
import { resetTestDatabase, type TestDatabase } from './db/test-database.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const shouldRun = !!TEST_DB_URL;

const ORG = 'org_sample';
const CONV = `/api/professional/conversations/${SAMPLE_CASE.conversation.id}`;
const MY_CONV = `/api/professional/me/conversations/${SAMPLE_CASE.conversation.id}`;
const INTAKE = `/api/professional/intake/${SAMPLE_CASE.intake.id}`;
const ASSIGNED_LIST = '/api/professional/conversations';
const MY_LIST = '/api/professional/me/conversations';
/** Fixed TOTP secret for the staff users of this suite (base32). */
const TOTP_SECRET = 'JBSWY3DPEHPK3PXP';
const STAFF = ['user_milica', 'user_nikola'];
const PEOPLE = ['user_milica', 'user_nikola', 'user_jovan', 'user_ivana'];
const MILICA_EXPERT_GRANT = 'grant_user_milica_expert';

describe.skipIf(!shouldRun)('Professional confidential domain (e2e)', () => {
  let app: INestApplication;
  let idp: FakeIdentityProvider;
  let testDb: TestDatabase;
  const jwtSecret = randomBytes(32).toString('hex');

  beforeAll(async () => {
    testDb = await resetTestDatabase(TEST_DB_URL!, 'professional');
    await seed(testDb.db);

    process.env.DATABASE_URL = testDb.url;
    process.env.AUTH_MODE = 'stub';
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

    // The fake pool gets the sample subjects the seed already linked; staff
    // sign in with the development password and an enrolled TOTP.
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

    const base = {
      scopeOrgId: null,
      scopeOrgUnitId: null,
      includeDescendants: false,
      grantedAt: new Date('2026-01-01'),
      validFrom: new Date('2026-01-01'),
    };
    // Milica reaches the case through her seeded expert grant
    // (assigned_cases) and the seeded CASE assignment. Nikola gets a
    // platform_owner grant listing the action, to show it returns no
    // confidential content.
    const platformOwner = PERMISSION_TEMPLATES.find((t) => t.key === 'platform_owner')!;
    await testDb.db.insert(grants).values({
      ...base,
      id: 'grant_test_nikola_platform_owner',
      subjectUserId: 'user_nikola',
      templateKey: platformOwner.key,
      actions: [...platformOwner.actions, 'conversation.read.assigned'],
      scopeType: platformOwner.scopeType,
      grantedByUserId: 'user_nikola',
    });
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await testDb?.close();
  });

  function extractCsrf(res: request.Response): string {
    const cookies = res.headers['set-cookie'] as string[] | undefined;
    const csrf = cookies?.find((c) => c.startsWith('nestself_csrf='))?.match(/nestself_csrf=([^;]+)/);
    if (!csrf) throw new Error('CSRF cookie not found');
    return csrf[1]!;
  }

  async function switchContext(agent: request.Agent, csrf: string, context: Record<string, string>) {
    const res = await agent.post('/api/auth/context').set('X-CSRF-Token', csrf).send({ context });
    expect(res.status).toBe(200);
  }

  /** Password + TOTP sign-in for staff and experts. */
  async function signInStaff(userId: string, context: Record<string, string>) {
    const agent = request.agent(app.getHttpServer());
    const pw = await agent
      .post('/api/auth/password')
      .send({ email: `${userId}@example.com`, password: SAMPLE_DEV_PASSWORD });
    expect(pw.status).toBe(200);
    expect(pw.body).toHaveProperty('step', 'totp');
    const totp = await agent
      .post('/api/auth/challenge')
      .send({ challengeToken: pw.body.challengeToken, response: computeTotp(TOTP_SECRET) });
    expect(totp.status).toBe(200);
    const csrf = extractCsrf(totp);
    await switchContext(agent, csrf, context);
    return agent;
  }

  function extractSessionId(...responses: request.Response[]): string {
    for (const res of [...responses].reverse()) {
      const cookies = (res.headers['set-cookie'] as unknown as string[] | undefined) ?? [];
      const match = cookies.map((c) => c.match(/nestself_session=([^;]+)/)).find(Boolean);
      if (match) return match[1]!;
    }
    throw new Error('Session cookie not found');
  }

  /** Move the session's authentication time 20 minutes into the past (beyond the restricted class's 15). */
  async function ageSession(sessionId: string) {
    const store = app.get<KeyValueStore>(KEY_VALUE_STORE);
    const key = sessionKey(hashSessionId(sessionId));
    const raw = await store.get(key);
    expect(raw).not.toBeNull();
    const ttl = await store.ttl(key);
    const record = JSON.parse(raw!) as { auth: { time: string } };
    record.auth.time = new Date(Date.now() - 20 * 60_000).toISOString();
    await store.set(key, JSON.stringify(record), { ttlSeconds: ttl });
  }

  /** Email-OTP sign-in for employees and organization admins. */
  async function signInMember(userId: string, orgContext = true) {
    const email = `${userId}@example.com`;
    const agent = request.agent(app.getHttpServer());
    const start = await agent.post('/api/auth/email-otp/start').send({ email });
    expect(start.status).toBe(200);
    const code = idp.sentCodes.filter((c) => c.email === email).pop()!.code;
    const verify = await agent
      .post('/api/auth/email-otp/verify')
      .send({ challengeToken: start.body.challengeToken, code });
    expect(verify.status).toBe(200);
    if (orgContext) {
      await switchContext(agent, extractCsrf(verify), { kind: 'organization', orgId: ORG });
    }
    return agent;
  }

  const expectedMessages = SAMPLE_CASE.conversation.messages.map((m) => ({
    id: m.id,
    authorUserId: m.authorUserId,
    body: m.body,
    createdAt: m.createdAt,
  }));

  it('the assigned expert reads the conversation and the intake record', async () => {
    const [seeded] = await testDb.db.select().from(grants).where(eq(grants.id, MILICA_EXPERT_GRANT));
    expect(seeded).toMatchObject({ templateKey: 'expert', scopeType: 'assigned_cases', revokedAt: null });
    expect(seeded!.actions).toContain('conversation.read.assigned');

    const milica = await signInStaff('user_milica', { kind: 'expert' });

    const conv = await milica.get(CONV);
    expect(conv.status).toBe(200);
    expect(conv.body).toEqual({
      id: SAMPLE_CASE.conversation.id,
      caseId: SAMPLE_CASE.id,
      orgId: ORG,
      messages: expectedMessages,
    });

    const intake = await milica.get(INTAKE);
    expect(intake.status).toBe(200);
    expect(intake.body).toEqual({
      id: SAMPLE_CASE.intake.id,
      caseId: SAMPLE_CASE.id,
      orgId: ORG,
      body: SAMPLE_CASE.intake.body,
      createdAt: SAMPLE_CASE.intake.createdAt,
    });

    const missing = await milica.get('/api/professional/conversations/conv_missing');
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe('not_found');
  });

  it('the assigned expert needs a restricted-class step-up: a 20-minute-old session gets 403 step_up_required', async () => {
    const agent = request.agent(app.getHttpServer());
    const pw = await agent
      .post('/api/auth/password')
      .send({ email: 'user_milica@example.com', password: SAMPLE_DEV_PASSWORD });
    const totp = await agent
      .post('/api/auth/challenge')
      .send({ challengeToken: pw.body.challengeToken, response: computeTotp(TOTP_SECRET) });
    expect(totp.status).toBe(200);
    const ctx = await agent
      .post('/api/auth/context')
      .set('X-CSRF-Token', extractCsrf(totp))
      .send({ context: { kind: 'expert' } });
    expect(ctx.status).toBe(200);
    await ageSession(extractSessionId(totp, ctx));

    const res = await agent.get(CONV);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('step_up_required');
    expect(res.body.details).toMatchObject({ stepUpClass: 'restricted', maxAge: 900 });
    expect(res.body).not.toHaveProperty('messages');
  });

  it('the participant reads their own conversation but not through the expert route', async () => {
    // C1: employee stays in personal context (no org-workspace grant).
    const jovan = await signInMember('user_jovan', false);

    const own = await jovan.get(MY_CONV);
    expect(own.status).toBe(200);
    expect(own.body.messages).toEqual(expectedMessages);

    const expertRoute = await jovan.get(CONV);
    expect(expertRoute.status).toBe(403);
    expect(expertRoute.body.code).toBe('forbidden');
  });

  it('a platform_owner grant does not reach the conversation', async () => {
    const nikola = await signInStaff('user_nikola', { kind: 'operations' });
    const res = await nikola.get(CONV);
    // Nikola holds no CASE assignment, so the engine denies at the
    // assignment step (no_matching_assignment) before grants are matched;
    // the exclusion of platform and other administrative scopes is proven by
    // the golden rows CONF-DENY-01/02/05/06. Staff templates count as
    // organization visibility, so require() answers 403, not 404.
    expect(res.status).toBe(403);
    expect(res.body).not.toHaveProperty('messages');

    const [denied] = await testDb.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.action, 'access.denied'), eq(auditEvents.actorUserId, 'user_nikola')));
    expect(denied!.details).toMatchObject({ actionAttempted: 'conversation.read.assigned', reason: 'no_matching_assignment' });
  });

  it('an hr_admin is denied and the denial is audited without content', async () => {
    const ivana = await signInMember('user_ivana');
    const res = await ivana.get(CONV);
    expect(res.status).toBe(403);
    expect(res.body).not.toHaveProperty('messages');

    const rows = await testDb.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.action, 'access.denied'), eq(auditEvents.actorUserId, 'user_ivana')));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.details).toMatchObject({
      actionAttempted: 'conversation.read.assigned',
      resourceType: 'conversation',
      resourceId: SAMPLE_CASE.id,
    });

    // No audit row anywhere carries message or intake text.
    const all = await testDb.db.select({ details: auditEvents.details }).from(auditEvents);
    const serialized = JSON.stringify(all);
    for (const body of [...SAMPLE_CASE.conversation.messages.map((m) => m.body), SAMPLE_CASE.intake.body]) {
      expect(serialized).not.toContain(body);
    }
  });

  const expectedSummary = {
    id: SAMPLE_CASE.conversation.id,
    caseId: SAMPLE_CASE.id,
    orgId: ORG,
    employeeUserId: SAMPLE_CASE.employeeUserId,
    expertUserId: SAMPLE_CASE.expertUserId,
    createdAt: expect.any(String),
    messageCount: SAMPLE_CASE.conversation.messages.length,
  };

  describe('conversation lists (metadata only)', () => {
    it('the assigned expert lists the conversation of her CASE assignment without any body', async () => {
      const milica = await signInStaff('user_milica', { kind: 'expert' });
      const res = await milica.get(ASSIGNED_LIST);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ items: [expectedSummary], nextCursor: null });
      expect(JSON.stringify(res.body)).not.toContain(SAMPLE_CASE.conversation.messages[0]!.body);
    });

    it('the list needs no step-up: a 20-minute-old expert session still lists, while the read is refused', async () => {
      const agent = request.agent(app.getHttpServer());
      const pw = await agent
        .post('/api/auth/password')
        .send({ email: 'user_milica@example.com', password: SAMPLE_DEV_PASSWORD });
      const totp = await agent
        .post('/api/auth/challenge')
        .send({ challengeToken: pw.body.challengeToken, response: computeTotp(TOTP_SECRET) });
      const ctx = await agent.post('/api/auth/context').set('X-CSRF-Token', extractCsrf(totp)).send({ context: { kind: 'expert' } });
      await ageSession(extractSessionId(totp, ctx));

      const list = await agent.get(ASSIGNED_LIST);
      expect(list.status).toBe(200);
      expect(list.body.items).toHaveLength(1);
      expect((await agent.get(CONV)).body.code).toBe('step_up_required');
    });

    it('the participant lists their own conversation and sees nothing on the assigned list', async () => {
      // Ruling E: employees stay in personal context (no org-workspace grant).
      const jovan = await signInMember('user_jovan', false);
      const own = await jovan.get(MY_LIST);
      expect(own.status).toBe(200);
      expect(own.body).toEqual({ items: [expectedSummary], nextCursor: null });

      const assigned = await jovan.get(ASSIGNED_LIST);
      expect(assigned.status).toBe(200);
      expect(assigned.body).toEqual({ items: [], nextCursor: null });
    });

    it('an hr_admin and platform staff list nothing, and listing writes no access.denied audit', async () => {
      const ivana = await signInMember('user_ivana');
      expect((await ivana.get(ASSIGNED_LIST)).body).toEqual({ items: [], nextCursor: null });
      expect((await ivana.get(MY_LIST)).body).toEqual({ items: [], nextCursor: null });

      const nikola = await signInStaff('user_nikola', { kind: 'operations' });
      const before = await testDb.db.select().from(auditEvents).where(eq(auditEvents.actorUserId, 'user_nikola'));
      expect((await nikola.get(ASSIGNED_LIST)).body).toEqual({ items: [], nextCursor: null });
      const after = await testDb.db.select().from(auditEvents).where(eq(auditEvents.actorUserId, 'user_nikola'));
      expect(after.filter((e) => e.action === 'access.denied')).toHaveLength(
        before.filter((e) => e.action === 'access.denied').length,
      );
    });

    it('pages the participant list by cursor, newest first, through exactly the full list', async () => {
      await testDb.db.insert(conversations).values(
        [1, 2, 3].map((n) => ({
          id: `conv_test_page_${n}`,
          orgId: ORG,
          caseId: `case_test_page_${n}`,
          employeeUserId: 'user_jovan',
          expertUserId: 'user_milica',
          createdAt: new Date(Date.now() + n * 1000),
        })),
      );
      // Ruling E: employees stay in personal context.
      const jovan = await signInMember('user_jovan', false);

      const full = await jovan.get(MY_LIST).query({ limit: 100 });
      expect(full.status).toBe(200);
      expect(full.body.nextCursor).toBeNull();
      const all = (full.body.items as Array<{ id: string; messageCount: number }>).map((i) => i.id);
      expect(all.slice(0, 3)).toEqual(['conv_test_page_3', 'conv_test_page_2', 'conv_test_page_1']);
      expect(all).toContain(SAMPLE_CASE.conversation.id);

      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const page: request.Response = await jovan.get(MY_LIST).query(cursor ? { limit: 1, cursor } : { limit: 1 });
        expect(page.status).toBe(200);
        expect(page.body.items.length).toBeLessThanOrEqual(1);
        seen.push(...(page.body.items as Array<{ id: string }>).map((i) => i.id));
        cursor = page.body.nextCursor as string | null;
      } while (cursor);
      expect(seen).toEqual(all);

      // The extra cases are not assigned to milica, so her list is unchanged.
      const milica = await signInStaff('user_milica', { kind: 'expert' });
      expect((await milica.get(ASSIGNED_LIST)).body).toEqual({ items: [expectedSummary], nextCursor: null });
    });

    it('rejects a limit outside 1..100 with 400 and answers an unknown cursor with an empty page', async () => {
      // Ruling E: employees stay in personal context.
      const jovan = await signInMember('user_jovan', false);
      expect((await jovan.get(MY_LIST).query({ limit: 0 })).status).toBe(400);
      expect((await jovan.get(MY_LIST).query({ limit: 101 })).status).toBe(400);
      const unknown = await jovan.get(MY_LIST).query({ cursor: 'conv_missing' });
      expect(unknown.status).toBe(200);
      expect(unknown.body).toEqual({ items: [], nextCursor: null });
    });

    it('the list routes require a session: 401 without one', async () => {
      expect((await request(app.getHttpServer()).get(ASSIGNED_LIST)).status).toBe(401);
      expect((await request(app.getHttpServer()).get(MY_LIST)).status).toBe(401);
    });
  });

  it('the expert loses the conversation once her expert grant is revoked', async () => {
    await testDb.db
      .update(grants)
      .set({ revokedAt: new Date(), revokedReason: 'test_fixture' })
      .where(eq(grants.id, MILICA_EXPERT_GRANT));
    await app.get(PrincipalLoader).invalidateUser('user_milica', [ORG]);

    const milica = await signInStaff('user_milica', { kind: 'expert' });
    // An expert has no membership or staff template, so the denial is a 404.
    const res = await milica.get(CONV);
    expect(res.status).toBe(404);
    expect(res.body).not.toHaveProperty('messages');

    // The CASE assignment remains, but the list applies the same engine check.
    const list = await milica.get(ASSIGNED_LIST);
    expect(list.status).toBe(200);
    expect(list.body).toEqual({ items: [], nextCursor: null });
  });
});
