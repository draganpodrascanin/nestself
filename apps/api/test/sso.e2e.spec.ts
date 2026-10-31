/**
 * SSO connection management e2e tests (auth phase 3, Task 3): the staff
 * lifecycle DRAFT -> TESTING -> ACTIVE -> SUSPENDED -> ACTIVE over HTTP,
 * DNS domain verification with the fake resolver, provider registration in
 * the fake identity provider, Review Focus 3 (domain on another connection),
 * 4 (a metadata URL on a host that resolves to a public and a private
 * address) and 5 (provider name length and collision), the per-organization
 * slug reservation, the ACTIVE -> TESTING and SUSPENDED -> TESTING moves on
 * a provider change (SSO-R-01) and the certificate expiry read from the
 * fetched metadata (the fake metadata fetcher).
 *
 * Requires TEST_DATABASE_URL (PostgreSQL). Skipped otherwise.
 */
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { and, eq, like } from 'drizzle-orm';
import { PERMISSION_TEMPLATES } from '@nestself/contracts';
import { IdentityProviderService } from '../src/identity/identity-provider.service.js';
import type { FakeIdentityProvider } from '../src/identity/fake-identity-provider.js';
import { SAMPLE_SAML_METADATA, SIGNING_CERT_NOT_AFTER } from '../src/identity/saml-metadata.fixture.js';
import { computeTotp } from '../src/identity/totp.js';
import { seed } from '../src/db/seed/seed-lib.js';
import { auditEvents, externalIdentities, grants, organizations } from '../src/db/schema/index.js';
import { SsoRepository } from '../src/db/repositories/sso.repository.js';
import { DNS_TXT_RESOLVER, type FakeDnsTxtResolver } from '../src/sso/dns-txt-resolver.js';
import { METADATA_FETCHER, type FakeMetadataFetcher } from '../src/sso/metadata-fetcher.js';
import { resetThrottlerStorage } from './throttler-reset.js';
import { resetTestDatabase, type TestDatabase } from './db/test-database.js';
import { KEY_VALUE_STORE, type KeyValueStore } from '../src/redis/key-value-store.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const shouldRun = !!TEST_DB_URL;

const ORG = 'org_sample';
const NIKOLA_EMAIL = 'user_nikola@example.com';
const IVANA_EMAIL = 'user_ivana@example.com';
const TEMP_PASSWORD = 'TempPassword1!';
const METADATA_URL = 'https://idp.acme.example/metadata';
/** Every metadata URL a test sign-in or a metadata PATCH below fetches; the fake fetcher serves the fixture there. */
const SERVED_METADATA_URLS = [
  METADATA_URL,
  'https://idp.acme.example/metadata-v2',
  'https://idp.acme.example/metadata-v3',
];
/** Resolves to one public and one private address (Review Focus 4). */
const MIXED_HOST = 'idp.mixed.example';

