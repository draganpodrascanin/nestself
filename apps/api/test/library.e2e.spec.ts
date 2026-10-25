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
import { z } from 'zod';
import { ContentDocumentSchema } from '@nestself/content/schema';
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

// TST-R-05 forbidden keys (must never appear anywhere in a response tree)
const FORBIDDEN_KEYS = new Set([
  'revisionId', 'reviewComments', 'audiences', 'membershipId',
  'draftId', 'privateSourceSubmissionId', 'unpublishedTranslations',
  'authorUserId', 'approvedByUserId', 'publicationId', 'orgId',
  'userId', 'approvalHash', 'lastEditorUserId',
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

// LIB-R-32: protected terms kept in Latin inside Cyrillic text
const CYRILLIC_PROTECTED_TERMS = [
  'NestSelf', 'Pexels', 'Phosphor', 'Onest', 'Europe/Belgrade',
  'English', 'Enterprise',
  'Lelki Elsősegély Telefonszolgálat', 'Lelki Elsősegély',
];

function stripProtectedContent(text: string): string {
  let result = text;
  result = result.replace(/https?:\/\/\S+/g, '');
  result = result.replace(/\{\{[^}]+\}\}/g, '');
  for (const term of CYRILLIC_PROTECTED_TERMS) {
    result = result.replaceAll(term, '');
  }
  return result;
}

function assertNoCyrillicLeak(text: string, field: string) {
  const stripped = stripProtectedContent(text);
  const latin = stripped.match(/[A-Za-z]+/);
  expect(
    latin,
    `LIB-R-32: Latin "${latin?.[0]}" in Cyrillic ${field}. Stripped: "${stripped.slice(0, 80)}"`,
  ).toBeNull();
}

/** Text-bearing attributes in the content document schema (LIB-R-32). */
const TEXT_BEARING_ATTRS = new Set([
  'alt', 'caption', 'title', 'attribution', 'label',
]);

function collectBodyTextNodes(node: unknown): string[] {
  if (!node || typeof node !== 'object') return [];
  const n = node as Record<string, unknown>;
  const results: string[] = [];
  if (n.type === 'text' && typeof n.text === 'string') results.push(n.text);
  if (n.attrs && typeof n.attrs === 'object') {
    for (const [key, val] of Object.entries(n.attrs as Record<string, unknown>)) {
      if (typeof val === 'string' && TEXT_BEARING_ATTRS.has(key)) results.push(val);
    }
  }
  const content = n.content as unknown[] | undefined;
  if (Array.isArray(content)) results.push(...content.flatMap(collectBodyTextNodes));
  return results;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Zod v4 $ZodType vs ZodTypeAny compat
function deepStrict(schema: any): any {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(shape)) out[k] = deepStrict(v);
    return z.object(out as any).strict();
  }
  if (schema instanceof z.ZodArray) {
    let arr = z.array(deepStrict(schema.element));
    for (const c of schema._def.checks ?? []) {
      const d = c._zod?.def as any;
      if (d?.check === 'min_length') arr = arr.min(d.minimum);
      if (d?.check === 'max_length') arr = arr.max(d.maximum);
    }
    return arr;
  }
  if (schema instanceof z.ZodNullable) return deepStrict(schema.unwrap()).nullable();
  if (schema instanceof z.ZodOptional) return deepStrict(schema.unwrap()).optional();
  return schema;
}

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
      const parsed = deepStrict(LibraryContentDetailSchema).safeParse(res.body);
      expect(parsed.success).toBe(true);

      // Body parses against ContentDocumentSchema
      const bodyParsed = ContentDocumentSchema.safeParse(res.body.body);
      expect(bodyParsed.success).toBe(true);

      // Forbidden keys (walk nested including body, media, related)
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
      expect(res.body.replacementLink).toBeNull();
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

    it('returns identical 404 body for unknown id and unavailable (minus requestId)', async () => {
      const session = await signInPersonal(EMILIJA);
      const orgARes = await session.agent
        .get(`/api/library/content/${RES_ORG_A_ONLY}`)
        .set('accept-language', 'sr-Latn');
      const unknownRes = await session.agent
        .get('/api/library/content/nonexistent_resource_id')
        .set('accept-language', 'sr-Latn');

      expect(orgARes.status).toBe(404);
      expect(unknownRes.status).toBe(404);

      // Compare full body minus request-specific fields
      const { requestId: _r1, ...orgABody } = orgARes.body;
      const { requestId: _r2, ...unknownBody } = unknownRes.body;
      expect(orgABody).toEqual(unknownBody);
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

    it('sr-Cyrl: full Cyrillic check on all text fields (LIB-R-32)', async () => {
      const session = await signInPersonal(JOVAN);
      const res = await session.agent
        .get(`/api/library/content/${RES_ALL_ELIGIBLE_1}`)
        .set('accept-language', 'sr-Cyrl');
      expect(res.status).toBe(200);
      expect(res.body.locale).toBe('sr-Cyrl');

      // Detail text fields — full Latin check (LIB-R-32)
      assertNoCyrillicLeak(res.body.title, 'title');
      assertNoCyrillicLeak(res.body.summary, 'summary');
      assertNoCyrillicLeak(res.body.outcome, 'outcome');
      assertNoCyrillicLeak(res.body.category.label, 'category.label');
      if (res.body.category.description) {
        assertNoCyrillicLeak(res.body.category.description, 'category.description');
      }
      assertNoCyrillicLeak(res.body.authorName, 'authorName');
      if (res.body.reviewerName) {
        assertNoCyrillicLeak(res.body.reviewerName, 'reviewerName');
      }

      // Sources
      for (const src of res.body.sources) {
        assertNoCyrillicLeak(src.label, 'source.label');
      }

      // Body text nodes (including label attrs)
      const bodyTexts = collectBodyTextNodes(res.body.body);
      for (const t of bodyTexts) {
        assertNoCyrillicLeak(t, 'body text');
      }

      // Related resources
      for (const rel of res.body.relatedResources) {
        assertNoCyrillicLeak(rel.title, 'related.title');
        assertNoCyrillicLeak(rel.summary, 'related.summary');
        assertNoCyrillicLeak(rel.categoryName, 'related.categoryName');
      }

      // Media alt text
      for (const m of res.body.media) {
        if (m.altText) {
          assertNoCyrillicLeak(m.altText, 'media.altText');
        }
      }

      // CTA label
      if (res.body.cta?.label) {
        assertNoCyrillicLeak(res.body.cta.label, 'cta.label');
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
      await testDb.db
        .update(contentRevisions)
        .set({ sources: JSON.parse('["WHO, Mental health at work, 2022"]') })
        .where(eq(contentRevisions.id, 'rev_var_team_meeting_sr-Latn_1'));

      const session = await signInPersonal(JOVAN);
      const res = await session.agent
        .get(`/api/library/content/${RES_ORG_A_ONLY}`)
        .set('accept-language', 'sr-Latn');
      expect(res.status).toBe(200);

      const parsed = deepStrict(LibraryContentDetailSchema).safeParse(res.body);
      expect(parsed.success).toBe(true);
      expect(res.body.sources[0].label).toBe('WHO, Mental health at work, 2022');
      expect(res.body.sources[0].url).toBeNull();

      // Cleanup
      await testDb.db
        .update(contentRevisions)
        .set({ sources: [] })
        .where(eq(contentRevisions.id, 'rev_var_team_meeting_sr-Latn_1'));
    });

    it('related resources exist and exclude future titles (no if guard)', async () => {
      // Seed a future-scheduled publication with a distinctive title
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
      await testDb.pool.query(`UPDATE content_revisions SET related_resource_ids = ARRAY['res_sample_evening_wind_down'] WHERE id='rev_var_pay_day_plan_sr-Latn_1'`);

      const session = await signInPersonal(JOVAN);
      const res = await session.agent
        .get(`/api/library/content/${RES_ALL_ELIGIBLE_2}`)
        .set('accept-language', 'sr-Latn');
      expect(res.status).toBe(200);

      // Assert the related list is populated (no if guard)
      expect(res.body.relatedResources.length).toBeGreaterThanOrEqual(1);

      const related = res.body.relatedResources.find(
        (r: { resourceId: string }) => r.resourceId === RES_ALL_ELIGIBLE_1,
      );
      expect(related).toBeTruthy();
      expect(related.title).not.toContain('PROBE UNRELEASED');
      expect(related.summary).not.toContain('PROBE UNRELEASED');

      // Entire response body must not contain PROBE UNRELEASED
      expect(JSON.stringify(res.body)).not.toContain('PROBE UNRELEASED');

      // Cleanup
      await testDb.pool.query(`DELETE FROM content_publication_audiences WHERE id='aud_probe_future'`);
      await testDb.pool.query(`DELETE FROM content_publications WHERE id='pub_probe_future'`);
      await testDb.pool.query(`DELETE FROM content_revisions WHERE id='rev_probe_future'`);
      await testDb.pool.query(`UPDATE content_revisions SET related_resource_ids = '{}' WHERE id='rev_var_pay_day_plan_sr-Latn_1'`);
    });

    it('difficulty is returned as an enum key', async () => {
      const session = await signInPersonal(JOVAN);
      const res = await session.agent
        .get(`/api/library/content/${RES_ALL_ELIGIBLE_1}`)
        .set('accept-language', 'sr-Latn');
      expect(res.status).toBe(200);
      // Difficulty is 'easy' (from seed), not a localized string
      expect(['easy', 'medium', 'hard', null]).toContain(res.body.difficulty);
    });
  });

  // -- Content list -------------------------------------------------------

  describe('GET /api/library/content', () => {
    it('strict-parses and returns correct items for Employee A, no forbidden keys', async () => {
      const session = await signInPersonal(JOVAN);
      const res = await session.agent
        .get('/api/library/content')
        .set('accept-language', 'sr-Latn');
      expect(res.status).toBe(200);

      const parsed = deepStrict(LibraryContentListSchema).safeParse(res.body);
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

      // Forbidden keys in every list item
      for (const item of res.body.items) {
        expect(findForbiddenKeys(item)).toEqual([]);
      }

      // Response headers
      expect(res.headers['vary']).toMatch(/Accept-Language/i);
      expect(res.headers['cache-control']).toMatch(/private/);
    });

    it('sr-Cyrl list items have no Latin diacritics', async () => {
      const session = await signInPersonal(JOVAN);
      const res = await session.agent
        .get('/api/library/content')
        .set('accept-language', 'sr-Cyrl');
      expect(res.status).toBe(200);

      for (const item of res.body.items) {
        assertNoCyrillicLeak(item.title, 'list item title');
        assertNoCyrillicLeak(item.summary, 'list item summary');
        assertNoCyrillicLeak(item.categoryName, 'list item categoryName');
      }
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
      expect(res.body.code).toBe('validation');
    });

    it('bit-flipped cursor returns 400', async () => {
      const session = await signInPersonal(JOVAN);
      const page1 = await session.agent
        .get('/api/library/content?limit=1')
        .set('accept-language', 'sr-Latn');
      expect(page1.status).toBe(200);
      expect(page1.body.nextCursor).toBeTruthy();

      const raw = Buffer.from(page1.body.nextCursor, 'base64url');
      const mid = Math.floor(raw.length / 2);
      raw[mid] = raw[mid]! ^ 0xff;
      const flipped = raw.toString('base64url');

      const res = await session.agent
        .get(`/api/library/content?cursor=${flipped}`)
        .set('accept-language', 'sr-Latn');
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('validation');
    });

    it('truncated cursor returns 400', async () => {
      const session = await signInPersonal(JOVAN);
      const page1 = await session.agent
        .get('/api/library/content?limit=1')
        .set('accept-language', 'sr-Latn');
      expect(page1.status).toBe(200);
      expect(page1.body.nextCursor).toBeTruthy();

      const truncated = Buffer.from(page1.body.nextCursor, 'base64url')
        .subarray(0, 8)
        .toString('base64url');

      const res = await session.agent
        .get(`/api/library/content?cursor=${truncated}`)
        .set('accept-language', 'sr-Latn');
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('validation');
    });

    it('random noise cursor returns 400', async () => {
      const session = await signInPersonal(JOVAN);
      const noise = randomBytes(64).toString('base64url');

      const res = await session.agent
        .get(`/api/library/content?cursor=${noise}`)
        .set('accept-language', 'sr-Latn');
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('validation');
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
      const parsed = deepStrict(SavedItemsListSchema).safeParse(list.body);
      expect(parsed.success).toBe(true);

      // Forbidden keys in saved items
      for (const item of list.body.items) {
        expect(findForbiddenKeys(item)).toEqual([]);
      }

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

      const listA = await mirjamSession.agent
        .get('/api/me/saved')
        .set('accept-language', 'sr-Latn');
      expect(listA.status).toBe(200);
      const idsA = listA.body.items.map((i: { resourceId: string }) => i.resourceId);
      expect(idsA).toContain(RES_ALL_ELIGIBLE_1);

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

    it('sr-Cyrl saved items have no Latin diacritics', async () => {
      const session = await signInPersonal(JOVAN);
      await session.agent.put(`/api/me/saved/${RES_ALL_ELIGIBLE_1}`).set('x-csrf-token', session.csrf).set('accept-language', 'sr-Latn');

      const list = await session.agent
        .get('/api/me/saved')
        .set('accept-language', 'sr-Cyrl');
      expect(list.status).toBe(200);

      for (const item of list.body.items) {
        if (item.title) assertNoCyrillicLeak(item.title, 'saved item title');
        if (item.categoryName) assertNoCyrillicLeak(item.categoryName, 'saved item categoryName');
      }
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
      expect(res.body.code).toBe('validation');
    });

    it('saved list pagination works', async () => {
      const session = await signInPersonal(JOVAN);
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

  // -- HTTP edge-case scenarios (item 8) ------------------------------------

  describe('HTTP edge-case scenarios', () => {
    it('expired media rights make the detail 404', async () => {
      // Insert a media asset with expired rights attached to a live resource
      const revId = 'rev_var_evening_wind_down_sr-Latn_1';
      const assetId = 'test_expired_media_asset';

      await testDb.pool.query(
        `INSERT INTO media_assets (id, kind, state, original_filename_hash, byte_size, mime_type, uploaded_by_user_id, rights_expires_at)
         VALUES ($1, 'image', 'ready', 'hash', 1000, 'image/jpeg', $2, $3) ON CONFLICT (id) DO NOTHING`,
        [assetId, JOVAN, new Date('2025-01-01T00:00:00Z')], // expired
      );
      await testDb.pool.query(
        `INSERT INTO content_revision_media (id, content_revision_id, media_asset_id, usage_kind)
         VALUES ($1, $2, $3, 'cover') ON CONFLICT (id) DO NOTHING`,
        ['test_crm_expired', revId, assetId],
      );

      try {
        const session = await signInPersonal(JOVAN);
        const res = await session.agent
          .get(`/api/library/content/${RES_ALL_ELIGIBLE_1}`)
          .set('accept-language', 'sr-Latn');
        expect(res.status).toBe(404);
        expect(res.body.code).toBe('content_not_available');

        // Also not in list
        const list = await session.agent
          .get('/api/library/content')
          .set('accept-language', 'sr-Latn');
        expect(list.status).toBe(200);
        const ids = list.body.items.map((i: { resourceId: string }) => i.resourceId);
        expect(ids).not.toContain(RES_ALL_ELIGIBLE_1);
      } finally {
        await testDb.pool.query(`DELETE FROM content_revision_media WHERE id = 'test_crm_expired'`);
        await testDb.pool.query(`DELETE FROM media_assets WHERE id = $1`, [assetId]);
      }
    });

    it('ended membership returns 403 org_context_expired', async () => {
      const session = await signInPersonal(JOVAN);

      // End Jovan's membership in the past
      await testDb.pool.query(
        `UPDATE memberships SET end_date = $1 WHERE user_id = $2 AND org_id = 'org_sample'`,
        [new Date('2025-06-01T00:00:00Z'), JOVAN],
      );

      try {
        // Detail: context loader rejects the expired membership before availability runs
        const res = await session.agent
          .get(`/api/library/content/${RES_ALL_ELIGIBLE_1}`)
          .set('accept-language', 'sr-Latn');
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('org_context_expired');

        // List also rejected
        const list = await session.agent
          .get('/api/library/content')
          .set('accept-language', 'sr-Latn');
        expect(list.status).toBe(403);
        expect(list.body.code).toBe('org_context_expired');
      } finally {
        await testDb.pool.query(
          `UPDATE memberships SET end_date = NULL WHERE user_id = $1 AND org_id = 'org_sample'`,
          [JOVAN],
        );
      }
    });

    it('superseded publication: newer publication makes the old one still available (latest content)', async () => {
      // When a newer publication exists for the same variant, the availability
      // formula takes the newest non-withdrawn one. Insert a new revision and
      // publish it -- the detail should reflect the newer revision's content.
      const newRevId = 'test_supersede_rev';
      const newPubId = 'test_supersede_pub';
      const srcRevId = 'rev_var_evening_wind_down_sr-Latn_1';
      const srcPubId = 'pub_var_evening_wind_down_sr-Latn';

      // Create a newer revision by copying key columns from the source
      await testDb.pool.query(
        `INSERT INTO content_revisions
           (id, content_variant_id, revision_number, state, body, title, summary,
            author_user_id, last_editor_user_id, related_resource_ids)
         SELECT $1, content_variant_id, 99, state, body,
                'SUPERSEDE TITLE', 'SUPERSEDE SUMMARY',
                author_user_id, last_editor_user_id, related_resource_ids
         FROM content_revisions WHERE id = $2
         ON CONFLICT (id) DO NOTHING`,
        [newRevId, srcRevId],
      );

      // Publish the newer revision (starts_at slightly later to guarantee ordering)
      await testDb.pool.query(
        `INSERT INTO content_publications
           (id, content_variant_id, content_revision_id, approval_hash, state,
            starts_at, required_capability, published_by_user_id)
         SELECT $1, content_variant_id, $2, approval_hash, 'live',
                now() - interval '1 hour', required_capability, published_by_user_id
         FROM content_publications WHERE id = $3
         ON CONFLICT (id) DO NOTHING`,
        [newPubId, newRevId, srcPubId],
      );
      await testDb.pool.query(
        `INSERT INTO content_publication_audiences (id, publication_id, kind)
         SELECT 'test_supersede_aud', $1, kind
         FROM content_publication_audiences WHERE publication_id = $2
         LIMIT 1
         ON CONFLICT (id) DO NOTHING`,
        [newPubId, srcPubId],
      );

      const session = await signInPersonal(JOVAN);
      const res = await session.agent
        .get(`/api/library/content/${RES_ALL_ELIGIBLE_1}`)
        .set('accept-language', 'sr-Latn');
      expect(res.status).toBe(200);
      // The detail should show the newest published revision's content
      expect(res.body.title).toBe('SUPERSEDE TITLE');
      expect(res.body.summary).toBe('SUPERSEDE SUMMARY');

      // Cleanup
      await testDb.pool.query(`DELETE FROM content_publication_audiences WHERE id = 'test_supersede_aud'`);
      await testDb.pool.query(`DELETE FROM content_publications WHERE id = $1`, [newPubId]);
      await testDb.pool.query(`DELETE FROM content_revisions WHERE id = $1`, [newRevId]);
    });
  });

  // -- TST-R-04: HTTP-level same-set (item 9) --------------------------------

  describe('TST-R-04: HTTP same-set consistency', () => {
    it('every resource in the list is also available in detail', async () => {
      const session = await signInPersonal(JOVAN);
      const list = await session.agent
        .get('/api/library/content?limit=50')
        .set('accept-language', 'sr-Latn');
      expect(list.status).toBe(200);
      expect(list.body.items.length).toBeGreaterThan(0);

      // Each listed resource must return 200 from detail
      for (const card of list.body.items) {
        const detail = await session.agent
          .get(`/api/library/content/${card.resourceId}`)
          .set('accept-language', 'sr-Latn');
        expect(detail.status).toBe(200);
        expect(detail.body.id).toBe(card.resourceId);
      }
    });

    it('unavailable resources are absent from both list and detail', async () => {
      const session = await signInPersonal(JOVAN);
      const unavailableIds = [RES_FUTURE, RES_WITHDRAWN];

      const list = await session.agent
        .get('/api/library/content?limit=50')
        .set('accept-language', 'sr-Latn');
      expect(list.status).toBe(200);
      const listIds = list.body.items.map((i: { resourceId: string }) => i.resourceId);

      for (const resId of unavailableIds) {
        expect(listIds).not.toContain(resId);
        const detail = await session.agent
          .get(`/api/library/content/${resId}`)
          .set('accept-language', 'sr-Latn');
        expect(detail.status).toBe(404);
      }
    });

    it('saved items of available resources show status=available and appear in list', async () => {
      const session = await signInPersonal(JOVAN);

      // Save a resource
      await session.agent
        .put(`/api/me/saved/${RES_ALL_ELIGIBLE_1}`)
        .set('x-csrf-token', session.csrf)
        .set('accept-language', 'sr-Latn');

      // Get list and saved
      const list = await session.agent
        .get('/api/library/content?limit=50')
        .set('accept-language', 'sr-Latn');
      const saved = await session.agent
        .get('/api/me/saved?limit=50')
        .set('accept-language', 'sr-Latn');

      const listIds = new Set(list.body.items.map((i: { resourceId: string }) => i.resourceId));
      const savedAvailable = saved.body.items.filter(
        (i: { status: string }) => i.status === 'available',
      );

      // Every available saved item must be in the list
      for (const item of savedAvailable) {
        expect(listIds.has(item.resourceId)).toBe(true);
      }
    });
  });
});
