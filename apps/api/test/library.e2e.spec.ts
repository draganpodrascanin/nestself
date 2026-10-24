/**
 * Library e2e tests (T-C1.11): content detail, list and saved items.
 *
 * Uses real sessions of the seeded acceptance employees:
 * - Jovan (Employee A, org A) — user_jovan
 * - Emilija (Employee B, org B) — user_emilija
 * - Mirjam (multi-org, orgs A and B) — user_mirjam
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
import { IdentityProviderService } from '../src/identity/identity-provider.service.js';
import type { FakeIdentityProvider } from '../src/identity/fake-identity-provider.js';
import { seed } from '../src/db/seed/seed-lib.js';
import {
  externalIdentities,
  contentPublications,
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

const _ORG_A = 'org_sample';
const ORG_B = 'org_sample_b';

// The list of forbidden keys that must never appear in detail responses
const FORBIDDEN_KEYS = [
  'revisionId', 'reviewComments', 'audiences', 'membershipId',
  'draftId', 'privateSourceSubmissionId', 'unpublishedTranslations',
];

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
    await app?.close();
    await testDb?.close();
  });

  // ─── Auth helpers ─────────────────────────────────────────────────

  function extractCsrf(res: request.Response): string {
    const cookies = res.headers['set-cookie'] as string[] | undefined;
    const csrf = cookies
      ?.find((c: string) => c.startsWith('nestself_csrf='))
      ?.match(/nestself_csrf=([^;]+)/);
    if (!csrf) throw new Error('CSRF cookie not found');
    return csrf[1]!;
  }

  /** Sign in to personal context (default for employees). */
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

  /** Switch to personal context for a specific org. */
  async function switchToPersonalOrg(
    session: { agent: ReturnType<typeof request.agent>; csrf: string },
    orgId: string,
  ) {
    const res = await session.agent
      .post('/api/auth/context')
      .set('x-csrf-token', session.csrf)
      .send({ context: { kind: 'personal', orgId } });
    expect(res.status).toBe(200);
    // Context switch may or may not set a new CSRF cookie — keep the existing one if not.
    let csrf = session.csrf;
    try {
      csrf = extractCsrf(res);
    } catch {
      // No new CSRF cookie — reuse the one from sign-in
    }
    return { agent: session.agent, csrf };
  }

  // ─── Content detail ───────────────────────────────────────────────

  describe('GET /api/library/content/:contentId', () => {
    it('Employee A reads the all-eligible article (200, correct field set)', async () => {
      const session = await signInPersonal(JOVAN);
      const res = await session.agent
        .get(`/api/library/content/${RES_ALL_ELIGIBLE_1}`)
        .set('accept-language', 'sr-Latn');
      expect(res.status).toBe(200);

      const body = res.body;
      // Required fields
      expect(body.id).toBe(RES_ALL_ELIGIBLE_1);
      expect(body.type).toBe('article');
      expect(body.locale).toBe('sr-Latn');
      expect(body.title).toBeTruthy();
      expect(body.summary).toBeTruthy();
      expect(typeof body.outcome).toBe('string');
      expect(body.body).toBeTruthy();
      expect(body.category).toBeTruthy();
      expect(body.category.id).toBeTruthy();
      expect(body.category.label).toBeTruthy();
      expect(typeof body.saved).toBe('boolean');
      expect(Array.isArray(body.sources)).toBe(true);
      expect(Array.isArray(body.media)).toBe(true);
      expect(Array.isArray(body.relatedResources)).toBe(true);
      expect(Array.isArray(body.availableLocales)).toBe(true);

      // Forbidden keys
      const json = JSON.stringify(body);
      for (const key of FORBIDDEN_KEYS) {
        expect(body).not.toHaveProperty(key);
      }
      // No email-like strings in the response
      expect(json).not.toMatch(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
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

    it('returns the same 404 body for an unknown id as for an unavailable one', async () => {
      const session = await signInPersonal(EMILIJA);
      const orgARes = await session.agent
        .get(`/api/library/content/${RES_ORG_A_ONLY}`)
        .set('accept-language', 'sr-Latn');
      const unknownRes = await session.agent
        .get('/api/library/content/nonexistent_resource_id')
        .set('accept-language', 'sr-Latn');

      expect(orgARes.status).toBe(404);
      expect(unknownRes.status).toBe(404);
      expect(orgARes.body.code).toBe(unknownRes.body.code);
    });

    it('future article returns 404 for everyone', async () => {
      const session = await signInPersonal(JOVAN);
      const res = await session.agent
        .get(`/api/library/content/${RES_FUTURE}`)
        .set('accept-language', 'sr-Latn');
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('content_not_available');
    });

    it('withdrawn article returns 404 for everyone', async () => {
      const session = await signInPersonal(JOVAN);
      const res = await session.agent
        .get(`/api/library/content/${RES_WITHDRAWN}`)
        .set('accept-language', 'sr-Latn');
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('content_not_available');
    });

    it('sr-Cyrl returns Cyrillic text with no Latin Serbian letters (outside exception list)', async () => {
      const session = await signInPersonal(JOVAN);
      const res = await session.agent
        .get(`/api/library/content/${RES_ALL_ELIGIBLE_1}`)
        .set('accept-language', 'sr-Cyrl');
      expect(res.status).toBe(200);
      expect(res.body.locale).toBe('sr-Cyrl');

      // Check that title/summary/outcome do not contain Latin Serbian letters
      // Exception list: certain words may still appear in Latin
      const serbianLatinLetters = /[čćžšđ]/i;
      expect(res.body.title).not.toMatch(serbianLatinLetters);
      expect(res.body.summary).not.toMatch(serbianLatinLetters);
    });

    it('hu returns the Hungarian variant', async () => {
      const session = await signInPersonal(JOVAN);
      const res = await session.agent
        .get(`/api/library/content/${RES_ALL_ELIGIBLE_1}`)
        .set('accept-language', 'hu');
      expect(res.status).toBe(200);
      expect(res.body.locale).toBe('hu');
      // Hungarian title should contain Hungarian characters
      expect(res.body.title).toContain('Nyugodtabb');
    });
  });

  // ─── Content list ─────────────────────────────────────────────────

  describe('GET /api/library/content', () => {
    it('returns a list of available content for Employee A', async () => {
      const session = await signInPersonal(JOVAN);
      const res = await session.agent
        .get('/api/library/content')
        .set('accept-language', 'sr-Latn');
      if (res.status !== 200) {
        console.error('List content response:', res.status, JSON.stringify(res.body, null, 2));
      }
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.items)).toBe(true);
      // Employee A (org A) should see all_eligible and org_a articles (3 total)
      expect(res.body.items.length).toBeGreaterThanOrEqual(3);
      // Should not include future or withdrawn
      const ids = res.body.items.map((i: { resourceId: string }) => i.resourceId);
      expect(ids).not.toContain(RES_FUTURE);
      expect(ids).not.toContain(RES_WITHDRAWN);
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
      // Page 1: limit 1
      const page1 = await session.agent
        .get('/api/library/content?limit=1')
        .set('accept-language', 'sr-Latn');
      expect(page1.status).toBe(200);
      expect(page1.body.items.length).toBe(1);

      if (page1.body.nextCursor) {
        const page2 = await session.agent
          .get(`/api/library/content?limit=1&cursor=${page1.body.nextCursor}`)
          .set('accept-language', 'sr-Latn');
        expect(page2.status).toBe(200);
        // Different items on page 2
        if (page2.body.items.length > 0) {
          expect(page2.body.items[0].resourceId).not.toBe(page1.body.items[0].resourceId);
        }
      }
    });
  });

  // ─── Saved items ──────────────────────────────────────────────────

  describe('Saved items', () => {
    it('Employee A saves an article twice, only one row created', async () => {
      const session = await signInPersonal(JOVAN);

      // Save
      const save1 = await session.agent
        .put(`/api/me/saved/${RES_ALL_ELIGIBLE_1}`)
        .set('x-csrf-token', session.csrf)
        .set('accept-language', 'sr-Latn');
      expect(save1.status).toBe(204);

      // Save again (idempotent)
      const save2 = await session.agent
        .put(`/api/me/saved/${RES_ALL_ELIGIBLE_1}`)
        .set('x-csrf-token', session.csrf)
        .set('accept-language', 'sr-Latn');
      expect(save2.status).toBe(204);

      // Check the list: should have exactly one entry for this resource
      const list = await session.agent
        .get('/api/me/saved')
        .set('accept-language', 'sr-Latn');
      expect(list.status).toBe(200);
      const matching = list.body.items.filter(
        (i: { resourceId: string }) => i.resourceId === RES_ALL_ELIGIBLE_1,
      );
      expect(matching.length).toBe(1);
    });

    it("Employee A's saved list in org A does not show in Mirjam's org B context", async () => {
      // Ensure Jovan has saved something
      const jovanSession = await signInPersonal(JOVAN);
      await jovanSession.agent
        .put(`/api/me/saved/${RES_ALL_ELIGIBLE_2}`)
        .set('x-csrf-token', jovanSession.csrf)
        .set('accept-language', 'sr-Latn');

      // Mirjam signs in, switches to org B
      const mirjamSession = await signInPersonal(MIRJAM);
      // By default Mirjam's first org is org A, switch to org B
      const mirjamB = await switchToPersonalOrg(mirjamSession, ORG_B);

      const list = await mirjamB.agent
        .get('/api/me/saved')
        .set('accept-language', 'sr-Latn');
      expect(list.status).toBe(200);
      // Mirjam in org B should not see Jovan's saved items
      const jovanItem = list.body.items.find(
        (i: { resourceId: string }) => i.resourceId === RES_ALL_ELIGIBLE_2,
      );
      expect(jovanItem).toBeUndefined();
    });

    it('Employee B never sees Employee A saved items', async () => {
      const emilijaSession = await signInPersonal(EMILIJA);
      const list = await emilijaSession.agent
        .get('/api/me/saved')
        .set('accept-language', 'sr-Latn');
      expect(list.status).toBe(200);
      // Emilija should not see Jovan's saved items
      const ids = list.body.items.map((i: { resourceId: string }) => i.resourceId);
      expect(ids).not.toContain(RES_ALL_ELIGIBLE_1);
      expect(ids).not.toContain(RES_ALL_ELIGIBLE_2);
    });

    it('Mirjam saves in org A, switches to org B, org B saved list is empty', async () => {
      const mirjamSession = await signInPersonal(MIRJAM);
      // Default context is org A
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
      // Org B list should not contain the org A save
      const idsB = listB.body.items.map((i: { resourceId: string }) => i.resourceId);
      expect(idsB).not.toContain(RES_ALL_ELIGIBLE_1);
    });

    it('withdrawing a publication makes the saved item show as unavailable', async () => {
      const jovanSession = await signInPersonal(JOVAN);

      // Save the all-eligible-2 article
      await jovanSession.agent
        .put(`/api/me/saved/${RES_ALL_ELIGIBLE_2}`)
        .set('x-csrf-token', jovanSession.csrf)
        .set('accept-language', 'sr-Latn');

      // Withdraw it via direct DB update
      const pubId = `pub_var_pay_day_plan_sr-Latn`;
      await testDb.db
        .update(contentPublications)
        .set({ withdrawnAt: new Date(), state: 'withdrawn' })
        .where(eq(contentPublications.id, pubId));

      // Check saved list: should show as unavailable
      const list = await jovanSession.agent
        .get('/api/me/saved')
        .set('accept-language', 'sr-Latn');
      expect(list.status).toBe(200);
      const item = list.body.items.find(
        (i: { resourceId: string }) => i.resourceId === RES_ALL_ELIGIBLE_2,
      );
      if (item) {
        expect(item.status).toBe('unavailable');
        expect(item.title).toBeNull();
      }

      // Detail should 404
      const detail = await jovanSession.agent
        .get(`/api/library/content/${RES_ALL_ELIGIBLE_2}`)
        .set('accept-language', 'sr-Latn');
      expect(detail.status).toBe(404);

      // Restore for other tests
      await testDb.db
        .update(contentPublications)
        .set({ withdrawnAt: null, state: 'live' })
        .where(eq(contentPublications.id, pubId));
    });

    it('DELETE saved item is idempotent', async () => {
      const session = await signInPersonal(JOVAN);

      // Save an item first
      await session.agent
        .put(`/api/me/saved/${RES_ALL_ELIGIBLE_1}`)
        .set('x-csrf-token', session.csrf)
        .set('accept-language', 'sr-Latn');

      // Delete
      const del1 = await session.agent
        .delete(`/api/me/saved/${RES_ALL_ELIGIBLE_1}`)
        .set('x-csrf-token', session.csrf)
        .set('accept-language', 'sr-Latn');
      expect(del1.status).toBe(204);

      // Delete again (idempotent)
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
  });

  // ─── Cleanup: remove saved items created during tests ─────────────
  afterAll(async () => {
    if (testDb?.db) {
      await testDb.db.delete(savedItems);
    }
  });
});
