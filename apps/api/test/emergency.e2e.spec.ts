/**
 * Emergency access e2e tests (T-2.5, API-R-26, CONF-R-08..10): a platform
 * owner requests access to one case, a different platform owner approves,
 * the requester reads one conversation and the read is audited; the
 * requester cannot approve their own request; an expired record is refused
 * by the engine before the sweeper runs, and the sweeper then revokes it.
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
import { PERMISSION_TEMPLATES } from '@nestself/contracts';
import { SAMPLE_CASE, SAMPLE_DEV_PASSWORD, SAMPLE_EXTERNAL_IDENTITIES } from '@nestself/sample-data';
import { IdentityProviderService } from '../src/identity/identity-provider.service.js';
import type { FakeIdentityProvider } from '../src/identity/fake-identity-provider.js';
import { computeTotp } from '../src/identity/totp.js';
import { MaintenanceJobsService } from '../src/jobs/maintenance-jobs.service.js';
import { seed } from '../src/db/seed/seed-lib.js';
import { auditEvents, emergencyAccess, externalIdentities, grants, users } from '../src/db/schema/index.js';
import { resetTestDatabase, type TestDatabase } from './db/test-database.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const shouldRun = !!TEST_DB_URL;

const BASE = '/api/ops/emergency-access';
/** Fixed TOTP secret for the staff users of this suite (base32). */
const TOTP_SECRET = 'JBSWY3DPEHPK3PXP';
const APPROVER_ID = 'user_admin_test';
const APPROVER_EMAIL = 'user_admin_test@example.com';
const PURPOSE = 'Safeguarding concern raised by the assigned expert (test fixture)';

