/**
 * Invitations e2e tests — full HTTP round-trips for create, revoke, preview
 * and accept through the running NestJS app.
 *
 * Requires TEST_DATABASE_URL (PostgreSQL). Skipped otherwise.
 *
 * @see T-1.5
 */
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { IdentityProviderService } from '../src/identity/identity-provider.service.js';
import type { FakeIdentityProvider } from '../src/identity/fake-identity-provider.js';
import { seed } from '../src/db/seed/seed-lib.js';
import { externalIdentities, invitations } from '../src/db/schema/index.js';
import { eq } from 'drizzle-orm';
import { resetTestDatabase, type TestDatabase } from './db/test-database.js';

// ---------------------------------------------------------------------------
// Guard
// ---------------------------------------------------------------------------

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const shouldRun = !!TEST_DB_URL;

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe.skipIf(!shouldRun)('Invitations (e2e)', () => {
  let app: INestApplication;
  let idp: FakeIdentityProvider;
  let testDb: TestDatabase;

  const jwtSecret = randomBytes(32).toString('hex');

  // HR admin agent (user_ivana — has people.invite + people.import grants).
  let hrAgent: ReturnType<typeof request.agent>;
  let hrCsrf: string;

  // -----------------------------------------------------------------------
  // Bootstrap
  // -----------------------------------------------------------------------

  beforeAll(async () => {
    testDb = await resetTestDatabase(TEST_DB_URL!, 'invitations');
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
      { email: 'user_ivana@example.com' },
      { email: 'user_jovan@example.com' },
    ]);

    // Link FakeIDP users to external_identities.
    for (const { localId, email } of [
      { localId: 'user_ivana', email: 'user_ivana@example.com' },
      { localId: 'user_jovan', email: 'user_jovan@example.com' },
    ]) {
      const idpUser = await idp.findUserByEmail(email);
      if (!idpUser) throw new Error(`FakeIDP user not found: ${email}`);
      await testDb.db.insert(externalIdentities).values({
        userId: localId,
        provider: 'cognito',
        subject: idpUser.sub,
        cognitoUsername: idpUser.username,
        email,
        emailVerified: true,
      });
    }

    // Sign in as HR admin (user_ivana).
    hrAgent = request.agent(app.getHttpServer());
    const startRes = await hrAgent
      .post('/api/auth/email-otp/start')
      .send({ email: 'user_ivana@example.com' });
    expect(startRes.status).toBe(200);

    const code = idp.sentCodes
      .filter((c) => c.email === 'user_ivana@example.com')
      .pop()!.code;

    const verifyRes = await hrAgent
      .post('/api/auth/email-otp/verify')
      .send({ challengeToken: startRes.body.challengeToken, code });
    expect(verifyRes.status).toBe(200);

    // Switch to org context.
    const cookies = verifyRes.headers['set-cookie'] as string[] | undefined;
    const csrfCookie = cookies?.find((c: string) => c.startsWith('nestself_csrf='));
    const match = csrfCookie?.match(/nestself_csrf=([^;]+)/);
    hrCsrf = match![1]!;

    await hrAgent
      .post('/api/auth/context')
      .set('X-CSRF-Token', hrCsrf)
      .send({ context: { kind: 'organization', orgId: 'org_sample' } });
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await testDb?.close();
  });

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  function createInvitation(body: Record<string, unknown>) {
    return hrAgent
      .post('/api/orgs/org_sample/invitations')
      .set('X-CSRF-Token', hrCsrf)
      .send(body);
  }

  // -----------------------------------------------------------------------
  // 1. Create invitation → 201
  // -----------------------------------------------------------------------

  let devToken: string;
  let _invitationId: string;

  it('POST /orgs/:orgId/invitations creates an invitation', async () => {
    const res = await createInvitation({
      email: 'newhire@example.com',
      templateKey: 'employee',
    });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body).toHaveProperty('email', 'newhire@example.com');
    expect(res.body).toHaveProperty('templateKey', 'employee');
    expect(res.body).toHaveProperty('devToken');
    expect(res.body).not.toHaveProperty('tokenHash');
    devToken = res.body.devToken;
    _invitationId = res.body.id;
  });

  // -----------------------------------------------------------------------
  // 2. Duplicate invitation → 409
  // -----------------------------------------------------------------------

  it('rejects duplicate pending invitation with 409', async () => {
    const res = await createInvitation({
      email: 'newhire@example.com',
      templateKey: 'employee',
    });

    expect(res.status).toBe(409);
    expect(res.body).toHaveProperty('code', 'duplicate_invitation');
  });

  // -----------------------------------------------------------------------
  // 3. Already-member invitation → 409
  // -----------------------------------------------------------------------

  it('rejects invitation for an existing active member with 409', async () => {
    const res = await createInvitation({
      email: 'user_jovan@example.com',
      templateKey: 'employee',
    });

    expect(res.status).toBe(409);
    expect(res.body).toHaveProperty('code', 'already_member');
  });

  // -----------------------------------------------------------------------
  // 4. Invalid template key → 400
  // -----------------------------------------------------------------------

  it('rejects invalid template key with 400', async () => {
    const res = await createInvitation({
      email: 'bad@example.com',
      templateKey: 'nonexistent',
    });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'validation');
  });

  // -----------------------------------------------------------------------
  // 4b. Only organization templates can be invited (C1)
  // -----------------------------------------------------------------------

  it('rejects the platform_owner template with 400 validation and details.templateKey', async () => {
    const res = await createInvitation({ email: 'escalate@example.com', templateKey: 'platform_owner' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'validation');
    expect(res.body.details).toEqual({ templateKey: 'platform_owner' });
  });

  it('accepts the hr_admin organization template (201)', async () => {
    const res = await createInvitation({ email: 'second-hr@example.com', templateKey: 'hr_admin' });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('templateKey', 'hr_admin');
  });

  it('import reports a platform template row in errors and creates only the valid row', async () => {
    const res = await hrAgent
      .post('/api/orgs/org_sample/invitations/import')
      .set('X-CSRF-Token', hrCsrf)
      .send({
        invitations: [
          { email: 'import-ok@example.com', templateKey: 'employee' },
          { email: 'import-owner@example.com', templateKey: 'platform_owner' },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.created).toBe(1);
    expect(res.body.errors).toEqual([
      expect.objectContaining({ email: 'import-owner@example.com' }),
    ]);
    const stored = await testDb.db
      .select({ email: invitations.email })
      .from(invitations)
      .where(eq(invitations.email, 'import-owner@example.com'));
    expect(stored).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // 5. Preview reveals only the org name
  // -----------------------------------------------------------------------

  it('GET /invitations/:token/preview returns only the org name', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/invitations/${devToken}/preview`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ organizationName: 'Example d.o.o.' });
    // Must not leak any other invitation details (API-R-09).
    expect(res.body).not.toHaveProperty('email');
    expect(res.body).not.toHaveProperty('templateKey');
    expect(res.body).not.toHaveProperty('tokenHash');
  });

  // -----------------------------------------------------------------------
  // 6. Preview with invalid token → 404
  // -----------------------------------------------------------------------

  it('preview with an unknown token returns 404', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/invitations/nonexistenttoken/preview');

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('code', 'not_found');
  });

  // -----------------------------------------------------------------------
  // 7. Accept invitation → sign-in challenge
  // -----------------------------------------------------------------------

  it('POST /invitations/accept accepts the invitation and returns a sign-in challenge', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/invitations/accept')
      .send({ token: devToken });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('method', 'email_otp');
    expect(res.body).toHaveProperty('challengeToken');
    expect(typeof res.body.challengeToken).toBe('string');
    // Token and hash must never appear in the response.
    expect(JSON.stringify(res.body)).not.toContain(devToken);
  });

  // -----------------------------------------------------------------------
  // 8. Accept is idempotent
  // -----------------------------------------------------------------------

  it('accepting the same invitation again returns a fresh challenge (idempotent)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/invitations/accept')
      .send({ token: devToken });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('method', 'email_otp');
    expect(res.body).toHaveProperty('challengeToken');
  });

  // -----------------------------------------------------------------------
  // 9. Accept with invalid token → 401
  // -----------------------------------------------------------------------

  it('accept with a bad token returns 401', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/invitations/accept')
      .send({ token: 'badtoken' });

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('code', 'invalid_invitation');
  });

  // -----------------------------------------------------------------------
  // 10. Revoke invitation → 200
  // -----------------------------------------------------------------------

  it('DELETE /orgs/:orgId/invitations/:invitationId revokes the invitation', async () => {
    // Create a second invitation to revoke (the first one is already accepted).
    const createRes = await createInvitation({
      email: 'torevoke@example.com',
      templateKey: 'employee',
    });
    expect(createRes.status).toBe(201);

    const revokeRes = await hrAgent
      .delete(`/api/orgs/org_sample/invitations/${createRes.body.id}`)
      .set('X-CSRF-Token', hrCsrf);

    expect(revokeRes.status).toBe(200);
    expect(revokeRes.body).toHaveProperty('revokedAt');
    expect(revokeRes.body.revokedAt).not.toBeNull();

    // Preview should now return 404.
    const previewRes = await request(app.getHttpServer())
      .get(`/api/invitations/${createRes.body.devToken}/preview`);
    expect(previewRes.status).toBe(404);
  });

  // -----------------------------------------------------------------------
  // 11. Revoke is idempotent
  // -----------------------------------------------------------------------

  it('revoking an already-revoked invitation is idempotent (200)', async () => {
    // Create and revoke an invitation.
    const createRes = await createInvitation({
      email: 'revoke2@example.com',
      templateKey: 'employee',
    });
    expect(createRes.status).toBe(201);

    const revokeRes1 = await hrAgent
      .delete(`/api/orgs/org_sample/invitations/${createRes.body.id}`)
      .set('X-CSRF-Token', hrCsrf);
    expect(revokeRes1.status).toBe(200);

    // Revoke again → still 200.
    const revokeRes2 = await hrAgent
      .delete(`/api/orgs/org_sample/invitations/${createRes.body.id}`)
      .set('X-CSRF-Token', hrCsrf);
    expect(revokeRes2.status).toBe(200);
    expect(revokeRes2.body).toHaveProperty('revokedAt');
  });

  // -----------------------------------------------------------------------
  // 12. Employee without people.invite → 403
  // -----------------------------------------------------------------------

  it('employee without people.invite grant is denied with 403', async () => {
    // Sign in as jovan (employee — no people.invite grant).
    const empAgent = request.agent(app.getHttpServer());
    const startRes = await empAgent
      .post('/api/auth/email-otp/start')
      .send({ email: 'user_jovan@example.com' });
    expect(startRes.status).toBe(200);

    const code = idp.sentCodes
      .filter((c) => c.email === 'user_jovan@example.com')
      .pop()!.code;
    const verifyRes = await empAgent
      .post('/api/auth/email-otp/verify')
      .send({ challengeToken: startRes.body.challengeToken, code });
    expect(verifyRes.status).toBe(200);

    const cookies = verifyRes.headers['set-cookie'] as string[] | undefined;
    const csrfCookie = cookies?.find((c: string) => c.startsWith('nestself_csrf='));
    const csrfMatch = csrfCookie?.match(/nestself_csrf=([^;]+)/);
    const empCsrf = csrfMatch![1]!;

    await empAgent
      .post('/api/auth/context')
      .set('X-CSRF-Token', empCsrf)
      .send({ context: { kind: 'organization', orgId: 'org_sample' } });

    const res = await empAgent
      .post('/api/orgs/org_sample/invitations')
      .set('X-CSRF-Token', empCsrf)
      .send({ email: 'noone@example.com', templateKey: 'employee' });

    expect(res.status).toBe(403);
  });

  // -----------------------------------------------------------------------
  // 13. Unauthenticated create → 401
  // -----------------------------------------------------------------------

  it('unauthenticated create returns 401', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/orgs/org_sample/invitations')
      .send({ email: 'nobody@example.com', templateKey: 'employee' });

    expect(res.status).toBe(401);
  });
});
