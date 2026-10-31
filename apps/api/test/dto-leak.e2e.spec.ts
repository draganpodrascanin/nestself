/**
 * TST-R-05: DTO-leak spec -- library surfaces forbidden key scan.
 *
 * Walks every JSON response from the library endpoints and asserts that
 * no internal column name or implementation detail leaks into the public
 * DTO. Uses the same test database as the library e2e spec.
 *
 * Requires TEST_DATABASE_URL (PostgreSQL). Skipped otherwise.
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
import { externalIdentities, savedItems } from '../src/db/schema/index.js';
import { resetTestDatabase, type TestDatabase } from './db/test-database.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const shouldRun = !!TEST_DB_URL;

/**
 * Keys that must never appear anywhere in a library response tree.
 * These are internal column names, editor-only metadata, and cross-tenant
 * references that violate the non-disclosure rules (ACC-R-22, LIB-R-11).
 */
const FORBIDDEN_KEYS = new Set([
  'revisionId',
  'reviewComments',
  'audiences',
  'membershipId',
  'draftId',
  'privateSourceSubmissionId',
  'unpublishedTranslations',
  'authorUserId',
  'approvedByUserId',
  'publicationId',
  'orgId',
  'userId',
  'approvalHash',
  'lastEditorUserId',
]);

/** Walk all keys in a nested object and collect any forbidden ones found. */
function findForbiddenKeys(obj: unknown, path = ''): string[] {
  if (!obj || typeof obj !== 'object') return [];
  const found: string[] = [];
  for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.has(key)) found.push(`${path}.${key}`);
    if (val && typeof val === 'object') {
      found.push(...findForbiddenKeys(val, `${path}.${key}`));
    }
  }
  return found;
}

const JOVAN = 'user_jovan';

describe.skipIf(!shouldRun)('DTO leak scan (TST-R-05)', () => {
  let app: INestApplication;
  let idp: FakeIdentityProvider;
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await resetTestDatabase(TEST_DB_URL!, 'dtoleak');
    await seed(testDb.db);

    process.env.DATABASE_URL = testDb.url;
    process.env.AUTH_MODE = 'stub';
    process.env.JWT_SECRET = randomBytes(32).toString('hex');
    process.env.SESSION_COOKIE_INSECURE_DEV = 'true';
    process.env.NODE_ENV = 'test';
    process.env.MEDIA_STORAGE = 'local';
    process.env.CONTENT_LINK_HOST_ALLOWLIST = '';
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

    idp.seedUsers([{ email: `${JOVAN}@example.com` }]);
    const idpUser = await idp.findUserByEmail(`${JOVAN}@example.com`);
    if (!idpUser) throw new Error('FakeIDP user not found');
    await testDb.db.insert(externalIdentities).values({
      userId: JOVAN,
      provider: 'cognito',
      subject: idpUser.sub,
      cognitoUsername: idpUser.username,
      email: `${JOVAN}@example.com`,
      emailVerified: true,
    }).onConflictDoNothing();
  }, 180_000);

  afterAll(async () => {
    if (testDb?.db) {
      await testDb.db.delete(savedItems);
    }
    await app?.close();
    await testDb?.close();
  });

  async function signIn() {
    const email = `${JOVAN}@example.com`;
    const agent = request.agent(app.getHttpServer());
    const start = await agent.post('/api/auth/email-otp/start').send({ email });
    expect(start.status).toBe(200);
    const code = idp.sentCodes.filter((c) => c.email === email).pop()!.code;
    const verify = await agent
      .post('/api/auth/email-otp/verify')
      .send({ challengeToken: start.body.challengeToken, code });
    expect(verify.status).toBe(200);
    const cookies = verify.headers['set-cookie'] as string[] | undefined;
    const csrf = cookies
      ?.find((c: string) => c.startsWith('nestself_csrf='))
      ?.match(/nestself_csrf=([^;]+)/)?.[1];
    return { agent, csrf: csrf! };
  }

  it('content list has no forbidden keys in any item', async () => {
    const session = await signIn();
    const res = await session.agent
      .get('/api/library/content')
      .set('accept-language', 'sr-Latn');
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);

    const forbidden = findForbiddenKeys(res.body);
    expect(forbidden).toEqual([]);
  });

  it('content detail has no forbidden keys', async () => {
    const session = await signIn();
    // Get the first item from the list to use for detail
    const list = await session.agent
      .get('/api/library/content')
      .set('accept-language', 'sr-Latn');
    expect(list.status).toBe(200);
    const firstId = list.body.items[0]?.resourceId;
    expect(firstId).toBeTruthy();

    const res = await session.agent
      .get(`/api/library/content/${firstId}`)
      .set('accept-language', 'sr-Latn');
    expect(res.status).toBe(200);

    const forbidden = findForbiddenKeys(res.body);
    expect(forbidden).toEqual([]);
  });

  it('content detail body document has no forbidden keys', async () => {
    const session = await signIn();
    const list = await session.agent
      .get('/api/library/content')
      .set('accept-language', 'sr-Latn');
    const firstId = list.body.items[0]?.resourceId;

    const res = await session.agent
      .get(`/api/library/content/${firstId}`)
      .set('accept-language', 'sr-Latn');
    expect(res.status).toBe(200);
    expect(res.body.body).toBeTruthy();

    const bodyForbidden = findForbiddenKeys(res.body.body);
    expect(bodyForbidden).toEqual([]);
  });

  it('saved items list has no forbidden keys', async () => {
    const session = await signIn();

    // Save something first
    const list = await session.agent
      .get('/api/library/content')
      .set('accept-language', 'sr-Latn');
    const firstId = list.body.items[0]?.resourceId;
    await session.agent
      .put(`/api/me/saved/${firstId}`)
      .set('x-csrf-token', session.csrf)
      .set('accept-language', 'sr-Latn');

    const saved = await session.agent
      .get('/api/me/saved')
      .set('accept-language', 'sr-Latn');
    expect(saved.status).toBe(200);
    expect(saved.body.items.length).toBeGreaterThan(0);

    const forbidden = findForbiddenKeys(saved.body);
    expect(forbidden).toEqual([]);
  });

  it('no email-like strings leak in any library endpoint', async () => {
    const session = await signIn();

    // List
    const list = await session.agent
      .get('/api/library/content')
      .set('accept-language', 'sr-Latn');
    expect(JSON.stringify(list.body)).not.toMatch(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);

    // Detail
    if (list.body.items.length > 0) {
      const detail = await session.agent
        .get(`/api/library/content/${list.body.items[0].resourceId}`)
        .set('accept-language', 'sr-Latn');
      expect(JSON.stringify(detail.body)).not.toMatch(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    }
  });

  it('sr-Cyrl endpoints have no forbidden keys (same scan, different locale)', async () => {
    const session = await signIn();
    const list = await session.agent
      .get('/api/library/content')
      .set('accept-language', 'sr-Cyrl');
    expect(list.status).toBe(200);
    expect(findForbiddenKeys(list.body)).toEqual([]);

    if (list.body.items.length > 0) {
      const detail = await session.agent
        .get(`/api/library/content/${list.body.items[0].resourceId}`)
        .set('accept-language', 'sr-Cyrl');
      expect(findForbiddenKeys(detail.body)).toEqual([]);
    }
  });
});
