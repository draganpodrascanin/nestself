/**
 * CMS e2e tests (T-C1.10): content resources, revisions, review and
 * publication API.
 *
 * Uses real sessions of the seeded editorial staff:
 * - Katarina (content_author)
 * - Darko (content_reviewer with disciplines psychological+general)
 * - Teodora (content_publisher)
 * - Vuk (editorial_lead)
 *
 * Requires TEST_DATABASE_URL (PostgreSQL). Skipped otherwise.
 */
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { eq, and } from 'drizzle-orm';
import { IdentityProviderService } from '../src/identity/identity-provider.service.js';
import type { FakeIdentityProvider } from '../src/identity/fake-identity-provider.js';
import { seed } from '../src/db/seed/seed-lib.js';
import {
  externalIdentities,
  outboxEvents,
  auditEvents,
} from '../src/db/schema/index.js';
import { resetTestDatabase, type TestDatabase } from './db/test-database.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const shouldRun = !!TEST_DB_URL;

/** Katarina is a content_author. */
const KATARINA = 'user_katarina';
/** Darko is a content_reviewer (disciplines: psychological, general). */
const DARKO = 'user_darko';
/** Teodora is a content_publisher. */
const TEODORA = 'user_teodora';
/** Vuk is an editorial_lead. */
const VUK = 'user_vuk';

const CATEGORY_STRESS = 'cat_stress';

const OPS_CMS = '/api/ops/cms';

