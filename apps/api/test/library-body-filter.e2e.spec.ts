/**
 * Body-filter integration test (FMT-R-27, LIB-R-23, T-C1.11).
 *
 * Seeds custom publications and verifies that the body filter correctly
 * removes unavailable references, capability-gated CTAs, and internal
 * links when read through `GET /api/library/content/:id`.
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
import { externalIdentities } from '../src/db/schema/index.js';
import { resetTestDatabase, type TestDatabase } from './db/test-database.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const shouldRun = !!TEST_DB_URL;

const JOVAN = 'user_jovan';   // Employee A, org_sample
const EMILIJA = 'user_emilija'; // Employee B, org_sample_b

const ORG_A = 'org_sample';
const ORG_B = 'org_sample_b';

// Prefix for all test-specific ids
const P = 'bf_';

// Target resource ids
const T1 = `${P}t1_all`;     // available to everyone
const T2 = `${P}t2_org_a`;   // published only to org A
const T3 = `${P}t3_future`;  // future
const T4 = `${P}t4_withdrawn`; // withdrawn

// Publication P that references all targets
const P_RES = `${P}host`;
// Second publication with open_service CTA
const P_SVC_RES = `${P}host_svc`;

describe.skipIf(!shouldRun)('Library body-filter (e2e)', () => {
  let app: INestApplication;
  let idp: FakeIdentityProvider;
  let testDb: TestDatabase;
  const jwtSecret = randomBytes(32).toString('hex');

  beforeAll(async () => {
    testDb = await resetTestDatabase(TEST_DB_URL!, 'bodyfilter');
    await seed(testDb.db);

    process.env.DATABASE_URL = testDb.url;
    process.env.AUTH_MODE = 'stub';
    process.env.JWT_SECRET = jwtSecret;
    process.env.SESSION_COOKIE_INSECURE_DEV = 'true';
    process.env.NODE_ENV = 'test';
    process.env.MEDIA_STORAGE = 'local';
    process.env.CONTENT_LINK_HOST_ALLOWLIST = '';
    delete process.env.REDIS_URL;

    // Seed target resources and publications
    const q = testDb.pool;
    const authorId = JOVAN;
    const catId = 'cat_stress'; // from seed
    const now = new Date('2026-10-17T00:00:00Z');
    const future = new Date('2030-01-01T00:00:00Z');
    const withdrawn = new Date('2026-10-15T00:00:00Z');

    // Helper: seed a complete resource -> variant -> revision -> publication chain
    async function seedResource(
      id: string,
      opts: {
        audience: 'all' | 'org_a';
        starts?: Date;
        withdrawnAt?: Date | null;
      },
    ) {
      await q.query(
        `INSERT INTO content_resources (id, type, state, primary_category_id, owner_user_id, review_discipline) VALUES ($1, 'article', 'active', $2, $3, 'general') ON CONFLICT (id) DO NOTHING`,
        [id, catId, authorId],
      );
      const varId = `${id}_var`;
      await q.query(
        `INSERT INTO content_variants (id, content_resource_id, locale, slug) VALUES ($1, $2, 'sr-Latn', $3) ON CONFLICT (id) DO NOTHING`,
        [varId, id, id],
      );
      const revId = `${id}_rev`;
      await q.query(
        `INSERT INTO content_revisions (id, content_variant_id, revision_number, state, body, title, summary, author_user_id, last_editor_user_id)
         VALUES ($1, $2, 1, 'approved', '{"type":"doc","schemaVersion":1,"content":[{"type":"paragraph","content":[{"type":"text","text":"Target content"}]}]}', $3, 'Summary', $4, $4) ON CONFLICT (id) DO NOTHING`,
        [revId, varId, `Title ${id}`, authorId],
      );
      const pubId = `${id}_pub`;
      const state = opts.withdrawnAt ? 'withdrawn' : (opts.starts && opts.starts > now ? 'scheduled' : 'live');
      await q.query(
        `INSERT INTO content_publications (id, content_variant_id, content_revision_id, approval_hash, state, starts_at, required_capability, published_by_user_id, withdrawn_at)
         VALUES ($1, $2, $3, 'hash', $4, $5, 'library', $6, $7) ON CONFLICT (id) DO NOTHING`,
        [pubId, varId, revId, state, opts.starts ?? now, authorId, opts.withdrawnAt ?? null],
      );
      const audId = `${id}_aud`;
      if (opts.audience === 'all') {
        await q.query(
          `INSERT INTO content_publication_audiences (id, publication_id, kind) VALUES ($1, $2, 'all_eligible') ON CONFLICT (id) DO NOTHING`,
          [audId, pubId],
        );
      } else {
        await q.query(
          `INSERT INTO content_publication_audiences (id, publication_id, kind, org_id) VALUES ($1, $2, 'organization', $3) ON CONFLICT (id) DO NOTHING`,
          [audId, pubId, ORG_A],
        );
      }
    }

    // T1: available to everyone
    await seedResource(T1, { audience: 'all' });
    // T2: published only to org A
    await seedResource(T2, { audience: 'org_a' });
    // T3: future
    await seedResource(T3, { audience: 'all', starts: future });
    // T4: withdrawn
    await seedResource(T4, { audience: 'all', withdrawnAt: withdrawn });

    // Host publication P: body references T1, T2, T3, T4 through various nodes
    const hostBody = {
      type: 'doc',
      schemaVersion: 1,
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Introduction text.' }] },
        // CTA of kind open_content -> T2
        { type: 'cta', attrs: { ctaKind: 'open_content', targetId: T2, label: 'Read T2' } },
        // relatedResource nodes -> T1, T2, T3, T4
        { type: 'relatedResource', attrs: { contentResourceId: T1 } },
        { type: 'relatedResource', attrs: { contentResourceId: T2 } },
        { type: 'relatedResource', attrs: { contentResourceId: T3 } },
        { type: 'relatedResource', attrs: { contentResourceId: T4 } },
        // Internal links in a bulletList
        { type: 'bulletList', content: [
          { type: 'listItem', content: [
            { type: 'paragraph', content: [
              { type: 'text', text: 'See T1', marks: [{ type: 'link', attrs: { href: `nestself:content/${T1}` } }] },
            ] },
          ] },
          { type: 'listItem', content: [
            { type: 'paragraph', content: [
              { type: 'text', text: 'See T2', marks: [{ type: 'link', attrs: { href: `nestself:content/${T2}` } }] },
            ] },
          ] },
          { type: 'listItem', content: [
            { type: 'paragraph', content: [
              { type: 'text', text: 'See T3', marks: [{ type: 'link', attrs: { href: `nestself:content/${T3}` } }] },
            ] },
          ] },
          { type: 'listItem', content: [
            { type: 'paragraph', content: [
              { type: 'text', text: 'See T4', marks: [{ type: 'link', attrs: { href: `nestself:content/${T4}` } }] },
            ] },
          ] },
        ] },
        // Internal link in a quote
        { type: 'quote', content: [
          { type: 'paragraph', content: [
            { type: 'text', text: 'As noted in T3', marks: [{ type: 'link', attrs: { href: `nestself:content/${T3}` } }] },
          ] },
        ] },
        // Internal link in a professionalNote
        { type: 'professionalNote', attrs: { noteKind: 'tip' }, content: [
          { type: 'paragraph', content: [
            { type: 'text', text: 'Tip from T4', marks: [{ type: 'link', attrs: { href: `nestself:content/${T4}` } }] },
          ] },
        ] },
      ],
    };
    await seedResource(P_RES, { audience: 'all' });
    // Update revision body with our rich body and audiences for both orgs
    await q.query(
      `UPDATE content_revisions SET body = $1::jsonb WHERE id = $2`,
      [JSON.stringify(hostBody), `${P_RES}_rev`],
    );
    // Add org B audience to P's publication
    await q.query(
      `INSERT INTO content_publication_audiences (id, publication_id, kind, org_id) VALUES ($1, $2, 'organization', $3) ON CONFLICT (id) DO NOTHING`,
      [`${P_RES}_aud_b`, `${P_RES}_pub`, ORG_B],
    );

    // Service CTA publication: open_service with capability enabled only for org A
    const svcBody = {
      type: 'doc',
      schemaVersion: 1,
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Service content.' }] },
        { type: 'cta', attrs: { ctaKind: 'open_service', targetId: 'general_questions', label: 'Ask a question' } },
      ],
    };
    await seedResource(P_SVC_RES, { audience: 'all' });
    await q.query(
      `UPDATE content_revisions SET body = $1::jsonb WHERE id = $2`,
      [JSON.stringify(svcBody), `${P_SVC_RES}_rev`],
    );
    await q.query(
      `INSERT INTO content_publication_audiences (id, publication_id, kind, org_id) VALUES ($1, $2, 'organization', $3) ON CONFLICT (id) DO NOTHING`,
      [`${P_SVC_RES}_aud_b`, `${P_SVC_RES}_pub`, ORG_B],
    );

    // Enable general_questions capability only for org A
    await q.query(
      `INSERT INTO org_content_capabilities (id, org_id, capability, enabled_from, configured_by_user_id) VALUES ($1, $2, 'general_questions', '2025-01-01', $3) ON CONFLICT (id) DO NOTHING`,
      [`${P}cap_gq_a`, ORG_A, authorId],
    );
    // Ensure org B does NOT have the general_questions capability
    // (the seed gives both orgs 'library' by default, but not 'general_questions')

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
    const people = [JOVAN, EMILIJA];
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
      }).onConflictDoNothing();
    }
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await testDb?.close();
  });

  // -- Auth helpers -------------------------------------------------------

  function extractCsrf(res: request.Response): string {
    const cookies = res.headers['set-cookie'] as string[] | undefined;
    const csrf = cookies
      ?.find((c: string) => c.startsWith('nestself_csrf='))
      ?.match(/nestself_csrf=([^;]+)/);
    if (!csrf) throw new Error('CSRF cookie not found');
    return csrf[1]!;
  }

  async function signInPersonal(userId: string) {
    const email = `${userId}@example.com`;
    const agent = request.agent(app.getHttpServer());
    const start = await agent.post('/api/auth/email-otp/start').send({ email });
    expect(start.status).toBe(200);
    const code = idp.sentCodes.filter((c) => c.email === email).pop()!.code;
    const verify = await agent
      .post('/api/auth/email-otp/verify')
      .send({ challengeToken: start.body.challengeToken, code });
    expect(verify.status).toBe(200);
    return { agent, csrf: extractCsrf(verify) };
  }

  // -- Tests --------------------------------------------------------------

  it('org-A reader sees T1 and T2 references, not T3 or T4', async () => {
    const session = await signInPersonal(JOVAN);
    const res = await session.agent
      .get(`/api/library/content/${P_RES}`)
      .set('accept-language', 'sr-Latn');
    expect(res.status).toBe(200);

    const json = JSON.stringify(res.body);

    // T1 and T2 visible
    expect(json).toContain(T1);
    expect(json).toContain(T2);

    // T3 and T4 nowhere
    expect(json).not.toContain(T3);
    expect(json).not.toContain(T4);

    // relatedResource nodes: only T1 and T2
    const body = res.body.body;
    const relatedNodes = findNodesOfType(body, 'relatedResource');
    const relatedIds = relatedNodes.map((n) =>
      ((n as Record<string, unknown>).attrs as Record<string, unknown>)?.contentResourceId,
    );
    expect(relatedIds).toContain(T1);
    expect(relatedIds).toContain(T2);
    expect(relatedIds).not.toContain(T3);
    expect(relatedIds).not.toContain(T4);
  });

  it('org-B reader sees only T1 (not T2 which is org-A-only)', async () => {
    const session = await signInPersonal(EMILIJA);
    const res = await session.agent
      .get(`/api/library/content/${P_RES}`)
      .set('accept-language', 'sr-Latn');
    expect(res.status).toBe(200);

    const json = JSON.stringify(res.body);

    // T1 visible (available to everyone)
    expect(json).toContain(T1);

    // T2 NOT visible (org-A-only)
    expect(json).not.toContain(T2);

    // T3 and T4 nowhere
    expect(json).not.toContain(T3);
    expect(json).not.toContain(T4);
  });

  it('unavailable links become plain text and keep their text', async () => {
    const session = await signInPersonal(EMILIJA);
    const res = await session.agent
      .get(`/api/library/content/${P_RES}`)
      .set('accept-language', 'sr-Latn');
    expect(res.status).toBe(200);

    // Find all text nodes in the body
    const textNodes = findTextNodes(res.body.body);

    // "See T2" should still exist as text, but without the link mark
    // (because T2 is unavailable to org B)
    const seeT2 = textNodes.find((n) => n.text === 'See T2');
    expect(seeT2).toBeTruthy();
    // The link mark should be unwrapped (removed)
    expect(seeT2!.marks).toBeUndefined();

    // "See T3" and "See T4" should also be plain text (unavailable)
    for (const label of ['See T3', 'See T4']) {
      const node = textNodes.find((n) => n.text === label);
      expect(node).toBeTruthy();
      expect(node!.marks).toBeUndefined();
    }

    // "See T1" should still have its link mark (T1 is available)
    const seeT1 = textNodes.find((n) => n.text === 'See T1');
    expect(seeT1).toBeTruthy();
    expect(seeT1!.marks).toBeDefined();
    expect(seeT1!.marks!.length).toBeGreaterThan(0);
    expect(seeT1!.marks![0]!.type).toBe('link');
  });

  it('open_service CTA is present for org A and absent for org B', async () => {
    // Org A
    const sessionA = await signInPersonal(JOVAN);
    const resA = await sessionA.agent
      .get(`/api/library/content/${P_SVC_RES}`)
      .set('accept-language', 'sr-Latn');
    expect(resA.status).toBe(200);
    expect(resA.body.cta).not.toBeNull();
    expect(resA.body.cta.kind).toBe('open_service');
    expect(resA.body.cta.targetId).toBe('general_questions');

    // Org B
    const sessionB = await signInPersonal(EMILIJA);
    const resB = await sessionB.agent
      .get(`/api/library/content/${P_SVC_RES}`)
      .set('accept-language', 'sr-Latn');
    expect(resB.status).toBe(200);
    expect(resB.body.cta).toBeNull();
  });

  it('detail.cta agrees with the body CTA node (org A)', async () => {
    const session = await signInPersonal(JOVAN);
    const res = await session.agent
      .get(`/api/library/content/${P_RES}`)
      .set('accept-language', 'sr-Latn');
    expect(res.status).toBe(200);

    // The body should have a CTA node for T2 (available to org A)
    const ctaNodes = findNodesOfType(res.body.body, 'cta');
    expect(ctaNodes.length).toBe(1);
    const ctaNode = ctaNodes[0] as Record<string, unknown>;
    const attrs = ctaNode.attrs as Record<string, unknown>;
    expect(attrs.ctaKind).toBe('open_content');
    expect(attrs.targetId).toBe(T2);

    // detail.cta must match
    expect(res.body.cta).not.toBeNull();
    expect(res.body.cta.kind).toBe('open_content');
    expect(res.body.cta.targetId).toBe(T2);
  });

  it('no id of an unavailable target appears anywhere in the JSON', async () => {
    // Org B reader: T2, T3, T4 are all unavailable
    const session = await signInPersonal(EMILIJA);
    const res = await session.agent
      .get(`/api/library/content/${P_RES}`)
      .set('accept-language', 'sr-Latn');
    expect(res.status).toBe(200);

    const json = JSON.stringify(res.body);
    for (const id of [T2, T3, T4]) {
      expect(json).not.toContain(id);
    }
  });

  // -- Helpers ------------------------------------------------------------

  function findNodesOfType(node: unknown, type: string): unknown[] {
    if (!node || typeof node !== 'object') return [];
    const n = node as Record<string, unknown>;
    const results: unknown[] = [];
    if (n.type === type) results.push(n);
    const content = n.content as unknown[] | undefined;
    if (Array.isArray(content)) {
      for (const child of content) results.push(...findNodesOfType(child, type));
    }
    return results;
  }

  interface TextNodeInfo {
    text: string;
    marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  }

  function findTextNodes(node: unknown): TextNodeInfo[] {
    if (!node || typeof node !== 'object') return [];
    const n = node as Record<string, unknown>;
    const results: TextNodeInfo[] = [];
    if (n.type === 'text' && typeof n.text === 'string') {
      results.push({
        text: n.text,
        marks: n.marks as TextNodeInfo['marks'],
      });
    }
    const content = n.content as unknown[] | undefined;
    if (Array.isArray(content)) {
      for (const child of content) results.push(...findTextNodes(child));
    }
    return results;
  }
});
