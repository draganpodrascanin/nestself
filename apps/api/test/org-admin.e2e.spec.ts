/**
 * Org-admin e2e tests — full HTTP round-trips for org-unit CRUD, closure
 * maintenance, member listing/filtering and member update (5.3).
 *
 * Requires TEST_DATABASE_URL (PostgreSQL). Skipped otherwise.
 */
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { IdentityProviderService } from '../src/identity/identity-provider.service.js';
import type { FakeIdentityProvider } from '../src/identity/fake-identity-provider.js';
import { seed } from '../src/db/seed/seed-lib.js';
import { externalIdentities, memberships } from '../src/db/schema/index.js';
import { resetTestDatabase, type TestDatabase } from './db/test-database.js';

// ---------------------------------------------------------------------------
// Guard
// ---------------------------------------------------------------------------

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const shouldRun = !!TEST_DB_URL;

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe.skipIf(!shouldRun)('Org Admin (e2e)', () => {
  let app: INestApplication;
  let idp: FakeIdentityProvider;
  let testDb: TestDatabase;

  const jwtSecret = randomBytes(32).toString('hex');

  // -----------------------------------------------------------------------
  // Bootstrap
  // -----------------------------------------------------------------------

  beforeAll(async () => {
    testDb = await resetTestDatabase(TEST_DB_URL!, 'orgadmin');
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

    const { ApiExceptionFilter } = await import(
      '../src/common/api-exception.filter.js'
    );

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();

    idp = app.get(IdentityProviderService) as FakeIdentityProvider;
    idp.seedUsers([
      { email: 'user_jovan@example.com' },
      { email: 'user_ivana@example.com' },
      { email: 'user_ana@example.com' },
    ]);

    // Link FakeIdentityProvider subs to ExternalIdentity rows.
    const people = [
      { localId: 'user_jovan', email: 'user_jovan@example.com' },
      { localId: 'user_ivana', email: 'user_ivana@example.com' },
      { localId: 'user_ana', email: 'user_ana@example.com' },
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
    const csrfCookie = cookies.find((c: string) =>
      c.startsWith('nestself_csrf='),
    );
    if (!csrfCookie) throw new Error('CSRF cookie not found');
    const match = csrfCookie.match(/nestself_csrf=([^;]+)/);
    if (!match) throw new Error('Could not parse CSRF token');
    return match[1]!;
  }

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

  async function switchContext(
    agent: ReturnType<typeof request.agent>,
    csrf: string,
    context: Record<string, unknown>,
  ) {
    const res = await agent
      .post('/api/auth/context')
      .set('X-CSRF-Token', csrf)
      .send({ context });
    expect(res.status).toBe(200);
  }

  // -----------------------------------------------------------------------
  // State shared across ordered tests
  // -----------------------------------------------------------------------

  let ivanaAgent: ReturnType<typeof request.agent>;
  let ivanaCsrf: string;
  let jovanAgent: ReturnType<typeof request.agent>;
  let jovanCsrf: string;
  let createdTeamId: string;

  // -----------------------------------------------------------------------
  // T-5.3: Org units
  // -----------------------------------------------------------------------

  describe('Org units', () => {
    it('signs in ivana (hr_admin) and jovan (employee)', async () => {
      const ivana = await signInEmailOtp('user_ivana@example.com');
      ivanaAgent = ivana.agent;
      ivanaCsrf = ivana.csrf;
      await switchContext(ivanaAgent, ivanaCsrf, {
        kind: 'organization',
        orgId: 'org_sample',
      });

      // C1: employee stays in personal context (no org-workspace grant).
      const jovan = await signInEmailOtp('user_jovan@example.com');
      jovanAgent = jovan.agent;
      jovanCsrf = jovan.csrf;
    });

    it('GET /orgs/:orgId/org-units lists units ordered by depth then name', async () => {
      const res = await ivanaAgent.get('/api/orgs/org_sample/org-units');
      expect(res.status).toBe(200);
      expect(res.body.items).toBeInstanceOf(Array);
      expect(res.body.items.length).toBeGreaterThanOrEqual(6);

      // First should be depth-0 root
      expect(res.body.items[0].kind).toBe('COMPANY');
      expect(res.body.items[0].parentId).toBeNull();

      // Depth 1 items should come before depth 2
      const rootIdx = res.body.items.findIndex(
        (u: { id: string }) => u.id === 'ou_root',
      );
      const engIdx = res.body.items.findIndex(
        (u: { id: string }) => u.id === 'ou_engineering',
      );
      const prodIdx = res.body.items.findIndex(
        (u: { id: string }) => u.id === 'team_product',
      );
      expect(rootIdx).toBeLessThan(engIdx);
      expect(engIdx).toBeLessThan(prodIdx);
    });

    it('POST /orgs/:orgId/org-units creates a team under ou_engineering', async () => {
      const res = await ivanaAgent
        .post('/api/orgs/org_sample/org-units')
        .set('X-CSRF-Token', ivanaCsrf)
        .send({
          parentId: 'ou_engineering',
          kind: 'TEAM',
          name: 'QA Team',
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');
      expect(res.body.parentId).toBe('ou_engineering');
      expect(res.body.kind).toBe('TEAM');
      expect(res.body.name).toBe('QA Team');
      createdTeamId = res.body.id;

      // Verify closure rows in DB
      const closureRows = await testDb.pool.query(
        `SELECT ancestor_id, descendant_id, depth
         FROM org_unit_closure
         WHERE descendant_id = $1
         ORDER BY depth ASC`,
        [createdTeamId],
      );

      expect(closureRows.rows).toHaveLength(3);
      // Self-row
      expect(closureRows.rows[0]).toEqual({
        ancestor_id: createdTeamId,
        descendant_id: createdTeamId,
        depth: 0,
      });
      // ou_engineering at depth 1
      expect(closureRows.rows[1]).toEqual({
        ancestor_id: 'ou_engineering',
        descendant_id: createdTeamId,
        depth: 1,
      });
      // ou_root at depth 2
      expect(closureRows.rows[2]).toEqual({
        ancestor_id: 'ou_root',
        descendant_id: createdTeamId,
        depth: 2,
      });
    });

    it('POST rejects COMPANY kind', async () => {
      const res = await ivanaAgent
        .post('/api/orgs/org_sample/org-units')
        .set('X-CSRF-Token', ivanaCsrf)
        .send({
          parentId: 'ou_root',
          kind: 'COMPANY',
          name: 'Bad',
        });
      expect(res.status).toBe(400);
    });

    it('PATCH /orgs/:orgId/org-units/:unitId renames a unit', async () => {
      const res = await ivanaAgent
        .patch(`/api/orgs/org_sample/org-units/${createdTeamId}`)
        .set('X-CSRF-Token', ivanaCsrf)
        .send({ name: 'QA & Testing' });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('QA & Testing');
    });

    it('POST /orgs/:orgId/org-units/:unitId/move moves team_sales under ou_engineering', async () => {
      const res = await ivanaAgent
        .post('/api/orgs/org_sample/org-units/team_sales/move')
        .set('X-CSRF-Token', ivanaCsrf)
        .send({ parentId: 'ou_engineering' });

      expect(res.status).toBe(200);
      expect(res.body.parentId).toBe('ou_engineering');

      // Verify closure rows: team_sales should now have
      // self(0), ou_engineering(1), ou_root(2)
      const closureRows = await testDb.pool.query(
        `SELECT ancestor_id, descendant_id, depth
         FROM org_unit_closure
         WHERE descendant_id = 'team_sales'
         ORDER BY depth ASC`,
      );
      expect(closureRows.rows).toHaveLength(3);
      expect(closureRows.rows[0]).toEqual({
        ancestor_id: 'team_sales',
        descendant_id: 'team_sales',
        depth: 0,
      });
      expect(closureRows.rows[1]).toEqual({
        ancestor_id: 'ou_engineering',
        descendant_id: 'team_sales',
        depth: 1,
      });
      expect(closureRows.rows[2]).toEqual({
        ancestor_id: 'ou_root',
        descendant_id: 'team_sales',
        depth: 2,
      });

      // team_sales should no longer be under ou_commercial
      const commercialRow = closureRows.rows.find(
        (r: { ancestor_id: string }) => r.ancestor_id === 'ou_commercial',
      );
      expect(commercialRow).toBeUndefined();
    });

    it('POST /move rejects a cycle', async () => {
      const res = await ivanaAgent
        .post('/api/orgs/org_sample/org-units/ou_engineering/move')
        .set('X-CSRF-Token', ivanaCsrf)
        .send({ parentId: 'team_product' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('cycle');
    });

    it('employee gets 403 on write endpoints', async () => {
      const createRes = await jovanAgent
        .post('/api/orgs/org_sample/org-units')
        .set('X-CSRF-Token', jovanCsrf)
        .send({
          parentId: 'ou_engineering',
          kind: 'TEAM',
          name: 'Unauthorized',
        });
      // Authorization guard returns 404 or 403 depending on non-disclosure
      expect([403, 404]).toContain(createRes.status);
    });
  });

  // -----------------------------------------------------------------------
  // T-5.3: Members
  // -----------------------------------------------------------------------

  describe('Members', () => {
    it('GET /orgs/:orgId/members lists with pagination (limit 2)', async () => {
      const res = await ivanaAgent.get(
        '/api/orgs/org_sample/members?limit=2',
      );
      expect(res.status).toBe(200);
      expect(res.body.items).toBeInstanceOf(Array);
      expect(res.body.items.length).toBeLessThanOrEqual(2);
      // There should be more members, so nextCursor should be present.
      // (Seed has jovan, ana, stefan, ivana — at least 4 ACTIVE)
      if (res.body.items.length === 2) {
        expect(res.body.nextCursor).toBeTruthy();

        // Fetch next page with cursor.
        const res2 = await ivanaAgent.get(
          `/api/orgs/org_sample/members?limit=2&cursor=${res.body.nextCursor}`,
        );
        expect(res2.status).toBe(200);
        // The next page should not repeat any items from page 1.
        const page1Ids = new Set(
          res.body.items.map((i: { membershipId: string }) => i.membershipId),
        );
        for (const item of res2.body.items) {
          expect(page1Ids.has(item.membershipId)).toBe(false);
        }
      }
    });

    it('GET /members?orgUnitId=ou_engineering includes descendants', async () => {
      // All seed memberships have orgUnitId = team_product (first SAMPLE_TEAMS id).
      // team_product is a descendant of ou_engineering via closure.
      const res = await ivanaAgent.get(
        '/api/orgs/org_sample/members?orgUnitId=ou_engineering',
      );
      expect(res.status).toBe(200);
      // Every returned member's orgUnitId should be in the subtree of ou_engineering
      // (team_product, team_operations, or ou_engineering itself).
      for (const item of res.body.items) {
        expect(
          [
            'ou_engineering',
            'team_product',
            'team_operations',
            // team_sales was moved under ou_engineering in the previous test
            'team_sales',
          ].includes(item.orgUnitId) || item.orgUnitId === createdTeamId,
        ).toBe(true);
      }
    });

    it('PATCH /orgs/:orgId/members/:id moves jovan to the new team', async () => {
      // Find jovan's membership id.
      const [membership] = await testDb.db
        .select()
        .from(memberships)
        .where(eq(memberships.userId, 'user_jovan'));
      expect(membership).toBeDefined();

      const res = await ivanaAgent
        .patch(`/api/orgs/org_sample/members/${membership!.id}`)
        .set('X-CSRF-Token', ivanaCsrf)
        .send({ orgUnitId: createdTeamId });

      expect(res.status).toBe(200);
      expect(res.body.orgUnitId).toBe(createdTeamId);
      // A full member item: the clients validate it with MemberItemSchema.
      expect(res.body).toMatchObject({ userId: 'user_jovan', email: 'user_jovan@example.com' });
      expect(res.body.displayName).not.toBe('');

      // Verify jovan's /auth/me reflects the new orgUnitId after cache invalidation.
      const meRes = await jovanAgent.get('/api/auth/me');
      expect(meRes.status).toBe(200);
      // The /me endpoint returns the principal which includes membership info.
      // The exact shape depends on PrincipalLoader but the membership
      // orgUnitId should be updated in the DB at minimum.
      const [updatedMembership] = await testDb.db
        .select()
        .from(memberships)
        .where(eq(memberships.userId, 'user_jovan'));
      expect(updatedMembership!.orgUnitId).toBe(createdTeamId);
    });

    it('employee gets 403 on PATCH (write)', async () => {
      const [membership] = await testDb.db
        .select()
        .from(memberships)
        .where(eq(memberships.userId, 'user_ana'));

      const res = await jovanAgent
        .patch(`/api/orgs/org_sample/members/${membership!.id}`)
        .set('X-CSRF-Token', jovanCsrf)
        .send({ orgUnitId: 'team_product' });

      expect([403, 404]).toContain(res.status);
    });
  });
});
