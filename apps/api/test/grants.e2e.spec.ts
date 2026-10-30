/**
 * Grant administration e2e tests (T-2.1, organization side): create, list,
 * adjust, revoke, delegate and preview over HTTP, plus approval authorities.
 *
 * Requires TEST_DATABASE_URL (PostgreSQL). Skipped otherwise.
 */
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { eq, inArray } from 'drizzle-orm';
import { CONFIDENTIAL_ACTIONS, PERMISSION_TEMPLATES } from '@nestself/contracts';
import { IdentityProviderService } from '../src/identity/identity-provider.service.js';
import type { FakeIdentityProvider } from '../src/identity/fake-identity-provider.js';
import { seed } from '../src/db/seed/seed-lib.js';
import { auditEvents, externalIdentities, grants } from '../src/db/schema/index.js';
import { resetTestDatabase, type TestDatabase } from './db/test-database.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const shouldRun = !!TEST_DB_URL;

const ORG = 'org_sample';
const BASE = `/api/orgs/${ORG}/grants`;
const IVANA_HR_ADMIN = 'grant_user_ivana_hr_admin';
/** Seeded (`EXTRA_SAMPLE_TEMPLATES`): ivana is the single owner of org_sample. */
const IVANA_EMPLOYER_OWNER = 'grant_user_ivana_employer_owner';
const CEILING = { type: 'spending_ceiling', amountMinor: 50_000, currency: 'EUR' };

