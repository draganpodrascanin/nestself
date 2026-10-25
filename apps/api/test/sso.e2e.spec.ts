/**
 * SSO connection management e2e tests (auth phase 3, Task 3): the staff
 * lifecycle DRAFT -> TESTING -> ACTIVE -> SUSPENDED -> ACTIVE over HTTP,
 * DNS domain verification with the fake resolver, provider registration in
 * the fake identity provider, Review Focus 3 (domain on another connection)
 * and 5 (provider name length and collision).
 *
 * Requires TEST_DATABASE_URL (PostgreSQL). Skipped otherwise.
 */
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { and, eq, like } from 'drizzle-orm';
import { PERMISSION_TEMPLATES } from '@nestself/contracts';
import { IdentityProviderService } from '../src/identity/identity-provider.service.js';
import type { FakeIdentityProvider } from '../src/identity/fake-identity-provider.js';
import { computeTotp } from '../src/identity/totp.js';
import { seed } from '../src/db/seed/seed-lib.js';
import { auditEvents, externalIdentities, grants } from '../src/db/schema/index.js';
import { SsoRepository } from '../src/db/repositories/sso.repository.js';
import { DNS_TXT_RESOLVER, type FakeDnsTxtResolver } from '../src/sso/dns-txt-resolver.js';
import { resetTestDatabase, type TestDatabase } from './db/test-database.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const shouldRun = !!TEST_DB_URL;

const ORG = 'org_sample';
const NIKOLA_EMAIL = 'user_nikola@example.com';
const IVANA_EMAIL = 'user_ivana@example.com';
const TEMP_PASSWORD = 'TempPassword1!';
const METADATA_URL = 'https://idp.acme.example/metadata';

describe.skipIf(!shouldRun)('SSO connection management (e2e)', () => {
  let app: INestApplication;
  let idp: FakeIdentityProvider;
  let dns: FakeDnsTxtResolver;
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
    delete process.env.API_PUBLIC_URL;
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

  it('test registers the provider in the identity provider and moves to TESTING', async () => {
    const res = await post(`/${connectionId}/test`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      startUrl: 'http://api.sso.test/api/auth/sso/start?connection=org-acme-saml&surface=workspace&test=1',
    });
    expect(await idp.listProviders()).toContain('org-acme-saml');
    const list = await nikola.agent.get('/api/ops/sso-connections').query({ orgId: ORG });
    expect(list.status).toBe(200);
    expect(list.body.items.find((c: { id: string }) => c.id === connectionId)).toMatchObject({
      status: 'TESTING',
      domains: [{ id: domainId, domain: 'acme.example' }],
    });
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
