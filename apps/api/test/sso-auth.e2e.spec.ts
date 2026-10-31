/**
 * Federated sign-in e2e tests (auth phase 3, Task 4): home-realm discovery,
 * `GET /auth/sso/start`, the stub-only fake authorize hop and
 * `GET /auth/sso/callback` with identity resolution per D-04 against the
 * fake identity provider. Covers Review Focus 1 (consumed or unknown state),
 * 2 (invitation of another organization) and 4 (SUSPENDED connection) and
 * SSO-R-04 timing.
 *
 * Connections are seeded through `SsoRepository` (the staff lifecycle over
 * HTTP is `sso.e2e.spec.ts`).
 *
 * Requires TEST_DATABASE_URL (PostgreSQL). Skipped otherwise.
 */
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import { IdentityProviderService } from '../src/identity/identity-provider.service.js';
import type { FakeIdentityProvider } from '../src/identity/fake-identity-provider.js';
import { seed } from '../src/db/seed/seed-lib.js';
import {
  auditEvents,
  externalIdentities,
  grants,
  invitations,
  memberships,
  orgUnits,
  organizations,
  users,
} from '../src/db/schema/index.js';
import { SsoRepository, type SsoConnectionPatch } from '../src/db/repositories/sso.repository.js';
import { NEUTRAL_DELAY_MS } from '../src/auth/neutral-delay.js';
import { KEY_VALUE_STORE, type KeyValueStore } from '../src/redis/key-value-store.js';
import { sessionKey, ssoTestKey } from '../src/redis/redis-keys.js';
import { Mailer, type MailMessage } from '../src/email/mailer.js';
import type { LoggingMailer } from '../src/email/logging-mailer.js';
import { hashSessionId } from '../src/session/session-helpers.js';
import { resetThrottlerStorage } from './throttler-reset.js';
import { resetTestDatabase, type TestDatabase } from './db/test-database.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const shouldRun = !!TEST_DB_URL;

const ORG = 'org_sample';
const OTHER_ORG = 'org_ssoauth_other';
const PROVIDER = 'org-acme-oidc';
/** OTHER_ORG's ACTIVE connection: start buckets are per IP and connection. */
const OTHER_PROVIDER = 'org-other-ssoauth-oidc';
const API ='http://api.ssoauth.test';
const WORKSPACE = 'http://workspace.ssoauth.test';
const ADMIN = 'http://admin.ssoauth.test';
/** Each surface's flow runs on that surface's origin (its SPA proxies /api). */
const CALLBACK = `${WORKSPACE}/api/auth/sso/callback`;
const ADMIN_CALLBACK = `${ADMIN}/api/auth/sso/callback`;
const callbackFor = (surface: string) => (surface === 'admin' ? ADMIN_CALLBACK : CALLBACK);
const originFor = (surface: string) => (surface === 'admin' ? ADMIN : WORKSPACE);

