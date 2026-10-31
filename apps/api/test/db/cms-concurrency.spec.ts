/**
 * CMS concurrency e2e tests (T-C1.10 review fix).
 *
 * Database-level concurrency tests from probes P13, P14, P17:
 * - P13: concurrent publish of the same resource → exactly one 201, the other 409
 * - P14: correction publishes with opposite locale order → no deadlock
 * - P17: concurrent POST new working revision → exactly one 201, rest 409
 *
 * Requires TEST_DATABASE_URL (PostgreSQL). Skipped otherwise.
 */
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { IdentityProviderService } from '../../src/identity/identity-provider.service.js';
import type { FakeIdentityProvider } from '../../src/identity/fake-identity-provider.js';
import { seed } from '../../src/db/seed/seed-lib.js';
import { externalIdentities } from '../../src/db/schema/index.js';
import { resetTestDatabase, type TestDatabase } from './test-database.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const shouldRun = !!TEST_DB_URL;

const K = 'user_katarina';
const D = 'user_darko';
const T = 'user_teodora';
const V = 'user_vuk';

const OPS = '/api/ops/cms';

type Agent = { agent: request.Agent; csrf: string };

describe.skipIf(!shouldRun)('CMS concurrency (e2e)', () => {
  let app: INestApplication;
  let idp: FakeIdentityProvider;
  let testDb: TestDatabase;
  const jwtSecret = randomBytes(32).toString('hex');
  const S: Record<string, Agent> = {};

  beforeAll(async () => {
    testDb = await resetTestDatabase(TEST_DB_URL!, 'cmscc');
    await seed(testDb.db);

    process.env.DATABASE_URL = testDb.url;
    process.env.AUTH_MODE = 'stub';
    process.env.JWT_SECRET = jwtSecret;
    process.env.SESSION_COOKIE_INSECURE_DEV = 'true';
    process.env.NODE_ENV = 'test';
    process.env.MEDIA_STORAGE = 'local';
    process.env.CONTENT_LINK_HOST_ALLOWLIST = '';
    delete process.env.REDIS_URL;

    const { AppModule } = await import('../../src/app.module.js');
    const mod: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const { ApiExceptionFilter } = await import(
      '../../src/common/api-exception.filter.js'
    );
    app = mod.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();

    idp = app.get(IdentityProviderService) as FakeIdentityProvider;

    const people = [K, D, T, V];
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
    for (const id of people) S[id] = await signInOps(id);
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

  const doc = (text: string) => ({
    type: 'doc',
    schemaVersion: 1,
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });

  async function create(
    locale: 'sr-Latn' | 'hu' | 'en' = 'sr-Latn',
    reviewDiscipline = 'psychological',
  ) {
    const k = S[K]!;
    const r = await k.agent
      .post(`${OPS}/resources`)
      .set('x-csrf-token', k.csrf)
      .send({
        type: 'article',
        primaryCategoryId: 'cat_stress',
        reviewPolicy: 'professional',
        reviewDiscipline,
        locale,
        title: 'Concurrency test',
      });
    expect(r.status).toBe(201);
    const v = r.body.variants[0];
    return {
      resourceId: r.body.id as string,
      variantId: v.id as string,
      revisionId: v.revisions[0].id as string,
    };
  }

  async function save(
    variantId: string,
    revisionId: string,
    lock: number,
    payload: Record<string, unknown>,
  ) {
    const k = S[K]!;
    return k.agent
      .put(`${OPS}/variants/${variantId}/revisions/${revisionId}`)
      .set('x-csrf-token', k.csrf)
      .set('if-match', `"${lock}"`)
      .send(payload);
  }

  async function submit(revisionId: string) {
    const k = S[K]!;
    return k.agent
      .post(`${OPS}/revisions/${revisionId}/submit`)
      .set('x-csrf-token', k.csrf);
  }

  async function approve(revisionId: string) {
    const d = S[D]!;
    return d.agent
      .post(`${OPS}/revisions/${revisionId}/approve`)
      .set('x-csrf-token', d.csrf)
      .send({});
  }

  async function publish(body: Record<string, unknown>) {
    const t = S[T]!;
    return t.agent
      .post(`${OPS}/publications`)
      .set('x-csrf-token', t.csrf)
      .send(body);
  }

  async function fullApproved() {
    const c = await create('sr-Latn');
    const k = S[K]!;
    for (const locale of ['hu', 'en']) {
      const r = await k.agent
        .post(`${OPS}/resources/${c.resourceId}/variants`)
        .set('x-csrf-token', k.csrf)
        .send({ locale });
      expect(r.status).toBe(201);
    }
    const det = await k.agent.get(`${OPS}/resources/${c.resourceId}`);
    const out: Record<string, { variantId: string; revisionId: string }> = {};
    for (const v of det.body.variants) {
      const rev = v.revisions[0];
      await save(v.id, rev.id, rev.lockVersion, {
        title: `T ${v.locale}`,
        summary: 'S',
        body: doc(`Body ${v.locale}`),
        proposedAudience: [{ kind: 'all_eligible' }],
      });
      expect((await submit(rev.id)).status).toBe(200);
      expect((await approve(rev.id)).status).toBe(200);
      out[v.locale as string] = { variantId: v.id, revisionId: rev.id };
    }
    return { resourceId: c.resourceId, variants: out };
  }

  async function fullPublished(
    audience: Record<string, unknown>[] = [{ kind: 'all_eligible' }],
  ) {
    const f = await fullApproved();
    const p = await publish({ resourceId: f.resourceId, audience });
    expect(p.status).toBe(201);
    return { ...f, pubResponse: p.body };
  }

  async function newApprovedRevision(
    variantId: string,
    title: string,
    bodyText: string,
  ): Promise<string> {
    const k = S[K]!;
    const nr = await k.agent
      .post(`${OPS}/variants/${variantId}/revisions`)
      .set('x-csrf-token', k.csrf);
    expect(nr.status).toBe(201);
    await save(variantId, nr.body.id, 1, {
      title,
      summary: 'S',
      body: doc(bodyText),
      proposedAudience: [{ kind: 'all_eligible' }],
    });
    expect((await submit(nr.body.id)).status).toBe(200);
    expect((await approve(nr.body.id)).status).toBe(200);
    return nr.body.id as string;
  }

  // ─── P13: concurrent publish ──────────────────────────────────────

  it('concurrent publish: exactly one 201, the other 409', async () => {
    const f = await fullApproved();
    const [a, b] = await Promise.all([
      publish({ resourceId: f.resourceId, audience: [{ kind: 'all_eligible' }] }),
      publish({ resourceId: f.resourceId, audience: [{ kind: 'all_eligible' }] }),
    ]);

    const statuses = [a.status, b.status].sort();

    // Exactly one wins (201), the other loses (409)
    expect(statuses).toEqual([201, 409]);

    // The loser gets the right error code
    const loser = a.status === 409 ? a : b;
    expect(loser.body.code).toBe('content_publication_exists');

    // Database has exactly 3 publications (one per locale)
    const count = Number(
      (
        await testDb.pool.query(
          `SELECT count(*) FROM content_publications p
           JOIN content_variants v ON v.id = p.content_variant_id
           WHERE v.content_resource_id = $1`,
          [f.resourceId],
        )
      ).rows[0].count,
    );
    expect(count).toBe(3);
  });

  // ─── P14: opposite-locale correction publish: no deadlock ─────────

  it('opposite-locale correction publishes produce no deadlock or 500', async () => {
    for (let i = 0; i < 3; i++) {
      const f = await fullPublished();

      // Create new approved revisions for hu and en only
      await newApprovedRevision(
        f.variants['hu']!.variantId,
        `P14-${i} hu v2`,
        `hu v2 ${i}`,
      );
      await newApprovedRevision(
        f.variants['en']!.variantId,
        `P14-${i} en v2`,
        `en v2 ${i}`,
      );

      // Two concurrent correction publishes with opposite locale order
      const [a, b] = await Promise.all([
        publish({
          resourceId: f.resourceId,
          audience: [{ kind: 'all_eligible' }],
          locales: ['hu', 'en'],
        }),
        publish({
          resourceId: f.resourceId,
          audience: [{ kind: 'all_eligible' }],
          locales: ['en', 'hu'],
        }),
      ]);

      // No 500 or deadlock
      expect(a.status).not.toBe(500);
      expect(b.status).not.toBe(500);
      expect(a.body.code).not.toBe('deadlock_detected');
      expect(b.body.code).not.toBe('deadlock_detected');

      // Exactly one 201 and one 409
      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([201, 409]);
    }
  });

  // ─── P17: concurrent new working revision ─────────────────────────

  it('concurrent new-revision POST: exactly 1x201, rest 409, zero 500', async () => {
    const c = await create();
    await save(c.variantId, c.revisionId, 1, {
      title: 'Concurrent rev test',
      summary: 'S',
      body: doc('test'),
      proposedAudience: [{ kind: 'all_eligible' }],
    });
    await submit(c.revisionId);
    await approve(c.revisionId);

    const k = S[K]!;
    const rs = await Promise.all(
      [0, 1, 2].map(() =>
        k.agent
          .post(`${OPS}/variants/${c.variantId}/revisions`)
          .set('x-csrf-token', k.csrf),
      ),
    );

    const statuses = rs.map((r) => r.status);
    const created = statuses.filter((s) => s === 201);
    const conflicts = statuses.filter((s) => s === 409);
    const serverErrors = statuses.filter((s) => s >= 500);

    // Exactly one wins
    expect(created.length).toBe(1);
    expect(conflicts.length).toBe(2);
    expect(serverErrors.length).toBe(0);
  });

  // ─── Forced concurrency: external lock holder ─────────────────────

  it('forced concurrency: publish with external FOR UPDATE holder → one 201, one 409, zero 500', async () => {
    const f = await fullApproved();
    const pg = await import('pg');
    const client = new pg.default.Client({ connectionString: testDb.url });
    await client.connect();

    try {
      // Hold a FOR UPDATE lock on the resource row
      await client.query('BEGIN');
      await client.query(
        'SELECT id FROM content_resources WHERE id = $1 FOR UPDATE',
        [f.resourceId],
      );

      // Fire both publish requests (they'll block on the resource lock)
      const pubPromises = [
        publish({ resourceId: f.resourceId, audience: [{ kind: 'all_eligible' }] }),
        publish({ resourceId: f.resourceId, audience: [{ kind: 'all_eligible' }] }),
      ];

      // Poll pg_stat_activity until both are waiting on the lock
      const waitForBlocked = async () => {
        for (let i = 0; i < 50; i++) {
          const result = await client.query(
            `SELECT count(*) FROM pg_stat_activity
             WHERE wait_event_type = 'Lock'
             AND query LIKE '%content_resources%FOR UPDATE%'`,
          );
          if (Number(result.rows[0].count) >= 2) return;
          await new Promise((r) => setTimeout(r, 100));
        }
      };
      await waitForBlocked();

      // Release the lock
      await client.query('COMMIT');

      const results = await Promise.all(pubPromises);
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([201, 409]);
      expect(statuses.filter((s) => s >= 500)).toHaveLength(0);
    } finally {
      await client.end();
    }
  });

  it('forced concurrency: new-working-revision with external FOR UPDATE holder → one 201, one 409, zero 500', async () => {
    const c = await create();
    await save(c.variantId, c.revisionId, 1, {
      title: 'Lock test',
      summary: 'S',
      body: doc('lock test'),
      proposedAudience: [{ kind: 'all_eligible' }],
    });
    await submit(c.revisionId);
    await approve(c.revisionId);

    const pg = await import('pg');
    const client = new pg.default.Client({ connectionString: testDb.url });
    await client.connect();

    try {
      // Hold a FOR UPDATE lock on the variant row
      await client.query('BEGIN');
      await client.query(
        'SELECT id FROM content_variants WHERE id = $1 FOR UPDATE',
        [c.variantId],
      );

      const k = S[K]!;
      const revPromises = [
        k.agent
          .post(`${OPS}/variants/${c.variantId}/revisions`)
          .set('x-csrf-token', k.csrf),
        k.agent
          .post(`${OPS}/variants/${c.variantId}/revisions`)
          .set('x-csrf-token', k.csrf),
      ];

      // Poll pg_stat_activity until both are waiting
      const waitForBlocked = async () => {
        for (let i = 0; i < 50; i++) {
          const result = await client.query(
            `SELECT count(*) FROM pg_stat_activity
             WHERE wait_event_type = 'Lock'
             AND query LIKE '%content_variants%FOR UPDATE%'`,
          );
          if (Number(result.rows[0].count) >= 2) return;
          await new Promise((r) => setTimeout(r, 100));
        }
      };
      await waitForBlocked();

      // Release the lock
      await client.query('COMMIT');

      const revResults = await Promise.all(revPromises);
      const statuses = revResults.map((r) => r.status).sort();
      expect(statuses).toEqual([201, 409]);
      expect(statuses.filter((s) => s >= 500)).toHaveLength(0);
    } finally {
      await client.end();
    }
  });
}, 180_000);
