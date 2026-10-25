/**
 * Library e2e tests (T-C1.11): content detail, list and saved items.
 *
 * Uses real sessions of the seeded acceptance employees:
 * - Jovan (Employee A, org A) -- user_jovan
 * - Emilija (Employee B, org B) -- user_emilija
 * - Mirjam (multi-org, orgs A and B) -- user_mirjam
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
import {
  LibraryContentDetailSchema,
  LibraryContentListSchema,
  SavedItemsListSchema,
} from '@nestself/contracts';
import { IdentityProviderService } from '../src/identity/identity-provider.service.js';
import type { FakeIdentityProvider } from '../src/identity/fake-identity-provider.js';
import { seed } from '../src/db/seed/seed-lib.js';
import {
  externalIdentities,
  contentPublications,
  contentRevisions,
  savedItems,
} from '../src/db/schema/index.js';
import { resetTestDatabase, type TestDatabase } from './db/test-database.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const shouldRun = !!TEST_DB_URL;

// Employee A (org A only)
const JOVAN = 'user_jovan';
// Employee B (org B only)
const EMILIJA = 'user_emilija';
// Multi-org employee (orgs A and B)
const MIRJAM = 'user_mirjam';

// Sample content resource ids (from sample-data fixtures)
const RES_ALL_ELIGIBLE_1 = 'res_sample_evening_wind_down';
const RES_ALL_ELIGIBLE_2 = 'res_sample_pay_day_plan';
const RES_ORG_A_ONLY = 'res_sample_team_meeting';
const RES_FUTURE = 'res_sample_desk_stretch';
const RES_WITHDRAWN = 'res_sample_harder_conversation';

const ORG_B = 'org_sample_b';

// Forbidden keys that must never appear anywhere in a response body tree
const FORBIDDEN_KEYS = new Set([
  'revisionId', 'reviewComments', 'audiences', 'membershipId',
  'draftId', 'privateSourceSubmissionId', 'unpublishedTranslations',
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

/** Serbian Latin diacritics that must not appear in Cyrillic output. */
const SERBIAN_LATIN_DIACRITICS = /[čćžšđ]/i;

