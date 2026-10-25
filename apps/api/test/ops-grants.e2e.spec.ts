/**
 * Operations grant administration e2e tests (T-2.1, operations side):
 * platform grants, organization grants reached from the operations
 * workspace and the per-context user access view over HTTP.
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
import { PrincipalLoader } from '../src/principal/principal-loader.js';
import { CONFIDENTIAL_ACTIONS, PERMISSION_TEMPLATES } from '@nestself/contracts';
import { IdentityProviderService } from '../src/identity/identity-provider.service.js';
import type { FakeIdentityProvider } from '../src/identity/fake-identity-provider.js';
import { computeTotp } from '../src/identity/totp.js';
import { seed } from '../src/db/seed/seed-lib.js';
import { auditEvents, externalIdentities, grants, organizations } from '../src/db/schema/index.js';
import { resetTestDatabase, type TestDatabase } from './db/test-database.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const shouldRun = !!TEST_DB_URL;

const ORG = 'org_sample';
const NIKOLA_EMAIL = 'user_nikola@example.com';
const TEMP_PASSWORD = 'TempPassword1!';

describe.skipIf(!shouldRun)('Operations grant administration (e2e)', () => {
  let app: INestApplication;
  let idp: FakeIdentityProvider;
  let testDb: TestDatabase;
  const jwtSecret = randomBytes(32).toString('hex');

  beforeAll(async () => {
    testDb = await resetTestDatabase(TEST_DB_URL!, 'opsgrants');
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

    idp = app.get(IdentityProviderService) as FakeIdentityProvider;
    idp.seedUsers([{ email: NIKOLA_EMAIL, password: TEMP_PASSWORD, temporaryPassword: TEMP_PASSWORD }]);
    const idpUser = await idp.findUserByEmail(NIKOLA_EMAIL);
    if (!idpUser) throw new Error('FakeIDP user not found');
    await testDb.db.insert(externalIdentities).values({
      userId: 'user_nikola',
      provider: 'cognito',
      subject: idpUser.sub,
      cognitoUsername: idpUser.username,
      email: NIKOLA_EMAIL,
      emailVerified: true,
    });

    // The seed gives nikola client_operations (assigned_clients) only; the
    // platform grant endpoints need a platform-scoped access.grant. The
    // sample data has no platform owner, so insert that grant here.
    const platformOwner = PERMISSION_TEMPLATES.find((t) => t.key === 'platform_owner')!;
    await testDb.db.insert(grants).values({
      id: 'grant_test_nikola_platform_owner',
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

  function extractCsrf(res: request.Response): string {
    const cookies = res.headers['set-cookie'] as string[] | undefined;
    const csrf = cookies?.find((c) => c.startsWith('nestself_csrf='))?.match(/nestself_csrf=([^;]+)/);
    if (!csrf) throw new Error('CSRF cookie not found');
    return csrf[1]!;
  }

  /** Staff sign-in: temporary password, new password, TOTP enrolment. */
  async function signInStaff() {
    const agent = request.agent(app.getHttpServer());
    const pw = await agent.post('/api/auth/password').send({ email: NIKOLA_EMAIL, password: TEMP_PASSWORD });
    expect(pw.status).toBe(200);
    const newPw = await agent
      .post('/api/auth/challenge')
      .send({ challengeToken: pw.body.challengeToken, response: 'NewSecurePassword1!' });
    expect(newPw.status).toBe(200);
    expect(newPw.body).toHaveProperty('step', 'totp_enrol');
    const enrol = await agent.post('/api/auth/totp/enrol').send({ challengeToken: newPw.body.challengeToken });
    expect(enrol.status).toBe(200);
    const secret = (enrol.body.secretUri as string).match(/secret=([A-Z2-7]+)/)![1]!;
    const complete = await agent
      .post('/api/auth/challenge')
      .send({ challengeToken: enrol.body.challengeToken ?? newPw.body.challengeToken, response: computeTotp(secret) });
    expect(complete.status).toBe(200);
    return { agent, csrf: extractCsrf(complete) };
  }

  let nikola: Awaited<ReturnType<typeof signInStaff>>;
  let orgGrantId: string;

  it('signs in nikola in the operations context', async () => {
    nikola = await signInStaff();
    const ctx = await nikola.agent
      .post('/api/auth/context')
      .set('X-CSRF-Token', nikola.csrf)
      .send({ context: { kind: 'operations' } });
    expect(ctx.status).toBe(200);
    expect(ctx.body.principal.context).toEqual({ kind: 'operations' });
  });

  it('creates a support_operator platform grant: 201, listed under /ops/grants and audited', async () => {
    const res = await nikola.agent
      .post('/api/ops/grants')
      .set('X-CSRF-Token', nikola.csrf)
      .send({ templateKey: 'support_operator', subjectUserId: 'user_nikola', scopeType: 'assigned_cases' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      subjectUserId: 'user_nikola',
      templateKey: 'support_operator',
      scopeType: 'assigned_cases',
      scopeOrgId: null,
      scopeOrgUnitId: null,
      grantedByUserId: 'user_nikola',
    });
    expect(res.body.actions).toEqual([...PERMISSION_TEMPLATES.find((t) => t.key === 'support_operator')!.actions]);

    const list = await nikola.agent.get('/api/ops/grants').query({ subjectUserId: 'user_nikola' });
    expect(list.status).toBe(200);
    const ids = list.body.items.map((g: { id: string }) => g.id);
    expect(ids).toContain(res.body.id);
    expect(ids).toContain('grant_test_nikola_platform_owner');
    for (const g of list.body.items as Array<{ scopeOrgId: string | null }>) expect(g.scopeOrgId).toBeNull();

    const [audit] = await testDb.db.select().from(auditEvents).where(eq(auditEvents.recordId, res.body.id as string));
    expect(audit).toMatchObject({ action: 'grant.created', orgId: null });
  });

  it('rejects a non-operations template or a scope type other than the template own: 400 validation', async () => {
    const orgTemplate = await nikola.agent
      .post('/api/ops/grants')
      .set('X-CSRF-Token', nikola.csrf)
      .send({ templateKey: 'hr_admin', subjectUserId: 'user_ana', scopeType: 'organization' });
    expect(orgTemplate.status).toBe(400);
    expect(orgTemplate.body.code).toBe('validation');

    const wrongScope = await nikola.agent
      .post('/api/ops/grants')
      .set('X-CSRF-Token', nikola.csrf)
      .send({ templateKey: 'support_operator', subjectUserId: 'user_nikola', scopeType: 'platform' });
    expect(wrongScope.status).toBe(400);
    expect(wrongScope.body.code).toBe('validation');
  });

  it("shows ana's access per context: org_sample with content.read, plus the platform context", async () => {
    const res = await nikola.agent.get('/api/ops/users/user_ana/access');
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe('user_ana');
    expect(res.body.suspended).toBe(false);
    const contexts = res.body.contexts as Array<{ orgId: string | null; actions: string[] }>;
    const org = contexts.find((c) => c.orgId === ORG);
    expect(org).toBeDefined();
    expect(org!.actions).toContain('content.read');
    expect(contexts.some((c) => c.orgId === null)).toBe(true);
    for (const c of contexts) for (const action of CONFIDENTIAL_ACTIONS) expect(c.actions).not.toContain(action);
  });

  it('returns 404 for the access view of an unknown user', async () => {
    const res = await nikola.agent.get('/api/ops/users/user_missing/access');
    expect(res.status).toBe(404);
  });

  it('creates an organization grant for ana through /ops/orgs/:orgId/grants: 201', async () => {
    const res = await nikola.agent
      .post(`/api/ops/orgs/${ORG}/grants`)
      .set('X-CSRF-Token', nikola.csrf)
      .send({ templateKey: 'reporting_user', subjectUserId: 'user_ana', scopeType: 'org_unit', scopeOrgUnitId: 'team_product' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      subjectUserId: 'user_ana',
      templateKey: 'reporting_user',
      scopeOrgId: ORG,
      scopeOrgUnitId: 'team_product',
      grantedByUserId: 'user_nikola',
    });
    orgGrantId = res.body.id as string;

    const list = await nikola.agent.get(`/api/ops/orgs/${ORG}/grants`).query({ subjectUserId: 'user_ana' });
    expect(list.status).toBe(200);
    expect(list.body.items.map((g: { id: string }) => g.id)).toContain(orgGrantId);

    const preview = await nikola.agent.get(`/api/ops/orgs/${ORG}/grants/preview`).query({ userId: 'user_ana' });
    expect(preview.status).toBe(200);
    expect(preview.body.grantIds).toContain(orgGrantId);
    expect(preview.body.actions).toContain('reports.aggregate.read');
  });

  it('revokes that grant through /ops/orgs/:orgId/grants/:grantId/revoke', async () => {
    const res = await nikola.agent
      .post(`/api/ops/orgs/${ORG}/grants/${orgGrantId}/revoke`)
      .set('X-CSRF-Token', nikola.csrf)
      .send({ reason: 'reporting no longer needed' });
    expect(res.status).toBe(200);
    expect(res.body.revokedAt).not.toBeNull();

    const list = await nikola.agent.get(`/api/ops/orgs/${ORG}/grants`).query({ subjectUserId: 'user_ana' });
    expect(list.body.items.map((g: { id: string }) => g.id)).not.toContain(orgGrantId);
  });

  it('revokes a support_operator platform grant through /ops/grants/:grantId/revoke: 200, audited, 409 on repeat', async () => {
    const created = await nikola.agent
      .post('/api/ops/grants')
      .set('X-CSRF-Token', nikola.csrf)
      .send({ templateKey: 'support_operator', subjectUserId: 'user_nikola', scopeType: 'assigned_cases' });
    expect(created.status).toBe(201);
    const grantId = created.body.id as string;

    const res = await nikola.agent
      .post(`/api/ops/grants/${grantId}/revoke`)
      .set('X-CSRF-Token', nikola.csrf)
      .send({ reason: 'support rota ended' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: grantId, scopeOrgId: null });
    expect(res.body.revokedAt).not.toBeNull();

    const list = await nikola.agent.get('/api/ops/grants').query({ subjectUserId: 'user_nikola' });
    expect(list.body.items.map((g: { id: string }) => g.id)).not.toContain(grantId);

    const events = await testDb.db.select().from(auditEvents).where(eq(auditEvents.recordId, grantId));
    expect(events.map((e) => e.action)).toContain('grant.revoked');
    expect(events.find((e) => e.action === 'grant.revoked')).toMatchObject({ orgId: null, actorUserId: 'user_nikola' });

    const again = await nikola.agent
      .post(`/api/ops/grants/${grantId}/revoke`)
      .set('X-CSRF-Token', nikola.csrf)
      .send({ reason: 'again' });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('conflict');
  });

  it('answers 404 when /ops/grants/:grantId/revoke names an organization-scoped grant', async () => {
    const res = await nikola.agent
      .post('/api/ops/grants/grant_user_ivana_employer_owner/revoke')
      .set('X-CSRF-Token', nikola.csrf)
      .send({ reason: 'wrong route' });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
    const [orgGrant] = await testDb.db.select().from(grants).where(eq(grants.id, 'grant_user_ivana_employer_owner'));
    expect(orgGrant).toBeDefined();
    expect(orgGrant!.revokedAt).toBeNull();
  });

  // ── Owner model (2026-10-24) ────────────────────────────────────────

  describe('organization owner (staff)', () => {
    const TRANSFER = `/api/ops/orgs/${ORG}/grants/transfer-ownership`;
    const IVANA_OWNER = 'grant_user_ivana_employer_owner';

    it('rejects a second employer_owner through /ops/orgs/:orgId/grants: 409 owner_exists', async () => {
      const res = await nikola.agent
        .post(`/api/ops/orgs/${ORG}/grants`)
        .set('X-CSRF-Token', nikola.csrf)
        .send({ templateKey: 'employer_owner', subjectUserId: 'user_stefan', scopeType: 'organization' });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('owner_exists');
      expect(res.body.details).toEqual({ currentOwnerUserId: 'user_ivana' });
    });

    it('rejects a staff transfer to a user outside the organization: 409 subject_not_member', async () => {
      const res = await nikola.agent.post(TRANSFER).set('X-CSRF-Token', nikola.csrf).send({ newOwnerUserId: 'user_nikola' });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('subject_not_member');
    });

    it('staff transfers ownership to stefan without holding the owner grant: 200, audited byStaff', async () => {
      const res = await nikola.agent.post(TRANSFER).set('X-CSRF-Token', nikola.csrf).send({ newOwnerUserId: 'user_stefan' });
      expect(res.status).toBe(200);
      expect(res.body.revokedGrantId).toBe(IVANA_OWNER);
      expect(res.body.createdGrant).toMatchObject({ subjectUserId: 'user_stefan', templateKey: 'employer_owner', grantedByUserId: 'user_nikola' });

      const [old] = await testDb.db.select().from(grants).where(eq(grants.id, IVANA_OWNER));
      expect(old!.revokedReason).toBe('ownership_transferred');
      expect(old!.revokedByUserId).toBe('user_nikola');

      const created = await testDb.db.select().from(auditEvents).where(eq(auditEvents.recordId, res.body.createdGrant.id as string));
      expect(created.find((e) => e.action === 'grant.created')).toMatchObject({
        actorUserId: 'user_nikola',
        orgId: ORG,
        details: expect.objectContaining({ transfer: true, byStaff: true, previousOwnerUserId: 'user_ivana' }),
      });
      const revoked = await testDb.db.select().from(auditEvents).where(eq(auditEvents.recordId, IVANA_OWNER));
      expect(revoked.find((e) => e.action === 'grant.revoked')).toMatchObject({
        details: expect.objectContaining({ reason: 'ownership_transferred', transfer: true, byStaff: true }),
      });
    });

    it('staff transfers ownership of org_sample back to ivana: 200, one active owner', async () => {
      const res = await nikola.agent.post(TRANSFER).set('X-CSRF-Token', nikola.csrf).send({ newOwnerUserId: 'user_ivana' });
      expect(res.status).toBe(200);
      expect(res.body.createdGrant).toMatchObject({ subjectUserId: 'user_ivana', templateKey: 'employer_owner' });

      const active = await nikola.agent.get(`/api/ops/orgs/${ORG}/grants`);
      const owners = (active.body.items as Array<{ templateKey: string | null; subjectUserId: string }>).filter(
        (g) => g.templateKey === 'employer_owner',
      );
      expect(owners.map((g) => g.subjectUserId)).toEqual(['user_ivana']);
    });

    it('creates the first owner when the organization has none: revokedGrantId null', async () => {
      const list = await nikola.agent.get(`/api/ops/orgs/${ORG}/grants`);
      const current = (list.body.items as Array<{ id: string; templateKey: string | null }>).find((g) => g.templateKey === 'employer_owner')!;
      const revoke = await nikola.agent
        .post(`/api/ops/orgs/${ORG}/grants/${current.id}/revoke`)
        .set('X-CSRF-Token', nikola.csrf)
        .send({ reason: 'owner left the company' });
      expect(revoke.status).toBe(200);

      const res = await nikola.agent.post(TRANSFER).set('X-CSRF-Token', nikola.csrf).send({ newOwnerUserId: 'user_ivana' });
      expect(res.status).toBe(200);
      expect(res.body.revokedGrantId).toBeNull();
      expect(res.body.createdGrant).toMatchObject({ subjectUserId: 'user_ivana', templateKey: 'employer_owner' });
    });
  });

  describe('organizations from the operations workspace', () => {
    type Org = { id: string; name: string; slug: string; status: string; createdAt: string };

    it('inserts two more clients for search and paging', async () => {
      await testDb.db.insert(organizations).values([
        { id: 'org_test_alpha', name: 'Alpha Test Org', slug: 'alpha-test', status: 'ONBOARDING' },
        { id: 'org_test_beta', name: 'Beta Test Org', slug: 'beta_test', status: 'ACTIVE' },
      ]);
    });

    it('GET /ops/organizations lists clients by name with the five public fields', async () => {
      const res = await nikola.agent.get('/api/ops/organizations').query({ limit: 100 });
      expect(res.status).toBe(200);
      expect(res.body.nextCursor).toBeNull();
      const items = res.body.items as Org[];
      expect(items.map((o) => o.id)).toEqual(expect.arrayContaining([ORG, 'org_test_alpha', 'org_test_beta']));
      const names = items.map((o) => o.name);
      expect([...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))).toEqual(names);
      expect(Object.keys(items.find((o) => o.id === 'org_test_alpha')!).sort()).toEqual(['createdAt', 'id', 'name', 'slug', 'status']);
      expect(items.find((o) => o.id === 'org_test_alpha')).toMatchObject({ slug: 'alpha-test', status: 'ONBOARDING' });
    });

    it('pages with the cursor through exactly the full list', async () => {
      const full = await nikola.agent.get('/api/ops/organizations').query({ limit: 100 });
      const all = (full.body.items as Org[]).map((o) => o.id);
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const page: request.Response = await nikola.agent
          .get('/api/ops/organizations')
          .query(cursor ? { limit: 1, cursor } : { limit: 1 });
        expect(page.status).toBe(200);
        seen.push(...(page.body.items as Org[]).map((o) => o.id));
        cursor = page.body.nextCursor as string | null;
      } while (cursor);
      expect(seen).toEqual(all);
    });

    it('search matches a name or slug prefix, case-insensitively, with LIKE wildcards taken literally', async () => {
      const byName = await nikola.agent.get('/api/ops/organizations').query({ search: 'alpha' });
      expect((byName.body.items as Org[]).map((o) => o.id)).toEqual(['org_test_alpha']);

      const bySlug = await nikola.agent.get('/api/ops/organizations').query({ search: 'BETA_' });
      expect((bySlug.body.items as Org[]).map((o) => o.id)).toEqual(['org_test_beta']);

      const wildcard = await nikola.agent.get('/api/ops/organizations').query({ search: '%' });
      expect(wildcard.status).toBe(200);
      expect(wildcard.body.items).toEqual([]);
    });

    it('GET /ops/organizations/:orgId returns one client; an unknown id is 404', async () => {
      const res = await nikola.agent.get(`/api/ops/organizations/${ORG}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        id: ORG,
        name: 'Example d.o.o.',
        slug: 'example',
        status: 'ACTIVE',
        createdAt: expect.any(String),
      });

      const missing = await nikola.agent.get('/api/ops/organizations/org_missing');
      expect(missing.status).toBe(404);
      expect(missing.body.code).toBe('not_found');
    });

    it('outside the operations context both routes are refused with context_mismatch', async () => {
      const toPersonal = await nikola.agent
        .post('/api/auth/context')
        .set('X-CSRF-Token', nikola.csrf)
        .send({ context: { kind: 'personal' } });
      expect(toPersonal.status).toBe(200);

      const list = await nikola.agent.get('/api/ops/organizations');
      expect(list.status).toBe(403);
      expect(list.body.code).toBe('context_mismatch');
      const one = await nikola.agent.get(`/api/ops/organizations/${ORG}`);
      expect(one.status).toBe(403);

      const back = await nikola.agent
        .post('/api/auth/context')
        .set('X-CSRF-Token', nikola.csrf)
        .send({ context: { kind: 'operations' } });
      expect(back.status).toBe(200);
    });

    it('unauthenticated requests are 401', async () => {
      expect((await request(app.getHttpServer()).get('/api/ops/organizations')).status).toBe(401);
    });

    it('client_operations alone (no platform grant): 200 on the assigned client, 403 on another client and on the list', async () => {
      const PLATFORM = 'grant_test_nikola_platform_owner';
      const loader = app.get(PrincipalLoader);
      await testDb.db.update(grants).set({ revokedAt: new Date(), revokedReason: 'test_fixture' }).where(eq(grants.id, PLATFORM));
      await loader.invalidateUser('user_nikola', [ORG, 'org_test_alpha', 'platform']);
      try {
        const assigned = await nikola.agent.get(`/api/ops/organizations/${ORG}`);
        expect(assigned.status).toBe(200);
        expect(assigned.body.id).toBe(ORG);

        const unassigned = await nikola.agent.get('/api/ops/organizations/org_test_alpha');
        expect(unassigned.status).toBe(403);
        expect(unassigned.body).not.toHaveProperty('name');

        const list = await nikola.agent.get('/api/ops/organizations');
        expect(list.status).toBe(403);
        expect(list.body).not.toHaveProperty('items');
      } finally {
        await testDb.db.update(grants).set({ revokedAt: null, revokedReason: null }).where(eq(grants.id, PLATFORM));
        await loader.invalidateUser('user_nikola', [ORG, 'org_test_alpha', 'platform']);
      }
      expect((await nikola.agent.get('/api/ops/organizations')).status).toBe(200);
    });
  });

  describe('pending invitations from the operations workspace', () => {
    it('GET /ops/orgs/:orgId/invitations lists a staff-created invitation until it is revoked', async () => {
      const created = await nikola.agent
        .post(`/api/ops/orgs/${ORG}/invitations`)
        .set('X-CSRF-Token', nikola.csrf)
        .send({ email: 'ops-listed@example.com', templateKey: 'employee' });
      expect(created.status).toBe(201);

      const list = await nikola.agent.get(`/api/ops/orgs/${ORG}/invitations`);
      expect(list.status).toBe(200);
      expect(list.body.items[0]).toMatchObject({ id: created.body.id, email: 'ops-listed@example.com', revokedAt: null });
      expect(list.body.items[0]).not.toHaveProperty('devToken');

      const revoke = await nikola.agent
        .delete(`/api/ops/orgs/${ORG}/invitations/${created.body.id}`)
        .set('X-CSRF-Token', nikola.csrf);
      expect(revoke.status).toBe(200);
      const after = await nikola.agent.get(`/api/ops/orgs/${ORG}/invitations`).query({ limit: 100 });
      expect((after.body.items as Array<{ id: string }>).map((i) => i.id)).not.toContain(created.body.id);
    });
  });
});

