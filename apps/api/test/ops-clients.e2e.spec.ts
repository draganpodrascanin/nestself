/**
 * Operations routes for assigned clients (T-2.0) — e2e.
 *
 * user_nikola holds the seeded `client_operations` grant (scope
 * `assigned_clients`, `scope_org_id` NULL) and a CLIENT assignment to
 * org_sample. No `platform_owner` grant is created here: every allowed call
 * below must pass through the assigned_clients scope.
 *
 * Requires TEST_DATABASE_URL (PostgreSQL). Skipped otherwise.
 */
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import { IdentityProviderService } from '../src/identity/identity-provider.service.js';
import type { FakeIdentityProvider } from '../src/identity/fake-identity-provider.js';
import { computeTotp } from '../src/identity/totp.js';
import { seed } from '../src/db/seed/seed-lib.js';
import {
  auditEvents,
  externalIdentities,
  memberships,
  organizations,
} from '../src/db/schema/index.js';
import { resetTestDatabase, type TestDatabase } from './db/test-database.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const shouldRun = !!TEST_DB_URL;

describe.skipIf(!shouldRun)('Operations routes for assigned clients (e2e)', () => {
  let app: INestApplication;
  let idp: FakeIdentityProvider;
  let testDb: TestDatabase;

  const jwtSecret = randomBytes(32).toString('hex');

  let nikolaAgent: ReturnType<typeof request.agent>;
  let nikolaCsrf: string;
  let anaMembershipId: string;

  beforeAll(async () => {
    testDb = await resetTestDatabase(TEST_DB_URL!, 'opsclients');
    await seed(testDb.db);

    // An organization nikola has no CLIENT assignment for.
    await testDb.db.insert(organizations).values({
      id: 'org_other',
      name: 'Other Organization',
      slug: 'other-organization',
    });

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
      { email: 'user_ivana@example.com' },
      {
        email: 'user_nikola@example.com',
        password: 'TempPassword1!',
        temporaryPassword: 'TempPassword1!',
      },
    ]);
    for (const p of [
      { localId: 'user_ivana', email: 'user_ivana@example.com' },
      { localId: 'user_nikola', email: 'user_nikola@example.com' },
    ]) {
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

    const [anaMembership] = await testDb.db
      .select()
      .from(memberships)
      .where(and(eq(memberships.userId, 'user_ana'), eq(memberships.orgId, 'org_sample')));
    anaMembershipId = anaMembership!.id;
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await testDb?.close();
  });

  // -----------------------------------------------------------------------
  // Helpers (same sign-in sequences as members.e2e.spec.ts)
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

  async function signInEmailOtp(email: string) {
    const agent = request.agent(app.getHttpServer());
    const startRes = await agent.post('/api/auth/email-otp/start').send({ email });
    expect(startRes.status).toBe(200);
    const code = idp.sentCodes.filter((c) => c.email === email).pop()!.code;
    const verifyRes = await agent
      .post('/api/auth/email-otp/verify')
      .send({ challengeToken: startRes.body.challengeToken, code });
    expect(verifyRes.status).toBe(200);
    return { agent, csrf: extractCsrf(verifyRes) };
  }

  async function signInStaff(email: string) {
    const agent = request.agent(app.getHttpServer());
    const pwRes = await agent.post('/api/auth/password').send({ email, password: 'TempPassword1!' });
    expect(pwRes.status).toBe(200);
    let challengeToken = pwRes.body.challengeToken as string;

    const newPwRes = await agent
      .post('/api/auth/challenge')
      .send({ challengeToken, response: 'NewSecurePassword1!' });
    expect(newPwRes.status).toBe(200);
    expect(newPwRes.body).toHaveProperty('step', 'totp_enrol');
    challengeToken = newPwRes.body.challengeToken as string;

    const enrolRes = await agent.post('/api/auth/totp/enrol').send({ challengeToken });
    expect(enrolRes.status).toBe(200);
    const totpSecret = (enrolRes.body.secretUri as string).match(/secret=([A-Z2-7]+)/)![1]!;
    if (enrolRes.body.challengeToken) challengeToken = enrolRes.body.challengeToken as string;

    const completeRes = await agent
      .post('/api/auth/challenge')
      .send({ challengeToken, response: computeTotp(totpSecret) });
    expect(completeRes.status).toBe(200);
    return { agent, csrf: extractCsrf(completeRes) };
  }

  // -----------------------------------------------------------------------
  // Allowed through the CLIENT assignment
  // -----------------------------------------------------------------------

  it('signs in nikola and switches to the operations context', async () => {
    const nikola = await signInStaff('user_nikola@example.com');
    nikolaAgent = nikola.agent;
    nikolaCsrf = nikola.csrf;

    const res = await nikolaAgent
      .post('/api/auth/context')
      .set('X-CSRF-Token', nikolaCsrf)
      .send({ context: { kind: 'operations' } });
    expect(res.status).toBe(200);
    expect(res.body.principal.context).toEqual({ kind: 'operations' });
  });

  it('GET /ops/orgs/org_sample/members lists the assigned client members (200)', async () => {
    const res = await nikolaAgent.get('/api/ops/orgs/org_sample/members');
    expect(res.status).toBe(200);
    const userIds = (res.body.items as Array<{ userId: string }>).map((m) => m.userId);
    expect(userIds).toContain('user_ana');
  });

  it('POST /ops/orgs/org_sample/invitations creates an invitation (201)', async () => {
    const res = await nikolaAgent
      .post('/api/ops/orgs/org_sample/invitations')
      .set('X-CSRF-Token', nikolaCsrf)
      .send({ email: 'ops-newhire@example.com', templateKey: 'employee' });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('email', 'ops-newhire@example.com');
    expect(res.body).toHaveProperty('templateKey', 'employee');
  });

  it('POST /ops/orgs/org_sample/invitations refuses the client_operations staff template (400)', async () => {
    const res = await nikolaAgent
      .post('/api/ops/orgs/org_sample/invitations')
      .set('X-CSRF-Token', nikolaCsrf)
      .send({ email: 'ops-staff@example.com', templateKey: 'client_operations' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'validation');
    expect(res.body.details).toEqual({ templateKey: 'client_operations' });
  });

  it('DELETE /ops/orgs/org_sample/invitations/:id revokes an invitation (200)', async () => {
    const createRes = await nikolaAgent
      .post('/api/ops/orgs/org_sample/invitations')
      .set('X-CSRF-Token', nikolaCsrf)
      .send({ email: 'ops-torevoke@example.com', templateKey: 'employee' });
    expect(createRes.status).toBe(201);

    const res = await nikolaAgent
      .delete(`/api/ops/orgs/org_sample/invitations/${createRes.body.id}`)
      .set('X-CSRF-Token', nikolaCsrf);
    expect(res.status).toBe(200);
    expect(res.body.revokedAt).not.toBeNull();
  });

  it('POST /ops/orgs/org_sample/invitations/import imports invitations (200)', async () => {
    const res = await nikolaAgent
      .post('/api/ops/orgs/org_sample/invitations/import')
      .set('X-CSRF-Token', nikolaCsrf)
      .send({ invitations: [{ email: 'ops-import@example.com', templateKey: 'employee' }] });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ created: 1, errors: [] });
  });

  it('POST /ops/orgs/org_sample/members/:id/end ends ana membership (200) and audits grant revocation', async () => {
    const res = await nikolaAgent
      .post(`/api/ops/orgs/org_sample/members/${anaMembershipId}/end`)
      .set('X-CSRF-Token', nikolaCsrf)
      .send({ reason: 'DEACTIVATED_BY_HR' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('membershipId', anaMembershipId);
    expect(res.body).toHaveProperty('status', 'ENDED');

    const [membership] = await testDb.db
      .select()
      .from(memberships)
      .where(eq(memberships.id, anaMembershipId));
    expect(membership!.status).toBe('ENDED');

    const revoked = await testDb.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.action, 'grant.revoked'), eq(auditEvents.actorUserId, 'user_nikola')));
    expect(revoked.length).toBeGreaterThan(0);
    for (const row of revoked) expect(row.orgId).toBe('org_sample');
  });

  // -----------------------------------------------------------------------
  // Denied
  // -----------------------------------------------------------------------

  it('an organization without a CLIENT assignment is denied (403 forbidden)', async () => {
    const res = await nikolaAgent
      .post('/api/ops/orgs/org_other/members/x/end')
      .set('X-CSRF-Token', nikolaCsrf)
      .send({ reason: 'DEACTIVATED_BY_HR' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('forbidden');
  });

  it('a bearer token is rejected with session_required (403)', async () => {
    const token = app.get(JwtService).sign({ userId: 'user_nikola' });
    const bearer = request(app.getHttpServer());

    const list = await bearer
      .get('/api/ops/orgs/org_sample/members')
      .set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(403);
    expect(list.body.code).toBe('session_required');

    const invite = await request(app.getHttpServer())
      .post('/api/ops/orgs/org_sample/invitations')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'ops-bearer@example.com', templateKey: 'employee' });
    expect(invite.status).toBe(403);
    expect(invite.body.code).toBe('session_required');
  });

  it('an organization context is rejected with context_mismatch (403)', async () => {
    const ivana = await signInEmailOtp('user_ivana@example.com');
    const switchRes = await ivana.agent
      .post('/api/auth/context')
      .set('X-CSRF-Token', ivana.csrf)
      .send({ context: { kind: 'organization', orgId: 'org_sample' } });
    expect(switchRes.status).toBe(200);

    const invite = await ivana.agent
      .post('/api/ops/orgs/org_sample/invitations')
      .set('X-CSRF-Token', ivana.csrf)
      .send({ email: 'ops-orgctx@example.com', templateKey: 'employee' });
    expect(invite.status).toBe(403);
    expect(invite.body.code).toBe('context_mismatch');

    const end = await ivana.agent
      .post(`/api/ops/orgs/org_sample/members/${anaMembershipId}/end`)
      .set('X-CSRF-Token', ivana.csrf)
      .send({ reason: 'DEACTIVATED_BY_HR' });
    expect(end.status).toBe(403);
    expect(end.body.code).toBe('context_mismatch');
  });
});