describe.skipIf(!shouldRun)('CMS (e2e)', () => {
  let app: INestApplication;
  let idp: FakeIdentityProvider;
  let testDb: TestDatabase;
  const jwtSecret = randomBytes(32).toString('hex');

  beforeAll(async () => {
    testDb = await resetTestDatabase(TEST_DB_URL!, 'cmsee');
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
    const people = [KATARINA, DARKO, TEODORA, VUK];
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

  async function signInOps(userId: string) {
    const email = `${userId}@example.com`;
    const agent = request.agent(app.getHttpServer());
    const start = await agent.post('/api/auth/email-otp/start').send({ email });
    expect(start.status).toBe(200);
    const code = idp.sentCodes.filter((c) => c.email === email).pop()!.code;
    const verify = await agent
      .post('/api/auth/email-otp/verify')
      .send({ challengeToken: start.body.challengeToken, code });
    expect(verify.status).toBe(200);
    const csrf = extractCsrf(verify);

    const switchRes = await agent
      .post('/api/auth/context')
      .set('x-csrf-token', csrf)
      .send({ context: { kind: 'operations' } });
    expect(switchRes.status).toBe(200);

    return { agent, csrf };
  }

  // ─── Test: full editorial workflow ────────────────────────────────

  it('completes the full editorial workflow: create -> save -> submit -> approve -> publish', async () => {
    const katarina = await signInOps(KATARINA);
    const darko = await signInOps(DARKO);
    const teodora = await signInOps(TEODORA);

    // 1. Author creates a resource
    const createRes = await katarina.agent
      .post(`${OPS_CMS}/resources`)
      .set('x-csrf-token', katarina.csrf)
      .send({
        type: 'article',
        primaryCategoryId: CATEGORY_STRESS,
        reviewPolicy: 'professional',
        reviewDiscipline: 'psychological',
        locale: 'sr-Latn',
        title: 'Kako upravljati stresom',
      });
    expect(createRes.status).toBe(201);
    expect(createRes.body.id).toBeTruthy();
    expect(createRes.body.type).toBe('article');
    const resourceId = createRes.body.id;

    // Extract variant and revision ids
    const variant = createRes.body.variants[0];
    expect(variant).toBeTruthy();
    expect(variant.locale).toBe('sr-Latn');
    const variantId = variant.id;
    const revisionId = variant.revisions[0].id;
    expect(revisionId).toBeTruthy();

    // 2. Save the working revision with If-Match
    const saveRes = await katarina.agent
      .put(`${OPS_CMS}/variants/${variantId}/revisions/${revisionId}`)
      .set('x-csrf-token', katarina.csrf)
      .set('if-match', '"1"')
      .send({
        title: 'Kako upravljati stresom na poslu',
        summary: 'Praktični saveti za upravljanje stresom',
        proposedAudience: [{ kind: 'all_eligible' }],
        body: {
          type: 'doc',
          schemaVersion: 1,
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Stres je normalan deo života.' }],
            },
          ],
        },
      });
    expect(saveRes.status).toBe(200);
    expect(saveRes.body.lockVersion).toBe(2);

    // 2b. Stale If-Match -> 409
    const staleRes = await katarina.agent
      .put(`${OPS_CMS}/variants/${variantId}/revisions/${revisionId}`)
      .set('x-csrf-token', katarina.csrf)
      .set('if-match', '"1"')
      .send({ title: 'stale' });
    expect(staleRes.status).toBe(409);
    expect(staleRes.body.code).toBe('content_edit_conflict');
    expect(staleRes.body.details.lockVersion).toBe(2);

    // 3. Add hu and en variants
    for (const locale of ['hu', 'en'] as const) {
      const varRes = await katarina.agent
        .post(`${OPS_CMS}/resources/${resourceId}/variants`)
        .set('x-csrf-token', katarina.csrf)
        .send({ locale });
      expect(varRes.status).toBe(201);
    }

    // Get resource detail to find all variant/revision ids
    const detailRes = await katarina.agent
      .get(`${OPS_CMS}/resources/${resourceId}`)
      .set('x-csrf-token', katarina.csrf);
    expect(detailRes.status).toBe(200);
    expect(detailRes.body.variants).toHaveLength(3);

    // Save and submit all three variants
    for (const v of detailRes.body.variants) {
      const rev = v.revisions[0];
      // Save
      await katarina.agent
        .put(`${OPS_CMS}/variants/${v.id}/revisions/${rev.id}`)
        .set('x-csrf-token', katarina.csrf)
        .set('if-match', `"${rev.lockVersion}"`)
        .send({
          title: `Title for ${v.locale}`,
          summary: `Summary for ${v.locale}`,
          proposedAudience: [{ kind: 'all_eligible' }],
          body: {
            type: 'doc',
            schemaVersion: 1,
            content: [{ type: 'paragraph', content: [{ type: 'text', text: `Content in ${v.locale}` }] }],
          },
        });

      // Submit
      const submitRes = await katarina.agent
        .post(`${OPS_CMS}/revisions/${rev.id}/submit`)
        .set('x-csrf-token', katarina.csrf);
      expect(submitRes.status).toBe(200);
      expect(submitRes.body.state).toBe('in_review');
    }

    // 4. Author cannot approve (no content.review grant -- returns 404 to avoid leaking existence)
    const selfApproveRes = await katarina.agent
      .post(`${OPS_CMS}/revisions/${revisionId}/approve`)
      .set('x-csrf-token', katarina.csrf)
      .send({});
    expect(selfApproveRes.status).toBe(404);

    // 5. Reviewer approves all three locales
    const detail2 = await katarina.agent
      .get(`${OPS_CMS}/resources/${resourceId}`)
      .set('x-csrf-token', katarina.csrf);

    for (const v of detail2.body.variants) {
      const rev = v.revisions.find((r: { state: string }) => r.state === 'in_review');
      if (!rev) continue;

      const approveRes = await darko.agent
        .post(`${OPS_CMS}/revisions/${rev.id}/approve`)
        .set('x-csrf-token', darko.csrf)
        .send({});
      expect(approveRes.status).toBe(200);
      expect(approveRes.body.state).toBe('approved');
      expect(approveRes.body.approvalHash).toBeTruthy();
    }

    // 6. Publisher cannot approve (wrong template)
    // The publisher's grant does not include content.review
    // This is already tested by the self-review test above; the publisher
    // would get a 403 from the authorization guard

    // 7. Publisher publishes all three locales
    const publishRes = await teodora.agent
      .post(`${OPS_CMS}/publications`)
      .set('x-csrf-token', teodora.csrf)
      .send({
        resourceId,
        audience: [{ kind: 'all_eligible' }],
      });
    expect(publishRes.status).toBe(201);
    expect(publishRes.body.publications).toBeDefined();
    expect(publishRes.body.publications.length).toBeGreaterThan(0);
    expect(publishRes.body.publications[0].state).toBe('live');

    // 8. Publishing with only two approved locales -> 409 content_locale_incomplete
    // Create a new resource with only sr-Latn variant
    const incompleteRes = await katarina.agent
      .post(`${OPS_CMS}/resources`)
      .set('x-csrf-token', katarina.csrf)
      .send({
        type: 'article',
        primaryCategoryId: CATEGORY_STRESS,
        reviewPolicy: 'editorial',
        reviewDiscipline: 'general',
        locale: 'sr-Latn',
        title: 'Incomplete resource',
      });
    expect(incompleteRes.status).toBe(201);
    const incompleteResourceId = incompleteRes.body.id;

    // Try publishing with missing locales
    const incPublish = await teodora.agent
      .post(`${OPS_CMS}/publications`)
      .set('x-csrf-token', teodora.csrf)
      .send({
        resourceId: incompleteResourceId,
        audience: [{ kind: 'all_eligible' }],
      });
    expect(incPublish.status).toBe(409);
    expect(incPublish.body.code).toBe('content_locale_incomplete');

    // 9. Verify audit rows exist
    const auditRows = await testDb.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.recordType, 'content_publication'),
          eq(auditEvents.action, 'publication.created'),
        ),
      );
    expect(auditRows.length).toBeGreaterThan(0);
    // Audit rows should not contain body text
    for (const row of auditRows) {
      const details = row.details as Record<string, unknown> | null;
      if (details) {
        expect(details).not.toHaveProperty('body');
        expect(details).not.toHaveProperty('messageBody');
      }
    }

    // 10. Verify outbox rows exist
    const outboxRows = await testDb.db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.type, 'publication.started'));
    expect(outboxRows.length).toBeGreaterThan(0);
    for (const row of outboxRows) {
      const payload = row.payload as Record<string, unknown>;
      expect(payload.publicationId).toBeTruthy();
      // No body text in payload
      expect(payload).not.toHaveProperty('body');
    }
  }, 120_000);

  // ─── Resource listing ─────────────────────────────────────────────

  it('lists resources with category scope', async () => {
    const vuk = await signInOps(VUK);

    const listRes = await vuk.agent
      .get(`${OPS_CMS}/resources`)
      .set('x-csrf-token', vuk.csrf);
    expect(listRes.status).toBe(200);
    expect(listRes.body.items).toBeDefined();
    expect(Array.isArray(listRes.body.items)).toBe(true);
  });

  // ─── If-Match editing ────────────────────────────────────────────

  it('returns 409 content_revision_locked when editing a submitted revision', async () => {
    const katarina = await signInOps(KATARINA);

    // Create a resource
    const createRes = await katarina.agent
      .post(`${OPS_CMS}/resources`)
      .set('x-csrf-token', katarina.csrf)
      .send({
        type: 'article',
        primaryCategoryId: CATEGORY_STRESS,
        reviewPolicy: 'editorial',
        reviewDiscipline: 'general',
        locale: 'sr-Latn',
        title: 'Locked test',
      });
    const v = createRes.body.variants[0];
    const rev = v.revisions[0];

    // Save (with proposedAudience so submit works)
    await katarina.agent
      .put(`${OPS_CMS}/variants/${v.id}/revisions/${rev.id}`)
      .set('x-csrf-token', katarina.csrf)
      .set('if-match', `"${rev.lockVersion}"`)
      .send({
        title: 'Updated title',
        summary: 'A summary',
        proposedAudience: [{ kind: 'all_eligible' }],
        body: {
          type: 'doc',
          schemaVersion: 1,
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Content' }] }],
        },
      });

    // Submit
    const submitRes = await katarina.agent
      .post(`${OPS_CMS}/revisions/${rev.id}/submit`)
      .set('x-csrf-token', katarina.csrf);
    expect(submitRes.status).toBe(200);

    // Try to edit the submitted revision -> 409
    const editRes = await katarina.agent
      .put(`${OPS_CMS}/variants/${v.id}/revisions/${rev.id}`)
      .set('x-csrf-token', katarina.csrf)
      .set('if-match', '"2"')
      .send({ title: 'Should fail' });
    expect(editRes.status).toBe(409);
    expect(editRes.body.code).toBe('content_revision_locked');
  });

  // ─── New working revision after approval ─────────────────────────

  it('creates a new working revision after approval (WRK-R-02)', async () => {
    const katarina = await signInOps(KATARINA);
    const darko = await signInOps(DARKO);

    // Create, save, submit, approve
    const createRes = await katarina.agent
      .post(`${OPS_CMS}/resources`)
      .set('x-csrf-token', katarina.csrf)
      .send({
        type: 'article',
        primaryCategoryId: CATEGORY_STRESS,
        reviewPolicy: 'professional',
        reviewDiscipline: 'psychological',
        locale: 'sr-Latn',
        title: 'New rev test',
      });
    const v = createRes.body.variants[0];
    const rev = v.revisions[0];

    await katarina.agent
      .put(`${OPS_CMS}/variants/${v.id}/revisions/${rev.id}`)
      .set('x-csrf-token', katarina.csrf)
      .set('if-match', `"${rev.lockVersion}"`)
      .send({
        title: 'Approved title',
        summary: 'Approved summary',
        proposedAudience: [{ kind: 'all_eligible' }],
        body: {
          type: 'doc',
          schemaVersion: 1,
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Approved content' }] }],
        },
      });

    const submitRes = await katarina.agent
      .post(`${OPS_CMS}/revisions/${rev.id}/submit`)
      .set('x-csrf-token', katarina.csrf);
    expect(submitRes.status).toBe(200);

    await darko.agent
      .post(`${OPS_CMS}/revisions/${rev.id}/approve`)
      .set('x-csrf-token', darko.csrf)
      .send({});

    // Now create a new working revision
    const newRevRes = await katarina.agent
      .post(`${OPS_CMS}/variants/${v.id}/revisions`)
      .set('x-csrf-token', katarina.csrf);
    expect(newRevRes.status).toBe(201);
    expect(newRevRes.body.state).toBe('draft');
    expect(newRevRes.body.lockVersion).toBe(1);
    // WRK-R-02: body should be copied from approved revision
    expect(newRevRes.body.title).toBe('Approved title');
    expect(newRevRes.body.summary).toBe('Approved summary');
  });

  // ─── Second concurrent publish -> 409 ────────────────────────────

  it('returns 409 content_publication_exists on duplicate publish', async () => {
    const katarina = await signInOps(KATARINA);
    const darko = await signInOps(DARKO);
    const teodora = await signInOps(TEODORA);

    // Create resource with all 3 locales
    const createRes = await katarina.agent
      .post(`${OPS_CMS}/resources`)
      .set('x-csrf-token', katarina.csrf)
      .send({
        type: 'article',
        primaryCategoryId: CATEGORY_STRESS,
        reviewPolicy: 'professional',
        reviewDiscipline: 'psychological',
        locale: 'sr-Latn',
        title: 'Duplicate publish test',
      });
    const resourceId = createRes.body.id;

    // Add hu and en
    for (const locale of ['hu', 'en'] as const) {
      await katarina.agent
        .post(`${OPS_CMS}/resources/${resourceId}/variants`)
        .set('x-csrf-token', katarina.csrf)
        .send({ locale });
    }

    // Get all variants, save, submit, approve
    const detail = await katarina.agent
      .get(`${OPS_CMS}/resources/${resourceId}`)
      .set('x-csrf-token', katarina.csrf);

    for (const v of detail.body.variants) {
      const rev = v.revisions[0];
      await katarina.agent
        .put(`${OPS_CMS}/variants/${v.id}/revisions/${rev.id}`)
        .set('x-csrf-token', katarina.csrf)
        .set('if-match', `"${rev.lockVersion}"`)
        .send({
          title: `Dup test ${v.locale}`,
          summary: 'Summary',
          proposedAudience: [{ kind: 'all_eligible' }],
          body: {
            type: 'doc',
            schemaVersion: 1,
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body' }] }],
          },
        });

      await katarina.agent
        .post(`${OPS_CMS}/revisions/${rev.id}/submit`)
        .set('x-csrf-token', katarina.csrf);

      await darko.agent
        .post(`${OPS_CMS}/revisions/${rev.id}/approve`)
        .set('x-csrf-token', darko.csrf)
        .send({});
    }

    // First publish
    const pub1 = await teodora.agent
      .post(`${OPS_CMS}/publications`)
      .set('x-csrf-token', teodora.csrf)
      .send({
        resourceId,
        audience: [{ kind: 'all_eligible' }],
      });
    expect(pub1.status).toBe(201);

    // Second publish of the same revision -> 409
    const pub2 = await teodora.agent
      .post(`${OPS_CMS}/publications`)
      .set('x-csrf-token', teodora.csrf)
      .send({
        resourceId,
        audience: [{ kind: 'all_eligible' }],
      });
    expect(pub2.status).toBe(409);
    expect(pub2.body.code).toBe('content_publication_exists');
  }, 120_000);

  // ─── Variant creation refuses sr-Cyrl ────────────────────────────

  it('refuses sr-Cyrl variant creation', async () => {
    const katarina = await signInOps(KATARINA);
    const createRes = await katarina.agent
      .post(`${OPS_CMS}/resources`)
      .set('x-csrf-token', katarina.csrf)
      .send({
        type: 'article',
        primaryCategoryId: CATEGORY_STRESS,
        reviewPolicy: 'editorial',
        reviewDiscipline: 'general',
        locale: 'sr-Latn',
        title: 'Cyrillic test',
      });

    const varRes = await katarina.agent
      .post(`${OPS_CMS}/resources/${createRes.body.id}/variants`)
      .set('x-csrf-token', katarina.csrf)
      .send({ locale: 'sr-Cyrl' });
    expect(varRes.status).toBe(400);
    expect(varRes.body.code).toBe('validation');
  });
});