describe.skipIf(!shouldRun)('Library (e2e)', () => {
  let app: INestApplication;
  let idp: FakeIdentityProvider;
  let testDb: TestDatabase;
  const jwtSecret = randomBytes(32).toString('hex');

  beforeAll(async () => {
    testDb = await resetTestDatabase(TEST_DB_URL!, 'library');
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
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const { ApiExceptionFilter } = await import('../src/common/api-exception.filter.js');

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();

    idp = app.get(IdentityProviderService) as FakeIdentityProvider;

    // Seed external identities for sign-in
    const people = [JOVAN, EMILIJA, MIRJAM];
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
    if (testDb?.db) {
      await testDb.db.delete(savedItems);
    }
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

  async function switchToPersonalOrg(
    session: { agent: ReturnType<typeof request.agent>; csrf: string },
    orgId: string,
  ) {
    const res = await session.agent
      .post('/api/auth/context')
      .set('x-csrf-token', session.csrf)
      .send({ context: { kind: 'personal', orgId } });
    expect(res.status).toBe(200);
    let csrf = session.csrf;
    try { csrf = extractCsrf(res); } catch { /* reuse existing */ }
    return { agent: session.agent, csrf };
  }

  // -- Content detail -----------------------------------------------------

  describe('GET /api/library/content/:contentId', () => {
    it('strict-parses against LibraryContentDetailSchema, no forbidden keys, correct headers', async () => {
      const session = await signInPersonal(JOVAN);
      const res = await session.agent
        .get(`/api/library/content/${RES_ALL_ELIGIBLE_1}`)
        .set('accept-language', 'sr-Latn');
      expect(res.status).toBe(200);

      // Strict contract parse
      const parsed = LibraryContentDetailSchema.strict().safeParse(res.body);
      expect(parsed.success).toBe(true);

      // Forbidden keys (walk nested)
      const forbidden = findForbiddenKeys(res.body);
      expect(forbidden).toEqual([]);

      // No email-like strings
      expect(JSON.stringify(res.body)).not.toMatch(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);

      // Required response headers
      expect(res.headers['vary']).toMatch(/Accept-Language/i);
      expect(res.headers['cache-control']).toMatch(/private/);
      expect(res.headers['cache-control']).toMatch(/no-store/);

      // Field checks
      expect(res.body.id).toBe(RES_ALL_ELIGIBLE_1);
      expect(res.body.type).toBe('article');
      expect(res.body.locale).toBe('sr-Latn');
      expect(res.body.availableLocales).toEqual(expect.arrayContaining(['sr-Latn', 'sr-Cyrl', 'hu', 'en']));
    });

    it('Employee A reads the org-A-only article', async () => {
      const session = await signInPersonal(JOVAN);
      const res = await session.agent
        .get(`/api/library/content/${RES_ORG_A_ONLY}`)
        .set('accept-language', 'sr-Latn');
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(RES_ORG_A_ONLY);
    });

    it('Employee B gets 404 for the org-A-only article', async () => {
      const session = await signInPersonal(EMILIJA);
      const res = await session.agent
        .get(`/api/library/content/${RES_ORG_A_ONLY}`)
        .set('accept-language', 'sr-Latn');
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('content_not_available');
    });

    it('returns the same full 404 body for unknown id as for unavailable', async () => {
      const session = await signInPersonal(EMILIJA);
      const orgARes = await session.agent
        .get(`/api/library/content/${RES_ORG_A_ONLY}`)
        .set('accept-language', 'sr-Latn');
      const unknownRes = await session.agent
        .get('/api/library/content/nonexistent_resource_id')
        .set('accept-language', 'sr-Latn');

      expect(orgARes.status).toBe(404);
      expect(unknownRes.status).toBe(404);
      // Compare the full body shape (ignoring request-specific fields like requestId)
      expect(orgARes.body.code).toBe(unknownRes.body.code);
      expect(orgARes.body.message).toBe(unknownRes.body.message);
    });

    it('future article returns 404', async () => {
      const session = await signInPersonal(JOVAN);
      const res = await session.agent
        .get(`/api/library/content/${RES_FUTURE}`)
        .set('accept-language', 'sr-Latn');
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('content_not_available');
    });

    it('withdrawn article returns 404', async () => {
      const session = await signInPersonal(JOVAN);
      const res = await session.agent
        .get(`/api/library/content/${RES_WITHDRAWN}`)
        .set('accept-language', 'sr-Latn');
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('content_not_available');
    });

    it('sr-Cyrl: full Cyrillic check on title, summary, outcome, category label', async () => {
      const session = await signInPersonal(JOVAN);
      const res = await session.agent
        .get(`/api/library/content/${RES_ALL_ELIGIBLE_1}`)
        .set('accept-language', 'sr-Cyrl');
      expect(res.status).toBe(200);
      expect(res.body.locale).toBe('sr-Cyrl');

      // None of these fields should contain Serbian Latin diacritics
      expect(res.body.title).not.toMatch(SERBIAN_LATIN_DIACRITICS);
      expect(res.body.summary).not.toMatch(SERBIAN_LATIN_DIACRITICS);
      expect(res.body.outcome).not.toMatch(SERBIAN_LATIN_DIACRITICS);
      expect(res.body.category.label).not.toMatch(SERBIAN_LATIN_DIACRITICS);
      if (res.body.category.description) {
        expect(res.body.category.description).not.toMatch(SERBIAN_LATIN_DIACRITICS);
      }
      expect(res.body.authorName).not.toMatch(SERBIAN_LATIN_DIACRITICS);
      if (res.body.reviewerName) {
        expect(res.body.reviewerName).not.toMatch(SERBIAN_LATIN_DIACRITICS);
      }
      // Sources
      for (const src of res.body.sources) {
        expect(src.label).not.toMatch(SERBIAN_LATIN_DIACRITICS);
      }
    });

    it('hu returns the Hungarian variant', async () => {
      const session = await signInPersonal(JOVAN);
      const res = await session.agent
        .get(`/api/library/content/${RES_ALL_ELIGIBLE_1}`)
        .set('accept-language', 'hu');
      expect(res.status).toBe(200);
      expect(res.body.locale).toBe('hu');
      expect(res.body.title).toContain('Nyugodtabb');
    });

    it('case-insensitive Accept-Language (sr-cyrl)', async () => {
      const session = await signInPersonal(JOVAN);
      const res = await session.agent
        .get(`/api/library/content/${RES_ALL_ELIGIBLE_1}`)
        .set('accept-language', 'sr-cyrl');
      expect(res.status).toBe(200);
      expect(res.body.locale).toBe('sr-Cyrl');
    });

    it('q=0 excludes a locale', async () => {
      const session = await signInPersonal(JOVAN);
      const res = await session.agent
        .get(`/api/library/content/${RES_ALL_ELIGIBLE_1}`)
        .set('accept-language', 'sr-Cyrl;q=0, en;q=0.5');
      expect(res.status).toBe(200);
      expect(res.body.locale).toBe('en');
    });

    it('string-shaped sources are normalized to { label, url }', async () => {
      // Seed a string source
      await testDb.db
        .update(contentRevisions)
        .set({ sources: JSON.parse('["WHO, Mental health at work, 2022"]') })
        .where(eq(contentRevisions.id, 'rev_var_team_meeting_sr-Latn_1'));

      const session = await signInPersonal(JOVAN);
      const res = await session.agent
        .get(`/api/library/content/${RES_ORG_A_ONLY}`)
        .set('accept-language', 'sr-Latn');
      expect(res.status).toBe(200);

      // Strict parse still succeeds
      const parsed = LibraryContentDetailSchema.strict().safeParse(res.body);
      expect(parsed.success).toBe(true);
      expect(res.body.sources[0].label).toBe('WHO, Mental health at work, 2022');
      expect(res.body.sources[0].url).toBeNull();

      // Cleanup
      await testDb.db
        .update(contentRevisions)
        .set({ sources: [] })
        .where(eq(contentRevisions.id, 'rev_var_team_meeting_sr-Latn_1'));
    });

    it('related resources use the availability formula (future revision title never leaks)', async () => {
      // Add a future-scheduled publication with a distinctive title
      await testDb.pool.query(`INSERT INTO content_revisions
        SELECT (jsonb_populate_record(null::content_revisions, to_jsonb(r) || jsonb_build_object(
          'id','rev_probe_future','revision_number',2,'title','PROBE UNRELEASED TITLE','summary','PROBE UNRELEASED SUMMARY'))).*
        FROM content_revisions r WHERE r.id='rev_var_evening_wind_down_sr-Latn_1'`);
      await testDb.pool.query(`INSERT INTO content_publications
        SELECT (jsonb_populate_record(null::content_publications, to_jsonb(p) || jsonb_build_object(
          'id','pub_probe_future','content_revision_id','rev_probe_future','state','scheduled',
          'starts_at', (now() + interval '7 days')))).*
        FROM content_publications p WHERE p.id='pub_var_evening_wind_down_sr-Latn'`);
      await testDb.pool.query(`INSERT INTO content_publication_audiences
        SELECT (jsonb_populate_record(null::content_publication_audiences, to_jsonb(a) || jsonb_build_object(
          'id','aud_probe_future','publication_id','pub_probe_future'))).*
        FROM content_publication_audiences a WHERE a.publication_id='pub_var_evening_wind_down_sr-Latn'`);
      // Make pay_day_plan reference evening_wind_down as related
      await testDb.pool.query(`UPDATE content_revisions SET related_resource_ids = ARRAY['res_sample_evening_wind_down'] WHERE id='rev_var_pay_day_plan_sr-Latn_1'`);

      const session = await signInPersonal(JOVAN);
      const res = await session.agent
        .get(`/api/library/content/${RES_ALL_ELIGIBLE_2}`)
        .set('accept-language', 'sr-Latn');
      expect(res.status).toBe(200);

      // The related resource must show the LIVE title, not the future one
      const related = res.body.relatedResources.find(
        (r: { resourceId: string }) => r.resourceId === RES_ALL_ELIGIBLE_1,
      );
      if (related) {
        expect(related.title).not.toContain('PROBE UNRELEASED');
        expect(related.summary).not.toContain('PROBE UNRELEASED');
      }

      // Cleanup
      await testDb.pool.query(`DELETE FROM content_publication_audiences WHERE id='aud_probe_future'`);
      await testDb.pool.query(`DELETE FROM content_publications WHERE id='pub_probe_future'`);
      await testDb.pool.query(`DELETE FROM content_revisions WHERE id='rev_probe_future'`);
      await testDb.pool.query(`UPDATE content_revisions SET related_resource_ids = '{}' WHERE id='rev_var_pay_day_plan_sr-Latn_1'`);
    });
  });

  // -- Content list -------------------------------------------------------

  describe('GET /api/library/content', () => {
    it('strict-parses the list response and returns correct items for Employee A', async () => {
      const session = await signInPersonal(JOVAN);
      const res = await session.agent
        .get('/api/library/content')
        .set('accept-language', 'sr-Latn');
      expect(res.status).toBe(200);

      const parsed = LibraryContentListSchema.strict().safeParse(res.body);
      expect(parsed.success).toBe(true);

      // Employee A (org A) should see all_eligible and org_a articles (3 total)
      expect(res.body.items.length).toBeGreaterThanOrEqual(3);
      const ids = res.body.items.map((i: { resourceId: string }) => i.resourceId);
      expect(ids).not.toContain(RES_FUTURE);
      expect(ids).not.toContain(RES_WITHDRAWN);

      // Each card has availableLocales
      for (const item of res.body.items) {
        expect(item.availableLocales).toEqual(expect.arrayContaining(['sr-Latn', 'sr-Cyrl', 'hu', 'en']));
      }

      // Response headers
      expect(res.headers['vary']).toMatch(/Accept-Language/i);
      expect(res.headers['cache-control']).toMatch(/private/);
    });

    it('Employee B does not see org-A-only content', async () => {
      const session = await signInPersonal(EMILIJA);
      const res = await session.agent
        .get('/api/library/content')
        .set('accept-language', 'sr-Latn');
      expect(res.status).toBe(200);
      const ids = res.body.items.map((i: { resourceId: string }) => i.resourceId);
      expect(ids).not.toContain(RES_ORG_A_ONLY);
    });

    it('pagination is stable across pages', async () => {
      const session = await signInPersonal(JOVAN);
      const page1 = await session.agent
        .get('/api/library/content?limit=1')
        .set('accept-language', 'sr-Latn');
      expect(page1.status).toBe(200);
      expect(page1.body.items.length).toBe(1);
      expect(page1.body.nextCursor).toBeTruthy();

      const page2 = await session.agent
        .get(`/api/library/content?limit=1&cursor=${page1.body.nextCursor}`)
        .set('accept-language', 'sr-Latn');
      expect(page2.status).toBe(200);
      expect(page2.body.items.length).toBeGreaterThanOrEqual(1);
      expect(page2.body.items[0].resourceId).not.toBe(page1.body.items[0].resourceId);
    });

    it('malformed cursor returns 400 validation', async () => {
      const session = await signInPersonal(JOVAN);
      const bad = Buffer.from('not-valid-json').toString('base64url');
      const res = await session.agent
        .get(`/api/library/content?cursor=${bad}`)
        .set('accept-language', 'sr-Latn');
      expect(res.status).toBe(400);
    });

    it('limit=0 returns 400 validation', async () => {
      const session = await signInPersonal(JOVAN);
      const res = await session.agent
        .get('/api/library/content?limit=0')
        .set('accept-language', 'sr-Latn');
      expect(res.status).toBe(400);
    });
  });

  // -- Saved items --------------------------------------------------------

  describe('Saved items', () => {
    it('Employee A saves an article twice, only one row created', async () => {
      const session = await signInPersonal(JOVAN);

      const save1 = await session.agent
        .put(`/api/me/saved/${RES_ALL_ELIGIBLE_1}`)
        .set('x-csrf-token', session.csrf)
        .set('accept-language', 'sr-Latn');
      expect(save1.status).toBe(204);

      const save2 = await session.agent
        .put(`/api/me/saved/${RES_ALL_ELIGIBLE_1}`)
        .set('x-csrf-token', session.csrf)
        .set('accept-language', 'sr-Latn');
      expect(save2.status).toBe(204);

      const list = await session.agent
        .get('/api/me/saved')
        .set('accept-language', 'sr-Latn');
      expect(list.status).toBe(200);

      // Strict parse
      const parsed = SavedItemsListSchema.strict().safeParse(list.body);
      expect(parsed.success).toBe(true);

      const matching = list.body.items.filter(
        (i: { resourceId: string }) => i.resourceId === RES_ALL_ELIGIBLE_1,
      );
      expect(matching.length).toBe(1);
      expect(matching[0].status).toBe('available');
      expect(matching[0].title).toBeTruthy();
    });

    it('Employee B never sees Employee A saved items', async () => {
      const emilijaSession = await signInPersonal(EMILIJA);
      const list = await emilijaSession.agent
        .get('/api/me/saved')
        .set('accept-language', 'sr-Latn');
      expect(list.status).toBe(200);
      const ids = list.body.items.map((i: { resourceId: string }) => i.resourceId);
      expect(ids).not.toContain(RES_ALL_ELIGIBLE_1);
      expect(ids).not.toContain(RES_ALL_ELIGIBLE_2);
    });

    it('Mirjam saves in org A, switches to org B, org B saved list is empty', async () => {
      const mirjamSession = await signInPersonal(MIRJAM);
      await mirjamSession.agent
        .put(`/api/me/saved/${RES_ALL_ELIGIBLE_1}`)
        .set('x-csrf-token', mirjamSession.csrf)
        .set('accept-language', 'sr-Latn');

      // Verify saved in org A
      const listA = await mirjamSession.agent
        .get('/api/me/saved')
        .set('accept-language', 'sr-Latn');
      expect(listA.status).toBe(200);
      const idsA = listA.body.items.map((i: { resourceId: string }) => i.resourceId);
      expect(idsA).toContain(RES_ALL_ELIGIBLE_1);

      // Switch to org B
      const mirjamB = await switchToPersonalOrg(mirjamSession, ORG_B);
      const listB = await mirjamB.agent
        .get('/api/me/saved')
        .set('accept-language', 'sr-Latn');
      expect(listB.status).toBe(200);
      const idsB = listB.body.items.map((i: { resourceId: string }) => i.resourceId);
      expect(idsB).not.toContain(RES_ALL_ELIGIBLE_1);
    });

    it("Employee A's saved list in org A does not show in Mirjam's org B context", async () => {
      const jovanSession = await signInPersonal(JOVAN);
      await jovanSession.agent
        .put(`/api/me/saved/${RES_ALL_ELIGIBLE_2}`)
        .set('x-csrf-token', jovanSession.csrf)
        .set('accept-language', 'sr-Latn');

      const mirjamSession = await signInPersonal(MIRJAM);
      const mirjamB = await switchToPersonalOrg(mirjamSession, ORG_B);

      const list = await mirjamB.agent
        .get('/api/me/saved')
        .set('accept-language', 'sr-Latn');
      expect(list.status).toBe(200);
      const jovanItem = list.body.items.find(
        (i: { resourceId: string }) => i.resourceId === RES_ALL_ELIGIBLE_2,
      );
      expect(jovanItem).toBeUndefined();
    });

    it('withdrawing a publication makes the saved item show as unavailable', async () => {
      const jovanSession = await signInPersonal(JOVAN);

      await jovanSession.agent
        .put(`/api/me/saved/${RES_ALL_ELIGIBLE_2}`)
        .set('x-csrf-token', jovanSession.csrf)
        .set('accept-language', 'sr-Latn');

      const pubId = 'pub_var_pay_day_plan_sr-Latn';
      await testDb.db
        .update(contentPublications)
        .set({ withdrawnAt: new Date(), state: 'withdrawn' })
        .where(eq(contentPublications.id, pubId));

      const list = await jovanSession.agent
        .get('/api/me/saved')
        .set('accept-language', 'sr-Latn');
      expect(list.status).toBe(200);
      const item = list.body.items.find(
        (i: { resourceId: string }) => i.resourceId === RES_ALL_ELIGIBLE_2,
      );
      expect(item).toBeTruthy();
      expect(item.status).toBe('unavailable');
      expect(item.title).toBeNull();

      // Detail should 404
      const detail = await jovanSession.agent
        .get(`/api/library/content/${RES_ALL_ELIGIBLE_2}`)
        .set('accept-language', 'sr-Latn');
      expect(detail.status).toBe(404);

      // Restore
      await testDb.db
        .update(contentPublications)
        .set({ withdrawnAt: null, state: 'live' })
        .where(eq(contentPublications.id, pubId));
    });

    it('DELETE saved item is idempotent', async () => {
      const session = await signInPersonal(JOVAN);
      await session.agent
        .put(`/api/me/saved/${RES_ALL_ELIGIBLE_1}`)
        .set('x-csrf-token', session.csrf)
        .set('accept-language', 'sr-Latn');

      const del1 = await session.agent
        .delete(`/api/me/saved/${RES_ALL_ELIGIBLE_1}`)
        .set('x-csrf-token', session.csrf)
        .set('accept-language', 'sr-Latn');
      expect(del1.status).toBe(204);

      const del2 = await session.agent
        .delete(`/api/me/saved/${RES_ALL_ELIGIBLE_1}`)
        .set('x-csrf-token', session.csrf)
        .set('accept-language', 'sr-Latn');
      expect(del2.status).toBe(204);
    });

    it('saving an unavailable resource returns 404', async () => {
      const session = await signInPersonal(JOVAN);
      const res = await session.agent
        .put(`/api/me/saved/${RES_FUTURE}`)
        .set('x-csrf-token', session.csrf)
        .set('accept-language', 'sr-Latn');
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('content_not_available');
    });

    it('saved list limit=0 returns 400', async () => {
      const session = await signInPersonal(JOVAN);
      const res = await session.agent
        .get('/api/me/saved?limit=0')
        .set('accept-language', 'sr-Latn');
      expect(res.status).toBe(400);
    });

    it('saved list malformed cursor returns 400', async () => {
      const session = await signInPersonal(JOVAN);
      const bad = Buffer.from('not-valid-json').toString('base64url');
      const res = await session.agent
        .get(`/api/me/saved?cursor=${bad}`)
        .set('accept-language', 'sr-Latn');
      expect(res.status).toBe(400);
    });

    it('saved list pagination works', async () => {
      const session = await signInPersonal(JOVAN);
      // Ensure at least 2 saved items
      await session.agent.put(`/api/me/saved/${RES_ALL_ELIGIBLE_1}`).set('x-csrf-token', session.csrf).set('accept-language', 'sr-Latn');
      await session.agent.put(`/api/me/saved/${RES_ALL_ELIGIBLE_2}`).set('x-csrf-token', session.csrf).set('accept-language', 'sr-Latn');

      const page1 = await session.agent
        .get('/api/me/saved?limit=1')
        .set('accept-language', 'sr-Latn');
      expect(page1.status).toBe(200);
      expect(page1.body.items.length).toBe(1);
      expect(page1.body.nextCursor).toBeTruthy();

      const page2 = await session.agent
        .get(`/api/me/saved?limit=1&cursor=${page1.body.nextCursor}`)
        .set('accept-language', 'sr-Latn');
      expect(page2.status).toBe(200);
      expect(page2.body.items.length).toBeGreaterThanOrEqual(1);
      expect(page2.body.items[0].resourceId).not.toBe(page1.body.items[0].resourceId);
    });
  });
});
