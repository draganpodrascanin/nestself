/**
 * Media e2e tests (T-C1.08): streaming multipart upload, Content-Digest,
 * processing, delivery with Range, authorization, availability, scoped item
 * routes, and error states.
 *
 * Requires TEST_DATABASE_URL (PostgreSQL). Skipped otherwise.
 * MEDIA_LOCAL_DIR is set to a temp directory and cleaned up.
 */
import 'dotenv/config';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
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
import { MEDIA_STORAGE, type MediaStorage } from '../src/media/storage/media-storage.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const shouldRun = !!TEST_DB_URL;

/** Katarina is a content_author with media.upload on all categories. */
const KATARINA = 'user_katarina';
/** Vuk is an editorial_lead with media.manage on all categories. */
const VUK = 'user_vuk';
/** Jovan is a regular employee (no content/media grants). */
const JOVAN = 'user_jovan';

const UPLOAD_CAP_BYTES = 200 * 1024;

const OPS_MEDIA = '/api/ops/cms/media';
const CATEGORY_ID = 'cat_stress';

/** Compute Content-Digest header value per RFC 9530. */
function contentDigest(buf: Buffer): string {
  const sha = createHash('sha256').update(buf).digest('base64');
  return `sha-256=:${sha}:`;
}

describe.skipIf(!shouldRun)('Media (e2e)', () => {
  let app: INestApplication;
  let idp: FakeIdentityProvider;
  let testDb: TestDatabase;
  let mediaService: MediaService;
  let mediaDir: string;
  const jwtSecret = randomBytes(32).toString('hex');

  beforeAll(async () => {
    testDb = await resetTestDatabase(TEST_DB_URL!, 'media');
    await seed(testDb.db);

    mediaDir = await mkdtemp(join(tmpdir(), 'nestself-media-e2e-'));

    process.env.DATABASE_URL = testDb.url;
    process.env.AUTH_MODE = 'stub';
    process.env.JWT_SECRET = jwtSecret;
    process.env.SESSION_COOKIE_INSECURE_DEV = 'true';
    process.env.NODE_ENV = 'test';
    process.env.MEDIA_STORAGE = 'local';
    process.env.MEDIA_LOCAL_DIR = mediaDir;
    // Small global cap so the 413 test needs only a ~300 KB body (all other
    // fixtures in this suite are far smaller). Read once at module creation.
    process.env.MEDIA_MAX_UPLOAD_BYTES = String(UPLOAD_CAP_BYTES);
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
    await rm(mediaDir, { recursive: true, force: true }).catch(() => {});
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

  /** Upload a JPEG via real multipart with Content-Digest and return the result. */
  async function uploadJpeg(
    session: { agent: ReturnType<typeof request.agent>; csrf: string },
    jpegBuf: Buffer,
    opts: { category?: string; idempotencyKey?: string; digest?: string; kind?: string } = {},
  ) {
    const digest = opts.digest ?? contentDigest(jpegBuf);
    let req = session.agent
      .post(OPS_MEDIA)
      .set('x-csrf-token', session.csrf)
      .set('Content-Digest', digest)
      .field('kind', opts.kind ?? 'image')
      .field('ownerCategoryId', opts.category ?? CATEGORY_ID)
      .field('licenseKind', 'owned')
      .attach('file', jpegBuf, 'test.jpg');

    if (opts.idempotencyKey) {
      req = req.set('idempotency-key', opts.idempotencyKey);
    }
    return req;
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

  // ─── Upload and processing (I8: real multipart) ──────────────────────

  describe('multipart upload and processing', () => {
    it('real multipart JPEG upload → 201 with assetId, processes to ready', async () => {
      const session = await signInOps(KATARINA);
      const jpeg = await createTestJpeg(800, 600);
      const res = await uploadJpeg(session, jpeg);

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('assetId');
      expect(res.body.state).toBe('uploaded');

      // Process the asset
      const processResult = await mediaService.processAsset(res.body.assetId);
      expect(processResult).not.toBeNull();

      const detail = await mediaService.getDetail(res.body.assetId);
      expect(detail).not.toBeNull();
      expect(detail!.state).toBe('ready');
      expect(detail!.renditions.length).toBe(5);
    });

    it('real multipart PDF upload → 201, processes to ready', async () => {
      const session = await signInOps(KATARINA);
      const pdf = createMinimalPdf();
      const digest = contentDigest(pdf);
      const res = await session.agent
        .post(OPS_MEDIA)
        .set('x-csrf-token', session.csrf)
        .set('Content-Digest', digest)
        .field('kind', 'pdf')
        .field('ownerCategoryId', CATEGORY_ID)
        .field('licenseKind', 'owned')
        .attach('file', pdf, 'test.pdf');

      expect(res.status).toBe(201);
      expect(res.body.state).toBe('uploaded');

      const processResult = await mediaService.processAsset(res.body.assetId);
      expect(processResult).not.toBeNull();

      const detail = await mediaService.getDetail(res.body.assetId);
      expect(detail!.state).toBe('ready');
      expect(detail!.renditions.length).toBe(1);
    });

    it('rejects kind not enabled in M1 (audio)', async () => {
      const session = await signInOps(KATARINA);
      const buf = Buffer.alloc(100);
      const res = await uploadJpeg(session, buf, { kind: 'audio' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('media_type_rejected');
    });
  });

  // ─── Content-Digest (I1) ─────────────────────────────────────────────

  describe('Content-Digest', () => {
    it('digest mismatch → 400 validation with reason digest_mismatch', async () => {
      const session = await signInOps(KATARINA);
      const jpeg = await createTestJpeg();
      const wrongDigest = 'sha-256=:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=:';
      const res = await uploadJpeg(session, jpeg, { digest: wrongDigest });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('validation');
      expect(res.body.details?.reason).toBe('digest_mismatch');
    });
  });

  // ─── Idempotent upload (I1) ──────────────────────────────────────────

  describe('idempotent upload', () => {
    it('replay with same key and digest → same asset with Idempotent-Replayed', async () => {
      const session = await signInOps(KATARINA);
      const jpeg = await createTestJpeg();
      const idemKey = randomBytes(16).toString('hex');

      const first = await uploadJpeg(session, jpeg, { idempotencyKey: idemKey });
      expect(first.status).toBe(201);

      // Replay
      const second = await uploadJpeg(session, jpeg, { idempotencyKey: idemKey });
      // Should replay (same assetId) with header
      expect(second.body.assetId).toBe(first.body.assetId);
      expect(second.headers['idempotent-replayed']).toBe('true');
    });

    it('same key different digest → 409 payload_mismatch', async () => {
      const session = await signInOps(KATARINA);
      const jpeg1 = await createTestJpeg(100, 100);
      const jpeg2 = await createTestJpeg(200, 200);
      const idemKey = randomBytes(16).toString('hex');

      const first = await uploadJpeg(session, jpeg1, { idempotencyKey: idemKey });
      expect(first.status).toBe(201);

      const second = await uploadJpeg(session, jpeg2, { idempotencyKey: idemKey });
      expect(second.status).toBe(409);
      expect(second.body.code).toBe('idempotency_conflict');
      expect(second.body.details?.reason).toBe('payload_mismatch');
    });
  });

  // ─── Type sniffing during request (I8) ───────────────────────────────

  describe('type sniffing', () => {
    it('415 for PNG declared as PDF (during request)', async () => {
      const session = await signInOps(KATARINA);
      const png = await sharp({
        create: { width: 200, height: 200, channels: 4, background: { r: 0, g: 128, b: 255, alpha: 1 } },
      }).png().toBuffer();
      const digest = contentDigest(png);

      const res = await session.agent
        .post(OPS_MEDIA)
        .set('x-csrf-token', session.csrf)
        .set('Content-Digest', digest)
        .field('kind', 'pdf')
        .field('ownerCategoryId', CATEGORY_ID)
        .field('licenseKind', 'owned')
        .attach('file', png, 'disguised.pdf');

      expect(res.status).toBe(415);
      expect(res.body.code).toBe('media_type_rejected');
    });

    it('415 for SVG renamed as PNG (during request)', async () => {
      const session = await signInOps(KATARINA);
      const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>');
      const digest = contentDigest(svg);

      const res = await session.agent
        .post(OPS_MEDIA)
        .set('x-csrf-token', session.csrf)
        .set('Content-Digest', digest)
        .field('kind', 'image')
        .field('ownerCategoryId', CATEGORY_ID)
        .field('licenseKind', 'owned')
        .attach('file', svg, 'evil.png');

      expect(res.status).toBe(415);
      expect(res.body.code).toBe('media_type_rejected');
    });
  });

  // ─── Staff item routes (I4) ──────────────────────────────────────────

  describe('staff endpoints', () => {
    let readyAssetId: string;

    beforeAll(async () => {
      const jpeg = await createTestJpeg(400, 300);
      const session = await signInOps(KATARINA);
      const res = await uploadJpeg(session, jpeg);
      expect(res.status).toBe(201);
      readyAssetId = res.body.assetId;
      await mediaService.processAsset(readyAssetId);
    });

    it('GET /api/ops/cms/media lists assets', async () => {
      const session = await signInOps(VUK);
      const res = await session.agent
        .get(OPS_MEDIA)
        .set('x-csrf-token', session.csrf);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('items');
      expect(Array.isArray(res.body.items)).toBe(true);
      expect(res.body.items.length).toBeGreaterThan(0);
    });

    it('GET /api/ops/cms/media/:assetId returns detail', async () => {
      const session = await signInOps(VUK);
      const res = await session.agent
        .get(`${OPS_MEDIA}/${readyAssetId}`)
        .set('x-csrf-token', session.csrf);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(readyAssetId);
      expect(res.body.state).toBe('ready');
      expect(Array.isArray(res.body.renditions)).toBe(true);
    });

    it('PUT /api/ops/cms/media/:assetId updates metadata', async () => {
      const session = await signInOps(VUK);
      const res = await session.agent
        .put(`${OPS_MEDIA}/${readyAssetId}`)
        .set('x-csrf-token', session.csrf)
        .send({
          altText: { en: 'Updated alt text' },
          focalPoint: { x: 0.5, y: 0.3 },
        });

      expect(res.status).toBe(200);
      expect(res.body.altText).toEqual({ en: 'Updated alt text' });
    });

    it('uploaded asset can be deleted by editorial lead', async () => {
      const jpeg = await createTestJpeg();
      const katSession = await signInOps(KATARINA);
      const uploadRes = await uploadJpeg(katSession, jpeg);
      expect(uploadRes.status).toBe(201);
      const delAssetId = uploadRes.body.assetId;

      const vukSession = await signInOps(VUK);
      const delRes = await vukSession.agent
        .delete(`${OPS_MEDIA}/${delAssetId}`)
        .set('x-csrf-token', vukSession.csrf);
      expect(delRes.status).toBe(204);

      const detailRes = await vukSession.agent
        .get(`${OPS_MEDIA}/${delAssetId}`)
        .set('x-csrf-token', vukSession.csrf);
      expect(detailRes.status).toBe(404);
    });

    it('GET preview streams for ready assets', async () => {
      const session = await signInOps(VUK);
      const res = await session.agent
        .get(`${OPS_MEDIA}/${readyAssetId}/original`)
        .set('x-csrf-token', session.csrf);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/^image\//);
      expect(res.headers['accept-ranges']).toBe('bytes');
    });

    it('preview of unready asset → 409 media_not_ready', async () => {
      const jpeg = await createTestJpeg();
      const katSession = await signInOps(KATARINA);
      const uploadRes = await uploadJpeg(katSession, jpeg);
      expect(uploadRes.status).toBe(201);

      const session = await signInOps(VUK);
      const res = await session.agent
        .get(`${OPS_MEDIA}/${uploadRes.body.assetId}/original`)
        .set('x-csrf-token', session.csrf);

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('media_not_ready');
    });

    it('PUT with empty body → 400', async () => {
      const session = await signInOps(VUK);
      const putRes = await session.agent
        .put(`${OPS_MEDIA}/${readyAssetId}`)
        .set('x-csrf-token', session.csrf)
        .send({});

      expect(putRes.status).toBe(400);
      expect(putRes.body.code).toBe('validation');
    });

    it('DELETE of processing asset → 409', async () => {
      const jpeg = await createTestJpeg();
      const katSession = await signInOps(KATARINA);
      const uploadRes = await uploadJpeg(katSession, jpeg);
      expect(uploadRes.status).toBe(201);

      await testDb.db.update(mediaAssets)
        .set({ state: 'processing' })
        .where(eq(mediaAssets.id, uploadRes.body.assetId));

      const vukSession = await signInOps(VUK);
      const delRes = await vukSession.agent
        .delete(`${OPS_MEDIA}/${uploadRes.body.assetId}`)
        .set('x-csrf-token', vukSession.csrf);

      expect(delRes.status).toBe(409);
    });

    it('invalid rendition kind → 404', async () => {
      const session = await signInOps(VUK);
      const res = await session.agent
        .get(`${OPS_MEDIA}/${readyAssetId}/totally_invalid`)
        .set('x-csrf-token', session.csrf);

      expect(res.status).toBe(404);
    });
  });

  // ─── Processing hardening ────────────────────────────────────────────

  describe('processing hardening', () => {
    it('double-processing is a no-op (I2)', async () => {
      const session = await signInOps(KATARINA);
      const jpeg = await createTestJpeg(200, 200);
      const res = await uploadJpeg(session, jpeg);
      expect(res.status).toBe(201);

      const first = await mediaService.processAsset(res.body.assetId);
      expect(first).not.toBeNull();
      expect(first!.newState).toBe('ready');

      const second = await mediaService.processAsset(res.body.assetId);
      expect(second).toBeNull();
    });
  });

  // ─── Employee delivery ───────────────────────────────────────────────

  describe('employee delivery', () => {
    const LIBRARY = '/api/library/media';
    const ORG_A = 'org_sample';
    const ORG_B = 'org_beta';
    const MARKO = 'user_marko';

    let readyAssetId: string;
    let pdfAssetId: string;
    let originalRenditionBytes: Buffer;
    let originalRenditionSize: number;
    let jovanSession: { agent: ReturnType<typeof request.agent>; csrf: string };
    let markoSession: { agent: ReturnType<typeof request.agent>; csrf: string };

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

    async function createPublicationChain(assetId: string, orgId: string) {
      const db = testDb.db;
      const now = new Date();
      const r = () => randomUUID().slice(0, 8);
      const resId = `res_${r()}`, varId = `var_${r()}`, revId = `rev_${r()}`;
      const pubId = `pub_${r()}`, audId = `aud_${r()}`, crmId = `crm_${r()}`;

      await db.insert(contentResources).values({
        id: resId, type: 'article', state: 'active',
        primaryCategoryId: CATEGORY_ID, ownerUserId: KATARINA, reviewPolicy: 'editorial',
      });
      await db.insert(contentVariants).values({
        id: varId, contentResourceId: resId, locale: 'sr-Latn', slug: `slug-${r()}`,
      });
      await db.insert(contentRevisions).values({
        id: revId, contentVariantId: varId, revisionNumber: 1, state: 'approved',
        body: { blocks: [] }, title: 'Test', summary: 'Test summary',
        authorUserId: KATARINA, lastEditorUserId: KATARINA,
        approvedAt: now, approvedByUserId: VUK,
      });
      await db.insert(contentRevisionMedia).values({
        id: crmId, contentRevisionId: revId, mediaAssetId: assetId, usageKind: 'cover',
      });
      await db.insert(contentPublications).values({
        id: pubId, contentVariantId: varId, contentRevisionId: revId,
        approvalHash: `hash_${pubId}`, state: 'live', requiredCapability: 'library',
        startsAt: new Date(now.getTime() - 3600_000), publishedByUserId: VUK,
      });
      await db.insert(contentPublicationAudiences).values({
        id: audId, publicationId: pubId, kind: 'organization', orgId,
      });
      return pubId;
    }

    beforeAll(async () => {
      const db = testDb.db;

      await db.insert(organizations).values({
        id: ORG_B, name: 'Beta d.o.o.', slug: 'beta', status: 'ACTIVE',
      }).onConflictDoNothing();
      await db.insert(users).values({
        id: MARKO, email: 'user_marko@example.com', displayName: 'Marko S.', locale: 'sr-Latn',
      }).onConflictDoNothing();
      await db.insert(memberships).values({
        userId: MARKO, orgId: ORG_B, status: 'ACTIVE', startDate: new Date('2026-01-01'),
      }).onConflictDoNothing();

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
        subjectUserId: MARKO, templateKey: 'employee',
        actions: employeeActions, scopeType: 'own', scopeOrgId: ORG_B,
        grantedByUserId: MARKO, grantedAt: new Date('2026-01-01'), validFrom: new Date('2026-01-01'),
      }).onConflictDoNothing();

      await db.insert(orgContentCapabilities).values({
        id: `org_cap_${ORG_B}_library`, orgId: ORG_B, capability: 'library',
        enabledFrom: new Date('2026-01-01'), configuredByUserId: MARKO,
      }).onConflictDoNothing();

      idp.seedUsers([{ email: 'user_marko@example.com' }]);
      const markoIdpUser = await idp.findUserByEmail('user_marko@example.com');
      if (!markoIdpUser) throw new Error('FakeIDP user not found');
      await db.insert(externalIdentities).values({
        userId: MARKO, provider: 'cognito', subject: markoIdpUser.sub,
        cognitoUsername: markoIdpUser.username, email: 'user_marko@example.com', emailVerified: true,
      }).onConflictDoNothing();

      // Upload JPEG
      const katSession = await signInOps(KATARINA);
      const jpeg = await createTestJpeg(800, 600);
      const uploadRes = await uploadJpeg(katSession, jpeg);
      expect(uploadRes.status).toBe(201);
      readyAssetId = uploadRes.body.assetId;
      await mediaService.processAsset(readyAssetId);

      // Read original bytes
      const { MEDIA_STORAGE: StorageToken } = await import('../src/media/storage/media-storage.js');
      const storage = app.get(StorageToken);
      const { stream } = await storage.get(`assets/${readyAssetId}/original`);
      const chunks: Buffer[] = [];
      for await (const chunk of stream as AsyncIterable<Buffer>) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
      }
      originalRenditionBytes = Buffer.concat(chunks);
      originalRenditionSize = originalRenditionBytes.length;

      // Upload PDF
      const pdf = createMinimalPdf();
      const pdfDigest = contentDigest(pdf);
      const pdfRes = await katSession.agent
        .post(OPS_MEDIA)
        .set('x-csrf-token', katSession.csrf)
        .set('Content-Digest', pdfDigest)
        .field('kind', 'pdf')
        .field('ownerCategoryId', CATEGORY_ID)
        .field('licenseKind', 'owned')
        .attach('file', pdf, 'test.pdf');
      expect(pdfRes.status).toBe(201);
      pdfAssetId = pdfRes.body.assetId;
      await mediaService.processAsset(pdfAssetId);

      await createPublicationChain(readyAssetId, ORG_A);
      await createPublicationChain(pdfAssetId, ORG_A);

      jovanSession = await signInPersonal(JOVAN);
      markoSession = await signInPersonal(MARKO);
    }, 180_000);

    it('full GET → 200 with correct bytes', async () => {
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
      expect((res.body as Buffer).length).toBe(originalRenditionSize);
    });

    it('Range bytes=0-99 → 206', async () => {
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
      expect(res.headers['content-range']).toBe(`bytes 0-99/${originalRenditionSize}`);
      expect((res.body as Buffer).length).toBe(100);
    });

    it('employee from other org → 404 (not 403)', async () => {
      const res = await markoSession.agent
        .get(`${LIBRARY}/${readyAssetId}/original`)
        .set('x-csrf-token', markoSession.csrf);

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('content_not_available');
    });

    it('PDF → Content-Disposition: attachment, CSP: sandbox', async () => {
      const res = await jovanSession.agent
        .get(`${LIBRARY}/${pdfAssetId}/pdf`)
        .set('x-csrf-token', jovanSession.csrf);

      expect(res.status).toBe(200);
      expect(res.headers['content-disposition']).toMatch(/attachment/);
      expect(res.headers['content-security-policy']).toBe('sandbox');
    });
  });
  // ─── Oversized upload and client abort cleanup ───────────────────────

  describe('upload cleanup', () => {
    /** Files left anywhere under MEDIA_LOCAL_DIR/quarantine/. */
    async function quarantineFiles(): Promise<string[]> {
      const root = join(mediaDir, 'quarantine');
      const out: string[] = [];
      const entries = await readdir(root, { recursive: true }).catch(() => [] as string[]);
      for (const e of entries) if (/original(\.meta)?$/.test(e)) out.push(e);
      return out;
    }

    async function waitFor(check: () => Promise<boolean>, ms = 10_000): Promise<void> {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        if (await check()) return;
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error('waitFor timed out');
    }

    it('oversized image → 413 media_too_large, streamed (not buffered), no row or file remains', async () => {
      const session = await signInOps(KATARINA);
      const before = await testDb.db.select({ id: mediaAssets.id }).from(mediaAssets);
      const filesBefore = await quarantineFiles();

      // JPEG magic prefix + noise, 300 KB: larger than the 200 KB test cap.
      const body = Buffer.concat([
        Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
        randomBytes(300 * 1024 - 4),
      ]);

      // Spy on the storage put and record every chunk the engine hands it.
      // Streaming proof: data arrives in several small chunks (never one
      // buffer holding the whole body), and consumption stops at the cap
      // rather than reading the full 300 KB.
      const storage = app.get<MediaStorage>(MEDIA_STORAGE);
      const chunkSizes: number[] = [];
      const putSpy = vi.spyOn(storage, 'put').mockImplementation(async (_key, stream) => {
        for await (const chunk of stream) chunkSizes.push((chunk as Buffer).length);
      });

      let res: request.Response;
      try {
        res = await uploadJpeg(session, body);
      } finally {
        putSpy.mockRestore();
      }

      expect(res.status).toBe(413);
      expect(res.body.code).toBe('media_too_large');

      expect(chunkSizes.length).toBeGreaterThan(1);
      expect(Math.max(...chunkSizes)).toBeLessThanOrEqual(128 * 1024);
      const received = chunkSizes.reduce((a, b) => a + b, 0);
      expect(received).toBeLessThanOrEqual(UPLOAD_CAP_BYTES);

      const after = await testDb.db.select({ id: mediaAssets.id }).from(mediaAssets);
      expect(after.length).toBe(before.length);
      expect(await quarantineFiles()).toEqual(filesBefore);
    });

    it('client abort mid-body → no uploaded row and no partial quarantine file', async () => {
      const session = await signInOps(KATARINA);
      const cookie = (
        (session.agent as unknown as {
          jar: { getCookies: (a: object) => Array<{ toValueString(): string }> };
        }).jar.getCookies({ domain: '127.0.0.1', path: '/api/ops/cms/media', secure: false, script: false })
      )
        .map((c) => c.toValueString())
        .join('; ');
      expect(cookie).toContain('nestself_csrf=');

      const before = await testDb.db
        .select({ id: mediaAssets.id })
        .from(mediaAssets)
        .where(eq(mediaAssets.state, 'uploaded'));
      const beforeIds = new Set(before.map((r) => r.id));
      const filesBefore = await quarantineFiles();

      await app.listen(0, '127.0.0.1');
      const { port } = app.getHttpServer().address() as AddressInfo;

      const full = Buffer.concat([
        Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
        randomBytes(150 * 1024),
      ]);
      const boundary = `----abort${randomUUID()}`;
      const field = (n: string, v: string) =>
        `--${boundary}\r\nContent-Disposition: form-data; name="${n}"\r\n\r\n${v}\r\n`;
      const head =
        field('kind', 'image') +
        field('ownerCategoryId', CATEGORY_ID) +
        field('licenseKind', 'owned') +
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.jpg"\r\n` +
        'Content-Type: image/jpeg\r\n\r\n';

      const req = http.request({
        host: '127.0.0.1',
        port,
        method: 'POST',
        path: OPS_MEDIA,
        headers: {
          'content-type': `multipart/form-data; boundary=${boundary}`,
          // Declares the full body; we never send it all.
          'content-length': String(Buffer.byteLength(head) + full.length + 100),
          'content-digest': contentDigest(full),
          'x-csrf-token': session.csrf,
          cookie,
        },
      });
      req.on('error', () => {});
      req.write(head);
      req.write(full.subarray(0, 60 * 1024));

      // The engine has inserted its row and is streaming to quarantine.
      let newIds: string[] = [];
      await waitFor(async () => {
        const rows = await testDb.db
          .select({ id: mediaAssets.id })
          .from(mediaAssets)
          .where(eq(mediaAssets.state, 'uploaded'));
        newIds = rows.map((r) => r.id).filter((id) => !beforeIds.has(id));
        return newIds.length === 1 && (await quarantineFiles()).length > filesBefore.length;
      });

      req.destroy();

      await waitFor(async () => {
        const rows = await testDb.db
          .select({ id: mediaAssets.id })
          .from(mediaAssets)
          .where(eq(mediaAssets.state, 'uploaded'));
        const left = rows.filter((r) => !beforeIds.has(r.id));
        return left.length === 0 && (await quarantineFiles()).length === filesBefore.length;
      });

      const rows = await testDb.db.select({ id: mediaAssets.id }).from(mediaAssets);
      expect(rows.some((r) => newIds.includes(r.id))).toBe(false);
      expect(await quarantineFiles()).toEqual(filesBefore);
    });
  });
});