describe.skipIf(!shouldRun)('Grant administration (e2e)', () => {
  let app: INestApplication;
  let idp: FakeIdentityProvider;
  let testDb: TestDatabase;
  const jwtSecret = randomBytes(32).toString('hex');

  beforeAll(async () => {
    testDb = await resetTestDatabase(TEST_DB_URL!, 'grants');
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
    const people = ['user_ivana', 'user_jovan', 'user_stefan', 'user_ana'];
    idp.seedUsers(people.map((id) => ({ email: `${id}@example.com` })));
    for (const id of people) {
      const email = `${id}@example.com`;
      const idpUser = await idp.findUserByEmail(email);
      if (!idpUser) throw new Error(`FakeIDP user not found: ${email}`);
      await testDb.db.insert(externalIdentities).values({
        userId: id,
        provider: 'cognito',
        subject: idpUser.sub,
        cognitoUsername: idpUser.username,
        email,
        emailVerified: true,
      });
    }

    // Owner model (2026-10-24): ivana's seeded employer_owner grant carries
    // access.grant/revoke/delegate/preview, so no test-inserted grant is
    // needed to exercise every route.
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

  /** Email-OTP sign-in, then switch to the organization context. */
  async function signIn(userId: string) {
    const email = `${userId}@example.com`;
    const agent = request.agent(app.getHttpServer());
    const start = await agent.post('/api/auth/email-otp/start').send({ email });
    expect(start.status).toBe(200);
    const code = idp.sentCodes.filter((c) => c.email === email).pop()!.code;
    const verify = await agent
      .post('/api/auth/email-otp/verify')
      .send({ challengeToken: start.body.challengeToken, code });
    expect(verify.status).toBe(200);
    const csrf = extractCsrf(verify);
    const ctx = await agent
      .post('/api/auth/context')
      .set('X-CSRF-Token', csrf)
      .send({ context: { kind: 'organization', orgId: ORG } });
    expect(ctx.status).toBe(200);
    return { agent, csrf };
  }

  let ivana: Awaited<ReturnType<typeof signIn>>;
  let createdId: string;
  let delegatedId: string;
  /** PATCH calls made so far; the route allows 10 per minute. */
  let patchCalls = 0;

  function patch(grantId: string, body: Record<string, unknown>) {
    patchCalls++;
    return ivana.agent.patch(`${BASE}/${grantId}`).set('X-CSRF-Token', ivana.csrf).send(body);
  }

  it('signs in ivana in the organization context', async () => {
    ivana = await signIn('user_ivana');
  });

  it('creates a team_manager grant for ana with the seeded owner grant alone (no test-inserted grant)', async () => {
    const extra = await testDb.db.select({ id: grants.id }).from(grants).where(eq(grants.subjectUserId, 'user_ivana'));
    expect(extra.map((g) => g.id).filter((id) => id.startsWith('grant_test_'))).toEqual([]);
  });

  it('creates a team_manager grant for ana scoped to team_product and lists it', async () => {
    const res = await ivana.agent
      .post(BASE)
      .set('X-CSRF-Token', ivana.csrf)
      .send({
        templateKey: 'team_manager',
        subjectUserId: 'user_ana',
        scopeType: 'org_unit',
        scopeOrgUnitId: 'team_product',
        conditions: [CEILING],
      });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      subjectUserId: 'user_ana',
      templateKey: 'team_manager',
      scopeType: 'org_unit',
      scopeOrgId: ORG,
      scopeOrgUnitId: 'team_product',
      grantedByUserId: 'user_ivana',
      conditions: [CEILING],
      revokedAt: null,
    });
    expect(res.body.actions).toEqual([...PERMISSION_TEMPLATES.find((t) => t.key === 'team_manager')!.actions]);
    createdId = res.body.id as string;

    const list = await ivana.agent.get(BASE).query({ subjectUserId: 'user_ana' });
    expect(list.status).toBe(200);
    expect(list.body.items.map((g: { id: string }) => g.id)).toContain(createdId);

    const [audit] = await testDb.db.select().from(auditEvents).where(inArray(auditEvents.recordId, [createdId]));
    expect(audit).toMatchObject({ action: 'grant.created' });
    expect(audit!.details).toMatchObject({ templateKey: 'team_manager', scopeType: 'org_unit', actionsCount: 8, conditionTypes: ['spending_ceiling'] });
  });

  it('rejects a create without the required spending_ceiling: 400 missing_conditions', async () => {
    const res = await ivana.agent
      .post(BASE)
      .set('X-CSRF-Token', ivana.csrf)
      .send({ templateKey: 'team_manager', subjectUserId: 'user_ana', scopeType: 'org_unit', scopeOrgUnitId: 'team_product' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('missing_conditions');
    expect(res.body.details.missing).toEqual(['spending_ceiling']);
  });

  it("previews ana's effective access with team_manager actions and no confidential action", async () => {
    const res = await ivana.agent.get(`${BASE}/preview`).query({ userId: 'user_ana' });
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe('user_ana');
    expect(res.body.actions).toContain('budget.read');
    for (const action of CONFIDENTIAL_ACTIONS) expect(res.body.actions).not.toContain(action);
    expect(res.body.grantIds).toContain(createdId);
  });

  it('adjusts validUntil', async () => {
    const res = await patch(createdId, { validUntil: '2027-06-30T00:00:00.000Z' });
    expect(res.status).toBe(200);
    expect(res.body.validUntil).toBe('2027-06-30T00:00:00.000Z');
  });

  it("delegates people.invite from ivana's hr_admin grant to stefan: 201", async () => {
    const res = await ivana.agent
      .post(`${BASE}/delegate`)
      .set('X-CSRF-Token', ivana.csrf)
      .send({ parentGrantId: IVANA_HR_ADMIN, subjectUserId: 'user_stefan', actions: ['people.invite'] });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      subjectUserId: 'user_stefan',
      parentGrantId: IVANA_HR_ADMIN,
      actions: ['people.invite'],
      scopeType: 'organization',
      templateKey: null,
    });
    delegatedId = res.body.id as string;
  });

  let stefan: Awaited<ReturnType<typeof signIn>>;

  function stefanInvites(email: string) {
    return stefan.agent
      .post(`/api/orgs/${ORG}/invitations`)
      .set('X-CSRF-Token', stefan.csrf)
      .send({ email, templateKey: 'employee' });
  }

  it('the delegated people.invite applies to stefan: invitation 201 and listed in /auth/me', async () => {
    stefan = await signIn('user_stefan');
    const invited = await stefanInvites('delegated.invite@example.com');
    expect(invited.status).toBe(201);

    const me = await stefan.agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.effectiveActions).toContain('people.invite');
    expect(me.body.effectiveActions).not.toContain('people.move');
  });

  it('an hr_admin action ivana did not delegate stays denied for stefan: people.move 403', async () => {
    const res = await stefan.agent
      .patch(`/api/orgs/${ORG}/members/mem_stefan`)
      .set('X-CSRF-Token', stefan.csrf)
      .send({ orgUnitId: 'team_product' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('forbidden');
  });

  it('rejects delegating an action the employer_owner grant does not contain: 403', async () => {
    const res = await ivana.agent
      .post(`${BASE}/delegate`)
      .set('X-CSRF-Token', ivana.csrf)
      .send({ parentGrantId: IVANA_EMPLOYER_OWNER, subjectUserId: 'user_stefan', actions: ['people.invite'] });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('delegation_exceeds_boundary');
    expect(res.body.details.reason).toBe('actions_exceed_parent');
  });

  it('rejects delegating to a user outside the organization: 403 (Review Focus 3)', async () => {
    const res = await ivana.agent
      .post(`${BASE}/delegate`)
      .set('X-CSRF-Token', ivana.csrf)
      .send({ parentGrantId: IVANA_HR_ADMIN, subjectUserId: 'user_milica', actions: ['people.invite'] });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('delegation_exceeds_boundary');
    expect(res.body.details.reason).toBe('subject_not_member');
  });

  it('rejects a delegation chain of depth 4: 403 (Review Focus 3)', async () => {
    // hr_admin (0) -> stefan (1) -> ana (2) -> ivana (3); ivana delegating
    // from the depth-3 grant would create depth 4.
    const link = (id: string, subjectUserId: string, parentGrantId: string) => ({
      id,
      subjectUserId,
      templateKey: null,
      actions: ['people.invite'],
      scopeType: 'organization',
      scopeOrgId: ORG,
      includeDescendants: false,
      parentGrantId,
      grantedByUserId: 'user_ivana',
      validFrom: new Date('2026-01-01'),
    });
    await testDb.db.insert(grants).values([
      link('grant_test_chain_1', 'user_stefan', IVANA_HR_ADMIN),
      link('grant_test_chain_2', 'user_ana', 'grant_test_chain_1'),
      link('grant_test_chain_3', 'user_ivana', 'grant_test_chain_2'),
    ]);

    const res = await ivana.agent
      .post(`${BASE}/delegate`)
      .set('X-CSRF-Token', ivana.csrf)
      .send({ parentGrantId: 'grant_test_chain_3', subjectUserId: 'user_jovan', actions: ['people.invite'] });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('delegation_exceeds_boundary');
    expect(res.body.details.reason).toBe('delegation_depth_exceeded');

    const children = await testDb.db.select({ id: grants.id }).from(grants).where(eq(grants.parentGrantId, 'grant_test_chain_3'));
    expect(children).toEqual([]);
  });

  it('revokes a grant and its delegated descendants', async () => {
    const res = await ivana.agent
      .post(`${BASE}/grant_test_chain_1/revoke`)
      .set('X-CSRF-Token', ivana.csrf)
      .send({ reason: 'chain no longer needed' });
    expect(res.status).toBe(200);
    expect(res.body.revokedAt).not.toBeNull();

    const rows = await testDb.db
      .select({ id: grants.id, revokedAt: grants.revokedAt, revokedReason: grants.revokedReason })
      .from(grants)
      .where(inArray(grants.id, ['grant_test_chain_1', 'grant_test_chain_2', 'grant_test_chain_3']));
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get('grant_test_chain_1')!.revokedReason).toBe('chain no longer needed');
    expect(byId.get('grant_test_chain_2')!.revokedAt).not.toBeNull();
    expect(byId.get('grant_test_chain_2')!.revokedReason).toBe('parent_revoked');
    expect(byId.get('grant_test_chain_3')!.revokedReason).toBe('parent_revoked');

    const events = await testDb.db
      .select({ action: auditEvents.action, recordId: auditEvents.recordId })
      .from(auditEvents)
      .where(inArray(auditEvents.recordId, ['grant_test_chain_1', 'grant_test_chain_2', 'grant_test_chain_3']));
    expect(events).toEqual(
      expect.arrayContaining([
        { action: 'grant.revoked', recordId: 'grant_test_chain_1' },
        { action: 'grant.delegation_revoked', recordId: 'grant_test_chain_2' },
        { action: 'grant.delegation_revoked', recordId: 'grant_test_chain_3' },
      ]),
    );

    // Revoked grants leave the default list and return with includeRevoked.
    const active = await ivana.agent.get(BASE);
    expect(active.body.items.map((g: { id: string }) => g.id)).not.toContain('grant_test_chain_1');
    const all = await ivana.agent.get(BASE).query({ includeRevoked: 'true' });
    expect(all.body.items.map((g: { id: string }) => g.id)).toContain('grant_test_chain_1');
    expect(all.body.items.map((g: { id: string }) => g.id)).toContain(delegatedId);
  });

  it('jovan (employee, a member) gets 403 on GET /', async () => {
    const jovan = await signIn('user_jovan');
    const res = await jovan.agent.get(BASE);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('forbidden');
  });

  describe('approval authorities', () => {
    const AA_BASE = `/api/orgs/${ORG}/approval-authorities`;
    let authorityId: string;

    it('creates, lists and adjusts an approval authority for stefan', async () => {
      const created = await ivana.agent
        .post(AA_BASE)
        .set('X-CSRF-Token', ivana.csrf)
        .send({
          userId: 'user_stefan',
          orgUnitId: 'team_product',
          includeDescendants: true,
          categories: ['events'],
          maxAmountMinor: 50_000,
          alternateUserId: 'user_ana',
          orgId: 'org_other',
        });
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({
        userId: 'user_stefan',
        orgId: ORG,
        orgUnitId: 'team_product',
        includeDescendants: true,
        categories: ['events'],
        maxAmountMinor: 50_000,
        currency: 'EUR',
        alternateUserId: 'user_ana',
        isConfidentialApprover: false,
        delegatedFromId: null,
      });
      authorityId = created.body.id as string;

      const list = await ivana.agent.get(AA_BASE);
      expect(list.status).toBe(200);
      expect(list.body.items.map((a: { id: string }) => a.id)).toContain(authorityId);

      const patched = await ivana.agent
        .patch(`${AA_BASE}/${authorityId}`)
        .set('X-CSRF-Token', ivana.csrf)
        .send({ maxAmountMinor: 75_000, isConfidentialApprover: true, userId: 'user_ivana' });
      expect(patched.status).toBe(200);
      expect(patched.body).toMatchObject({ id: authorityId, userId: 'user_stefan', maxAmountMinor: 75_000, isConfidentialApprover: true });

      const events = await testDb.db
        .select({ action: auditEvents.action, details: auditEvents.details })
        .from(auditEvents)
        .where(eq(auditEvents.recordId, authorityId));
      expect(events).toHaveLength(2);
      for (const event of events) expect(event.action).toBe('approval_authority.changed');
      expect(events.map((e) => (e.details as { changedFields: string[] }).changedFields)).toEqual(
        expect.arrayContaining([['maxAmountMinor', 'isConfidentialApprover']]),
      );
    });

    it('rejects an alternate equal to the user: 400 validation', async () => {
      const res = await ivana.agent
        .post(AA_BASE)
        .set('X-CSRF-Token', ivana.csrf)
        .send({ userId: 'user_stefan', alternateUserId: 'user_stefan' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('validation');
    });

    it('rejects a user outside the organization: 409 subject_not_member', async () => {
      const res = await ivana.agent.post(AA_BASE).set('X-CSRF-Token', ivana.csrf).send({ userId: 'user_milica' });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('subject_not_member');
    });
  });

  it("revoking ivana's root hr_admin grant ends stefan's delegated people.invite: 403", async () => {
    const revoked = await ivana.agent
      .post(`${BASE}/${IVANA_HR_ADMIN}/revoke`)
      .set('X-CSRF-Token', ivana.csrf)
      .send({ reason: 'delegation test teardown' });
    expect(revoked.status).toBe(200);

    const res = await stefanInvites('after.revoke@example.com');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('forbidden');
  });

  it('the 11th write within a minute returns 429 rate_limited', async () => {
    const statuses: number[] = [];
    while (patchCalls < 11) {
      const res = await patch(createdId, { validUntil: '2027-07-31T00:00:00.000Z' });
      statuses.push(res.status);
      if (patchCalls === 11) expect(res.body.code).toBe('rate_limited');
    }
    expect(statuses.slice(0, -1).every((s) => s === 200)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });

  // ── Owner model (2026-10-24) ────────────────────────────────────────

  describe('organization owner', () => {
    const TRANSFER = `${BASE}/transfer-ownership`;
    let ana: Awaited<ReturnType<typeof signIn>>;

    it('rejects a second employer_owner grant for stefan: 409 owner_exists', async () => {
      const res = await ivana.agent
        .post(BASE)
        .set('X-CSRF-Token', ivana.csrf)
        .send({ templateKey: 'employer_owner', subjectUserId: 'user_stefan', scopeType: 'organization' });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('owner_exists');
      expect(res.body.details).toEqual({ currentOwnerUserId: 'user_ivana' });
      const owners = await testDb.db
        .select({ id: grants.id })
        .from(grants)
        .where(eq(grants.templateKey, 'employer_owner'));
      expect(owners.map((g) => g.id)).toEqual([IVANA_EMPLOYER_OWNER]);
    });

    it('rejects a transfer by a member who is not the owner: 403', async () => {
      const res = await stefan.agent
        .post(TRANSFER)
        .set('X-CSRF-Token', stefan.csrf)
        .send({ newOwnerUserId: 'user_stefan' });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('forbidden');
    });

    it('rejects a transfer to a user outside the organization: 409 subject_not_member', async () => {
      const res = await ivana.agent
        .post(TRANSFER)
        .set('X-CSRF-Token', ivana.csrf)
        .send({ newOwnerUserId: 'user_milica' });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('subject_not_member');
    });

    let anaPreviewGrantId: string;

    it("ivana delegates access.preview from her owner grant to ana: ana can list grants", async () => {
      const res = await ivana.agent
        .post(`${BASE}/delegate`)
        .set('X-CSRF-Token', ivana.csrf)
        .send({ parentGrantId: IVANA_EMPLOYER_OWNER, subjectUserId: 'user_ana', actions: ['access.preview'] });
      expect(res.status).toBe(201);
      expect(res.body.parentGrantId).toBe(IVANA_EMPLOYER_OWNER);
      anaPreviewGrantId = res.body.id as string;

      ana = await signIn('user_ana');
      const list = await ana.agent.get(BASE);
      expect(list.status).toBe(200);
    });

    it('ivana transfers ownership to stefan: 200, her grant revoked, audited, access moves', async () => {
      const res = await ivana.agent
        .post(TRANSFER)
        .set('X-CSRF-Token', ivana.csrf)
        .send({ newOwnerUserId: 'user_stefan' });
      expect(res.status).toBe(200);
      expect(res.body.revokedGrantId).toBe(IVANA_EMPLOYER_OWNER);
      expect(res.body.createdGrant).toMatchObject({
        subjectUserId: 'user_stefan',
        templateKey: 'employer_owner',
        scopeType: 'organization',
        scopeOrgId: ORG,
        grantedByUserId: 'user_ivana',
        revokedAt: null,
      });
      expect(res.body.createdGrant.actions).toEqual([...PERMISSION_TEMPLATES.find((t) => t.key === 'employer_owner')!.actions]);
      const newOwnerGrantId = res.body.createdGrant.id as string;

      const [old] = await testDb.db.select().from(grants).where(eq(grants.id, IVANA_EMPLOYER_OWNER));
      expect(old!.revokedAt).not.toBeNull();
      expect(old!.revokedReason).toBe('ownership_transferred');
      expect(old!.revokedByUserId).toBe('user_ivana');

      const events = await testDb.db
        .select({ action: auditEvents.action, recordId: auditEvents.recordId, details: auditEvents.details })
        .from(auditEvents)
        .where(inArray(auditEvents.recordId, [IVANA_EMPLOYER_OWNER, newOwnerGrantId]));
      const revokedEvent = events.find((e) => e.action === 'grant.revoked' && e.recordId === IVANA_EMPLOYER_OWNER);
      const createdEvent = events.find((e) => e.action === 'grant.created' && e.recordId === newOwnerGrantId);
      expect(revokedEvent!.details).toMatchObject({ reason: 'ownership_transferred', transfer: true, newOwnerUserId: 'user_stefan' });
      expect(createdEvent!.details).toMatchObject({ transfer: true, previousOwnerUserId: 'user_ivana', templateKey: 'employer_owner' });
      expect(createdEvent!.details).not.toHaveProperty('byStaff');

      const stefanMe = await stefan.agent.get('/api/auth/me');
      expect(stefanMe.status).toBe(200);
      expect(stefanMe.body.effectiveActions).toContain('access.grant');
      const ivanaMe = await ivana.agent.get('/api/auth/me');
      expect(ivanaMe.status).toBe(200);
      expect(ivanaMe.body.effectiveActions).not.toContain('access.grant');

      // Ana's delegation from the old owner grant now hangs below stefan's.
      const [child] = await testDb.db.select().from(grants).where(eq(grants.id, anaPreviewGrantId));
      expect(child!.revokedAt).toBeNull();
      expect(child!.parentGrantId).toBe(newOwnerGrantId);
      const adjusted = await testDb.db
        .select({ action: auditEvents.action, details: auditEvents.details })
        .from(auditEvents)
        .where(eq(auditEvents.recordId, anaPreviewGrantId));
      expect(adjusted.find((e) => e.action === 'grant.adjusted')!.details).toMatchObject({
        reparented: true,
        fromGrantId: IVANA_EMPLOYER_OWNER,
      });
      const anaList = await ana.agent.get(BASE);
      expect(anaList.status).toBe(200);
    });

    it('ivana, no longer the owner, cannot transfer again: 403', async () => {
      const res = await ivana.agent
        .post(TRANSFER)
        .set('X-CSRF-Token', ivana.csrf)
        .send({ newOwnerUserId: 'user_ivana' });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('forbidden');
    });

    it("stefan, the new owner, revokes ana's team_manager grant: 200", async () => {
      const res = await stefan.agent
        .post(`${BASE}/${createdId}/revoke`)
        .set('X-CSRF-Token', stefan.csrf)
        .send({ reason: 'new owner tidy-up' });
      expect(res.status).toBe(200);
      expect(res.body.revokedAt).not.toBeNull();
    });
  });
});
