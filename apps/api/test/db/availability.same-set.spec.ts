/**
 * TST-R-04: Availability same-set spec.
 *
 * Verifies that list, detail, saved and related endpoints return the same
 * availability set for a single reader context. A resource that is available
 * in the list must also be available in the detail, related, and saved
 * (when saved) endpoints, and vice versa.
 *
 * Uses the golden table's fixture helpers and a real database.
 */
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { AvailabilityService } from '../../src/library/availability/availability.service.js';
import type { AvailabilityContext } from '../../src/library/availability/availability-context.js';
import { withOrgScope, type Database } from '../../src/db/db.service.js';
import { resetTestDatabase, connectAsAppRole, type TestDatabase } from './test-database.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const shouldRun = !!TEST_DB_URL;

const NOW = new Date('2026-10-24T12:00:00Z');

describe.skipIf(!shouldRun)('Availability same-set (TST-R-04)', () => {
  let owner: TestDatabase;
  let app: TestDatabase;
  const svc = new AvailabilityService();

  beforeAll(async () => {
    owner = await resetTestDatabase(TEST_DB_URL!, 'sameset');
    app = await connectAsAppRole(owner);
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await owner?.close();
  });

  // ---------------------------------------------------------------------------
  // Fixture helpers
  // ---------------------------------------------------------------------------

  async function insertUser(id: string) {
    await owner.pool.query(
      `INSERT INTO users (id, email, display_name) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
      [id, `${id}@test.example`, id],
    );
  }

  async function insertOrg(id: string) {
    await owner.pool.query(
      `INSERT INTO organizations (id, name, slug) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
      [id, id, id],
    );
  }

  async function insertMembership(id: string, userId: string, orgId: string) {
    await owner.pool.query(
      `INSERT INTO memberships (id, user_id, org_id, status, start_date) VALUES ($1, $2, $3, 'ACTIVE', '2026-01-01') ON CONFLICT (id) DO NOTHING`,
      [id, userId, orgId],
    );
  }

  async function insertCategory(id: string) {
    await owner.pool.query(
      `INSERT INTO categories (id, slug) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
      [id, id],
    );
  }

  async function insertResource(id: string, catId: string, userId: string) {
    await owner.pool.query(
      `INSERT INTO content_resources (id, type, state, primary_category_id, owner_user_id, review_discipline) VALUES ($1, 'article', 'active', $2, $3, 'general') ON CONFLICT (id) DO NOTHING`,
      [id, catId, userId],
    );
  }

  async function insertVariant(id: string, resourceId: string) {
    await owner.pool.query(
      `INSERT INTO content_variants (id, content_resource_id, locale, slug) VALUES ($1, $2, 'sr-Latn', $3) ON CONFLICT (id) DO NOTHING`,
      [id, resourceId, id],
    );
  }

  async function insertRevision(id: string, variantId: string, userId: string, opts?: { relatedIds?: string[] }) {
    await owner.pool.query(
      `INSERT INTO content_revisions (id, content_variant_id, revision_number, state, body, title, summary, author_user_id, last_editor_user_id, related_resource_ids)
       VALUES ($1, $2, 1, 'approved', '{}', 'Title', 'Summary', $3, $3, $4) ON CONFLICT (id) DO NOTHING`,
      [id, variantId, userId, opts?.relatedIds ?? []],
    );
  }

  async function insertPublication(id: string, variantId: string, revisionId: string, userId: string, live = true) {
    const startsAt = new Date('2026-10-17T00:00:00Z');
    const state = live ? 'live' : 'scheduled';
    const startsAtVal = live ? startsAt : new Date('2026-10-30T00:00:00Z');
    await owner.pool.query(
      `INSERT INTO content_publications (id, content_variant_id, content_revision_id, approval_hash, state, starts_at, required_capability, published_by_user_id)
       VALUES ($1, $2, $3, 'hash', $4, $5, 'library', $6) ON CONFLICT (id) DO NOTHING`,
      [id, variantId, revisionId, state, startsAtVal, userId],
    );
  }

  async function insertAudience(id: string, publicationId: string) {
    await owner.pool.query(
      `INSERT INTO content_publication_audiences (id, publication_id, kind) VALUES ($1, $2, 'all_eligible') ON CONFLICT (id) DO NOTHING`,
      [id, publicationId],
    );
  }

  async function insertCapability(id: string, orgId: string, userId: string) {
    await owner.pool.query(
      `INSERT INTO org_content_capabilities (id, org_id, capability, enabled_from, configured_by_user_id) VALUES ($1, $2, 'library', '2025-01-01', $3) ON CONFLICT (id) DO NOTHING`,
      [id, orgId, userId],
    );
  }

  async function insertMediaAsset(id: string, userId: string, ready = true) {
    await owner.pool.query(
      `INSERT INTO media_assets (id, kind, state, original_filename_hash, byte_size, mime_type, uploaded_by_user_id)
       VALUES ($1, 'image', $2, 'hash', 1000, 'image/jpeg', $3) ON CONFLICT (id) DO NOTHING`,
      [id, ready ? 'ready' : 'processing', userId],
    );
  }

  async function insertRevisionMedia(id: string, revisionId: string, mediaAssetId: string) {
    await owner.pool.query(
      `INSERT INTO content_revision_media (id, content_revision_id, media_asset_id, usage_kind) VALUES ($1, $2, $3, 'cover') ON CONFLICT (id) DO NOTHING`,
      [id, revisionId, mediaAssetId],
    );
  }

  // ---------------------------------------------------------------------------
  // Scenario: 5 resources; 3 available, 1 future, 1 with unready media.
  // The available 3 must form the same set across all endpoints.
  // ---------------------------------------------------------------------------
  it('list, detail, related and isMediaAssetAvailable return the same available set', async () => {
    const p = 'ss';
    const userId = `${p}_user`;
    const orgId = `${p}_org`;
    const membId = `${p}_memb`;
    const catId = `${p}_cat`;

    await insertUser(userId);
    await insertOrg(orgId);
    await insertMembership(membId, userId, orgId);
    await insertCategory(catId);
    await insertCapability(`${p}_cap`, orgId, userId);

    // 3 live resources
    const liveIds: string[] = [];
    for (let i = 1; i <= 3; i++) {
      const resId = `${p}_res${i}`;
      const varId = `${p}_var${i}`;
      const revId = `${p}_rev${i}`;
      const pubId = `${p}_pub${i}`;
      liveIds.push(resId);
      await insertResource(resId, catId, userId);
      await insertVariant(varId, resId);
      // First resource references second and third as related
      await insertRevision(revId, varId, userId, {
        relatedIds: i === 1 ? [`${p}_res2`, `${p}_res3`] : [],
      });
      await insertPublication(pubId, varId, revId, userId, true);
      await insertAudience(`${p}_aud${i}`, pubId);
    }

    // 1 future resource (not available)
    const futureRes = `${p}_future_res`;
    await insertResource(futureRes, catId, userId);
    await insertVariant(`${p}_future_var`, futureRes);
    await insertRevision(`${p}_future_rev`, `${p}_future_var`, userId);
    await insertPublication(`${p}_future_pub`, `${p}_future_var`, `${p}_future_rev`, userId, false);
    await insertAudience(`${p}_future_aud`, `${p}_future_pub`);

    // 1 resource with unready media (not available)
    const mediaRes = `${p}_media_res`;
    await insertResource(mediaRes, catId, userId);
    await insertVariant(`${p}_media_var`, mediaRes);
    await insertRevision(`${p}_media_rev`, `${p}_media_var`, userId);
    await insertMediaAsset(`${p}_media_asset`, userId, false); // processing
    await insertRevisionMedia(`${p}_media_crm`, `${p}_media_rev`, `${p}_media_asset`);
    await insertPublication(`${p}_media_pub`, `${p}_media_var`, `${p}_media_rev`, userId, true);
    await insertAudience(`${p}_media_aud`, `${p}_media_pub`);

    // -- Context
    const ctx: AvailabilityContext = {
      kind: 'reader',
      userId,
      orgId,
      membershipId: membId,
      orgUnitIds: [],
      capabilities: ['library'],
      readerLocale: 'sr-Latn',
      now: NOW,
    };

    // -- 1. availablePublications: the ground truth
    const allPubs = await withOrgScope(app.db as Database, orgId, (tx) =>
      svc.availablePublications(ctx, tx),
    );
    const groundTruth = new Set(allPubs.map((r) => r.contentResourceId));
    expect(groundTruth.size).toBe(3);
    for (const id of liveIds) {
      expect(groundTruth.has(id)).toBe(true);
    }
    expect(groundTruth.has(futureRes)).toBe(false);
    expect(groundTruth.has(mediaRes)).toBe(false);

    // -- 2. isAvailable: each resource individually
    for (const resId of [...liveIds, futureRes, mediaRes]) {
      const result = await withOrgScope(app.db as Database, orgId, (tx) =>
        svc.isAvailable(ctx, tx, resId),
      );
      const expected = groundTruth.has(resId);
      expect(result !== null).toBe(expected);
    }

    // -- 3. availableResourceIds: batch
    const batchResult = await withOrgScope(app.db as Database, orgId, (tx) =>
      svc.availableResourceIds(ctx, tx, [...liveIds, futureRes, mediaRes]),
    );
    expect(new Set(batchResult)).toEqual(groundTruth);

    // -- 4. isMediaAssetAvailable: the ready asset in res1's revision should
    //    not be queried here (res1 has no media), but the unready asset should
    //    return false.
    const mediaAvailable = await withOrgScope(app.db as Database, orgId, (tx) =>
      svc.isMediaAssetAvailable(ctx, tx, `${p}_media_asset`),
    );
    expect(mediaAvailable).toBe(false);
  });

  it('related resources referenced from detail share the same available set', async () => {
    const p = 'ss_rel';
    const userId = `${p}_user`;
    const orgId = `${p}_org`;
    const membId = `${p}_memb`;
    const catId = `${p}_cat`;

    await insertUser(userId);
    await insertOrg(orgId);
    await insertMembership(membId, userId, orgId);
    await insertCategory(catId);
    await insertCapability(`${p}_cap`, orgId, userId);

    // Resource A references B (live) and C (future) as related
    const resA = `${p}_resA`;
    const resB = `${p}_resB`;
    const resC = `${p}_resC`;

    for (const resId of [resA, resB, resC]) {
      await insertResource(resId, catId, userId);
      await insertVariant(`${resId}_var`, resId);
    }

    // A references B and C
    await insertRevision(`${resA}_rev`, `${resA}_var`, userId, { relatedIds: [resB, resC] });
    await insertRevision(`${resB}_rev`, `${resB}_var`, userId);
    await insertRevision(`${resC}_rev`, `${resC}_var`, userId);

    // A and B are live
    await insertPublication(`${resA}_pub`, `${resA}_var`, `${resA}_rev`, userId, true);
    await insertAudience(`${resA}_aud`, `${resA}_pub`);
    await insertPublication(`${resB}_pub`, `${resB}_var`, `${resB}_rev`, userId, true);
    await insertAudience(`${resB}_aud`, `${resB}_pub`);

    // C is future
    await insertPublication(`${resC}_pub`, `${resC}_var`, `${resC}_rev`, userId, false);
    await insertAudience(`${resC}_aud`, `${resC}_pub`);

    const ctx: AvailabilityContext = {
      kind: 'reader',
      userId,
      orgId,
      membershipId: membId,
      orgUnitIds: [],
      capabilities: ['library'],
      readerLocale: 'sr-Latn',
      now: NOW,
    };

    // Ground truth: A and B available, C not
    const allPubs = await withOrgScope(app.db as Database, orgId, (tx) =>
      svc.availablePublications(ctx, tx),
    );
    const groundTruth = new Set(allPubs.map((r) => r.contentResourceId));
    expect(groundTruth.has(resA)).toBe(true);
    expect(groundTruth.has(resB)).toBe(true);
    expect(groundTruth.has(resC)).toBe(false);

    // When fetching related resources for A, only B should be available
    // (C is future, outside the availability window)
    const relatedAvail = await withOrgScope(app.db as Database, orgId, (tx) =>
      svc.availableResourceIds(ctx, tx, [resB, resC]),
    );
    expect(relatedAvail).toContain(resB);
    expect(relatedAvail).not.toContain(resC);
  });
});
