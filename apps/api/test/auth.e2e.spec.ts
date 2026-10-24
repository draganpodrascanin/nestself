/**
 * Auth e2e tests — full HTTP round-trips through NestJS with the FakeIdentityProvider.
 *
 * Requires TEST_DATABASE_URL (PostgreSQL). Skipped otherwise.
 *
 * @see T-1.4, T-1.6, T-1.7
 */
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { IdentityProviderService } from '../src/identity/identity-provider.service.js';
import type { FakeIdentityProvider } from '../src/identity/fake-identity-provider.js';
import { computeTotp } from '../src/identity/totp.js';
import { seed } from '../src/db/seed/seed-lib.js';
import { externalIdentities, memberships } from '../src/db/schema/index.js';
import { and, eq } from 'drizzle-orm';
import { KEY_VALUE_STORE, type KeyValueStore } from '../src/redis/key-value-store.js';
import { hashSessionId } from '../src/session/session-helpers.js';
import { sessionKey } from '../src/redis/redis-keys.js';
import { resetTestDatabase, type TestDatabase } from './db/test-database.js';
import {
  MeResponseSchema,
  PasswordResponseSchema,
} from '@nestself/contracts';

// ---------------------------------------------------------------------------
// Guard
// ---------------------------------------------------------------------------

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const shouldRun = !!TEST_DB_URL;

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe.skipIf(!shouldRun)('Auth (e2e)', () => {
  let app: INestApplication;
  let idp: FakeIdentityProvider;
  let testDb: TestDatabase;

  // Cookie-jar agent for the employee sign-in flow.
  let agent: ReturnType<typeof request.agent>;
  // CSRF token extracted from Set-Cookie after sign-in.
  let csrfToken: string;

  const jwtSecret = randomBytes(32).toString('hex');

  // -----------------------------------------------------------------------
  // Bootstrap
  // -----------------------------------------------------------------------

  beforeAll(async () => {
    // -- Prepare test database (drop, create, migrate, seed) -------------------
    testDb = await resetTestDatabase(TEST_DB_URL!, 'auth');
    await seed(testDb.db);

    // -- Set env for the NestJS app ------------------------------------------
    process.env.DATABASE_URL = testDb.url;
    process.env.AUTH_MODE = 'stub';
    process.env.JWT_SECRET = jwtSecret;
    process.env.SESSION_COOKIE_INSECURE_DEV = 'true';
    process.env.NODE_ENV = 'test';
    // Use in-memory KV store so throttle state is isolated per test run.
    delete process.env.REDIS_URL;

    // -- Bootstrap NestJS app ------------------------------------------------
    // AppModule is imported lazily: ConfigModule.forRoot() validates process.env when the
    // module file is evaluated, so the test database URL above must already be in place.
    const { AppModule } = await import('../src/app.module.js');
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    const { ApiExceptionFilter } = await import('../src/common/api-exception.filter.js');

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();

    // -- Seed FakeIdentityProvider -------------------------------------------
    idp = app.get(IdentityProviderService) as FakeIdentityProvider;
    idp.seedUsers([
      { email: 'user_jovan@example.com' },
      { email: 'user_stefan@example.com' },
      { email: 'user_ivana@example.com' },
      { email: 'user_nikola@example.com', password: 'TempPassword1!', temporaryPassword: 'TempPassword1!' },
      // Pool-only users for the retry cases: they never reach a session.
      { email: 'retry_exhaust@example.com' },
      { email: 'retry_lock@example.com' },
    ]);

    // Link FakeIdentityProvider subs → ExternalIdentity rows.
    const people = [
      { localId: 'user_jovan', email: 'user_jovan@example.com' },
      { localId: 'user_stefan', email: 'user_stefan@example.com' },
      { localId: 'user_ivana', email: 'user_ivana@example.com' },
      { localId: 'user_nikola', email: 'user_nikola@example.com' },
    ];
    for (const p of people) {
      const idpUser = await idp.findUserByEmail(p.email);
      if (!idpUser) throw new Error(`FakeIDP user not found: ${p.email}`);
      await testDb.db.insert(externalIdentities).values({
        userId: p.localId,
        provider: 'cognito',
        subject: idpUser.sub,
        cognitoUsername: idpUser.username,
        email: p.email,
        emailVerified: true,
      });
    }

    agent = request.agent(app.getHttpServer());
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await testDb?.close();
  });

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  function extractCsrf(res: request.Response): string {
    const cookies = res.headers['set-cookie'] as string[] | undefined;
    if (!cookies) throw new Error('No Set-Cookie headers in response');
    const csrfCookie = cookies.find((c: string) => c.startsWith('nestself_csrf='));
    if (!csrfCookie) throw new Error('CSRF cookie not found');
    const match = csrfCookie.match(/nestself_csrf=([^;]+)/);
    if (!match) throw new Error('Could not parse CSRF token');
    return match[1]!;
  }

  /** The newest code the fake provider sent to an address. */
  function lastSentCode(email: string): string {
    return idp.sentCodes.filter((c) => c.email === email).pop()!.code;
  }

  /** A well-formed code guaranteed to differ from `code`. */
  function wrongCode(code: string): string {
    return code === '000000' ? '111111' : '000000';
  }

  // -----------------------------------------------------------------------
  // 1. Employee email-OTP sign-in
  // -----------------------------------------------------------------------

  it('employee email-OTP: start → verify → session cookies (item 1: schema parse)', async () => {
    const startRes = await agent
      .post('/api/auth/email-otp/start')
      .send({ email: 'user_jovan@example.com' });
    expect(startRes.status).toBe(200);
    expect(startRes.body).toHaveProperty('challengeToken');
    expect(startRes.body).toHaveProperty('codeDeliveryMedium', 'EMAIL');

    const { challengeToken } = startRes.body;
    const sent = idp.sentCodes;
    const lastCode = sent.filter((c) => c.email === 'user_jovan@example.com').pop();
    expect(lastCode).toBeDefined();

    const verifyRes = await agent
      .post('/api/auth/email-otp/verify')
      .send({ challengeToken, code: lastCode!.code });
    expect(verifyRes.status).toBe(200);

    // Item 1: parse with contracts schema
    const verifyBody = MeResponseSchema.parse(verifyRes.body);
    expect(verifyBody.principal.userId).toBe('user_jovan');
    expect(verifyBody.principal.auth).toMatchObject({ method: 'email_otp', secondFactor: false });

    const setCookies = verifyRes.headers['set-cookie'] as unknown as string[];
    expect(setCookies.some((c: string) => c.startsWith('nestself_session='))).toBe(true);
    expect(setCookies.some((c: string) => c.startsWith('nestself_csrf='))).toBe(true);

    csrfToken = extractCsrf(verifyRes);
  });

  // -----------------------------------------------------------------------
  // 2. GET /auth/me returns the principal
  // -----------------------------------------------------------------------

  it('GET /api/auth/me returns authenticated principal (item 1: schema parse)', async () => {
    const res = await agent.get('/api/auth/me');
    expect(res.status).toBe(200);

    // Item 1: parse with contracts schema
    const me = MeResponseSchema.parse(res.body);
    expect(me.principal.userId).toBe('user_jovan');
  });

  // -----------------------------------------------------------------------
  // 2b. Profile updates
  // -----------------------------------------------------------------------

  it('PATCH /api/auth/me/locale and /me/display-name update the profile', async () => {
    const localeRes = await agent
      .patch('/api/auth/me/locale')
      .set('X-CSRF-Token', csrfToken)
      .send({ locale: 'hu' });
    expect(localeRes.status).toBe(200);
    expect(localeRes.body.principal.locale).toBe('hu');

    const nameRes = await agent
      .patch('/api/auth/me/display-name')
      .set('X-CSRF-Token', csrfToken)
      .send({ displayName: 'Jovan P.' });
    expect(nameRes.status).toBe(200);
    expect(nameRes.body.principal.initials).toBe('JP');

    // The cache was dropped: /me reflects the new values on the next request.
    const meRes = await agent.get('/api/auth/me');
    expect(meRes.body.principal.locale).toBe('hu');
    expect(meRes.body.principal.displayName).toBe('Jovan P.');

    const badRes = await agent
      .patch('/api/auth/me/locale')
      .set('X-CSRF-Token', csrfToken)
      .send({ locale: 'xx' });
    expect(badRes.status).toBe(400);
  });

  // -----------------------------------------------------------------------
  // 3. CSRF rejection: mutating request without X-CSRF-Token → 403
  // -----------------------------------------------------------------------

  it('POST without X-CSRF-Token is rejected by CsrfGuard', async () => {
    const res = await agent
      .post('/api/auth/sign-out-all')
      .send({});
    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('code', 'csrf_rejected');
  });

  // -----------------------------------------------------------------------
  // 4. CSRF acceptance: mutating request with correct header succeeds
  // -----------------------------------------------------------------------

  it('POST with correct X-CSRF-Token succeeds', async () => {
    const res = await agent
      .post('/api/auth/sign-out-all')
      .set('X-CSRF-Token', csrfToken)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('signedOutOthers', true);
  });

  // -----------------------------------------------------------------------
  // 5. Context switch
  // -----------------------------------------------------------------------

  it('POST /api/auth/context switches the active context (item 1: schema parse)', async () => {
    const res = await agent
      .post('/api/auth/context')
      .set('X-CSRF-Token', csrfToken)
      .send({ context: { kind: 'personal' } });
    expect(res.status).toBe(200);

    // Item 1: parse with contracts schema
    const ctxBody = MeResponseSchema.parse(res.body);
    // ACC-R-12: personal context resolves orgId from ACTIVE date-current membership.
    expect(ctxBody.principal.context).toEqual({ kind: 'personal', orgId: 'org_sample' });

    // C1: a plain employee cannot switch to the organization context
    // (no org-workspace template grant via canEnterContext).
    const orgDenied = await agent
      .post('/api/auth/context')
      .set('X-CSRF-Token', csrfToken)
      .send({ context: { kind: 'organization', orgId: 'org_sample' } });
    expect(orgDenied.status).toBe(403);
    expect(orgDenied.body).toHaveProperty('code', 'invalid_context');

    // An employee cannot claim operations, expert, or unknown org contexts.
    for (const context of [{ kind: 'operations' }, { kind: 'expert' }, { kind: 'organization', orgId: 'org_other' }]) {
      const denied = await agent
        .post('/api/auth/context')
        .set('X-CSRF-Token', csrfToken)
        .send({ context });
      expect(denied.status).toBe(403);
      expect(denied.body).toHaveProperty('code', 'invalid_context');
    }

    // Confirm the context was unchanged (still personal).
    const me = await agent.get('/api/auth/me');
    const meBody = MeResponseSchema.parse(me.body);
    expect(meBody.principal.context).toEqual({ kind: 'personal', orgId: 'org_sample' });
  });

  // -----------------------------------------------------------------------
  // 6. Programme route access control
  // -----------------------------------------------------------------------

  it('employee is denied access to programme route (403)', async () => {
    const res = await agent
      .get('/api/orgs/org_sample/programme')
      .set('X-CSRF-Token', csrfToken);
    expect(res.status).toBe(403);
  });

  it('hr_admin can access programme route', async () => {
    // Sign in as hr_admin (user_ivana).
    const hrAgent = request.agent(app.getHttpServer());
    const startRes = await hrAgent
      .post('/api/auth/email-otp/start')
      .send({ email: 'user_ivana@example.com' });
    expect(startRes.status).toBe(200);

    const sent = idp.sentCodes;
    const lastCode = sent.filter((c) => c.email === 'user_ivana@example.com').pop();
    expect(lastCode).toBeDefined();

    const verifyRes = await hrAgent
      .post('/api/auth/email-otp/verify')
      .send({ challengeToken: startRes.body.challengeToken, code: lastCode!.code });
    expect(verifyRes.status).toBe(200);

    const hrCsrf = extractCsrf(verifyRes);

    // Item 2: hr_admin now signs in with personal context; switch to org first.
    const ctxRes = await hrAgent
      .post('/api/auth/context')
      .set('X-CSRF-Token', hrCsrf)
      .send({ context: { kind: 'organization', orgId: 'org_sample' } });
    expect(ctxRes.status).toBe(200);

    const progRes = await hrAgent
      .get('/api/orgs/org_sample/programme')
      .set('X-CSRF-Token', hrCsrf);
    expect(progRes.status).toBe(200);

    // Clean up: sign out.
    await hrAgent
      .post('/api/auth/sign-out')
      .set('X-CSRF-Token', hrCsrf);
  });

  // -----------------------------------------------------------------------
  // 7. Staff password + TOTP flow
  // -----------------------------------------------------------------------

  it('staff password flow: temp password → new password → MFA setup → TOTP → tokens (item 1: schema parse)', async () => {
    const staffAgent = request.agent(app.getHttpServer());

    // Step 1: POST /auth/password with temporary password → NEW_PASSWORD_REQUIRED.
    const pwRes = await staffAgent
      .post('/api/auth/password')
      .send({ email: 'user_nikola@example.com', password: 'TempPassword1!' });
    expect(pwRes.status).toBe(200);
    // Item 1: parse password response with contracts schema
    const pwBody = PasswordResponseSchema.parse(pwRes.body);
    expect('step' in pwBody && pwBody.step).toBe('new_password');
    let challengeToken = 'challengeToken' in pwBody ? (pwBody.challengeToken as string) : '';

    // Step 2: Respond with new password → MFA_SETUP (user has no TOTP enrolled).
    const newPwRes = await staffAgent
      .post('/api/auth/challenge')
      .send({ challengeToken, response: 'NewSecurePassword1!' });
    expect(newPwRes.status).toBe(200);
    // Item 1: parse challenge response
    const challengeBody = PasswordResponseSchema.parse(newPwRes.body);
    expect('step' in challengeBody && challengeBody.step).toBe('totp_enrol');
    const mfaSetupToken = 'challengeToken' in challengeBody ? (challengeBody.challengeToken as string) : '';
    expect(mfaSetupToken).toBeTruthy();
    challengeToken = mfaSetupToken;

    // Step 3: Enrol TOTP → get secretUri.
    const enrolRes = await staffAgent
      .post('/api/auth/totp/enrol')
      .send({ challengeToken });
    expect(enrolRes.status).toBe(200);
    expect(enrolRes.body).toHaveProperty('secretUri');
    const secretUri = enrolRes.body.secretUri as string;
    const secretMatch = secretUri.match(/secret=([A-Z2-7]+)/);
    expect(secretMatch).toBeTruthy();
    const totpSecret = secretMatch![1]!;

    // Use the new challengeToken if one was returned.
    if (enrolRes.body.challengeToken) {
      challengeToken = enrolRes.body.challengeToken as string;
    }

    // Step 4: Complete MFA setup via /auth/challenge with the enrolment challenge token.
    const completeRes = await staffAgent
      .post('/api/auth/challenge')
      .send({ challengeToken, response: computeTotp(totpSecret) });
    expect(completeRes.status).toBe(200);
    // Item 1: parse the final challenge response (MeResponse branch of the union)
    const completeBody = PasswordResponseSchema.parse(completeRes.body);
    expect('principal' in completeBody).toBe(true);
    if ('principal' in completeBody) {
      expect(completeBody.principal.userId).toBe('user_nikola');
      expect(completeBody.principal.auth).toMatchObject({ method: 'password_totp', secondFactor: true });
    }

    const staffCsrf = extractCsrf(completeRes);
    expect(staffCsrf).toBeTruthy();

    await staffAgent
      .post('/api/auth/sign-out')
      .set('X-CSRF-Token', staffCsrf);
  });

  // -----------------------------------------------------------------------
  // 8. Sessions list and revoke
  // -----------------------------------------------------------------------

  it('sessions list includes the current session; revoke destroys another', async () => {
    // Create a second session for user_jovan.
    const secondAgent = request.agent(app.getHttpServer());
    const startRes = await secondAgent
      .post('/api/auth/email-otp/start')
      .send({ email: 'user_jovan@example.com' });
    const code = idp.sentCodes.filter((c) => c.email === 'user_jovan@example.com').pop()!.code;
    const verifyRes = await secondAgent
      .post('/api/auth/email-otp/verify')
      .send({ challengeToken: startRes.body.challengeToken, code });
    expect(verifyRes.status).toBe(200);
    const secondCsrf = extractCsrf(verifyRes);

    // List sessions from the second session — should see at least 2.
    const listRes = await secondAgent
      .get('/api/auth/sessions')
      .set('X-CSRF-Token', secondCsrf);
    expect(listRes.status).toBe(200);
    expect(listRes.body.sessions.length).toBeGreaterThanOrEqual(2);
    const current = listRes.body.sessions.find((s: { isCurrent: boolean }) => s.isCurrent);
    expect(current).toBeDefined();

    // Find a non-current session and revoke it.
    const other = listRes.body.sessions.find((s: { isCurrent: boolean }) => !s.isCurrent);
    expect(other).toBeDefined();
    const revokeRes = await secondAgent
      .delete(`/api/auth/sessions/${other.sessionId}`)
      .set('X-CSRF-Token', secondCsrf);
    expect(revokeRes.status).toBe(200);
    expect(revokeRes.body).toHaveProperty('destroyed', true);

    // The revoked session should no longer appear in the list.
    const listRes2 = await secondAgent
      .get('/api/auth/sessions')
      .set('X-CSRF-Token', secondCsrf);
    const revoked = listRes2.body.sessions.find(
      (s: { sessionId: string }) => s.sessionId === other.sessionId,
    );
    expect(revoked).toBeUndefined();

    // Keep secondAgent signed in for sign-out test.
    agent = secondAgent;
    csrfToken = secondCsrf;
  });

  // -----------------------------------------------------------------------
  // 9. Sign-out → subsequent /me returns 401
  // -----------------------------------------------------------------------

  it('POST /api/auth/sign-out clears session; /me returns 401', async () => {
    const signOutRes = await agent
      .post('/api/auth/sign-out')
      .set('X-CSRF-Token', csrfToken);
    expect(signOutRes.status).toBe(200);
    expect(signOutRes.body).toHaveProperty('signedOut', true);

    const meRes = await agent.get('/api/auth/me');
    expect(meRes.status).toBe(401);
  });

  // -----------------------------------------------------------------------
  // 10. Lockout after 5 wrong OTP codes
  // -----------------------------------------------------------------------

  it('locks out after 5 wrong OTP codes', async () => {
    const lockAgent = request.agent(app.getHttpServer());

    for (let i = 0; i < 5; i++) {
      const startRes = await lockAgent
        .post('/api/auth/email-otp/start')
        .send({ email: 'user_stefan@example.com' });
      expect(startRes.status).toBe(200);

      const verifyRes = await lockAgent
        .post('/api/auth/email-otp/verify')
        .send({ challengeToken: startRes.body.challengeToken, code: '000000' });
      expect(verifyRes.status).toBe(401);
    }

    // The 6th attempt should be throttled at the start endpoint.
    const blockedStart = await lockAgent
      .post('/api/auth/email-otp/start')
      .send({ email: 'user_stefan@example.com' });
    expect(blockedStart.status).toBe(429);
    expect(blockedStart.body).toHaveProperty('code', 'too_many_attempts');
  });
  // -----------------------------------------------------------------------
  // 10a. Code email locale
  // -----------------------------------------------------------------------

  it('email-otp/start forwards the requested locale to the identity provider', async () => {
    const spy = vi.spyOn(idp, 'startEmailOtp');
    try {
      const res = await request(app.getHttpServer())
        .post('/api/auth/email-otp/start')
        .send({ email: 'user_ivana@example.com', locale: 'sr-Cyrl' });
      expect(res.status).toBe(200);
      expect(spy).toHaveBeenCalledWith({ email: 'user_ivana@example.com', locale: 'sr-Cyrl' });
    } finally {
      spy.mockRestore();
    }
  });

  it('email-otp/start refuses a locale outside the supported four', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/email-otp/start')
      .send({ email: 'user_ivana@example.com', locale: 'de' });
    expect(res.status).toBe(400);
  });

  // -----------------------------------------------------------------------
  // 10b. Bounded retry on a wrong email code (§21)
  // -----------------------------------------------------------------------

  describe('email code retry', () => {
    async function start(email: string): Promise<string> {
      const res = await request(app.getHttpServer())
        .post('/api/auth/email-otp/start')
        .send({ email });
      expect(res.status).toBe(200);
      return res.body.challengeToken as string;
    }

    function verify(challengeToken: string, code: string) {
      return request(app.getHttpServer())
        .post('/api/auth/email-otp/verify')
        .send({ challengeToken, code });
    }

    it('a wrong code answers invalid_code and the same token then accepts the right code', async () => {
      const email = 'user_jovan@example.com';
      const challengeToken = await start(email);
      const code = lastSentCode(email);

      const wrong = await verify(challengeToken, wrongCode(code));
      expect(wrong.status).toBe(401);
      expect(wrong.body).toHaveProperty('code', 'invalid_code');

      const right = await verify(challengeToken, code);
      expect(right.status).toBe(200);
      expect(right.body.principal).toHaveProperty('userId', 'user_jovan');
    });

    it('after three wrong codes the token is gone and the right code answers invalid_challenge', async () => {
      const email = 'retry_exhaust@example.com';
      const challengeToken = await start(email);
      const code = lastSentCode(email);

      for (let i = 0; i < 3; i++) {
        const wrong = await verify(challengeToken, wrongCode(code));
        expect(wrong.status).toBe(401);
        expect(wrong.body).toHaveProperty('code', 'invalid_code');
      }

      const right = await verify(challengeToken, code);
      expect(right.status).toBe(401);
      expect(right.body).toHaveProperty('code', 'invalid_challenge');
    });

    it('an unknown address answers three wrong codes and then the dead token exactly like a known one', async () => {
      const challengeToken = await start('nobody_here@example.com');

      for (let i = 0; i < 3; i++) {
        const wrong = await verify(challengeToken, '000000');
        expect(wrong.status).toBe(401);
        expect(wrong.body).toHaveProperty('code', 'invalid_code');
      }

      const afterBudget = await verify(challengeToken, '000000');
      expect(afterBudget.status).toBe(401);
      expect(afterBudget.body).toHaveProperty('code', 'invalid_challenge');
    });

    it('the sign-in throttle still locks after five wrong codes spread over three challenges', async () => {
      const email = 'retry_lock@example.com';
      const wrong = () => wrongCode(lastSentCode(email));

      // A: one wrong code, so A is handed back with tries left.
      const a = await start(email);
      const codeA = lastSentCode(email);
      expect((await verify(a, wrong())).status).toBe(401);
      // B: three wrong codes spend its budget (four failures so far).
      const b = await start(email);
      for (let i = 0; i < 3; i++) {
        expect((await verify(b, wrong())).status).toBe(401);
      }
      // C: the fifth failure fires the lock, so C is not handed back.
      const c = await start(email);
      const codeC = lastSentCode(email);
      const fifth = await verify(c, wrongCode(codeC));
      expect(fifth.status).toBe(401);
      expect(fifth.body).toHaveProperty('code', 'invalid_code');

      const blocked = await request(app.getHttpServer())
        .post('/api/auth/email-otp/start')
        .send({ email });
      expect(blocked.status).toBe(429);
      expect(blocked.body).toHaveProperty('code', 'too_many_attempts');

      // A still had tries left, but the lock outranks it: its code is refused with 429.
      const lockedA = await verify(a, codeA);
      expect(lockedA.status).toBe(429);
      expect(lockedA.body).toHaveProperty('code', 'too_many_attempts');

      // C was not handed back after the locking failure: its right code finds no challenge.
      const lockedC = await verify(c, codeC);
      expect(lockedC.status).toBe(401);
      expect(lockedC.body).toHaveProperty('code', 'invalid_challenge');
    });
  });

  // -----------------------------------------------------------------------
  // 11. Step-up re-authentication (T-2.6)
  // -----------------------------------------------------------------------

  describe('step-up', () => {
    let ivanaAgent: ReturnType<typeof request.agent>;
    let ivanaCsrf: string;
    let ivanaSessionId: string;
    let anaMembershipId: string;

    function extractSessionId(res: request.Response): string {
      const cookies = res.headers['set-cookie'] as unknown as string[];
      const match = cookies.map((c) => c.match(/nestself_session=([^;]+)/)).find(Boolean);
      if (!match) throw new Error('Session cookie not found');
      return match[1]!;
    }

    async function signIn(email: string) {
      const signInAgent = request.agent(app.getHttpServer());
      const startRes = await signInAgent.post('/api/auth/email-otp/start').send({ email });
      const code = idp.sentCodes.filter((c) => c.email === email).pop()!.code;
      const verifyRes = await signInAgent
        .post('/api/auth/email-otp/verify')
        .send({ challengeToken: startRes.body.challengeToken, code });
      expect(verifyRes.status).toBe(200);
      return { agent: signInAgent, csrf: extractCsrf(verifyRes), sessionId: extractSessionId(verifyRes) };
    }

    /** Move the session's authentication time 40 minutes into the past. */
    async function ageSession(sessionId: string) {
      const store = app.get<KeyValueStore>(KEY_VALUE_STORE);
      const key = sessionKey(hashSessionId(sessionId));
      const raw = await store.get(key);
      expect(raw).not.toBeNull();
      const ttl = await store.ttl(key);
      const record = JSON.parse(raw!) as { auth: { time: string } };
      record.auth.time = new Date(Date.now() - 40 * 60_000).toISOString();
      await store.set(key, JSON.stringify(record), { ttlSeconds: ttl });
    }

    async function startStepUp(): Promise<string> {
      const res = await ivanaAgent
        .post('/api/auth/step-up/start')
        .set('X-CSRF-Token', ivanaCsrf)
        .send({});
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ method: 'email_otp', ssoStartUrl: null });
      return res.body.challengeToken as string;
    }

    const lastCode = (email: string) => idp.sentCodes.filter((c) => c.email === email).pop()!.code;

    it('signs ivana (hr_admin) in, switches to the org context and ages the session', async () => {
      const ivana = await signIn('user_ivana@example.com');
      ivanaAgent = ivana.agent;
      ivanaCsrf = ivana.csrf;
      ivanaSessionId = ivana.sessionId;

      const ctxRes = await ivanaAgent
        .post('/api/auth/context')
        .set('X-CSRF-Token', ivanaCsrf)
        .send({ context: { kind: 'organization', orgId: 'org_sample' } });
      expect(ctxRes.status).toBe(200);

      const [membership] = await testDb.db
        .select()
        .from(memberships)
        .where(and(eq(memberships.userId, 'user_ana'), eq(memberships.orgId, 'org_sample')));
      expect(membership).toBeDefined();
      anaMembershipId = membership!.id;

      await ageSession(ivanaSessionId);
    });

    it('people.deactivate after a 40-minute-old authentication is refused with step_up_required', async () => {
      const res = await ivanaAgent
        .post(`/api/orgs/org_sample/members/${anaMembershipId}/end`)
        .set('X-CSRF-Token', ivanaCsrf)
        .send({ reason: 'DEACTIVATED_BY_HR' });
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({
        code: 'step_up_required',
        details: { stepUpClass: 'administration', maxAge: 1800, method: 'email_otp' },
      });
    });

    it("another user presenting ivana's challenge token is refused with invalid_challenge", async () => {
      const challengeToken = await startStepUp();
      const jovan = await signIn('user_jovan@example.com');

      const res = await jovan.agent
        .post('/api/auth/step-up/verify')
        .set('X-CSRF-Token', jovan.csrf)
        .send({ challengeToken, response: lastCode('user_ivana@example.com') });
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 'invalid_challenge');

      await jovan.agent.post('/api/auth/sign-out').set('X-CSRF-Token', jovan.csrf);
    });

    it('a step-up challenge cannot be used to sign in', async () => {
      const challengeToken = await startStepUp();
      const res = await request(app.getHttpServer())
        .post('/api/auth/email-otp/verify')
        .send({ challengeToken, code: lastCode('user_ivana@example.com') });
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 'invalid_challenge');
    });

    it('a wrong step-up code keeps the challenge; the right code on the same token then succeeds', async () => {
      const challengeToken = await startStepUp();
      const code = lastCode('user_ivana@example.com');

      const wrong = await ivanaAgent
        .post('/api/auth/step-up/verify')
        .set('X-CSRF-Token', ivanaCsrf)
        .send({ challengeToken, response: wrongCode(code) });
      expect(wrong.status).toBe(401);
      expect(wrong.body).toHaveProperty('code', 'invalid_code');

      const right = await ivanaAgent
        .post('/api/auth/step-up/verify')
        .set('X-CSRF-Token', ivanaCsrf)
        .send({ challengeToken, response: code });
      expect(right.status).toBe(204);

      // Put the session back where the next case expects it: stale, needing step-up.
      ivanaCsrf = extractCsrf(right);
      ivanaSessionId = extractSessionId(right);
      await ageSession(ivanaSessionId);
    });

    it('step-up verify returns 204 with a new session id and CSRF token; the action then succeeds', async () => {
      const challengeToken = await startStepUp();

      const verifyRes = await ivanaAgent
        .post('/api/auth/step-up/verify')
        .set('X-CSRF-Token', ivanaCsrf)
        .send({ challengeToken, response: lastCode('user_ivana@example.com') });
      expect(verifyRes.status).toBe(204);
      const newSessionId = extractSessionId(verifyRes);
      const newCsrf = extractCsrf(verifyRes);
      expect(newSessionId).not.toBe(ivanaSessionId);
      expect(newCsrf).not.toBe(ivanaCsrf);

      // The old session id no longer authenticates.
      const store = app.get<KeyValueStore>(KEY_VALUE_STORE);
      expect(await store.get(sessionKey(hashSessionId(ivanaSessionId)))).toBeNull();

      const endRes = await ivanaAgent
        .post(`/api/orgs/org_sample/members/${anaMembershipId}/end`)
        .set('X-CSRF-Token', newCsrf)
        .send({ reason: 'DEACTIVATED_BY_HR' });
      expect(endRes.status).toBe(200);
      expect(endRes.body).toHaveProperty('status', 'ENDED');

      await ivanaAgent.post('/api/auth/sign-out').set('X-CSRF-Token', newCsrf);
    });
  });

  describe('effective actions', () => {
    async function signInAs(email: string) {
      const agent = request.agent(app.getHttpServer());
      const startRes = await agent.post('/api/auth/email-otp/start').send({ email });
      const code = idp.sentCodes.filter((c) => c.email === email).pop()!.code;
      const verifyRes = await agent
        .post('/api/auth/email-otp/verify')
        .send({ challengeToken: startRes.body.challengeToken, code });
      expect(verifyRes.status).toBe(200);
      return { agent, csrf: extractCsrf(verifyRes), body: verifyRes.body as { effectiveActions: string[] } };
    }

    it("ivana's /me in the organization context lists program.overview and access.preview", async () => {
      const ivana = await signInAs('user_ivana@example.com');
      const ctxRes = await ivana.agent
        .post('/api/auth/context')
        .set('X-CSRF-Token', ivana.csrf)
        .send({ context: { kind: 'organization', orgId: 'org_sample' } });
      expect(ctxRes.status).toBe(200);
      expect(ctxRes.body.effectiveActions).toEqual(expect.arrayContaining(['program.overview', 'access.preview']));

      const me = await ivana.agent.get('/api/auth/me');
      expect(me.status).toBe(200);
      expect(me.body.effectiveActions).toEqual(
        expect.arrayContaining(['program.overview', 'access.preview', 'access.delegate', 'content.read']),
      );
      await ivana.agent.post('/api/auth/sign-out').set('X-CSRF-Token', ivana.csrf);
    });

    it("jovan's /me lists content.read but not program.overview", async () => {
      const jovan = await signInAs('user_jovan@example.com');
      expect(jovan.body.effectiveActions).toContain('content.read');

      const me = await jovan.agent.get('/api/auth/me');
      expect(me.status).toBe(200);
      expect(me.body.effectiveActions).toContain('content.read');
      expect(me.body.effectiveActions).not.toContain('program.overview');
      expect(me.body.effectiveActions).not.toContain('access.preview');
      await jovan.agent.post('/api/auth/sign-out').set('X-CSRF-Token', jovan.csrf);
    });
  });
});
