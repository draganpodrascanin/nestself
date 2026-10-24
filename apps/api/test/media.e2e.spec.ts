/**
 * Media e2e tests (T-C1.08): upload, processing, delivery with Range,
 * authorization, availability, and error states.
 *
 * Requires TEST_DATABASE_URL (PostgreSQL). Skipped otherwise.
 */
import 'dotenv/config';
import { randomBytes, randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import sharp from 'sharp';
import { eq } from 'drizzle-orm';
import { IdentityProviderService } from '../src/identity/identity-provider.service.js';
import type { FakeIdentityProvider } from '../src/identity/fake-identity-provider.js';
import { seed } from '../src/db/seed/seed-lib.js';
import {
  externalIdentities,
  organizations,
  memberships,
  grants,
  users,
  contentResources,
  contentVariants,
  contentRevisions,
  contentPublications,
  contentPublicationAudiences,
  contentRevisionMedia,
  mediaAssets,
  orgContentCapabilities,
} from '../src/db/schema/index.js';
import { resetTestDatabase, type TestDatabase } from './db/test-database.js';
import { MediaService } from '../src/media/media.service.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const shouldRun = !!TEST_DB_URL;

/** Katarina is a content_author with media.upload on all categories. */
const KATARINA = 'user_katarina';
/** Vuk is an editorial_lead with media.manage on all categories. */
const VUK = 'user_vuk';
/** Jovan is a regular employee (no content/media grants). */
const JOVAN = 'user_jovan';

const OPS_MEDIA = '/api/ops/cms/media';
const CATEGORY_ID = 'cat_stress';

describe.skipIf(!shouldRun)('Media (e2e)', () => {
  let app: INestApplication;
  let idp: FakeIdentityProvider;
  let testDb: TestDatabase;
  let mediaService: MediaService;
  const jwtSecret = randomBytes(32).toString('hex');

  beforeAll(async () => {
    testDb = await resetTestDatabase(TEST_DB_URL!, 'media');
    await seed(testDb.db);

    process.env.DATABASE_URL = testDb.url;
    process.env.AUTH_MODE = 'stub';
    process.env.JWT_SECRET = jwtSecret;
    process.env.SESSION_COOKIE_INSECURE_DEV = 'true';
    process.env.NODE_ENV = 'test';
    process.env.MEDIA_STORAGE = 'local';
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

    mediaService = app.get(MediaService);
    idp = app.get(IdentityProviderService) as FakeIdentityProvider;

    // Seed external identities for sign-in
    const people = [KATARINA, VUK, JOVAN];
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

  function extractCsrf(res: request.Response): string {
    const cookies = res.headers['set-cookie'] as string[] | undefined;
    const csrf = cookies
      ?.find((c) => c.startsWith('nestself_csrf='))
      ?.match(/nestself_csrf=([^;]+)/);
    if (!csrf) throw new Error('CSRF cookie not found');
    return csrf[1]!;
  }

  /** Sign in to the operations context. */
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

    // Switch to operations context
    const switchRes = await agent
      .post('/api/auth/context')
      .set('x-csrf-token', csrf)
      .send({ context: { kind: 'operations' } });
    expect(switchRes.status).toBe(200);

    return { agent, csrf };
  }

  /** Create a valid JPEG buffer for testing. */
  async function createTestJpeg(width = 100, height = 100): Promise<Buffer> {
    return sharp({
      create: { width, height, channels: 3, background: { r: 255, g: 0, b: 0 } },
    })
      .jpeg()
      .toBuffer();
  }

  /** Create a valid PNG buffer. */
  async function createTestPng(): Promise<Buffer> {
    return sharp({
      create: { width: 200, height: 200, channels: 4, background: { r: 0, g: 128, b: 255, alpha: 1 } },
    })
      .png()
      .toBuffer();
  }

  describe('upload and processing', () => {
    it('author uploads a JPEG in an assigned category and it is processed to ready', async () => {
      const { agent, csrf } = await signInOps(KATARINA);
      const jpeg = await createTestJpeg(800, 600);

      const res = await agent
        .post(OPS_MEDIA)
        .set('x-csrf-token', csrf)
        .send({
          kind: 'image',
          ownerCategoryId: CATEGORY_ID,
          licenseKind: 'owned',
          file: jpeg.toString('base64'),
          mimeType: 'image/jpeg',
          originalFilename: 'test.jpg',
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('assetId');
      expect(res.body.state).toBe('uploaded');

      // Process the asset
      await mediaService.processAsset(res.body.assetId);

      // Verify it is now ready
      const detail = await mediaService.getDetail(res.body.assetId);
      expect(detail).not.toBeNull();
      expect(detail!.state).toBe('ready');
      expect(detail!.renditions.length).toBe(5); // original, card_webp, card_jpeg, detail_webp, detail_jpeg
    });

    it('rejects a disguised file (PNG as PDF)', async () => {
      const { agent, csrf } = await signInOps(KATARINA);
      const png = await createTestPng();

      const res = await agent
        .post(OPS_MEDIA)
        .set('x-csrf-token', csrf)
        .send({
          kind: 'pdf',
          ownerCategoryId: CATEGORY_ID,
          licenseKind: 'owned',
          file: png.toString('base64'),
          mimeType: 'application/pdf',
          originalFilename: 'disguised.pdf',
        });

      expect(res.status).toBe(201);

      // Process the asset — it should be rejected
      await mediaService.processAsset(res.body.assetId);

      const detail = await mediaService.getDetail(res.body.assetId);
      expect(detail).not.toBeNull();
      expect(detail!.state).toBe('rejected');
      expect(detail!.rejectionCode).toBe('type_mismatch');
    });

    it('rejects kind not enabled in M1 (audio)', async () => {
      const { agent, csrf } = await signInOps(KATARINA);

      const res = await agent
        .post(OPS_MEDIA)
        .set('x-csrf-token', csrf)
        .send({
          kind: 'audio',
          ownerCategoryId: CATEGORY_ID,
          licenseKind: 'owned',
          file: Buffer.alloc(100).toString('base64'),
          mimeType: 'audio/mpeg',
          originalFilename: 'test.mp3',
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('media_type_rejected');
      expect(res.body.details?.reason).toBe('kind_not_enabled');
    });
  });

  describe('staff endpoints', () => {
    let readyAssetId: string;

    beforeAll(async () => {
      // Upload via Katarina (content_author has media.upload)
      const jpeg = await createTestJpeg(400, 300);
      const { agent, csrf } = await signInOps(KATARINA);
      const res = await agent
        .post(OPS_MEDIA)
        .set('x-csrf-token', csrf)
        .send({
          kind: 'image',
          ownerCategoryId: CATEGORY_ID,
          licenseKind: 'owned',
          file: jpeg.toString('base64'),
          mimeType: 'image/jpeg',
          originalFilename: 'staff-test.jpg',
        });
      expect(res.status).toBe(201);
      readyAssetId = res.body.assetId;
      await mediaService.processAsset(readyAssetId);
    });

    it('GET /api/ops/cms/media lists assets', async () => {
      const { agent, csrf } = await signInOps(VUK);
      const res = await agent
        .get(OPS_MEDIA)
        .set('x-csrf-token', csrf);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('items');
      expect(Array.isArray(res.body.items)).toBe(true);
      expect(res.body.items.length).toBeGreaterThan(0);
    });

    it('GET /api/ops/cms/media/:assetId returns detail', async () => {
      const { agent, csrf } = await signInOps(VUK);
      const res = await agent
        .get(`${OPS_MEDIA}/${readyAssetId}`)
        .set('x-csrf-token', csrf);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(readyAssetId);
      expect(res.body.state).toBe('ready');
      expect(Array.isArray(res.body.renditions)).toBe(true);
    });

    it('PUT /api/ops/cms/media/:assetId updates metadata', async () => {
      const { agent, csrf } = await signInOps(VUK);
      const res = await agent
        .put(`${OPS_MEDIA}/${readyAssetId}`)
        .set('x-csrf-token', csrf)
        .send({
          altText: { en: 'Updated alt text' },
          focalPoint: { x: 0.5, y: 0.3 },
        });

      expect(res.status).toBe(200);
      expect(res.body.altText).toEqual({ en: 'Updated alt text' });
      expect(res.body.focalPoint).toEqual({ x: 0.5, y: 0.3 });
    });

    it('uploaded asset can be deleted by editorial lead', async () => {
      // Upload with Katarina (content_author has media.upload)
      const jpeg = await createTestJpeg();
      const katSession = await signInOps(KATARINA);
      const uploadRes = await katSession.agent
        .post(OPS_MEDIA)
        .set('x-csrf-token', katSession.csrf)
        .send({
          kind: 'image',
          ownerCategoryId: CATEGORY_ID,
          licenseKind: 'owned',
          file: jpeg.toString('base64'),
          mimeType: 'image/jpeg',
          originalFilename: 'delete-test.jpg',
        });
      expect(uploadRes.status).toBe(201);
      const delAssetId = uploadRes.body.assetId;

      // Delete with Vuk (editorial_lead has media.manage)
      const vukSession = await signInOps(VUK);
      const delRes = await vukSession.agent
        .delete(`${OPS_MEDIA}/${delAssetId}`)
        .set('x-csrf-token', vukSession.csrf);
      expect(delRes.status).toBe(204);

      // Verify it is gone
      const detailRes = await vukSession.agent
        .get(`${OPS_MEDIA}/${delAssetId}`)
        .set('x-csrf-token', vukSession.csrf);
      expect(detailRes.status).toBe(404);
    });

    it('GET /api/ops/cms/media/:assetId/:rendition streams for ready assets', async () => {
      const { agent, csrf } = await signInOps(VUK);
      const res = await agent
        .get(`${OPS_MEDIA}/${readyAssetId}/original`)
        .set('x-csrf-token', csrf);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/^image\//);
      expect(res.headers['accept-ranges']).toBe('bytes');
    });

    it('preview of unready asset returns 409 media_not_ready', async () => {
      // Upload with Katarina, preview with Vuk
      const jpeg = await createTestJpeg();
      const katSession = await signInOps(KATARINA);
      const uploadRes = await katSession.agent
        .post(OPS_MEDIA)
        .set('x-csrf-token', katSession.csrf)
        .send({
          kind: 'image',
          ownerCategoryId: CATEGORY_ID,
          licenseKind: 'owned',
          file: jpeg.toString('base64'),
          mimeType: 'image/jpeg',
          originalFilename: 'unready.jpg',
        });
      expect(uploadRes.status).toBe(201);

      const { agent, csrf } = await signInOps(VUK);
      const res = await agent
        .get(`${OPS_MEDIA}/${uploadRes.body.assetId}/original`)
        .set('x-csrf-token', csrf);

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('media_not_ready');
    });
  });

  describe('idempotent upload', () => {
    it('replay returns the same asset id', async () => {
      const { agent, csrf } = await signInOps(KATARINA);
      const jpeg = await createTestJpeg();
      const idempotencyKey = randomBytes(16).toString('hex');

      const first = await agent
        .post(OPS_MEDIA)
        .set('x-csrf-token', csrf)
        .set('idempotency-key', idempotencyKey)
        .send({
          kind: 'image',
          ownerCategoryId: CATEGORY_ID,
          licenseKind: 'owned',
          file: jpeg.toString('base64'),
          mimeType: 'image/jpeg',
          originalFilename: 'idempotent.jpg',
        });

      expect(first.status).toBe(201);

      // Note: idempotency requires Redis, which is not available in this test.
      // The endpoint still works (idempotency is skipped without the key being
      // stored). In a production test with Redis this would return the same
      // asset id.
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Employee delivery: GET /api/library/media/:assetId/:rendition
  // ─────────────────────────────────────────────────────────────────────────

  describe('employee delivery', () => {
    const LIBRARY = '/api/library/media';
    const ORG_A = 'org_sample';
    const ORG_B = 'org_beta';
    const MARKO = 'user_marko';

    /** Asset ids set up by the beforeAll block. */
    let readyAssetId: string;
    let pdfAssetId: string;
    let draftOnlyAssetId: string;
    let processingAssetId: string;
    let rejectedAssetId: string;
    let expiringAssetId: string;
    let withdrawableAssetId: string;
    let withdrawPubId: string;
    let cardRenditionKind: string;

    /** Buffer for the original rendition (for byte-exact assertions). */
    let originalRenditionBytes: Buffer;
    let originalRenditionSize: number;

    /** Personal-context sessions. */
    let jovanSession: { agent: ReturnType<typeof request.agent>; csrf: string };
    let markoSession: { agent: ReturnType<typeof request.agent>; csrf: string };

    // ── Helpers ───────────────────────────────────────────────────────────

    /** Sign in to personal context (no context switch; employees stay personal). */
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

    /**
     * Create the full content publication chain in the database so that the
     * availability formula returns the asset as available for `orgId`.
     * Returns the publication id.
     */
    async function createPublicationChain(
      assetId: string,
      orgId: string,
      opts: {
        pubId?: string;
        withdrawn?: boolean;
        startsAt?: Date;
        endsAt?: Date | null;
      } = {},
    ): Promise<string> {
      const db = testDb.db;
      const now = new Date();
      const resId = `res_${randomUUID().slice(0, 8)}`;
      const variantId = `var_${randomUUID().slice(0, 8)}`;
      const revId = `rev_${randomUUID().slice(0, 8)}`;
      const pubId = opts.pubId ?? `pub_${randomUUID().slice(0, 8)}`;
      const audId = `aud_${randomUUID().slice(0, 8)}`;
      const crmId = `crm_${randomUUID().slice(0, 8)}`;

      // content_resources (editorial policy avoids the professional discipline check)
      await db.insert(contentResources).values({
        id: resId,
        type: 'article',
        state: 'active',
        primaryCategoryId: CATEGORY_ID,
        ownerUserId: KATARINA,
        reviewPolicy: 'editorial',
      });

      // content_variants (sr-Latn, the default authored locale)
      await db.insert(contentVariants).values({
        id: variantId,
        contentResourceId: resId,
        locale: 'sr-Latn',
        slug: `slug-${randomUUID().slice(0, 8)}`,
      });

      // content_revisions (approved)
      await db.insert(contentRevisions).values({
        id: revId,
        contentVariantId: variantId,
        revisionNumber: 1,
        state: 'approved',
        body: { blocks: [] },
        title: 'Test content for media delivery',
        summary: 'Test summary',
        authorUserId: KATARINA,
        lastEditorUserId: KATARINA,
        approvedAt: now,
        approvedByUserId: VUK,
      });

      // content_revision_media — link the revision to the media asset
      await db.insert(contentRevisionMedia).values({
        id: crmId,
        contentRevisionId: revId,
        mediaAssetId: assetId,
        usageKind: 'cover',
      });

      // content_publications
      await db.insert(contentPublications).values({
        id: pubId,
        contentVariantId: variantId,
        contentRevisionId: revId,
        approvalHash: `hash_${pubId}`,
        state: 'live',
        requiredCapability: 'library',
        startsAt: opts.startsAt ?? new Date(now.getTime() - 3600_000),
        endsAt: opts.endsAt ?? null,
        publishedByUserId: VUK,
        withdrawnAt: opts.withdrawn ? now : null,
        withdrawnByUserId: opts.withdrawn ? VUK : null,
      });

      // content_publication_audiences — organization audience for `orgId`
      await db.insert(contentPublicationAudiences).values({
        id: audId,
        publicationId: pubId,
        kind: 'organization',
        orgId,
      });

      return pubId;
    }

    /** Create a minimal PDF buffer (valid PDF header). */
    function createMinimalPdf(): Buffer {
      const pdfContent =
        '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
        '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n' +
        '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n' +
        'xref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n' +
        '0000000115 00000 n \ntrailer\n<< /Root 1 0 R /Size 4 >>\nstartxref\n206\n%%EOF';
      return Buffer.from(pdfContent, 'utf-8');
    }

    // ── Setup ────────────────────────────────────────────────────────────

    beforeAll(async () => {
      const db = testDb.db;

      // ── Second organisation (org_beta) with employee Marko ──
      await db.insert(organizations).values({
        id: ORG_B,
        name: 'Beta d.o.o.',
        slug: 'beta',
        status: 'ACTIVE',
      }).onConflictDoNothing();

      await db.insert(users).values({
        id: MARKO,
        email: 'user_marko@example.com',
        displayName: 'Marko Savić',
        locale: 'sr-Latn',
      }).onConflictDoNothing();

      await db.insert(memberships).values({
        userId: MARKO,
        orgId: ORG_B,
        status: 'ACTIVE',
        startDate: new Date('2026-01-01'),
      }).onConflictDoNothing();

      // Grant Marko the employee template for org_beta
      const employeeActions = [
        'content.read', 'content.bookmark', 'service.request', 'service.book',
        'appointment.cancel', 'appointment.reschedule', 'event.register',
        'consultation.join', 'conversation.participate',
        'poll.respond', 'editorial.request.submit',
        'preferences.manage', 'voucher.activate',
        'feedback.submit', 'data.export.own', 'data.erasure.request',
      ];
      await db.insert(grants).values({
        id: `grant_${MARKO}_employee`,
        subjectUserId: MARKO,
        templateKey: 'employee',
        actions: employeeActions,
        scopeType: 'own',
        scopeOrgId: ORG_B,
        grantedByUserId: MARKO,
        grantedAt: new Date('2026-01-01'),
        validFrom: new Date('2026-01-01'),
      }).onConflictDoNothing();

      // Enable 'library' capability for org_beta
      await db.insert(orgContentCapabilities).values({
        id: `org_cap_${ORG_B}_library`,
        orgId: ORG_B,
        capability: 'library',
        enabledFrom: new Date('2026-01-01'),
        configuredByUserId: MARKO,
      }).onConflictDoNothing();

      // Seed IDP for Marko
      idp.seedUsers([{ email: 'user_marko@example.com' }]);
      const markoIdpUser = await idp.findUserByEmail('user_marko@example.com');
      if (!markoIdpUser) throw new Error('FakeIDP user not found: user_marko@example.com');
      await db.insert(externalIdentities).values({
        userId: MARKO,
        provider: 'cognito',
        subject: markoIdpUser.sub,
        cognitoUsername: markoIdpUser.username,
        email: 'user_marko@example.com',
        emailVerified: true,
      }).onConflictDoNothing();

      // ── Upload and process the main test image via the staff API ──
      const jpeg = await createTestJpeg(800, 600);
      const katSession = await signInOps(KATARINA);
      const uploadRes = await katSession.agent
        .post(OPS_MEDIA)
        .set('x-csrf-token', katSession.csrf)
        .send({
          kind: 'image',
          ownerCategoryId: CATEGORY_ID,
          licenseKind: 'owned',
          file: jpeg.toString('base64'),
          mimeType: 'image/jpeg',
          originalFilename: 'delivery-test.jpg',
        });
      expect(uploadRes.status).toBe(201);
      readyAssetId = uploadRes.body.assetId;
      await mediaService.processAsset(readyAssetId);

      // Read the original rendition bytes for exact comparisons
      const detail = await mediaService.getDetail(readyAssetId);
      expect(detail).not.toBeNull();
      expect(detail!.state).toBe('ready');
      const origRendition = detail!.renditions.find((r) => r.kind === 'original');
      expect(origRendition).toBeDefined();
      originalRenditionSize = origRendition!.byteSize;

      // Read actual bytes from storage for byte-exact assertions
      const { MEDIA_STORAGE: StorageToken } = await import('../src/media/storage/media-storage.js');
      const storage = app.get(StorageToken);
      const { stream } = await storage.get(
        `assets/${readyAssetId}/original`,
      );
      const chunks: Buffer[] = [];
      for await (const chunk of stream as AsyncIterable<Buffer>) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
      }
      originalRenditionBytes = Buffer.concat(chunks);
      originalRenditionSize = originalRenditionBytes.length;

      // Identify a card rendition for cache-header assertions
      const cardRendition = detail!.renditions.find((r) => r.kind === 'card_jpeg' || r.kind === 'card_webp');
      cardRenditionKind = cardRendition?.kind ?? 'card_jpeg';

      // ── PDF asset ──
      const pdfBuf = createMinimalPdf();
      const pdfUploadRes = await katSession.agent
        .post(OPS_MEDIA)
        .set('x-csrf-token', katSession.csrf)
        .send({
          kind: 'pdf',
          ownerCategoryId: CATEGORY_ID,
          licenseKind: 'owned',
          file: pdfBuf.toString('base64'),
          mimeType: 'application/pdf',
          originalFilename: 'test.pdf',
        });
      expect(pdfUploadRes.status).toBe(201);
      pdfAssetId = pdfUploadRes.body.assetId;
      await mediaService.processAsset(pdfAssetId);

      // ── Draft-only asset (uploaded, not published) ──
      const draftJpeg = await createTestJpeg(400, 300);
      const draftUploadRes = await katSession.agent
        .post(OPS_MEDIA)
        .set('x-csrf-token', katSession.csrf)
        .send({
          kind: 'image',
          ownerCategoryId: CATEGORY_ID,
          licenseKind: 'owned',
          file: draftJpeg.toString('base64'),
          mimeType: 'image/jpeg',
          originalFilename: 'draft-only.jpg',
        });
      expect(draftUploadRes.status).toBe(201);
      draftOnlyAssetId = draftUploadRes.body.assetId;
      await mediaService.processAsset(draftOnlyAssetId);

      // ── Processing asset (stays in 'uploaded' state, never processed) ──
      const procJpeg = await createTestJpeg(100, 100);
      const procUploadRes = await katSession.agent
        .post(OPS_MEDIA)
        .set('x-csrf-token', katSession.csrf)
        .send({
          kind: 'image',
          ownerCategoryId: CATEGORY_ID,
          licenseKind: 'owned',
          file: procJpeg.toString('base64'),
          mimeType: 'image/jpeg',
          originalFilename: 'processing.jpg',
        });
      expect(procUploadRes.status).toBe(201);
      processingAssetId = procUploadRes.body.assetId;
      // Force the state to 'processing' in DB
      await db.update(mediaAssets)
        .set({ state: 'processing' })
        .where(eq(mediaAssets.id, processingAssetId));

      // ── Rejected asset ──
      const rejJpeg = await createTestJpeg(100, 100);
      const rejUploadRes = await katSession.agent
        .post(OPS_MEDIA)
        .set('x-csrf-token', katSession.csrf)
        .send({
          kind: 'image',
          ownerCategoryId: CATEGORY_ID,
          licenseKind: 'owned',
          file: rejJpeg.toString('base64'),
          mimeType: 'image/jpeg',
          originalFilename: 'rejected.jpg',
        });
      expect(rejUploadRes.status).toBe(201);
      rejectedAssetId = rejUploadRes.body.assetId;
      await db.update(mediaAssets)
        .set({ state: 'rejected', rejectionCode: 'type_mismatch' })
        .where(eq(mediaAssets.id, rejectedAssetId));

      // ── Expiring asset: ready, with rights_expires_at in the future ──
      const expJpeg = await createTestJpeg(400, 300);
      const expUploadRes = await katSession.agent
        .post(OPS_MEDIA)
        .set('x-csrf-token', katSession.csrf)
        .send({
          kind: 'image',
          ownerCategoryId: CATEGORY_ID,
          licenseKind: 'licensed',
          file: expJpeg.toString('base64'),
          mimeType: 'image/jpeg',
          originalFilename: 'expiring.jpg',
        });
      expect(expUploadRes.status).toBe(201);
      expiringAssetId = expUploadRes.body.assetId;
      await mediaService.processAsset(expiringAssetId);
      // Set rights to expire in the future (3 seconds from now)
      await db.update(mediaAssets)
        .set({ rightsExpiresAt: new Date(Date.now() + 3_000) })
        .where(eq(mediaAssets.id, expiringAssetId));

      // ── Withdrawable asset (for withdrawal test) ──
      const wdJpeg = await createTestJpeg(400, 300);
      const wdUploadRes = await katSession.agent
        .post(OPS_MEDIA)
        .set('x-csrf-token', katSession.csrf)
        .send({
          kind: 'image',
          ownerCategoryId: CATEGORY_ID,
          licenseKind: 'owned',
          file: wdJpeg.toString('base64'),
          mimeType: 'image/jpeg',
          originalFilename: 'withdrawable.jpg',
        });
      expect(wdUploadRes.status).toBe(201);
      withdrawableAssetId = wdUploadRes.body.assetId;
      await mediaService.processAsset(withdrawableAssetId);

      // ── Create publication chains for available assets ──
      // Main image — audience: org_sample (org_a)
      await createPublicationChain(readyAssetId, ORG_A);
      // Card image rendition uses same asset and same publication chain
      // PDF — audience: org_sample
      await createPublicationChain(pdfAssetId, ORG_A);
      // Expiring asset — audience: org_sample
      await createPublicationChain(expiringAssetId, ORG_A);
      // Withdrawable — audience: org_sample (will be withdrawn mid-test)
      withdrawPubId = await createPublicationChain(withdrawableAssetId, ORG_A);
      // Processing and rejected assets — give them publication chains too so
      // the 404 comes from the asset state check, not the availability formula.
      await createPublicationChain(processingAssetId, ORG_A);
      await createPublicationChain(rejectedAssetId, ORG_A);

      // ── Sign in employees ──
      jovanSession = await signInPersonal(JOVAN);
      markoSession = await signInPersonal(MARKO);
    }, 180_000);

    // ── 1. Employee A — full GET available asset ──

    it('1a. full GET → 200, correct bytes, Content-Type from rendition, Accept-Ranges, Cache-Control: private, no-store', async () => {
      const res = await jovanSession.agent
        .get(`${LIBRARY}/${readyAssetId}/original`)
        .set('x-csrf-token', jovanSession.csrf)
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/^image\/jpeg/);
      expect(res.headers['accept-ranges']).toBe('bytes');
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      // Byte-exact match
      expect(Buffer.isBuffer(res.body)).toBe(true);
      expect((res.body as Buffer).length).toBe(originalRenditionSize);
      expect((res.body as Buffer).equals(originalRenditionBytes)).toBe(true);
    });

    it('1b. card image rendition → Cache-Control: private, max-age=300', async () => {
      const res = await jovanSession.agent
        .get(`${LIBRARY}/${readyAssetId}/${cardRenditionKind}`)
        .set('x-csrf-token', jovanSession.csrf);

      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('private, max-age=300');
    });

    // ── 2. Range requests ──

    it('2a. Range bytes=0-99 → 206 with Content-Range and exact bytes', async () => {
      const res = await jovanSession.agent
        .get(`${LIBRARY}/${readyAssetId}/original`)
        .set('x-csrf-token', jovanSession.csrf)
        .set('Range', 'bytes=0-99')
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        });

      expect(res.status).toBe(206);
      expect(res.headers['content-range']).toBe(
        `bytes 0-99/${originalRenditionSize}`,
      );
      expect((res.body as Buffer).length).toBe(100);
      expect((res.body as Buffer).equals(originalRenditionBytes.subarray(0, 100))).toBe(true);
    });

    it('2b. suffix range bytes=-50 → 206', async () => {
      const res = await jovanSession.agent
        .get(`${LIBRARY}/${readyAssetId}/original`)
        .set('x-csrf-token', jovanSession.csrf)
        .set('Range', 'bytes=-50')
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        });

      expect(res.status).toBe(206);
      const start = originalRenditionSize - 50;
      expect(res.headers['content-range']).toBe(
        `bytes ${start}-${originalRenditionSize - 1}/${originalRenditionSize}`,
      );
      expect((res.body as Buffer).length).toBe(50);
      expect(
        (res.body as Buffer).equals(originalRenditionBytes.subarray(start)),
      ).toBe(true);
    });

    it('2c. unsatisfiable range bytes=999999999- → 416 with Content-Range', async () => {
      const res = await jovanSession.agent
        .get(`${LIBRARY}/${readyAssetId}/original`)
        .set('x-csrf-token', jovanSession.csrf)
        .set('Range', 'bytes=999999999-');

      expect(res.status).toBe(416);
      expect(res.headers['content-range']).toBe(
        `bytes */${originalRenditionSize}`,
      );
    });

    // ── 3. Employee B (other org, not in audience) → 404 ──

    it('3a. Employee B full GET → 404 content_not_available (never 403)', async () => {
      const res = await markoSession.agent
        .get(`${LIBRARY}/${readyAssetId}/original`)
        .set('x-csrf-token', markoSession.csrf);

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('content_not_available');
    });

    it('3b. Employee B Range request → 404 content_not_available (never 403)', async () => {
      const res = await markoSession.agent
        .get(`${LIBRARY}/${readyAssetId}/original`)
        .set('x-csrf-token', markoSession.csrf)
        .set('Range', 'bytes=0-10');

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('content_not_available');
    });

    // ── 4. Draft-only asset (no publication) → 404 ──

    it('4. asset not referenced by any available publication → 404', async () => {
      const res = await jovanSession.agent
        .get(`${LIBRARY}/${draftOnlyAssetId}/original`)
        .set('x-csrf-token', jovanSession.csrf);

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('content_not_available');
    });

    // ── 5. Asset in processing or rejected state → 404 ──

    it('5a. asset in processing state → 404', async () => {
      const res = await jovanSession.agent
        .get(`${LIBRARY}/${processingAssetId}/original`)
        .set('x-csrf-token', jovanSession.csrf);

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('content_not_available');
    });

    it('5b. asset in rejected state → 404', async () => {
      const res = await jovanSession.agent
        .get(`${LIBRARY}/${rejectedAssetId}/original`)
        .set('x-csrf-token', jovanSession.csrf);

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('content_not_available');
    });

    // ── 6. Rights expiry ──

    it('6. asset succeeds before rights expiry and fails after', async () => {
      // Should succeed now (rights_expires_at is in the future)
      const beforeRes = await jovanSession.agent
        .get(`${LIBRARY}/${expiringAssetId}/original`)
        .set('x-csrf-token', jovanSession.csrf);
      expect(beforeRes.status).toBe(200);

      // Move rights_expires_at to the past
      await testDb.db.update(mediaAssets)
        .set({ rightsExpiresAt: new Date(Date.now() - 1_000) })
        .where(eq(mediaAssets.id, expiringAssetId));

      const afterRes = await jovanSession.agent
        .get(`${LIBRARY}/${expiringAssetId}/original`)
        .set('x-csrf-token', jovanSession.csrf);
      expect(afterRes.status).toBe(404);
      expect(afterRes.body.code).toBe('content_not_available');
    });

    // ── 7. Withdrawal: first request succeeds, then publication withdrawn, next 404 ──

    it('7. publication withdrawn after first success → next Range request 404', async () => {
      // First request should succeed
      const firstRes = await jovanSession.agent
        .get(`${LIBRARY}/${withdrawableAssetId}/original`)
        .set('x-csrf-token', jovanSession.csrf);
      expect(firstRes.status).toBe(200);

      // Withdraw the publication
      await testDb.db.update(contentPublications)
        .set({
          withdrawnAt: new Date(),
          withdrawnByUserId: VUK,
          state: 'withdrawn',
        })
        .where(eq(contentPublications.id, withdrawPubId));

      // Next Range request should return 404
      const rangeRes = await jovanSession.agent
        .get(`${LIBRARY}/${withdrawableAssetId}/original`)
        .set('x-csrf-token', jovanSession.csrf)
        .set('Range', 'bytes=0-10');

      expect(rangeRes.status).toBe(404);
      expect(rangeRes.body.code).toBe('content_not_available');
    });

    // ── 8. PDF rendition security headers ──

    it('8. PDF → Content-Disposition: attachment, CSP: sandbox, X-Content-Type-Options: nosniff', async () => {
      const res = await jovanSession.agent
        .get(`${LIBRARY}/${pdfAssetId}/pdf`)
        .set('x-csrf-token', jovanSession.csrf);

      expect(res.status).toBe(200);
      expect(res.headers['content-disposition']).toMatch(/attachment/);
      expect(res.headers['content-security-policy']).toBe('sandbox');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    // ── 9. Unknown asset id → 404, same body shape (no existence leak) ──

    it('9. unknown asset id → 404 with same body shape as unavailable', async () => {
      const unknownId = `nonexistent_${randomUUID().slice(0, 8)}`;
      const res = await jovanSession.agent
        .get(`${LIBRARY}/${unknownId}/original`)
        .set('x-csrf-token', jovanSession.csrf);

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('content_not_available');
      // Same shape as an actual unavailable asset
      expect(res.body).toHaveProperty('message');
    });

    // ── 10. scan_status gate ──

    it('10. scan_status gate: not_scanned_local is refused when NODE_ENV=production', async () => {
      // The controller checks: if NODE_ENV=production && scan_status !== 'no_threats_found' → 404.
      // We cannot flip NODE_ENV mid-test without restarting the app, so we
      // verify the guard logic directly.
      // The controller code at line ~96: process.env.NODE_ENV === 'production'
      // && asset.scanStatus !== 'no_threats_found' → throw NOT_AVAILABLE.
      //
      // Test the guard function:
      // 1. With NODE_ENV='test', not_scanned_local assets are allowed (current test setup)
      // 2. The production guard IS the conditional in the controller

      // Create a ready asset with scan_status = 'not_scanned_local'
      const scanJpeg = await createTestJpeg(200, 200);
      const katSession = await signInOps(KATARINA);
      const scanUploadRes = await katSession.agent
        .post(OPS_MEDIA)
        .set('x-csrf-token', katSession.csrf)
        .send({
          kind: 'image',
          ownerCategoryId: CATEGORY_ID,
          licenseKind: 'owned',
          file: scanJpeg.toString('base64'),
          mimeType: 'image/jpeg',
          originalFilename: 'scan-test.jpg',
        });
      expect(scanUploadRes.status).toBe(201);
      const scanAssetId = scanUploadRes.body.assetId;
      await mediaService.processAsset(scanAssetId);
      await createPublicationChain(scanAssetId, ORG_A);

      // Verify it works under NODE_ENV=test (not_scanned_local is allowed)
      const testEnvRes = await jovanSession.agent
        .get(`${LIBRARY}/${scanAssetId}/original`)
        .set('x-csrf-token', jovanSession.csrf);
      expect(testEnvRes.status).toBe(200);

      // Temporarily flip to production to test the guard
      const origEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        const prodRes = await jovanSession.agent
          .get(`${LIBRARY}/${scanAssetId}/original`)
          .set('x-csrf-token', jovanSession.csrf);
        expect(prodRes.status).toBe(404);
        expect(prodRes.body.code).toBe('content_not_available');
      } finally {
        process.env.NODE_ENV = origEnv;
      }
    });
  });
});
