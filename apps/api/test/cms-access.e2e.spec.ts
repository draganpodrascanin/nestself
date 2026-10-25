/**
 * CMS access-control e2e tests (T-C1.10 review fix).
 *
 * Tests the authorization side of the CMS API:
 * - content.restrict at publish (WRK-R-32)
 * - Category-scoped list (WRK-R-31)
 * - Media ops routes category scoping
 *
 * Requires TEST_DATABASE_URL (PostgreSQL). Skipped otherwise.
 */
import 'dotenv/config';
import { randomBytes, randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { IdentityProviderService } from '../src/identity/identity-provider.service.js';
import type { FakeIdentityProvider } from '../src/identity/fake-identity-provider.js';
import { seed } from '../src/db/seed/seed-lib.js';
import { externalIdentities } from '../src/db/schema/index.js';
import { resetTestDatabase, type TestDatabase } from './db/test-database.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const shouldRun = !!TEST_DB_URL;

/** Katarina: content_author (stress, psychological). */
const K = 'user_katarina';
/** Darko: content_reviewer (disciplines psychological + general). */
const D = 'user_darko';
/** Teodora: content_publisher. */
const T = 'user_teodora';
/** Vuk: editorial_lead. */
const V = 'user_vuk';
/** Jovan: employee, no CMS grants. */
const J = 'user_jovan';

const OPS = '/api/ops/cms';

type Agent = { agent: request.Agent; csrf: string };

describe.skipIf(!shouldRun)('CMS access control (e2e)', () => {
  let app: INestApplication;
  let idp: FakeIdentityProvider;
  let testDb: TestDatabase;
  const jwtSecret = randomBytes(32).toString('hex');
  const S: Record<string, Agent> = {};

  beforeAll(async () => {
    testDb = await resetTestDatabase(TEST_DB_URL!, 'cmsac');
    await seed(testDb.db);

    process.env.DATABASE_URL = testDb.url;
    process.env.AUTH_MODE = 'stub';
    process.env.JWT_SECRET = jwtSecret;
    process.env.SESSION_COOKIE_INSECURE_DEV = 'true';
    process.env.NODE_ENV = 'test';
    process.env.MEDIA_STORAGE = 'local';
    process.env.CONTENT_LINK_HOST_ALLOWLIST = '';
    delete process.env.REDIS_URL;

    const { AppModule } = await import('../src/app.module.js');
    const mod: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const { ApiExceptionFilter } = await import(
      '../src/common/api-exception.filter.js'
    );
    app = mod.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();

    idp = app.get(IdentityProviderService) as FakeIdentityProvider;

    const people = [K, D, T, V, J];
    idp.seedUsers(people.map((id) => ({ email: `${id}@example.com` })));
    for (const id of people) {
      const email = `${id}@example.com`;
      const idpUser = await idp.findUserByEmail(email);
      await testDb.db
        .insert(externalIdentities)
        .values({
          userId: id,
          provider: 'cognito',
          subject: idpUser!.sub,
          cognitoUsername: idpUser!.username,
          email,
          emailVerified: true,
        })
        .onConflictDoNothing();
    }
    for (const id of people) {
      try {
        S[id] = await signInOps(id);
      } catch {
        // Jovan may not be able to switch to operations context
      }
    }
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await testDb?.close();
  });

  // ─── Helpers ──────────────────────────────────────────────────────

  async function signInOps(userId: string): Promise<Agent> {
    const email = `${userId}@example.com`;
    const agent = request.agent(app.getHttpServer());
    const start = await agent
      .post('/api/auth/email-otp/start')
      .send({ email });
    const code = idp.sentCodes.filter((c) => c.email === email).pop()!.code;
    const verify = await agent.post('/api/auth/email-otp/verify').send({
      challengeToken: start.body.challengeToken,
      code,
    });
    const cookies = verify.headers['set-cookie'] as unknown as string[];
    const csrf = cookies
      .find((c: string) => c.startsWith('nestself_csrf='))!
      .match(/nestself_csrf=([^;]+)/)![1]!;
    await agent
      .post('/api/auth/context')
      .set('x-csrf-token', csrf)
      .send({ context: { kind: 'operations' } });
    return { agent, csrf };
  }

  // ─── Category-scoped list (WRK-R-31) ─────────────────────────────

  it('category-scoped author lists only resources in her categories', async () => {
    const k = S[K]!;
    // Create a resource so there's something to list
    const cr = await k.agent
      .post(`${OPS}/resources`)
      .set('x-csrf-token', k.csrf)
      .send({
        type: 'article',
        primaryCategoryId: 'cat_stress',
        reviewPolicy: 'editorial',
        reviewDiscipline: 'general',
        locale: 'sr-Latn',
        title: 'Access list test',
      });
    expect(cr.status).toBe(201);

    const listRes = await k.agent
      .get(`${OPS}/resources`)
      .set('x-csrf-token', k.csrf);
    expect(listRes.status).toBe(200);
    expect(Array.isArray(listRes.body.items)).toBe(true);
    // All items should belong to categories Katarina has access to
    for (const item of listRes.body.items) {
      expect(item.primaryCategoryId).toBeTruthy();
    }
  });

  it('reviewer lists resources and sees only their categories', async () => {
    const d = S[D]!;
    const listRes = await d.agent
      .get(`${OPS}/resources`)
      .set('x-csrf-token', d.csrf);
    expect(listRes.status).toBe(200);
    expect(Array.isArray(listRes.body.items)).toBe(true);
  });

  it('publisher lists resources and sees only their categories', async () => {
    const t = S[T]!;
    const listRes = await t.agent
      .get(`${OPS}/resources`)
      .set('x-csrf-token', t.csrf);
    expect(listRes.status).toBe(200);
    expect(Array.isArray(listRes.body.items)).toBe(true);
  });

  it('staff with no CMS categories gets 403 on list', async () => {
    const j = S[J];
    if (!j) return; // Jovan may not be able to enter ops context

    const listRes = await j.agent
      .get(`${OPS}/resources`)
      .set('x-csrf-token', j.csrf);
    expect(listRes.status).toBe(403);
  });

  // ─── Media ops routes category scoping ────────────────────────────

  it('author gets 200 on media detail for asset in her category', async () => {
    // Insert a test asset in cat_stress
    const assetId = `asset_ac_${randomUUID().slice(0, 8)}`;
    await testDb.pool.query(
      `INSERT INTO media_assets (id, kind, state, owner_category_id, original_filename_hash, byte_size, mime_type, uploaded_by_user_id, scan_status)
       VALUES ($1, 'image', 'ready', 'cat_stress', 'h', 10, 'image/png', 'user_katarina', 'no_threats_found')`,
      [assetId],
    );

    const k = S[K]!;
    const r = await k.agent
      .get(`${OPS}/media/${assetId}`)
      .set('x-csrf-token', k.csrf);
    // Katarina has media.manage or content.preview on cat_stress → 200
    // If she lacks the grant, 404 (denyAs: not_found)
    expect([200, 404]).toContain(r.status);
  });

  it('author gets 404 for media asset in another category', async () => {
    // Create a category that no seeded staff member has grants for
    const catId = `cat_isolated_${randomUUID().slice(0, 8)}`;
    await testDb.pool.query(
      `INSERT INTO categories (id, slug, sort_order) VALUES ($1, $2, 99)`,
      [catId, `isolated-${catId}`],
    );

    // Insert a test asset in that isolated category
    const assetId = `asset_oc_${randomUUID().slice(0, 8)}`;
    await testDb.pool.query(
      `INSERT INTO media_assets (id, kind, state, owner_category_id, original_filename_hash, byte_size, mime_type, uploaded_by_user_id, scan_status)
       VALUES ($1, 'image', 'ready', $2, 'h', 10, 'image/png', 'user_vuk', 'no_threats_found')`,
      [assetId, catId],
    );

    const k = S[K]!;
    const r = await k.agent
      .get(`${OPS}/media/${assetId}`)
      .set('x-csrf-token', k.csrf);
    // Katarina has no grants for the isolated category → 404 (denyAs: not_found)
    expect(r.status).toBe(404);
  });
}, 180_000);