describe.skipIf(!shouldRun)('Emergency access (e2e)', () => {
  let app: INestApplication;
  let idp: FakeIdentityProvider;
  let testDb: TestDatabase;
  const jwtSecret = randomBytes(32).toString('hex');

  beforeAll(async () => {
    testDb = await resetTestDatabase(TEST_DB_URL!, 'emergency');
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

    // Nikola is a seeded staff user; the second approver exists only in
    // this suite (user row, external identity, fake pool user).
    await testDb.db.insert(users).values({ id: APPROVER_ID, email: APPROVER_EMAIL, displayName: 'Approver (test fixture)' });
    idp = app.get(IdentityProviderService) as FakeIdentityProvider;
    const nikola = SAMPLE_EXTERNAL_IDENTITIES.find((i) => i.userId === 'user_nikola')!;
    const staff = { password: SAMPLE_DEV_PASSWORD, totpSecret: TOTP_SECRET, totpEnrolled: true };
    idp.seedUsers([
      { email: nikola.email, sub: nikola.subject, username: nikola.cognitoUsername, ...staff },
      { email: APPROVER_EMAIL, sub: 'sub_admin_test', username: 'admin_test', ...staff },
    ]);
    await testDb.db.insert(externalIdentities).values({
      userId: APPROVER_ID,
      provider: 'cognito',
      subject: 'sub_admin_test',
      cognitoUsername: 'admin_test',
      email: APPROVER_EMAIL,
      emailVerified: true,
    });

    const platformOwner = PERMISSION_TEMPLATES.find((t) => t.key === 'platform_owner')!;
    const grant = {
      templateKey: platformOwner.key,
      actions: [...platformOwner.actions],
      scopeType: platformOwner.scopeType,
      scopeOrgId: null,
      scopeOrgUnitId: null,
      includeDescendants: false,
      grantedAt: new Date('2026-01-01'),
      validFrom: new Date('2026-01-01'),
      grantedByUserId: 'user_nikola',
    };
    await testDb.db.insert(grants).values([
      { ...grant, id: 'grant_test_nikola_platform_owner', subjectUserId: 'user_nikola' },
      { ...grant, id: 'grant_test_admin_platform_owner', subjectUserId: APPROVER_ID },
    ]);
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

  /** Password + TOTP sign-in, then the operations context. */
  async function signInStaff(email: string) {
    const agent = request.agent(app.getHttpServer());
    const pw = await agent.post('/api/auth/password').send({ email, password: SAMPLE_DEV_PASSWORD });
    expect(pw.status).toBe(200);
    expect(pw.body).toHaveProperty('step', 'totp');
    const totp = await agent
      .post('/api/auth/challenge')
      .send({ challengeToken: pw.body.challengeToken, response: computeTotp(TOTP_SECRET) });
    expect(totp.status).toBe(200);
    const csrf = extractCsrf(totp);
    const ctx = await agent.post('/api/auth/context').set('X-CSRF-Token', csrf).send({ context: { kind: 'operations' } });
    expect(ctx.status).toBe(200);
    return { agent, csrf };
  }

  let requester: Awaited<ReturnType<typeof signInStaff>>;
  let approver: Awaited<ReturnType<typeof signInStaff>>;
  let accessId: string;
  const record = (id = accessId) => `${BASE}/${id}/records/conversation/${SAMPLE_CASE.conversation.id}`;

  it('nikola requests access to one case: 201, pending with a provisional window, audited', async () => {
    requester = await signInStaff('user_nikola@example.com');
    approver = await signInStaff(APPROVER_EMAIL);

    const res = await requester.agent
      .post(BASE)
      .set('X-CSRF-Token', requester.csrf)
      .send({ scopeKind: 'CASE', scopeId: SAMPLE_CASE.id, purpose: PURPOSE, durationMinutes: 30 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      userId: 'user_nikola',
      approvedByUserId: null,
      approvedAt: null,
      scopeKind: 'CASE',
      scopeId: SAMPLE_CASE.id,
      durationMinutes: 30,
      revokedAt: null,
    });
    expect(Date.parse(res.body.expiresAt) - Date.parse(res.body.grantedAt)).toBe(30 * 60_000);
    accessId = res.body.id as string;

    const [audited] = await testDb.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.action, 'emergency_access.requested'), eq(auditEvents.recordId, accessId)));
    expect(audited!.details).toMatchObject({ purpose: PURPOSE, scopeKind: 'CASE', scopeId: SAMPLE_CASE.id });
  });

  it('a pending request grants nothing', async () => {
    const res = await requester.agent.get(record());
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('forbidden');
    expect(res.body).not.toHaveProperty('content');
  });

  it('nikola cannot approve his own request: 403 self_approval_denied', async () => {
    const res = await requester.agent.post(`${BASE}/${accessId}/approve`).set('X-CSRF-Token', requester.csrf).send({});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('self_approval_denied');
    const [row] = await testDb.db.select().from(emergencyAccess).where(eq(emergencyAccess.id, accessId));
    expect(row!.approvedByUserId).toBeNull();
  });

  it('a different platform owner approves: the window restarts at approval', async () => {
    const res = await approver.agent.post(`${BASE}/${accessId}/approve`).set('X-CSRF-Token', approver.csrf).send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ approvedByUserId: APPROVER_ID });
    expect(res.body.approvedAt).toBe(res.body.grantedAt);
    expect(Date.parse(res.body.expiresAt) - Date.parse(res.body.approvedAt)).toBe(30 * 60_000);

    const [audited] = await testDb.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.action, 'emergency_access.approved'), eq(auditEvents.recordId, accessId)));
    expect(audited!.actorUserId).toBe(APPROVER_ID);

    const again = await approver.agent.post(`${BASE}/${accessId}/approve`).set('X-CSRF-Token', approver.csrf).send({});
    expect(again.status).toBe(409);
  });

  it('nikola reads the conversation once; the read is audited without content', async () => {
    const res = await requester.agent.get(record());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      emergencyAccessId: accessId,
      recordType: 'conversation',
      recordId: SAMPLE_CASE.conversation.id,
      content: { id: SAMPLE_CASE.conversation.id, caseId: SAMPLE_CASE.id },
    });
    expect(res.body.content.messages).toHaveLength(SAMPLE_CASE.conversation.messages.length);

    const used = await testDb.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.action, 'emergency_access.used'), eq(auditEvents.recordId, accessId)));
    expect(used).toHaveLength(1);
    expect(used[0]!.details).toEqual({
      emergencyAccessId: accessId,
      recordType: 'conversation',
      recordId: SAMPLE_CASE.conversation.id,
    });
    const serialized = JSON.stringify(await testDb.db.select({ details: auditEvents.details }).from(auditEvents));
    for (const m of SAMPLE_CASE.conversation.messages) expect(serialized).not.toContain(m.body);

    // Single-record reads only: an unknown record type is rejected.
    const bad = await requester.agent.get(`${BASE}/${accessId}/records/note/${SAMPLE_CASE.conversation.id}`);
    expect(bad.status).toBe(400);
    // The approver holds no emergency access of their own.
    const other = await approver.agent.get(record());
    expect(other.status).toBe(404);
  });

  it('an expired record is refused before the sweeper runs, then the sweeper revokes it', async () => {
    await testDb.db
      .update(emergencyAccess)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(emergencyAccess.id, accessId));

    // The engine refuses (403 forbidden, not the service's emergency_not_active):
    // expiry is evaluated from the row on every request (AUTHZ-R-46).
    const res = await requester.agent.get(record());
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('forbidden');
    expect(res.body).not.toHaveProperty('content');
    const [before] = await testDb.db.select().from(emergencyAccess).where(eq(emergencyAccess.id, accessId));
    expect(before!.revokedAt).toBeNull();

    const report = await app.get(MaintenanceJobsService).run('emergency.sweep-expired');
    expect(report).toEqual({ job: 'emergency.sweep-expired', expired: [accessId] });

    const [after] = await testDb.db.select().from(emergencyAccess).where(eq(emergencyAccess.id, accessId));
    expect(after!.revokedAt).not.toBeNull();
    expect(after!.revokedByUserId).toBeNull();
    const [expired] = await testDb.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.action, 'emergency_access.expired'), eq(auditEvents.recordId, accessId)));
    expect(expired!.actorKind).toBe('JOB');

    const list = await approver.agent.get(BASE);
    expect(list.status).toBe(200);
    const listed = (list.body.items as Array<{ id: string; revokedAt: string | null }>).find((i) => i.id === accessId);
    expect(listed?.revokedAt).not.toBeNull();
  });

  it('a pending request is denied (deleted) and an active one revoked, each audited', async () => {
    const body = { scopeKind: 'USER_RECORDS', scopeId: 'user_jovan', purpose: PURPOSE, durationMinutes: 15 };
    const denied = await requester.agent.post(BASE).set('X-CSRF-Token', requester.csrf).send(body);
    expect(denied.status).toBe(201);
    const deny = await approver.agent.post(`${BASE}/${denied.body.id}/deny`).set('X-CSRF-Token', approver.csrf).send({});
    expect(deny.status).toBe(204);
    expect(await testDb.db.select().from(emergencyAccess).where(eq(emergencyAccess.id, denied.body.id))).toEqual([]);

    const revoked = await requester.agent.post(BASE).set('X-CSRF-Token', requester.csrf).send(body);
    await approver.agent.post(`${BASE}/${revoked.body.id}/approve`).set('X-CSRF-Token', approver.csrf).send({});
    const read = await requester.agent.get(`${BASE}/${revoked.body.id}/records/conversation/${SAMPLE_CASE.conversation.id}`);
    expect(read.status).toBe(200);
    const revoke = await approver.agent.post(`${BASE}/${revoked.body.id}/revoke`).set('X-CSRF-Token', approver.csrf).send({});
    expect(revoke.status).toBe(200);
    expect(revoke.body.revokedAt).not.toBeNull();
    const after = await requester.agent.get(`${BASE}/${revoked.body.id}/records/conversation/${SAMPLE_CASE.conversation.id}`);
    expect(after.status).toBe(403);

    const actions = (
      await testDb.db
        .select({ action: auditEvents.action, recordId: auditEvents.recordId })
        .from(auditEvents)
    ).filter((e) => e.recordId === denied.body.id || e.recordId === revoked.body.id);
    expect(actions.map((a) => a.action)).toEqual(
      expect.arrayContaining(['emergency_access.denied', 'emergency_access.revoked']),
    );
  });
});
