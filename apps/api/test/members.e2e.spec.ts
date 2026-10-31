/**
 * Members and Users e2e tests — full HTTP round-trips for membership
 * deactivation (T-1.16) and user suspension (T-1.18).
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
import { IdentityProviderService } from '../src/identity/identity-provider.service.js';
import type { FakeIdentityProvider } from '../src/identity/fake-identity-provider.js';
import { computeTotp } from '../src/identity/totp.js';
import { MemberListResponseSchema, OrgUnitListResponseSchema, PERMISSION_TEMPLATES } from '@nestself/contracts';
import { resolveSampleScope, seed } from '../src/db/seed/seed-lib.js';
import { auditEvents, externalIdentities, grants, memberships, users } from '../src/db/schema/index.js';
import { resetTestDatabase, type TestDatabase } from './db/test-database.js';
import { resetThrottlerStorage } from './throttler-reset.js';

// ---------------------------------------------------------------------------
// Guard
// ---------------------------------------------------------------------------

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const shouldRun = !!TEST_DB_URL;

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe.skipIf(!shouldRun)('Members & Users (e2e)', () => {
  let app: INestApplication;
  let idp: FakeIdentityProvider;
  let testDb: TestDatabase;

  const jwtSecret = randomBytes(32).toString('hex');

  // -----------------------------------------------------------------------
  // Bootstrap
  // -----------------------------------------------------------------------

  beforeAll(async () => {
    testDb = await resetTestDatabase(TEST_DB_URL!, 'members');
    await seed(testDb.db);

    process.env.DATABASE_URL = testDb.url;
    process.env.AUTH_MODE = 'stub';
    process.env.JWT_SECRET = jwtSecret;
    process.env.SESSION_COOKIE_INSECURE_DEV = 'true';
    process.env.NODE_ENV = 'test';
    delete process.env.REDIS_URL;

    const { AppModule } = await import('../src/app.module.js');
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    const { ApiExceptionFilter } = await import('../src/common/api-exception.filter.js');

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();

    idp = app.get(IdentityProviderService) as FakeIdentityProvider;
    idp.seedUsers([
      { email: 'user_jovan@example.com' },
      { email: 'user_stefan@example.com' },
      { email: 'user_ivana@example.com' },
      {
        email: 'user_nikola@example.com',
        password: 'TempPassword1!',
        temporaryPassword: 'TempPassword1!',
      },
    ]);

    // Link FakeIdentityProvider subs to ExternalIdentity rows.
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

    // The seed gives user_nikola the `client_operations` template (scope
    // assigned_clients, CLIENT assignment to org_sample), which carries
    // `people.deactivate` for ending memberships of assigned clients. The
    // platform-level suspension endpoint (`/ops/users/:id/suspend`) has no
    // organization in its resource, so it needs the `platform_owner`
    // template. The sample data has no platform owner; create that grant
    // from the template the way the grant administration would.
    const platformOwner = PERMISSION_TEMPLATES.find((t) => t.key === 'platform_owner')!;
    await testDb.db.insert(grants).values({
      id: 'grant_user_nikola_platform_owner',
      subjectUserId: 'user_nikola',
      templateKey: platformOwner.key,
      actions: [...platformOwner.actions],
      scopeType: platformOwner.scopeType,
      scopeOrgId: null,
      scopeOrgUnitId: null,
      includeDescendants: false,
      grantedByUserId: 'user_nikola',
      grantedAt: new Date('2026-01-01'),
      validFrom: new Date('2026-01-01'),
    });
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

  /** Sign in an employee (email-OTP) and return agent + CSRF token. */
  async function signInEmailOtp(email: string) {
    const agent = request.agent(app.getHttpServer());
    const startRes = await agent
      .post('/api/auth/email-otp/start')
      .send({ email });
    expect(startRes.status).toBe(200);

    const code = idp.sentCodes.filter((c) => c.email === email).pop()!.code;
    const verifyRes = await agent
      .post('/api/auth/email-otp/verify')
      .send({ challengeToken: startRes.body.challengeToken, code });
    expect(verifyRes.status).toBe(200);

    return { agent, csrf: extractCsrf(verifyRes) };
  }

  /**
   * Sign in a staff user (password + TOTP) following the same sequence
   * as auth.e2e.spec.ts test 7.
   */
  async function signInStaff(email: string) {
    const agent = request.agent(app.getHttpServer());

    // Step 1: password with temporary password.
    const pwRes = await agent
      .post('/api/auth/password')
      .send({ email, password: 'TempPassword1!' });
    expect(pwRes.status).toBe(200);
    let challengeToken = pwRes.body.challengeToken as string;

    // Step 2: Respond with new password.
    const newPwRes = await agent
      .post('/api/auth/challenge')
      .send({ challengeToken, response: 'NewSecurePassword1!' });
    expect(newPwRes.status).toBe(200);
    expect(newPwRes.body).toHaveProperty('step', 'totp_enrol');
    challengeToken = newPwRes.body.challengeToken as string;

    // Step 3: TOTP enrolment.
    const enrolRes = await agent
      .post('/api/auth/totp/enrol')
      .send({ challengeToken });
    expect(enrolRes.status).toBe(200);
    const secretUri = enrolRes.body.secretUri as string;
    const secretMatch = secretUri.match(/secret=([A-Z2-7]+)/);
    const totpSecret = secretMatch![1]!;
    if (enrolRes.body.challengeToken) {
      challengeToken = enrolRes.body.challengeToken as string;
    }

    // Step 4: Complete MFA setup.
    const completeRes = await agent
      .post('/api/auth/challenge')
      .send({ challengeToken, response: computeTotp(totpSecret) });
    expect(completeRes.status).toBe(200);

    return { agent, csrf: extractCsrf(completeRes) };
  }

  // -----------------------------------------------------------------------
  // T-1.16: Membership deactivation
  // -----------------------------------------------------------------------

  describe('POST /orgs/:orgId/members/:membershipId/end', () => {
    let ivanaAgent: ReturnType<typeof request.agent>;
    let ivanaCsrf: string;
    let jovanAgent: ReturnType<typeof request.agent>;
    let _jovanCsrf: string;

    it('signs in ivana (hr_admin) and jovan (employee)', async () => {
      const ivana = await signInEmailOtp('user_ivana@example.com');
      ivanaAgent = ivana.agent;
      ivanaCsrf = ivana.csrf;

      const jovan = await signInEmailOtp('user_jovan@example.com');
      jovanAgent = jovan.agent;
      _jovanCsrf = jovan.csrf;

      // Verify jovan can hit /me.
      const meRes = await jovanAgent.get('/api/auth/me');
      expect(meRes.status).toBe(200);
      expect(meRes.body.principal.userId).toBe('user_jovan');
    });

    let stefanAgent: ReturnType<typeof request.agent>;
    let stefanCsrf: string;

    function stefanInvites(email: string) {
      return stefanAgent
        .post('/api/orgs/org_sample/invitations')
        .set('X-CSRF-Token', stefanCsrf)
        .send({ email, templateKey: 'employee' });
    }

    it('stefan holds people.invite delegated from a grant of jovan (cache warmed)', async () => {
      // Jovan is the member whose membership ends below; give him a root
      // grant with people.invite and delegate it to stefan.
      const base = {
        actions: ['people.invite'],
        scopeType: 'organization',
        scopeOrgId: 'org_sample',
        includeDescendants: false,
        grantedByUserId: 'user_ivana',
        grantedAt: new Date('2026-01-01'),
        validFrom: new Date('2026-01-01'),
      };
      await testDb.db.insert(grants).values([
        { ...base, id: 'grant_test_jovan_invite', subjectUserId: 'user_jovan', templateKey: null },
        {
          ...base,
          id: 'grant_test_stefan_from_jovan',
          subjectUserId: 'user_stefan',
          templateKey: null,
          parentGrantId: 'grant_test_jovan_invite',
        },
      ]);

      const stefan = await signInEmailOtp('user_stefan@example.com');
      stefanAgent = stefan.agent;
      stefanCsrf = stefan.csrf;
      await stefanAgent
        .post('/api/auth/context')
        .set('X-CSRF-Token', stefanCsrf)
        .send({ context: { kind: 'organization', orgId: 'org_sample' } });

      const me = await stefanAgent.get('/api/auth/me');
      expect(me.body.effectiveActions).toContain('people.invite');
      expect((await stefanInvites('before.end@example.com')).status).toBe(201);
    });

    it('ivana cannot end her own membership: 409, membership still ACTIVE, session intact', async () => {
      await ivanaAgent
        .post('/api/auth/context')
        .set('X-CSRF-Token', ivanaCsrf)
        .send({ context: { kind: 'organization', orgId: 'org_sample' } });

      const [own] = await testDb.db
        .select()
        .from(memberships)
        .where(eq(memberships.userId, 'user_ivana'));
      expect(own).toBeDefined();

      const res = await ivanaAgent
        .post(`/api/orgs/org_sample/members/${own!.id}/end`)
        .set('X-CSRF-Token', ivanaCsrf)
        .send({ reason: 'LEFT' });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('cannot_end_self');

      const [after] = await testDb.db
        .select()
        .from(memberships)
        .where(eq(memberships.id, own!.id));
      expect(after!.status).toBe('ACTIVE');
      expect(after!.endDate).toBeNull();

      const me = await ivanaAgent.get('/api/auth/me');
      expect(me.status).toBe(200);
    });

    it('ends jovan membership as ivana: 200 with status ENDED', async () => {
      // Find jovan's membership id from the DB.
      const [membership] = await testDb.db
        .select()
        .from(memberships)
        .where(eq(memberships.userId, 'user_jovan'));
      expect(membership).toBeDefined();

      // Switch ivana to the org context first.
      await ivanaAgent
        .post('/api/auth/context')
        .set('X-CSRF-Token', ivanaCsrf)
        .send({ context: { kind: 'organization', orgId: 'org_sample' } });

      const start = performance.now();
      const endRes = await ivanaAgent
        .post(`/api/orgs/org_sample/members/${membership!.id}/end`)
        .set('X-CSRF-Token', ivanaCsrf)
        .send({ reason: 'DEACTIVATED_BY_HR' });
      const elapsed = performance.now() - start;

      expect(endRes.status).toBe(200);
      expect(endRes.body).toHaveProperty('status', 'ENDED');
      expect(endRes.body).toHaveProperty('endedReason', 'DEACTIVATED_BY_HR');
      expect(endRes.body).toHaveProperty('membershipId', membership!.id);
      expect(endRes.body).toHaveProperty('revokedGrantIds');

      // DR-15: under 1000 ms.
      expect(elapsed).toBeLessThan(1000);
    });

    it("ending jovan's membership invalidates stefan: the delegated people.invite is gone", async () => {
      const me = await stefanAgent.get('/api/auth/me');
      expect(me.status).toBe(200);
      expect(me.body.effectiveActions).not.toContain('people.invite');
      const res = await stefanInvites('after.end@example.com');
      expect(res.status).toBe(403);
    });

    it('jovan GET /auth/me now returns 401 (session destroyed)', async () => {
      const meRes = await jovanAgent.get('/api/auth/me');
      expect(meRes.status).toBe(401);
    });

    it('jovan org-scoped grants are revoked in the DB', async () => {
      const grantRows = await testDb.db
        .select()
        .from(grants)
        .where(eq(grants.subjectUserId, 'user_jovan'));

      const orgGrants = grantRows.filter((g) => g.scopeOrgId === 'org_sample');
      for (const g of orgGrants) {
        expect(g.revokedAt).not.toBeNull();
      }
    });

    it('idempotent: re-ending returns the existing result', async () => {
      const [membership] = await testDb.db
        .select()
        .from(memberships)
        .where(eq(memberships.userId, 'user_jovan'));

      const endRes = await ivanaAgent
        .post(`/api/orgs/org_sample/members/${membership!.id}/end`)
        .set('X-CSRF-Token', ivanaCsrf)
        .send({ reason: 'LEFT' });

      expect(endRes.status).toBe(200);
      expect(endRes.body.status).toBe('ENDED');
      // Original reason preserved.
      expect(endRes.body.endedReason).toBe('DEACTIVATED_BY_HR');
    });
  });

  // -----------------------------------------------------------------------
  // T-1.18: User suspension
  // -----------------------------------------------------------------------

  describe('POST /ops/users/:userId/suspend', () => {
    let nikolaAgent: ReturnType<typeof request.agent>;
    let nikolaCsrf: string;
    let stefanAgent: ReturnType<typeof request.agent>;
    let _stefanCsrf: string;

    it('signs in nikola (operations) via password+TOTP and stefan (employee)', async () => {
      const nikola = await signInStaff('user_nikola@example.com');
      nikolaAgent = nikola.agent;
      nikolaCsrf = nikola.csrf;

      const stefan = await signInEmailOtp('user_stefan@example.com');
      stefanAgent = stefan.agent;
      _stefanCsrf = stefan.csrf;

      // Verify stefan can hit /me.
      const meRes = await stefanAgent.get('/api/auth/me');
      expect(meRes.status).toBe(200);
      expect(meRes.body.principal.userId).toBe('user_stefan');
    });

    it('nikola switches to operations context', async () => {
      const res = await nikolaAgent
        .post('/api/auth/context')
        .set('X-CSRF-Token', nikolaCsrf)
        .send({ context: { kind: 'operations' } });
      expect(res.status).toBe(200);
      expect(res.body.principal.context).toEqual({ kind: 'operations' });
    });

    it('nikola cannot suspend his own account: 409, nothing revoked', async () => {
      const res = await nikolaAgent
        .post('/api/ops/users/user_nikola/suspend')
        .set('X-CSRF-Token', nikolaCsrf)
        .send({ reason: 'Suspending myself by mistake' });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('cannot_suspend_self');

      const [self] = await testDb.db.select().from(users).where(eq(users.id, 'user_nikola'));
      expect(self!.suspendedAt).toBeNull();
      const me = await nikolaAgent.get('/api/auth/me');
      expect(me.status).toBe(200);
    });

    it('suspends stefan', async () => {
      const suspendRes = await nikolaAgent
        .post('/api/ops/users/user_stefan/suspend')
        .set('X-CSRF-Token', nikolaCsrf)
        .send({ reason: 'Security investigation' });

      expect(suspendRes.status).toBe(200);
      expect(suspendRes.body).toHaveProperty('userId', 'user_stefan');
      expect(suspendRes.body).toHaveProperty('suspendedAt');
    });

    it('stefan session is gone (GET /auth/me returns 401)', async () => {
      const meRes = await stefanAgent.get('/api/auth/me');
      expect(meRes.status).toBe(401);
    });

    it('users.suspended_at is set in the DB', async () => {
      const [user] = await testDb.db
        .select()
        .from(users)
        .where(eq(users.id, 'user_stefan'));
      expect(user!.suspendedAt).not.toBeNull();
    });

    it('employee calling /ops/users/:id/suspend gets 403', async () => {
      // Sign in an employee (jovan is already ended, use a fresh session
      // with a new email-OTP — but jovan's membership is ended so sign in
      // a different employee. Use user_ana (employee, org_sample).
      // First, seed the IdP user for ana.
      idp.seedUsers([{ email: 'user_ana@example.com' }]);
      const anaIdp = await idp.findUserByEmail('user_ana@example.com');
      await testDb.db.insert(externalIdentities).values({
        userId: 'user_ana',
        provider: 'cognito',
        subject: anaIdp!.sub,
        cognitoUsername: anaIdp!.username,
        email: 'user_ana@example.com',
        emailVerified: true,
      });

      const ana = await signInEmailOtp('user_ana@example.com');

      // Switch to operations context (will fail for an employee — they
      // don't have operations grants). The resolver enforces operations context.
      await ana.agent
        .post('/api/auth/context')
        .set('X-CSRF-Token', ana.csrf)
        .send({ context: { kind: 'operations' } });

      const suspendRes = await ana.agent
        .post('/api/ops/users/user_stefan/suspend')
        .set('X-CSRF-Token', ana.csrf)
        .send({ reason: 'Unauthorized attempt' });

      expect(suspendRes.status).toBe(403);
    });

    it('reinstate clears suspension', async () => {
      const reinstateRes = await nikolaAgent
        .post('/api/ops/users/user_stefan/reinstate')
        .set('X-CSRF-Token', nikolaCsrf);

      expect(reinstateRes.status).toBe(200);
      expect(reinstateRes.body).toHaveProperty('userId', 'user_stefan');

      const [user] = await testDb.db
        .select()
        .from(users)
        .where(eq(users.id, 'user_stefan'));
      expect(user!.suspendedAt).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Member and org-unit lists: program.overview or access.preview
  //
  // An employer owner holds access.preview but no HR template, so the access
  // page needs the lists to answer for access.preview as well.
  // -----------------------------------------------------------------------

  describe('GET /orgs/:orgId/members and /org-units', () => {
    const ORG = 'org_sample';
    const MEMBERS = `/api/orgs/${ORG}/members`;
    const ORG_UNITS = `/api/orgs/${ORG}/org-units`;
    const CREATED_AT = new Date('2026-01-01');

    let hrAdmin: Awaited<ReturnType<typeof signInToOrg>>;
    let ownerOnly: Awaited<ReturnType<typeof signInToOrg>>;
    let employee: Awaited<ReturnType<typeof signInToOrg>>;

    /** Email-OTP sign-in, then into the organization context. */
    async function signInToOrg(userId: string) {
      const session = await signInEmailOtp(`${userId}@example.com`);
      const context = await session.agent
        .post('/api/auth/context')
        .set('X-CSRF-Token', session.csrf)
        .send({ context: { kind: 'organization', orgId: ORG } });
      expect(context.status).toBe(200);
      return session;
    }

    /** A new active member of the organization who can sign in with an email code. */
    async function addMember(userId: string, displayName: string, templateKeys: string[]) {
      const email = `${userId}@example.com`;
      await testDb.db.insert(users).values({ id: userId, email, displayName });
      await testDb.db.insert(memberships).values({ userId, orgId: ORG, status: 'ACTIVE', startDate: CREATED_AT });
      for (const key of templateKeys) {
        const template = PERMISSION_TEMPLATES.find((t) => t.key === key)!;
        await testDb.db.insert(grants).values({
          id: `grant_${userId}_${key}`,
          subjectUserId: userId,
          templateKey: key,
          actions: [...template.actions],
          scopeType: template.scopeType,
          ...resolveSampleScope(template.scopeType, ORG, null),
          grantedByUserId: 'user_ivana',
          grantedAt: CREATED_AT,
          validFrom: CREATED_AT,
        });
      }
      idp.seedUsers([{ email }]);
      const idpUser = await idp.findUserByEmail(email);
      await testDb.db.insert(externalIdentities).values({
        userId,
        provider: 'cognito',
        subject: idpUser!.sub,
        cognitoUsername: idpUser!.username,
        email,
        emailVerified: true,
      });
    }

    beforeAll(async () => {
      resetThrottlerStorage(app);
      await addMember('user_owner_only', 'Olga Vlasnik', []);
      await addMember('user_plain_employee', 'Emil Zaposleni', ['employee']);

      // Ownership moves only through the API: ivana, the seeded owner, hands it to
      // the new member. She keeps her hr_admin grant; the new owner has no HR template.
      hrAdmin = await signInToOrg('user_ivana');
      const transfer = await hrAdmin.agent
        .post(`/api/orgs/${ORG}/grants/transfer-ownership`)
        .set('X-CSRF-Token', hrAdmin.csrf)
        .send({ newOwnerUserId: 'user_owner_only' });
      expect(transfer.status).toBe(200);

      ownerOnly = await signInToOrg('user_owner_only');
      employee = await signInToOrg('user_plain_employee');
    }, 60_000);

    it('the owner has access.preview and no program.overview', async () => {
      const me = await ownerOnly.agent.get('/api/auth/me');
      expect(me.status).toBe(200);
      expect(me.body.effectiveActions).toContain('access.preview');
      expect(me.body.effectiveActions).not.toContain('program.overview');
    });

    it('an owner without HR rights lists the members: 200', async () => {
      const res = await ownerOnly.agent.get(MEMBERS);

      expect(res.status).toBe(200);
      expect(MemberListResponseSchema.parse(res.body)).toEqual(res.body);
      expect(res.body.items.map((m: { userId: string }) => m.userId)).toEqual(
        expect.arrayContaining(['user_ivana', 'user_owner_only', 'user_plain_employee']),
      );
    });

    it('an owner without HR rights lists the org units: 200', async () => {
      const res = await ownerOnly.agent.get(ORG_UNITS);

      expect(res.status).toBe(200);
      expect(OrgUnitListResponseSchema.parse(res.body)).toEqual(res.body);
      expect(res.body.items.length).toBeGreaterThan(0);
    });

    it('the owner still cannot change members or org units: 403', async () => {
      const move = await ownerOnly.agent
        .patch(`${MEMBERS}/any-membership`)
        .set('X-CSRF-Token', ownerOnly.csrf)
        .send({ lineManagerUserId: null });
      expect(move.status).toBe(403);

      const create = await ownerOnly.agent
        .post(ORG_UNITS)
        .set('X-CSRF-Token', ownerOnly.csrf)
        .send({ parentId: 'ou_any', kind: 'TEAM', name: 'Not allowed' });
      expect(create.status).toBe(403);
    });

    it('an HR administrator without an owner grant lists both (program.overview alone is enough)', async () => {
      const me = await hrAdmin.agent.get('/api/auth/me');
      expect(me.body.effectiveActions).toContain('program.overview');
      expect(me.body.effectiveActions).not.toContain('access.preview');

      expect((await hrAdmin.agent.get(MEMBERS)).status).toBe(200);
      expect((await hrAdmin.agent.get(ORG_UNITS)).status).toBe(200);
    });

    it('a plain employee is refused both lists: 403, audited under the first action with the alternatives', async () => {
      for (const path of [MEMBERS, ORG_UNITS]) {
        const res = await employee.agent.get(path);
        expect(res.status, path).toBe(403);
        expect(res.body.code).toBe('forbidden');
      }

      const denied = await testDb.db
        .select({ recordType: auditEvents.recordType, details: auditEvents.details })
        .from(auditEvents)
        .where(and(eq(auditEvents.action, 'access.denied'), eq(auditEvents.actorUserId, 'user_plain_employee')));
      expect(denied.map((e) => e.recordType).sort()).toEqual(['membership', 'org_unit']);
      for (const event of denied) {
        expect(event.details).toMatchObject({
          actionAttempted: 'program.overview',
          alternatives: ['program.overview', 'access.preview'],
          reason: 'no_matching_grant',
        });
      }
    });
  });
});