describe.skipIf(!shouldRun)('Federated sign-in (e2e)', () => {
  let app: INestApplication;
  let idp: FakeIdentityProvider;
  let testDb: TestDatabase;
  let repo: SsoRepository;
  let connectionId: string;
  let unitId: string;
  const jwtSecret = randomBytes(32).toString('hex');

  beforeAll(async () => {
    testDb = await resetTestDatabase(TEST_DB_URL!, 'ssoauth');
    await seed(testDb.db);

    process.env.DATABASE_URL = testDb.url;
    process.env.AUTH_MODE = 'stub';
    process.env.JWT_SECRET = jwtSecret;
    process.env.SESSION_COOKIE_INSECURE_DEV = 'true';
    process.env.NODE_ENV = 'test';
    process.env.API_PUBLIC_URL = API;
    process.env.WORKSPACE_URL = WORKSPACE;
    process.env.ADMIN_URL = ADMIN;
    delete process.env.REDIS_URL;
    delete process.env.FAKE_DNS_TXT_AUTOVERIFY;

    const { AppModule } = await import('../src/app.module.js');
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const { ApiExceptionFilter } = await import('../src/common/api-exception.filter.js');

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();

    idp = app.get(IdentityProviderService) as FakeIdentityProvider;
    repo = app.get(SsoRepository);

    await idp.createProvider({
      name: PROVIDER,
      protocol: 'OIDC',
      oidcIssuer: 'https://idp.acme.example',
      oidcClientId: 'client',
      attributeMapping: {},
    });
    const [unit] = await testDb.db.select().from(orgUnits).where(eq(orgUnits.orgId, ORG)).limit(1);
    unitId = unit!.id;
    const conn = await repo.createConnection({
      orgId: ORG,
      protocol: 'OIDC',
      cognitoProviderName: PROVIDER,
      status: 'ACTIVE',
      oidcIssuer: 'https://idp.acme.example',
      oidcClientId: 'client',
      defaultOrgUnitId: unitId,
      lastTestedAt: new Date(),
    });
    connectionId = conn.id;
    const domain = await repo.addDomain({ connectionId, domain: 'acme.example', verificationToken: 'a'.repeat(32) });
    await repo.markDomainVerified(domain.id, new Date());

    await testDb.db.insert(organizations).values({ id: OTHER_ORG, name: 'Other SSO Auth Org', slug: 'other-ssoauth' });
    await idp.createProvider({
      name: OTHER_PROVIDER,
      protocol: 'OIDC',
      oidcIssuer: 'https://idp.other.example',
      oidcClientId: 'client',
      attributeMapping: {},
    });
    await repo.createConnection({
      orgId: OTHER_ORG,
      protocol: 'OIDC',
      cognitoProviderName: OTHER_PROVIDER,
      status: 'ACTIVE',
      oidcIssuer: 'https://idp.other.example',
      oidcClientId: 'client',
      lastTestedAt: new Date(),
    });

    // Known native user with a password (the discover timing baseline).
    idp.seedUsers([{ email: 'user_nikola@example.com', password: 'Password1!' }]);
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await testDb?.close();
    for (const k of ['API_PUBLIC_URL', 'WORKSPACE_URL', 'ADMIN_URL']) delete process.env[k];
  });

  beforeEach(() => {
    // Start allows 60 a minute per IP and connection, the callback 120 per IP,
    // and every test here comes from the same socket address.
    resetThrottlerStorage(app);
  });

  const setConnection = (patch: SsoConnectionPatch) => repo.updateConnection(connectionId, patch);

  /** What `POST /ops/sso-connections/:id/test` stores (the staff route is covered in sso.e2e). */
  async function issueTestNonce(): Promise<string> {
    const nonce = randomBytes(32).toString('base64url');
    await app.get<KeyValueStore>(KEY_VALUE_STORE).set(ssoTestKey(nonce), JSON.stringify({ connectionId }), { ttlSeconds: 900 });
    return nonce;
  }

  async function invite(email: string, orgId = ORG): Promise<string> {
    const [row] = await testDb.db
      .insert(invitations)
      .values({
        email,
        orgId,
        orgUnitId: orgId === ORG ? unitId : null,
        templateKey: 'employee',
        tokenHash: randomBytes(32).toString('hex'),
        expiresAt: new Date(Date.now() + 7 * 86_400_000),
        invitedByUserId: 'user_ivana',
      })
      .returning();
    return row!.id;
  }

  function seedFederated(subject: string, email: string, emailVerified = true) {
    idp.seedFederatedUsers([{ providerName: PROVIDER, subject, email, emailVerified }]);
  }

  /**
   * Browser walk: start -> fake authorize (as `email`) -> callback, with
   * cookies kept by the agent. Returns every hop's response.
   */
  async function federatedSignIn(email: string, query: Record<string, string> = {}) {
    const agent = request.agent(app.getHttpServer());
    const surface = query.surface ?? 'workspace';
    const start = await agent
      .get('/api/auth/sso/start')
      .query({ connection: PROVIDER, surface: 'workspace', ...query });
    expect(start.status).toBe(302);
    const authorizeUrl = new URL(start.headers.location as string);
    // The whole flow stays on the surface's own origin, never API_PUBLIC_URL.
    expect(authorizeUrl.origin).toBe(originFor(surface));
    expect(authorizeUrl.searchParams.get('redirect_uri')).toBe(callbackFor(surface));
    authorizeUrl.searchParams.set('as', email);
    const authorize = await agent.get(authorizeUrl.pathname + authorizeUrl.search);
    expect(authorize.status).toBe(302);
    const callbackUrl = new URL(authorize.headers.location as string);
    expect(callbackUrl.origin + callbackUrl.pathname).toBe(callbackFor(surface));
    const callback = await agent.get(callbackUrl.pathname + callbackUrl.search);
    expect(callback.status).toBe(302);
    return { agent, start, authorizeUrl, callbackUrl, callback, location: callback.headers.location as string };
  }

  function sessionCookie(res: request.Response): string | undefined {
    const cookies = res.headers['set-cookie'] as string[] | undefined;
    return cookies?.find((c) => c.startsWith('nestself_session='));
  }

  async function auditFor(action: string) {
    return testDb.db.select().from(auditEvents).where(eq(auditEvents.action, action));
  }

  // -------------------------------------------------------------------------
  // (a) Home-realm discovery
  // -------------------------------------------------------------------------

  describe('discover (3.4.3)', () => {
    const discover = (email: string, origin?: string) => {
      const req = request(app.getHttpServer()).post('/api/auth/discover');
      if (origin) req.set('Origin', origin);
      return req.send({ email });
    };

    it('routes a verified domain of an ACTIVE connection to sso with the start URL and connection', async () => {
      const res = await discover('Someone@ACME.example');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        method: 'sso',
        ssoStartUrl: `${WORKSPACE}/api/auth/sso/start?connection=${PROVIDER}&surface=workspace`,
        connection: PROVIDER,
      });
    });

    it('carries the admin surface, on the admin origin, when the request comes from the admin app', async () => {
      const res = await discover('someone@acme.example', ADMIN);
      expect(res.body.ssoStartUrl).toBe(`${ADMIN}/api/auth/sso/start?connection=${PROVIDER}&surface=admin`);
    });

    it('answers a public email domain natively', async () => {
      const res = await discover('someone@gmail.com');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ method: 'email_otp', ssoStartUrl: null, connection: null });
    });

    it('answers natively while the connection is SUSPENDED (Review Focus 4)', async () => {
      await setConnection({ status: 'SUSPENDED' });
      try {
        const res = await discover('someone@acme.example');
        expect(res.body).toEqual({ method: 'email_otp', ssoStartUrl: null, connection: null });
      } finally {
        await setConnection({ status: 'ACTIVE' });
      }
    });

    it('takes the same time for SSO, known and unknown addresses (SSO-R-04, 50 ms)', async () => {
      const median = async (email: string) => {
        const samples: number[] = [];
        for (let i = 0; i < 5; i += 1) {
          const t = performance.now();
          const res = await discover(email);
          samples.push(performance.now() - t);
          expect(res.status).toBe(200);
        }
        samples.sort((a, b) => a - b);
        return samples[2]!;
      };
      const sso = await median('someone@acme.example');
      const known = await median('user_nikola@example.com');
      const unknown = await median('nobody@nowhere.example');
      for (const t of [sso, known, unknown]) expect(t).toBeGreaterThanOrEqual(NEUTRAL_DELAY_MS - 5);
      expect(Math.max(sso, known, unknown) - Math.min(sso, known, unknown)).toBeLessThan(50);
    });
  });

  // -------------------------------------------------------------------------
  // (b) start
  // -------------------------------------------------------------------------

  describe('GET /auth/sso/start (API-R-06)', () => {
    it('302s to the fake authorize URL with an S256 challenge, state and our callback', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/auth/sso/start')
        .query({ connection: PROVIDER, surface: 'workspace', returnPath: '/people' });
      expect(res.status).toBe(302);
      expect(res.headers['cache-control']).toBe('no-store');
      const url = new URL(res.headers.location as string);
      expect(url.origin + url.pathname).toBe(`${WORKSPACE}/api/auth/sso/_fake/authorize`);
      expect(url.searchParams.get('connection')).toBe(PROVIDER);
      expect(url.searchParams.get('redirect_uri')).toBe(CALLBACK);
      expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(url.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    });

    it.each(['https://evil.example/', '//evil.example', '/a//b', 'people'])(
      'rejects returnPath %s with 400 validation',
      async (returnPath) => {
        const res = await request(app.getHttpServer())
          .get('/api/auth/sso/start')
          .query({ connection: PROVIDER, surface: 'workspace', returnPath });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('validation');
      },
    );

    it('rejects an unknown surface with 400', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/auth/sso/start')
        .query({ connection: PROVIDER, surface: 'mobile' });
      expect(res.status).toBe(400);
    });

    it('sends an unknown connection to the neutral sign-in error', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/auth/sso/start')
        .query({ connection: 'org-nope-saml', surface: 'admin' });
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe(`${ADMIN}/sign-in?reason=sso_denied`);
    });

    it('surface=admin: the authorize Location carries the admin-origin redirect_uri', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/auth/sso/start')
        .query({ connection: PROVIDER, surface: 'admin' });
      expect(res.status).toBe(302);
      const url = new URL(res.headers.location as string);
      expect(url.origin + url.pathname).toBe(`${ADMIN}/api/auth/sso/_fake/authorize`);
      expect(url.searchParams.get('redirect_uri')).toBe(ADMIN_CALLBACK);
    });

    it.each([
      'https://evil.example/cb',
      'https://evil.example/api/auth/sso/callback',
      `${ADMIN}/api/auth/sso/callback/x`,
    ])('the fake authorize hop refuses the foreign redirect_uri %s', async (redirectUri) => {
      const res = await request(app.getHttpServer())
        .get('/api/auth/sso/_fake/authorize')
        .query({ connection: PROVIDER, state: 's', code_challenge: 'c', redirect_uri: redirectUri });
      expect(res.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // (c) callback
  // -------------------------------------------------------------------------

  describe('GET /auth/sso/callback (API-R-07, D-04)', () => {
    it('pending invitation in the connection org: binds, ACTIVE membership, identity.linked, session, return path', async () => {
      const email = 'jovana@acme.example';
      const invitationId = await invite(email);
      seedFederated('sub-jovana', email);

      const { agent, callback, location } = await federatedSignIn(email, { returnPath: '/people?tab=1' });
      expect(location).toBe(`${WORKSPACE}/people?tab=1`);
      expect(sessionCookie(callback)).toBeDefined();

      const me = await agent.get('/api/auth/me');
      expect(me.status).toBe(200);
      expect(me.body.principal.auth).toMatchObject({ method: 'sso', secondFactor: true });

      const [user] = await testDb.db.select().from(users).where(eq(users.email, email));
      const [identity] = await testDb.db
        .select()
        .from(externalIdentities)
        .where(eq(externalIdentities.userId, user!.id));
      expect(identity).toMatchObject({ provider: `cognito:${PROVIDER}`, email, emailVerified: true });
      const [membership] = await testDb.db
        .select()
        .from(memberships)
        .where(and(eq(memberships.userId, user!.id), eq(memberships.orgId, ORG)));
      expect(membership).toMatchObject({ status: 'ACTIVE', orgUnitId: unitId });
      const [inv] = await testDb.db.select().from(invitations).where(eq(invitations.id, invitationId));
      expect(inv!.acceptedAt).not.toBeNull();
      expect(inv!.acceptedUserId).toBe(user!.id);
      const linked = (await auditFor('identity.linked')).filter((e) => e.recordId === user!.id);
      expect(linked).toHaveLength(1);
      expect((await auditFor('invitation.accepted')).some((e) => e.recordId === invitationId)).toBe(true);
    });

    it('existing identity: signs in again without a new binding', async () => {
      const { callback, location } = await federatedSignIn('jovana@acme.example');
      expect(location).toBe(`${WORKSPACE}/`);
      expect(sessionCookie(callback)).toBeDefined();
      const rows = await testDb.db
        .select()
        .from(externalIdentities)
        .where(eq(externalIdentities.provider, `cognito:${PROVIDER}`));
      expect(rows.filter((r) => r.email === 'jovana@acme.example')).toHaveLength(1);
    });

    it('surface=admin: start -> callback lands on ADMIN_URL with a session that /auth/me accepts', async () => {
      const { agent, callback, location, start, callbackUrl } = await federatedSignIn('jovana@acme.example', {
        surface: 'admin',
        returnPath: '/organizations',
      });
      expect(start.status).toBe(302);
      expect(callbackUrl.origin).toBe(ADMIN);
      expect(location).toBe(`${ADMIN}/organizations`);
      const cookie = sessionCookie(callback);
      expect(cookie).toBeDefined();
      // Host-only (no Domain) and Path=/: it binds to the host that ran the callback.
      expect(cookie).not.toMatch(/;\s*Domain=/i);
      expect(cookie).toMatch(/;\s*Path=\//i);
      const me = await agent.get('/api/auth/me');
      expect(me.status).toBe(200);
      expect(me.body.principal.auth).toMatchObject({ method: 'sso', secondFactor: true });
    });

    it('surface=admin: a denial lands on the admin sign-in page', async () => {
      const { location } = await federatedSignIn('nobody-admin@acme.example', { surface: 'admin' });
      expect(location).toBe(`${ADMIN}/sign-in?reason=sso_denied`);
    });

    it('existing identity still signs in while the connection is SUSPENDED (Review Focus 4)', async () => {
      // Start while ACTIVE, suspend mid-flow, then complete.
      const agent = request.agent(app.getHttpServer());
      const start = await agent.get('/api/auth/sso/start').query({ connection: PROVIDER, surface: 'workspace' });
      const authorizeUrl = new URL(start.headers.location as string);
      authorizeUrl.searchParams.set('as', 'jovana@acme.example');
      const authorize = await agent.get(authorizeUrl.pathname + authorizeUrl.search);
      await setConnection({ status: 'SUSPENDED' });
      try {
        const cb = new URL(authorize.headers.location as string);
        const callback = await agent.get(cb.pathname + cb.search);
        expect(callback.status).toBe(302);
        expect(callback.headers.location).toBe(`${WORKSPACE}/`);
        expect(sessionCookie(callback)).toBeDefined();
      } finally {
        await setConnection({ status: 'ACTIVE' });
      }
    });

    it('a new binding through a SUSPENDED connection is denied', async () => {
      const email = 'late@acme.example';
      await invite(email);
      const agent = request.agent(app.getHttpServer());
      const start = await agent.get('/api/auth/sso/start').query({ connection: PROVIDER, surface: 'workspace' });
      const authorizeUrl = new URL(start.headers.location as string);
      authorizeUrl.searchParams.set('as', email);
      const authorize = await agent.get(authorizeUrl.pathname + authorizeUrl.search);
      await setConnection({ status: 'SUSPENDED' });
      try {
        const cb = new URL(authorize.headers.location as string);
        const callback = await agent.get(cb.pathname + cb.search);
        expect(callback.headers.location).toBe(`${WORKSPACE}/sign-in?reason=sso_denied`);
        expect(sessionCookie(callback)).toBeUndefined();
      } finally {
        await setConnection({ status: 'ACTIVE' });
      }
    });

    it('an invitation of another organization does not bind (Review Focus 2)', async () => {
      const email = 'elsewhere@acme.example';
      const invitationId = await invite(email, OTHER_ORG);
      const deleteUser = vi.spyOn(idp, 'deleteUser');
      const { callback, location } = await federatedSignIn(email);
      expect(location).toBe(`${WORKSPACE}/sign-in?reason=sso_denied`);
      expect(sessionCookie(callback)).toBeUndefined();
      const [inv] = await testDb.db.select().from(invitations).where(eq(invitations.id, invitationId));
      expect(inv!.acceptedAt).toBeNull();
      expect(await testDb.db.select().from(users).where(eq(users.email, email))).toHaveLength(0);
      const denied = await auditFor('identity.denied');
      expect(denied.some((e) => (e.details as { emailNormalised?: string }).emailNormalised === email)).toBe(true);
      // SSO-R-10: the orphan federated pool user is deleted.
      expect(deleteUser).toHaveBeenCalledWith(`${PROVIDER}_${idp.listFederatedUsers(PROVIDER).find((u) => u.email === email)!.subject}`);
      deleteUser.mockRestore();
    });

    it('JIT off and no invitation: denied', async () => {
      const { location } = await federatedSignIn('walkin@acme.example');
      expect(location).toBe(`${WORKSPACE}/sign-in?reason=sso_denied`);
    });

    it('JIT on: creates the user, an ACTIVE membership in the default unit with the employee grant', async () => {
      await setConnection({ jitProvisioning: true });
      try {
        const email = 'walkin@acme.example';
        const { callback, location } = await federatedSignIn(email);
        expect(location).toBe(`${WORKSPACE}/`);
        expect(sessionCookie(callback)).toBeDefined();
        const [user] = await testDb.db.select().from(users).where(eq(users.email, email));
        const [membership] = await testDb.db.select().from(memberships).where(eq(memberships.userId, user!.id));
        expect(membership).toMatchObject({ orgId: ORG, status: 'ACTIVE', orgUnitId: unitId });
        const userGrants = await testDb.db.select().from(grants).where(eq(grants.subjectUserId, user!.id));
        expect(userGrants.map((g) => g.templateKey)).toEqual(['employee']);
        expect((await auditFor('identity.created')).some((e) => e.recordId === user!.id)).toBe(true);
      } finally {
        await setConnection({ jitProvisioning: false });
      }
    });

    it('unverified OIDC email: no binding, redirect to sso_email_unverified with the address', async () => {
      const email = 'unverified@acme.example';
      await invite(email);
      seedFederated('sub-unverified', email, false);
      const { callback, location } = await federatedSignIn(email);
      expect(location).toBe(`${WORKSPACE}/sign-in?reason=sso_email_unverified&email=unverified%40acme.example`);
      expect(sessionCookie(callback)).toBeUndefined();
      expect(await testDb.db.select().from(users).where(eq(users.email, email))).toHaveLength(0);
    });

    it('a replayed state is answered neutrally with no session (Review Focus 1)', async () => {
      const { agent, callbackUrl } = await federatedSignIn('jovana@acme.example');
      const before = (await auditFor('auth.sign_in.failed')).length;
      const replay = await agent.get(callbackUrl.pathname + callbackUrl.search);
      expect(replay.status).toBe(302);
      expect(replay.headers.location).toBe(`${WORKSPACE}/sign-in?reason=sso_denied`);
      expect(sessionCookie(replay)).toBeUndefined();
      const failed = await auditFor('auth.sign_in.failed');
      expect(failed.length).toBe(before + 1);
      const state = callbackUrl.searchParams.get('state')!;
      const code = callbackUrl.searchParams.get('code')!;
      for (const e of failed) {
        expect(JSON.stringify(e.details)).not.toContain(state);
        expect(JSON.stringify(e.details)).not.toContain(code);
      }
    });

    it('a never-issued state is answered neutrally', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/auth/sso/callback')
        .query({ code: 'whatever', state: 'never-issued' });
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe(`${WORKSPACE}/sign-in?reason=sso_denied`);
      expect(sessionCookie(res)).toBeUndefined();
    });

    it('the test flag on a TESTING connection binds and sets lastTestedAt', async () => {
      await setConnection({ status: 'TESTING', lastTestedAt: null });
      try {
        const email = 'tester@acme.example';
        await invite(email);
        const plain = await request(app.getHttpServer())
          .get('/api/auth/sso/start')
          .query({ connection: PROVIDER, surface: 'workspace' });
        expect(plain.headers.location).toBe(`${WORKSPACE}/sign-in?reason=sso_denied`);

        // The literal flag of the first version is not a nonce.
        const literal = await request(app.getHttpServer())
          .get('/api/auth/sso/start')
          .query({ connection: PROVIDER, surface: 'workspace', test: '1' });
        expect(literal.status).toBe(400);
        const unknown = await request(app.getHttpServer())
          .get('/api/auth/sso/start')
          .query({ connection: PROVIDER, surface: 'workspace', test: 'u'.repeat(43) });
        expect(unknown.headers.location).toBe(`${WORKSPACE}/sign-in?reason=sso_denied`);

        const nonce = await issueTestNonce();
        const { location } = await federatedSignIn(email, { test: nonce });
        expect(location).toBe(`${WORKSPACE}/`);
        const conn = await repo.findConnection(connectionId);
        expect(conn!.lastTestedAt).not.toBeNull();

        // Single use: the callback spent it.
        const again = await request(app.getHttpServer())
          .get('/api/auth/sso/start')
          .query({ connection: PROVIDER, surface: 'workspace', test: nonce });
        expect(again.headers.location).toBe(`${WORKSPACE}/sign-in?reason=sso_denied`);
      } finally {
        await setConnection({ status: 'ACTIVE' });
      }
    });

    it('JIT never provisions on a TESTING connection, even on a test flow', async () => {
      await setConnection({ status: 'TESTING', jitProvisioning: true, lastTestedAt: null });
      try {
        const { location } = await federatedSignIn('jit.tester@acme.example', { test: await issueTestNonce() });
        expect(location).toBe(`${WORKSPACE}/sign-in?reason=sso_denied`);
        expect(await testDb.db.select().from(users).where(eq(users.email, 'jit.tester@acme.example'))).toHaveLength(0);
        expect((await repo.findConnection(connectionId))!.lastTestedAt).toBeNull();
      } finally {
        await setConnection({ status: 'ACTIVE', jitProvisioning: false });
      }
    });
  });

  // -------------------------------------------------------------------------
  // Review fixes: verified-domain rule, browser binding
  // -------------------------------------------------------------------------

  describe('review fixes', () => {
    it('an OIDC assertion of an off-domain address (email_verified true) with a pending invitation binds nothing (neutral sso_denied)', async () => {
      const email = 'invited@othermail.com';
      const invitationId = await invite(email);
      const { callback, location } = await federatedSignIn(email);
      expect(location).toBe(`${WORKSPACE}/sign-in?reason=sso_denied`);
      const denied = await auditFor('identity.denied');
      expect(
        denied.some(
          (e) =>
            (e.details as { emailNormalised?: string; reason?: string }).emailNormalised === email &&
            (e.details as { reason?: string }).reason === 'email_off_domain',
        ),
      ).toBe(true);
      expect(sessionCookie(callback)).toBeUndefined();
      const [inv] = await testDb.db.select().from(invitations).where(eq(invitations.id, invitationId));
      expect(inv!.acceptedAt).toBeNull();
      expect(await testDb.db.select().from(users).where(eq(users.email, email))).toHaveLength(0);
    });

    it('the same flow for an on-domain address binds', async () => {
      const email = 'ondomain@acme.example';
      await invite(email);
      const { callback, location } = await federatedSignIn(email);
      expect(location).toBe(`${WORKSPACE}/`);
      expect(sessionCookie(callback)).toBeDefined();
    });

    it('start sets the browser-binding cookie, HttpOnly, SameSite=Lax, callback path only', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/auth/sso/start')
        .query({ connection: PROVIDER, surface: 'workspace' });
      const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('nestself_sso='))!;
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Lax/i);
      expect(cookie).toMatch(/Path=\/api\/auth\/sso\/callback/);
      expect(cookie).toMatch(/Max-Age=600/);
    });

    it('a callback from a browser without the cookie is denied (login CSRF) and clears the cookie', async () => {
      seedFederated('sub-jovana', 'jovana@acme.example');
      const victim = request.agent(app.getHttpServer());
      const attacker = request.agent(app.getHttpServer());
      // The attacker starts and authorizes; the victim's browser gets the callback URL.
      const start = await attacker.get('/api/auth/sso/start').query({ connection: PROVIDER, surface: 'workspace' });
      const authorizeUrl = new URL(start.headers.location as string);
      authorizeUrl.searchParams.set('as', 'jovana@acme.example');
      const authorize = await attacker.get(authorizeUrl.pathname + authorizeUrl.search);
      const cb = new URL(authorize.headers.location as string);
      const before = (await auditFor('auth.sign_in.failed')).length;
      const res = await victim.get(cb.pathname + cb.search);
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe(`${WORKSPACE}/sign-in?reason=sso_denied`);
      expect(sessionCookie(res)).toBeUndefined();
      expect((res.headers['set-cookie'] as unknown as string[]).some((c) => c.startsWith('nestself_sso=;') && /Max-Age=0/.test(c))).toBe(true);
      const failed = await auditFor('auth.sign_in.failed');
      expect(failed.length).toBe(before + 1);
      expect(failed.some((e) => (e.details as { reason?: string }).reason === 'sso_browser')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Step-up of a federated user (5.4): a NestSelf code to the identity's address
  // -------------------------------------------------------------------------

  describe('federated step-up (5.4)', () => {
    const store = () => app.get<KeyValueStore>(KEY_VALUE_STORE);

    function cookieValue(res: request.Response, name: string): string {
      const cookies = (res.headers['set-cookie'] as string[] | undefined) ?? [];
      const cookie = cookies.find((c) => c.startsWith(`${name}=`));
      if (!cookie) throw new Error(`${name} cookie not set`);
      return cookie.slice(name.length + 1).split(';')[0]!;
    }

    /** Invited, bound and signed in through the fake IdP: the agent, its CSRF token and session id. */
    async function signInFederated(email: string) {
      await invite(email);
      seedFederated(`sub-${email}`, email);
      const { agent, callback } = await federatedSignIn(email);
      return {
        agent,
        csrf: cookieValue(callback, 'nestself_csrf'),
        sessionId: cookieValue(callback, 'nestself_session'),
      };
    }

    type Federated = Awaited<ReturnType<typeof signInFederated>>;

    const stepUp = (who: Federated, path: 'start' | 'resend' | 'verify', body: Record<string, string> = {}) =>
      who.agent.post(`/api/auth/step-up/${path}`).set('X-CSRF-Token', who.csrf).send(body);

    /** The newest code mail to `email` (the logging mailer keeps what it "sent" in test runs). */
    function lastMailTo(email: string): MailMessage {
      const mail = (app.get(Mailer) as LoggingMailer).sent.filter((m) => m.to === email).at(-1);
      if (!mail) throw new Error(`no mail to ${email}`);
      return mail;
    }

    /** Move the session's authentication time 40 minutes into the past. */
    async function ageSession(sessionId: string) {
      const key = sessionKey(hashSessionId(sessionId));
      const raw = await store().get(key);
      expect(raw).not.toBeNull();
      const ttl = await store().ttl(key);
      const record = JSON.parse(raw!) as { auth: { time: string } };
      record.auth.time = new Date(Date.now() - 40 * 60_000).toISOString();
      await store().set(key, JSON.stringify(record), { ttlSeconds: ttl });
    }

    it('a federated session steps up with the mailed code and regenerates the session', async () => {
      const email = 'marija@acme.example';
      const marija = await signInFederated(email);
      await ageSession(marija.sessionId);

      const start = await stepUp(marija, 'start');
      expect(start.status).toBe(200);
      expect(start.body).toEqual({
        method: 'email_otp',
        challengeToken: expect.any(String),
        ssoStartUrl: null,
        emailMasked: 'm***@acme.example',
      });
      const mail = lastMailTo(email);
      expect(mail).toMatchObject({ template: 'step_up_code', locale: 'sr-Latn' });

      const verify = await stepUp(marija, 'verify', {
        challengeToken: start.body.challengeToken as string,
        response: mail.params.code!,
      });
      expect(verify.status).toBe(204);
      const newSessionId = cookieValue(verify, 'nestself_session');
      expect(newSessionId).not.toBe(marija.sessionId);
      expect(cookieValue(verify, 'nestself_csrf')).not.toBe(marija.csrf);
      // The old session id no longer authenticates; the new one carries the step-up.
      expect(await store().get(sessionKey(hashSessionId(marija.sessionId)))).toBeNull();
      const me = await marija.agent.get('/api/auth/me');
      expect(me.status).toBe(200);
      expect(Date.now() - new Date(me.body.principal.auth.lastStepUpAt as string).getTime()).toBeLessThan(60_000);
      const completed = (await auditFor('auth.step_up.completed')).filter(
        (e) => e.actorUserId === me.body.principal.userId,
      );
      expect(completed.map((e) => e.details)).toEqual([{ method: 'email_otp', issuer: 'nestself' }]);
    });

    it('step-up/resend inside the cooldown answers 429 rate_limited with retryAfter', async () => {
      const email = 'petar@acme.example';
      const petar = await signInFederated(email);
      const start = await stepUp(petar, 'start');
      expect(start.status).toBe(200);
      const challengeToken = start.body.challengeToken as string;
      const firstCode = lastMailTo(email).params.code!;

      // The cooldown starts with the first mail.
      const refused = await stepUp(petar, 'resend', { challengeToken });
      expect(refused.status).toBe(429);
      expect(refused.body).toHaveProperty('code', 'rate_limited');
      expect(refused.body.details.retryAfter).toBeGreaterThan(0);
      expect(refused.body.details.retryAfter).toBeLessThanOrEqual(60);

      // 61 seconds later: a new code for the same token; the first one stopped working.
      vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 61_000 });
      try {
        const renewed = await stepUp(petar, 'resend', { challengeToken });
        expect(renewed.status).toBe(200);
        expect(renewed.body).toEqual({
          method: 'email_otp',
          challengeToken,
          ssoStartUrl: null,
          emailMasked: 'p***@acme.example',
        });
        const secondCode = lastMailTo(email).params.code!;
        expect(secondCode).not.toBe(firstCode);

        const old = await stepUp(petar, 'verify', { challengeToken, response: firstCode });
        expect(old.status).toBe(401);
        expect(old.body).toHaveProperty('code', 'invalid_code');
        const verified = await stepUp(petar, 'verify', { challengeToken, response: secondCode });
        expect(verified.status).toBe(204);
      } finally {
        vi.useRealTimers();
      }
    });

    it("another user presenting a federated user's step-up token is refused with invalid_challenge (Review Focus 1)", async () => {
      const ana = await signInFederated('ana.fed@acme.example');
      const bojan = await signInFederated('bojan@acme.example');
      const start = await stepUp(ana, 'start');
      expect(start.status).toBe(200);

      const res = await stepUp(bojan, 'verify', {
        challengeToken: start.body.challengeToken as string,
        response: lastMailTo('ana.fed@acme.example').params.code!,
      });
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 'invalid_challenge');

      // Nothing was recorded on bojan's session, and the refusal is audited.
      const me = await bojan.agent.get('/api/auth/me');
      expect(me.body.principal.auth.lastStepUpAt).toBeNull();
      const failed = (await auditFor('auth.step_up.failed')).filter((e) => e.actorUserId === me.body.principal.userId);
      expect(failed.map((e) => e.details)).toEqual([{ method: 'email_otp', reason: 'foreign_challenge' }]);
    });
  });

  // -------------------------------------------------------------------------
  // Throttles (5.9): a refused browser hop lands on the sign-in page
  // -------------------------------------------------------------------------

  describe('throttles (5.9)', () => {
    const RATE_LIMITED = `${WORKSPACE}/sign-in?reason=sso_rate_limited`;
    const start = (connection: string) =>
      request(app.getHttpServer()).get('/api/auth/sso/start').query({ connection, surface: 'workspace' });
    const callback = () =>
      request(app.getHttpServer()).get('/api/auth/sso/callback').query({ code: 'c', state: 'never-issued' });

    function expectAuthorizeHop(res: request.Response, connection: string) {
      expect(res.status).toBe(302);
      const url = new URL(res.headers.location as string);
      expect(url.origin + url.pathname).toBe(`${WORKSPACE}/api/auth/sso/_fake/authorize`);
      expect(url.searchParams.get('connection')).toBe(connection);
    }

    async function spendStarts(connection: string, count: number, from?: string) {
      for (let i = 0; i < count; i++) {
        const req = start(connection);
        expectAuthorizeHop(await (from ? req.set('X-Forwarded-For', from) : req), connection);
      }
    }

    function expectRateLimitedRedirect(res: request.Response) {
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe(RATE_LIMITED);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['retry-after']).toBe('60');
      // A redirect, not the JSON 429 the browser would show as raw text.
      expect(res.headers['content-type']).toBeUndefined();
      expect(res.text).toBe('');
    }

    it('start buckets are per IP and connection', async () => {
      await spendStarts(PROVIDER, 60);
      expectAuthorizeHop(await start(OTHER_PROVIDER), OTHER_PROVIDER);
      // The first connection's own bucket is spent.
      expect((await start(PROVIDER)).headers.location).toBe(RATE_LIMITED);
    });

    it('61 starts with distinct unknown connections from one IP: neutral redirects, no 429, no audit rows', async () => {
      // Each value is its own bucket, so the throttle never refuses these; an
      // audit row per unknown name would let one client write rows without bound.
      const before = (await auditFor('auth.sign_in.failed')).length;
      for (let i = 0; i < 61; i++) {
        const res = await start(`org-unknown${i}-oidc`);
        expect(res.status).toBe(302);
        expect(res.headers.location).toBe(`${WORKSPACE}/sign-in?reason=sso_denied`);
      }
      expect((await auditFor('auth.sign_in.failed')).length).toBe(before);
    });

    it('the 61st start of one connection redirects to /sign-in?reason=sso_rate_limited', async () => {
      await spendStarts(PROVIDER, 60);
      expectRateLimitedRedirect(await start(PROVIDER));
    });

    it('callback over its limit redirects too', async () => {
      for (let i = 0; i < 120; i++) {
        expect((await callback()).headers.location).toBe(`${WORKSPACE}/sign-in?reason=sso_denied`);
      }
      expectRateLimitedRedirect(await callback());
    });

    it('behind trusted proxies (TRUST_PROXY_HOPS) each visitor address has its own start bucket', async () => {
      // What main.ts sets from TRUST_PROXY_HOPS; this suite's app runs without it.
      const express = app.getHttpAdapter().getInstance();
      express.set('trust proxy', 1);
      try {
        await spendStarts(PROVIDER, 60, '198.51.100.7');
        expectRateLimitedRedirect(await start(PROVIDER).set('X-Forwarded-For', '198.51.100.7'));
        expectAuthorizeHop(await start(PROVIDER).set('X-Forwarded-For', '198.51.100.8'), PROVIDER);
      } finally {
        express.set('trust proxy', false);
      }
    });
  });
});