describe.skipIf(!shouldRun)('SSO connection management (e2e)', () => {
  let app: INestApplication;
  let idp: FakeIdentityProvider;
  let dns: FakeDnsTxtResolver;
  let metadata: FakeMetadataFetcher;
  let testDb: TestDatabase;
  const jwtSecret = randomBytes(32).toString('hex');

  beforeAll(async () => {
    testDb = await resetTestDatabase(TEST_DB_URL!, 'sso');
    await seed(testDb.db);

    process.env.DATABASE_URL = testDb.url;
    process.env.AUTH_MODE = 'stub';
    process.env.JWT_SECRET = jwtSecret;
    process.env.SESSION_COOKIE_INSECURE_DEV = 'true';
    process.env.NODE_ENV = 'test';
    process.env.API_PUBLIC_URL = 'http://api.sso.test';
    // Explicit, so apps/api/.env (dotenv) cannot decide the test link's origin.
    process.env.WORKSPACE_URL = 'http://workspace.sso.test';
    process.env.ADMIN_URL = 'http://admin.sso.test';
    process.env.COGNITO_USER_POOL_ID = 'eu-central-1_ssotest';
    process.env.COGNITO_DOMAIN = 'https://auth.sso.test';
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
    dns = app.get<FakeDnsTxtResolver>(DNS_TXT_RESOLVER);
    metadata = app.get<FakeMetadataFetcher>(METADATA_FETCHER);
    for (const url of SERVED_METADATA_URLS) metadata.setResponse(url, SAMPLE_SAML_METADATA);
    metadata.setAddresses(MIXED_HOST, ['203.0.113.10', '10.0.0.1']);
    metadata.setAddresses('login.internal.example', ['10.20.30.40']);
    idp.seedUsers([
      { email: NIKOLA_EMAIL, password: TEMP_PASSWORD, temporaryPassword: TEMP_PASSWORD },
      { email: IVANA_EMAIL },
    ]);
    for (const p of [
      { userId: 'user_nikola', email: NIKOLA_EMAIL },
      { userId: 'user_ivana', email: IVANA_EMAIL },
    ]) {
      const idpUser = await idp.findUserByEmail(p.email);
      if (!idpUser) throw new Error(`FakeIDP user not found: ${p.email}`);
      await testDb.db.insert(externalIdentities).values({
        userId: p.userId,
        provider: 'cognito',
        subject: idpUser.sub,
        cognitoUsername: idpUser.username,
        email: p.email,
        emailVerified: true,
      });
    }

    // sso.manage is a platform_owner action; the sample data has no platform owner.
    const platformOwner = PERMISSION_TEMPLATES.find((t) => t.key === 'platform_owner')!;
    await testDb.db.insert(grants).values({
      id: 'grant_test_nikola_platform_owner_sso',
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
    for (const k of ['API_PUBLIC_URL', 'WORKSPACE_URL', 'ADMIN_URL']) delete process.env[k];
  });

  beforeEach(() => {
    // The write routes allow 10 requests a minute per IP and every request
    // here comes from the same socket address; the suite is longer than that.
    resetThrottlerStorage(app);
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
    const enrol = await agent.post('/api/auth/totp/enrol').send({ challengeToken: newPw.body.challengeToken });
    expect(enrol.status).toBe(200);
    const secret = (enrol.body.secretUri as string).match(/secret=([A-Z2-7]+)/)![1]!;
    const complete = await agent
      .post('/api/auth/challenge')
      .send({ challengeToken: enrol.body.challengeToken ?? newPw.body.challengeToken, response: computeTotp(secret) });
    expect(complete.status).toBe(200);
    return { agent, csrf: extractCsrf(complete) };
  }

  async function signInEmailOtp(email: string) {
    const agent = request.agent(app.getHttpServer());
    const start = await agent.post('/api/auth/email-otp/start').send({ email });
    expect(start.status).toBe(200);
    const code = idp.sentCodes.filter((c) => c.email === email).pop()!.code;
    const verify = await agent.post('/api/auth/email-otp/verify').send({ challengeToken: start.body.challengeToken, code });
    expect(verify.status).toBe(200);
    return { agent, csrf: extractCsrf(verify) };
  }

  let nikola: Awaited<ReturnType<typeof signInStaff>>;
  const post = (path: string, body: object = {}) =>
    nikola.agent.post(`/api/ops/sso-connections${path}`).set('X-CSRF-Token', nikola.csrf).send(body);
  const patch = (path: string, body: object) =>
    nikola.agent.patch(`/api/ops/sso-connections${path}`).set('X-CSRF-Token', nikola.csrf).send(body);

  let connectionId: string;
  let domainId: string;
  let txtName: string;
  let txtValue: string;

  it('signs in nikola in the operations context', async () => {
    nikola = await signInStaff();
    const ctx = await nikola.agent
      .post('/api/auth/context')
      .set('X-CSRF-Token', nikola.csrf)
      .send({ context: { kind: 'operations' } });
    expect(ctx.status).toBe(200);
  });

  it('creates a SAML connection in DRAFT: 201, provider name org-acme-saml, audited', async () => {
    const res = await post('', { orgId: ORG, slug: 'acme', protocol: 'SAML', metadataUrl: METADATA_URL });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      orgId: ORG,
      protocol: 'SAML',
      cognitoProviderName: 'org-acme-saml',
      status: 'DRAFT',
      metadataUrl: METADATA_URL,
      idpInitiatedAllowed: false,
      domains: [],
      spMetadata: {
        entityId: 'urn:amazon:cognito:sp:eu-central-1_ssotest',
        acsUrl: 'https://auth.sso.test/saml2/idpresponse',
      },
    });
    connectionId = res.body.id as string;
    expect(await idp.listProviders()).not.toContain('org-acme-saml');
    const [audit] = await testDb.db.select().from(auditEvents).where(eq(auditEvents.recordId, connectionId));
    expect(audit).toMatchObject({ action: 'sso_connection.created', orgId: ORG, actorUserId: 'user_nikola' });
  });

  it('adds acme.example: 201 with the TXT record name and value', async () => {
    const res = await post(`/${connectionId}/domains`, { domain: ' ACME.example ' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ domain: 'acme.example', verifiedAt: null, txtRecordName: '_nestself-verify.acme.example' });
    expect(res.body.txtRecordValue).toMatch(/^nestself-domain-verification=[0-9a-f]{32}$/);
    expect(res.body).not.toHaveProperty('verificationToken');
    domainId = res.body.id as string;
    txtName = res.body.txtRecordName as string;
    txtValue = res.body.txtRecordValue as string;
  });

  it('verification fails with 422 domain_unverified while the record is absent', async () => {
    const res = await post(`/${connectionId}/domains/${domainId}/verify`);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('domain_unverified');
  });

  it('testing before any domain is verified is refused: 409 sso_connection_state', async () => {
    const res = await post(`/${connectionId}/test`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('sso_connection_state');
  });

  it('verification succeeds once the TXT record is published: 200, verifiedAt set, audited', async () => {
    dns.setTxt(txtName, ['v=spf1 -all', txtValue]);
    const res = await post(`/${connectionId}/domains/${domainId}/verify`);
    expect(res.status).toBe(200);
    expect(res.body.verifiedAt).not.toBeNull();
    const events = await testDb.db.select().from(auditEvents).where(eq(auditEvents.recordId, domainId));
    expect(events.map((e) => e.action).sort()).toEqual(['sso_domain.added', 'sso_domain.verified']);
    const token = txtValue.split('=')[1]!;
    for (const e of events) expect(JSON.stringify(e.details)).not.toContain(token);
  });

  it('test registers the provider in the identity provider, moves to TESTING and stores the fetched certificate expiry', async () => {
    const res = await post(`/${connectionId}/test`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      startUrl: expect.stringMatching(
        // A workspace flow: it starts on the workspace origin, where its callback runs.
        /^http:\/\/workspace\.sso\.test\/api\/auth\/sso\/start\?connection=org-acme-saml&surface=workspace&test=[A-Za-z0-9_-]{43}$/,
      ),
    });
    // The single-use test nonce is bound to this connection.
    const nonce = new URL(res.body.startUrl as string).searchParams.get('test')!;
    const stored = await app.get<KeyValueStore>(KEY_VALUE_STORE).get(`sso_test:${nonce}`);
    expect(JSON.parse(stored!)).toEqual({ connectionId });
    expect(await idp.listProviders()).toContain('org-acme-saml');
    const list = await nikola.agent.get('/api/ops/sso-connections').query({ orgId: ORG });
    expect(list.status).toBe(200);
    expect(list.body.items.find((c: { id: string }) => c.id === connectionId)).toMatchObject({
      status: 'TESTING',
      domains: [{ id: domainId, domain: 'acme.example' }],
      // Read from the metadata the fake fetcher serves at METADATA_URL.
      certificateExpiresAt: SIGNING_CERT_NOT_AFTER.toISOString(),
    });
    expect(metadata.fetched).toContain(METADATA_URL);
  });

  it('activation is refused until a test sign-in has bound: 409 sso_connection_state', async () => {
    const res = await post(`/${connectionId}/activate`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('sso_connection_state');
  });

  it('activates after lastTestedAt is set: 200 ACTIVE', async () => {
    await app.get(SsoRepository).updateConnection(connectionId, { lastTestedAt: new Date() });
    const res = await post(`/${connectionId}/activate`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ACTIVE');
    expect(res.body.lastTestedAt).not.toBeNull();
  });

  it('suspends and reactivates through PATCH, auditing every status change', async () => {
    const suspended = await patch(`/${connectionId}`, { status: 'SUSPENDED' });
    expect(suspended.status).toBe(200);
    expect(suspended.body.status).toBe('SUSPENDED');
    expect(await idp.listProviders()).toContain('org-acme-saml');

    const active = await patch(`/${connectionId}`, { status: 'ACTIVE' });
    expect(active.status).toBe(200);
    expect(active.body.status).toBe('ACTIVE');

    const changed = await testDb.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.recordId, connectionId), eq(auditEvents.action, 'sso_connection.changed')));
    const transitions = changed.map((e) => e.details as { from: string; to: string });
    expect(transitions.sort((a, b) => `${a.from}>${a.to}`.localeCompare(`${b.from}>${b.to}`))).toEqual(
      [
        { from: 'ACTIVE', to: 'SUSPENDED' },
        { from: 'DRAFT', to: 'TESTING' },
        { from: 'SUSPENDED', to: 'ACTIVE' },
        { from: 'TESTING', to: 'ACTIVE' },
      ],
    );
  });

  it('refuses an invalid transition and a protocol change after TESTING', async () => {
    const reset = await patch(`/${connectionId}`, { status: 'DRAFT' });
    expect(reset.status).toBe(409);
    expect(reset.body.code).toBe('sso_connection_state');
    const protocol = await patch(`/${connectionId}`, { protocol: 'OIDC' });
    expect(protocol.status).toBe(422);
    expect(protocol.body.code).toBe('validation');
  });

  it('a provider change on the ACTIVE connection takes it back to TESTING; activation needs a new test sign-in (SSO-R-01)', async () => {
    const deactivations = async () =>
      testDb.db
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.recordId, connectionId), eq(auditEvents.action, 'sso_connection.deactivated')));
    const before = (await deactivations()).length;
    const res = await patch(`/${connectionId}`, { metadataUrl: 'https://idp.acme.example/metadata-v2' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'TESTING', lastTestedAt: null, metadataUrl: 'https://idp.acme.example/metadata-v2' });
    const changed = await testDb.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.recordId, connectionId), eq(auditEvents.action, 'sso_connection.changed')));
    expect(changed.map((e) => e.details)).toContainEqual({ from: 'ACTIVE', to: 'TESTING' });
    // Discovery stops routing to it, as after a suspension.
    const after = await deactivations();
    expect(after).toHaveLength(before + 1);
    for (const row of after) expect(row.details).toEqual({ from: 'ACTIVE' });
    const activate = await post(`/${connectionId}/activate`);
    expect(activate.status).toBe(409);
    expect(activate.body.code).toBe('sso_connection_state');

    // Back to ACTIVE through the normal path for the tests below.
    expect((await post(`/${connectionId}/test`)).status).toBe(200);
    await app.get(SsoRepository).updateConnection(connectionId, { lastTestedAt: new Date() });
    expect((await post(`/${connectionId}/activate`)).status).toBe(200);
  });

  it('a provider change on a SUSPENDED connection moves it to TESTING; reactivation needs a new test sign-in (SSO-R-01)', async () => {
    const auditOf = async (action: 'sso_connection.changed' | 'sso_connection.deactivated') =>
      testDb.db
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.recordId, connectionId), eq(auditEvents.action, action)));
    expect((await patch(`/${connectionId}`, { status: 'SUSPENDED' })).status).toBe(200);
    const deactivationsBefore = (await auditOf('sso_connection.deactivated')).length;

    const res = await patch(`/${connectionId}`, { metadataUrl: 'https://idp.acme.example/metadata-v3' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'TESTING',
      lastTestedAt: null,
      metadataUrl: 'https://idp.acme.example/metadata-v3',
      certificateExpiresAt: SIGNING_CERT_NOT_AFTER.toISOString(),
    });
    expect((await auditOf('sso_connection.changed')).map((e) => e.details)).toContainEqual({ from: 'SUSPENDED', to: 'TESTING' });
    // It was not routable while suspended: leaving SUSPENDED is no deactivation.
    expect(await auditOf('sso_connection.deactivated')).toHaveLength(deactivationsBefore);
    const reactivate = await patch(`/${connectionId}`, { status: 'ACTIVE' });
    expect(reactivate.status).toBe(409);
    expect(reactivate.body.code).toBe('sso_connection_state');
    expect((await post(`/${connectionId}/activate`)).status).toBe(409);

    // Back to ACTIVE through the normal path for the tests below.
    expect((await post(`/${connectionId}/test`)).status).toBe(200);
    await app.get(SsoRepository).updateConnection(connectionId, { lastTestedAt: new Date() });
    expect((await post(`/${connectionId}/activate`)).status).toBe(200);
  });

  it('refuses an http: metadata URL or issuer in the request body: the body schema answers 400 validation, nothing changes', async () => {
    const create = await post('', { orgId: ORG, slug: 'plainhttp', protocol: 'SAML', metadataUrl: 'http://idp.acme.example/metadata' });
    expect(create.status).toBe(400);
    expect(create.body.code).toBe('validation');
    expect(await app.get(SsoRepository).findConnectionByProviderName('org-plainhttp-saml')).toBeNull();

    const update = await patch(`/${connectionId}`, { metadataUrl: 'http://idp.acme.example/metadata-v4' });
    expect(update.status).toBe(400);
    expect(update.body.code).toBe('validation');
    const issuer = await patch(`/${connectionId}`, { oidcIssuer: 'http://login.acme.example' });
    expect(issuer.status).toBe(400);
    expect(issuer.body.code).toBe('validation');
    expect(await app.get(SsoRepository).findConnection(connectionId)).toMatchObject({
      status: 'ACTIVE',
      metadataUrl: 'https://idp.acme.example/metadata-v3',
      oidcIssuer: null,
    });
  });

  it('refuses a metadata URL or issuer whose host is not public: 422 validation with details.field (Review Focus 4)', async () => {
    const mixedUrl = `https://${MIXED_HOST}/metadata`;
    const create = await post('', { orgId: ORG, slug: 'mixed', protocol: 'SAML', metadataUrl: mixedUrl });
    expect(create.status).toBe(422);
    expect(create.body).toMatchObject({ code: 'validation', details: { field: 'metadataUrl', reason: 'private_address' } });
    expect(await app.get(SsoRepository).findConnectionByProviderName('org-mixed-saml')).toBeNull();

    const update = await patch(`/${connectionId}`, { metadataUrl: mixedUrl });
    expect(update.status).toBe(422);
    expect(update.body).toMatchObject({ code: 'validation', details: { field: 'metadataUrl', reason: 'private_address' } });
    expect(await app.get(SsoRepository).findConnection(connectionId)).toMatchObject({
      status: 'ACTIVE',
      metadataUrl: 'https://idp.acme.example/metadata-v3',
    });

    const oidc = await post('', {
      orgId: ORG,
      slug: 'internal',
      protocol: 'OIDC',
      oidcIssuer: 'https://login.internal.example',
      oidcClientId: 'client-internal',
    });
    expect(oidc.status).toBe(422);
    expect(oidc.body).toMatchObject({ code: 'validation', details: { field: 'oidcIssuer', reason: 'private_address' } });
    expect(metadata.fetched.some((url) => url.includes(MIXED_HOST))).toBe(false);
  });

  it('a provider name freed by a protocol switch stays reserved for its organization: another org gets 409 provider_name_taken', async () => {
    const otherOrg = 'org_sso_e2e_other';
    await testDb.db.insert(organizations).values({ id: otherOrg, name: 'Other SSO e2e Org', slug: 'other-sso-e2e' });

    const created = await post('', { orgId: ORG, slug: 'freed', protocol: 'SAML', metadataUrl: METADATA_URL });
    expect(created.status).toBe(201);
    const switched = await patch(`/${created.body.id as string}`, {
      protocol: 'OIDC',
      oidcIssuer: 'https://login.freed.example',
      oidcClientId: 'client-freed',
    });
    expect(switched.status).toBe(200);
    expect(switched.body.cognitoProviderName).toBe('org-freed-oidc');

    for (const protocol of ['SAML', 'OIDC'] as const) {
      const body =
        protocol === 'SAML'
          ? { orgId: otherOrg, slug: 'freed', protocol, metadataUrl: METADATA_URL }
          : { orgId: otherOrg, slug: 'freed', protocol, oidcIssuer: 'https://login.b.example', oidcClientId: 'b' };
      const taken = await post('', body);
      expect(taken.status).toBe(409);
      expect(taken.body.code).toBe('conflict');
      expect(taken.body.details).toMatchObject({ reason: 'provider_name_taken', field: 'slug' });
    }

    // The owning organization may take the freed sibling name itself.
    const own = await post('', { orgId: ORG, slug: 'freed', protocol: 'SAML', metadataUrl: METADATA_URL });
    expect(own.status).toBe(201);
    expect(own.body.cognitoProviderName).toBe('org-freed-saml');
  });

  it('a reset to DRAFT invalidates the test sign-in: reset -> re-test -> activate is 409 (SSO-R-01)', async () => {
    const created = await post('', { orgId: ORG, slug: 'reset', protocol: 'SAML', metadataUrl: METADATA_URL });
    expect(created.status).toBe(201);
    const id = created.body.id as string;
    const domain = await post(`/${id}/domains`, { domain: 'reset.example' });
    expect(domain.status).toBe(201);
    dns.setTxt(domain.body.txtRecordName as string, [domain.body.txtRecordValue as string]);
    expect((await post(`/${id}/domains/${domain.body.id as string}/verify`)).status).toBe(200);
    expect((await post(`/${id}/test`)).status).toBe(200);
    await app.get(SsoRepository).updateConnection(id, { lastTestedAt: new Date() });

    const reset = await patch(`/${id}`, { status: 'DRAFT' });
    expect(reset.status).toBe(200);
    expect(reset.body).toMatchObject({ status: 'DRAFT', lastTestedAt: null });
    expect(await idp.listProviders()).not.toContain('org-reset-saml');

    expect((await post(`/${id}/test`)).status).toBe(200);
    const activate = await post(`/${id}/activate`);
    expect(activate.status).toBe(409);
    expect(activate.body.code).toBe('sso_connection_state');
  });

  it('refuses a public email domain: 422 domain_blocklisted', async () => {
    const res = await post(`/${connectionId}/domains`, { domain: 'gmail.com' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('domain_blocklisted');
  });

  it('refuses a domain verified for another connection: 409 conflict (Review Focus 3)', async () => {
    const other = await post('', { orgId: ORG, slug: 'acme-two', protocol: 'SAML', metadataUrl: METADATA_URL });
    expect(other.status).toBe(201);
    const res = await post(`/${other.body.id as string}/domains`, { domain: 'acme.example' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('conflict');
  });

  it('refuses a provider name over 20 characters (422) and a taken one (409) (Review Focus 5)', async () => {
    const long = await post('', { orgId: ORG, slug: 'abcdefghijkl', protocol: 'SAML', metadataUrl: METADATA_URL });
    expect(long.status).toBe(422);
    expect(long.body.code).toBe('validation');
    const taken = await post('', { orgId: ORG, slug: 'acme', protocol: 'SAML', metadataUrl: METADATA_URL });
    expect(taken.status).toBe(409);
    expect(taken.body.code).toBe('conflict');
  });

  it('refuses idpInitiatedAllowed: true on create and on PATCH with 422 validation', async () => {
    const create = await post('', { orgId: ORG, slug: 'idpinit', protocol: 'SAML', idpInitiatedAllowed: true });
    expect(create.status).toBe(422);
    expect(create.body.code).toBe('validation');
    const update = await patch(`/${connectionId}`, { idpInitiatedAllowed: true });
    expect(update.status).toBe(422);
    expect(update.body.code).toBe('validation');
  });

  it('a write-only OIDC client secret never reaches a response or an audit event', async () => {
    const res = await post('', {
      orgId: ORG,
      slug: 'acme-oidc',
      protocol: 'OIDC',
      oidcIssuer: 'https://login.acme.example',
      oidcClientId: 'client-1',
      oidcClientSecret: 'e2e-oidc-secret-value',
    });
    expect(res.status).toBe(201);
    expect(JSON.stringify(res.body)).not.toContain('e2e-oidc-secret-value');
    const events = await testDb.db.select().from(auditEvents).where(like(auditEvents.action, 'sso_%'));
    expect(JSON.stringify(events)).not.toContain('e2e-oidc-secret-value');
  });

  it('oidcEmailVerifiedClaimRequired defaults to true, and PATCH true -> false -> true stores, answers and audits it', async () => {
    const created = await post('', {
      orgId: ORG,
      slug: 'claim',
      protocol: 'OIDC',
      oidcIssuer: 'https://login.claim.example',
      oidcClientId: 'client-claim',
    });
    expect(created.status).toBe(201);
    expect(created.body.oidcEmailVerifiedClaimRequired).toBe(true);
    const id = created.body.id as string;
    const stored = async () => (await app.get(SsoRepository).findConnection(id))!.oidcEmailVerifiedClaimRequired;

    const off = await patch(`/${id}`, { oidcEmailVerifiedClaimRequired: false });
    expect(off.status).toBe(200);
    expect(off.body).toMatchObject({ status: 'DRAFT', oidcEmailVerifiedClaimRequired: false });
    expect(await stored()).toBe(false);
    const listed = await nikola.agent.get('/api/ops/sso-connections').query({ orgId: ORG });
    expect(listed.body.items.find((c: { id: string }) => c.id === id).oidcEmailVerifiedClaimRequired).toBe(false);

    const on = await patch(`/${id}`, { oidcEmailVerifiedClaimRequired: true });
    expect(on.status).toBe(200);
    expect(on.body.oidcEmailVerifiedClaimRequired).toBe(true);
    expect(await stored()).toBe(true);

    const updates = await testDb.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.recordId, id), eq(auditEvents.action, 'sso_connection.updated')));
    expect(updates.map((e) => e.details)).toEqual(
      expect.arrayContaining([
        { fields: ['oidcEmailVerifiedClaimRequired'], oidcEmailVerifiedClaimRequired: false },
        { fields: ['oidcEmailVerifiedClaimRequired'], oidcEmailVerifiedClaimRequired: true },
      ]),
    );
    expect(updates).toHaveLength(2);
  });

  it('a client secret PATCHed onto a DRAFT OIDC connection stages the provider: 200, still DRAFT', async () => {
    const created = await post('', {
      orgId: ORG,
      slug: 'stage',
      protocol: 'OIDC',
      oidcIssuer: 'https://login.stage.example',
      oidcClientId: 'client-stage',
    });
    expect(created.status).toBe(201);
    expect(await idp.listProviders()).not.toContain('org-stage-oidc');

    const res = await patch(`/${created.body.id as string}`, { oidcClientSecret: 'e2e-staged-secret' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'DRAFT', cognitoProviderName: 'org-stage-oidc' });
    expect(JSON.stringify(res.body)).not.toContain('e2e-staged-secret');
    expect(await idp.listProviders()).toContain('org-stage-oidc');
    expect(await idp.describeProvider('org-stage-oidc')).toMatchObject({ name: 'org-stage-oidc', protocol: 'OIDC' });

    // Another field on the staged DRAFT keeps the registration.
    const switched = await patch(`/${created.body.id as string}`, { oidcEmailVerifiedClaimRequired: false });
    expect(switched.status).toBe(200);
    expect(await idp.listProviders()).toContain('org-stage-oidc');
  });

  it('an unknown connection is 404', async () => {
    const res = await post('/sso_missing/test');
    expect(res.status).toBe(404);
  });

  it('a non-staff member is refused: 403', async () => {
    const ivana = await signInEmailOtp(IVANA_EMAIL);
    const list = await ivana.agent.get('/api/ops/sso-connections');
    expect(list.status).toBe(403);
    const create = await ivana.agent
      .post('/api/ops/sso-connections')
      .set('X-CSRF-Token', ivana.csrf)
      .send({ orgId: ORG, slug: 'ivana', protocol: 'SAML', metadataUrl: METADATA_URL });
    expect(create.status).toBe(403);
  });
});
