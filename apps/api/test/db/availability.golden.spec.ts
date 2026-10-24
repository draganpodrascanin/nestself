/**
 * Availability golden table tests (T-C1.09, 5.10, ACC-R-21).
 *
 * Each case inserts the minimal rows required, calls
 * `availablePublications` under `withOrgScope`, and asserts the result.
 * The test runs against a real PostgreSQL database. Cases AV-01 to AV-24.
 */
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { AvailabilityService } from '../../src/library/availability/availability.service.js';
import { AvailabilityContextLoader } from '../../src/library/availability/availability-context-loader.js';
import type { AvailabilityContext } from '../../src/library/availability/availability-context.js';
import { withOrgScope, type Database } from '../../src/db/db.service.js';
import { resetTestDatabase, connectAsAppRole, type TestDatabase } from './test-database.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const shouldRun = !!TEST_DB_URL;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A UTC timestamp relative to `NOW` by a number of days. */
function daysFromNow(days: number): Date {
  // Use UTC arithmetic to avoid DST shifts
  return new Date(Date.UTC(2026, 9, 24, 12, 0, 0) + days * 86_400_000);
}

const NOW = new Date('2026-10-24T12:00:00Z');
const YESTERDAY = daysFromNow(-1);
const TOMORROW = daysFromNow(1);
const LAST_WEEK = daysFromNow(-7);
const TWO_DAYS_AGO = daysFromNow(-2);
const LAST_MONTH = daysFromNow(-30);
const LAST_YEAR = daysFromNow(-365);

describe.skipIf(!shouldRun)('Availability golden table (T-C1.09)', () => {
  let owner: TestDatabase;
  let app: TestDatabase;
  const svc = new AvailabilityService();

  beforeAll(async () => {
    owner = await resetTestDatabase(TEST_DB_URL!, 'avail');
    app = await connectAsAppRole(owner);
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await owner?.close();
  });

  // ---------------------------------------------------------------------------
  // Fixture insertion helpers (all go through the owner connection to bypass RLS)
  // ---------------------------------------------------------------------------

  async function insertUser(id: string, email?: string) {
    await owner.pool.query(
      `INSERT INTO users (id, email, display_name) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
      [id, email ?? `${id}@test.example`, id],
    );
  }

  async function insertOrg(id: string, name?: string) {
    await owner.pool.query(
      `INSERT INTO organizations (id, name, slug) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
      [id, name ?? id, id],
    );
  }

  async function insertOrgUnit(id: string, orgId: string, parentId?: string | null) {
    await owner.pool.query(
      `INSERT INTO org_units (id, org_id, parent_id, name, kind) VALUES ($1, $2, $3, $4, 'DEPARTMENT') ON CONFLICT (id) DO NOTHING`,
      [id, orgId, parentId ?? null, id],
    );
  }

  async function insertClosure(ancestorId: string, descendantId: string, depth: number) {
    await owner.pool.query(
      `INSERT INTO org_unit_closure (ancestor_id, descendant_id, depth) VALUES ($1, $2, $3) ON CONFLICT (ancestor_id, descendant_id) DO NOTHING`,
      [ancestorId, descendantId, depth],
    );
  }

  async function insertMembership(
    id: string,
    userId: string,
    orgId: string,
    status: string = 'ACTIVE',
    orgUnitId?: string | null,
    opts?: { startDate?: Date; endDate?: Date | null },
  ) {
    await owner.pool.query(
      `INSERT INTO memberships (id, user_id, org_id, status, start_date, end_date, org_unit_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING`,
      [
        id,
        userId,
        orgId,
        status,
        opts?.startDate ?? new Date('2026-01-01'),
        opts?.endDate ?? null,
        orgUnitId ?? null,
      ],
    );
  }

  async function insertCategory(id: string) {
    await owner.pool.query(
      `INSERT INTO categories (id, slug) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
      [id, id],
    );
  }

  async function insertResource(
    id: string,
    catId: string,
    userId: string,
    state: string = 'active',
  ) {
    await owner.pool.query(
      `INSERT INTO content_resources (id, type, state, primary_category_id, owner_user_id, review_discipline) VALUES ($1, 'article', $2, $3, $4, 'general') ON CONFLICT (id) DO NOTHING`,
      [id, state, catId, userId],
    );
  }

  async function insertVariant(
    id: string,
    resourceId: string,
    locale: string = 'sr-Latn',
    slug?: string,
  ) {
    await owner.pool.query(
      `INSERT INTO content_variants (id, content_resource_id, locale, slug) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
      [id, resourceId, locale, slug ?? id],
    );
  }

  async function insertRevision(
    id: string,
    variantId: string,
    userId: string,
    revNumber: number = 1,
  ) {
    await owner.pool.query(
      `INSERT INTO content_revisions (id, content_variant_id, revision_number, state, body, title, summary, author_user_id, last_editor_user_id)
       VALUES ($1, $2, $3, 'approved', '{}', 'Title', 'Summary', $4, $4) ON CONFLICT (id) DO NOTHING`,
      [id, variantId, revNumber, userId],
    );
  }

  async function insertPublication(
    id: string,
    variantId: string,
    revisionId: string,
    userId: string,
    opts: {
      state?: string;
      startsAt?: Date;
      endsAt?: Date | null;
      withdrawnAt?: Date | null;
      requiredCapability?: string;
    } = {},
  ) {
    const {
      state = 'live',
      startsAt = LAST_WEEK,
      endsAt = null,
      withdrawnAt = null,
      requiredCapability = 'library',
    } = opts;
    await owner.pool.query(
      `INSERT INTO content_publications (id, content_variant_id, content_revision_id, approval_hash, state, starts_at, ends_at, withdrawn_at, required_capability, published_by_user_id)
       VALUES ($1, $2, $3, 'hash', $4, $5, $6, $7, $8, $9) ON CONFLICT (id) DO NOTHING`,
      [id, variantId, revisionId, state, startsAt, endsAt, withdrawnAt, requiredCapability, userId],
    );
  }

  async function insertAudience(
    id: string,
    publicationId: string,
    kind: string,
    orgId?: string | null,
    orgUnitId?: string | null,
    includeDescendants: boolean = true,
  ) {
    await owner.pool.query(
      `INSERT INTO content_publication_audiences (id, publication_id, kind, org_id, org_unit_id, include_descendants) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
      [id, publicationId, kind, orgId ?? null, orgUnitId ?? null, includeDescendants],
    );
  }

  async function insertCapability(
    id: string,
    orgId: string,
    userId: string,
    capability: string = 'library',
    enabledFrom: Date = LAST_YEAR,
    enabledUntil: Date | null = null,
  ) {
    await owner.pool.query(
      `INSERT INTO org_content_capabilities (id, org_id, capability, enabled_from, enabled_until, configured_by_user_id) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
      [id, orgId, capability, enabledFrom, enabledUntil, userId],
    );
  }

  async function insertMediaAsset(
    id: string,
    userId: string,
    state: string = 'ready',
    rightsExpiresAt: Date | null = null,
  ) {
    await owner.pool.query(
      `INSERT INTO media_assets (id, kind, state, original_filename_hash, byte_size, mime_type, uploaded_by_user_id, rights_expires_at)
       VALUES ($1, 'image', $2, 'hash', 1000, 'image/jpeg', $3, $4) ON CONFLICT (id) DO NOTHING`,
      [id, state, userId, rightsExpiresAt],
    );
  }

  async function insertRevisionMedia(id: string, revisionId: string, mediaAssetId: string) {
    await owner.pool.query(
      `INSERT INTO content_revision_media (id, content_revision_id, media_asset_id, usage_kind) VALUES ($1, $2, $3, 'cover') ON CONFLICT (id) DO NOTHING`,
      [id, revisionId, mediaAssetId],
    );
  }

  /** Build a minimal set of base entities for a test case. */
  async function setupBaseEntities(prefix: string) {
    const ids = {
      user: `${prefix}_user`,
      org: `${prefix}_org`,
      membership: `${prefix}_memb`,
      category: `${prefix}_cat`,
      resource: `${prefix}_res`,
      variant: `${prefix}_var`,
      revision: `${prefix}_rev`,
      publication: `${prefix}_pub`,
      audience: `${prefix}_aud`,
      capability: `${prefix}_cap`,
    };
    await insertUser(ids.user);
    await insertOrg(ids.org);
    await insertMembership(ids.membership, ids.user, ids.org);
    await insertCategory(ids.category);
    await insertResource(ids.resource, ids.category, ids.user);
    await insertVariant(ids.variant, ids.resource);
    await insertRevision(ids.revision, ids.variant, ids.user);
    await insertCapability(ids.capability, ids.org, ids.user);
    return ids;
  }

  function makeCtx(
    ids: { user: string; org: string; membership: string },
    overrides: Partial<AvailabilityContext> = {},
  ): AvailabilityContext {
    return {
      kind: 'reader',
      userId: ids.user,
      orgId: ids.org,
      membershipId: ids.membership,
      orgUnitIds: [],
      capabilities: ['library'],
      readerLocale: 'sr-Latn',
      now: NOW,
      ...overrides,
    };
  }

  /** Run availablePublications under withOrgScope (I1). */
  async function availScoped(ctx: AvailabilityContext, filter = {}) {
    return withOrgScope(app.db as Database, ctx.orgId, (tx) =>
      svc.availablePublications(ctx, tx, filter),
    );
  }

  // ---------------------------------------------------------------------------
  // AV-01: Global audience, all conditions met
  // ---------------------------------------------------------------------------
  it('AV-01: Global audience, all conditions met -> available', async () => {
    const p = 'av01';
    const ids = await setupBaseEntities(p);
    await insertPublication(ids.publication, ids.variant, ids.revision, ids.user);
    await insertAudience(ids.audience, ids.publication, 'all_eligible');

    const ctx = makeCtx(ids);
    const rows = await availScoped(ctx);
    expect(rows.some((r) => r.contentResourceId === ids.resource)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // AV-02: Tenant-only audience, matching org
  // ---------------------------------------------------------------------------
  it('AV-02: Tenant-only audience, matching org -> available', async () => {
    const p = 'av02';
    const ids = await setupBaseEntities(p);
    await insertPublication(ids.publication, ids.variant, ids.revision, ids.user);
    await insertAudience(ids.audience, ids.publication, 'organization', ids.org);

    const ctx = makeCtx(ids);
    const rows = await availScoped(ctx);
    expect(rows.some((r) => r.contentResourceId === ids.resource)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // AV-03: Tenant-only audience, non-matching org
  // ---------------------------------------------------------------------------
  it('AV-03: Tenant-only audience, non-matching org -> not available', async () => {
    const p = 'av03';
    const ids = await setupBaseEntities(p);
    const otherOrg = `${p}_other_org`;
    await insertOrg(otherOrg);
    await insertPublication(ids.publication, ids.variant, ids.revision, ids.user);
    await insertAudience(ids.audience, ids.publication, 'organization', otherOrg);

    const ctx = makeCtx(ids);
    const rows = await availScoped(ctx);
    expect(rows.some((r) => r.contentResourceId === ids.resource)).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // AV-04: Unit audience with include_descendants, reader in child unit
  // ---------------------------------------------------------------------------
  it('AV-04: Unit audience with include_descendants, reader in child unit -> available', async () => {
    const p = 'av04';
    const ids = await setupBaseEntities(p);
    const parentUnit = `${p}_parent_unit`;
    const childUnit = `${p}_child_unit`;
    await insertOrgUnit(parentUnit, ids.org, null);
    await insertOrgUnit(childUnit, ids.org, parentUnit);
    // Closure: self-references + parent-child
    await insertClosure(parentUnit, parentUnit, 0);
    await insertClosure(childUnit, childUnit, 0);
    await insertClosure(parentUnit, childUnit, 1);

    // Update membership to assign primary unit
    await owner.pool.query(`UPDATE memberships SET org_unit_id = $1 WHERE id = $2`, [childUnit, ids.membership]);

    await insertPublication(ids.publication, ids.variant, ids.revision, ids.user);
    await insertAudience(ids.audience, ids.publication, 'org_unit', ids.org, parentUnit, true);

    // orgUnitIds: primary is child, ancestor is parent
    const ctx = makeCtx(ids, { orgUnitIds: [childUnit, parentUnit] });
    const rows = await availScoped(ctx);
    expect(rows.some((r) => r.contentResourceId === ids.resource)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // AV-05: Unit audience with include_descendants, reader in sibling unit
  // ---------------------------------------------------------------------------
  it('AV-05: Unit audience with include_descendants, reader in sibling unit -> not available', async () => {
    const p = 'av05';
    const ids = await setupBaseEntities(p);
    const rootUnit = `${p}_root`;
    const targetUnit = `${p}_target`;
    const siblingUnit = `${p}_sibling`;
    await insertOrgUnit(rootUnit, ids.org);
    await insertOrgUnit(targetUnit, ids.org, rootUnit);
    await insertOrgUnit(siblingUnit, ids.org, rootUnit);
    await insertClosure(rootUnit, rootUnit, 0);
    await insertClosure(targetUnit, targetUnit, 0);
    await insertClosure(siblingUnit, siblingUnit, 0);
    await insertClosure(rootUnit, targetUnit, 1);
    await insertClosure(rootUnit, siblingUnit, 1);

    await insertPublication(ids.publication, ids.variant, ids.revision, ids.user);
    // Audience: target unit with include_descendants
    await insertAudience(ids.audience, ids.publication, 'org_unit', ids.org, targetUnit, true);

    // Reader is in the sibling unit; ancestors: sibling -> root
    const ctx = makeCtx(ids, { orgUnitIds: [siblingUnit, rootUnit] });
    const rows = await availScoped(ctx);
    expect(rows.some((r) => r.contentResourceId === ids.resource)).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // AV-06: Unit audience without descendants, reader in exact unit
  // ---------------------------------------------------------------------------
  it('AV-06: Unit audience without descendants, reader in exact unit -> available', async () => {
    const p = 'av06';
    const ids = await setupBaseEntities(p);
    const exactUnit = `${p}_exact`;
    await insertOrgUnit(exactUnit, ids.org);
    await insertClosure(exactUnit, exactUnit, 0);

    await insertPublication(ids.publication, ids.variant, ids.revision, ids.user);
    await insertAudience(ids.audience, ids.publication, 'org_unit', ids.org, exactUnit, false);

    const ctx = makeCtx(ids, { orgUnitIds: [exactUnit] });
    const rows = await availScoped(ctx);
    expect(rows.some((r) => r.contentResourceId === ids.resource)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // AV-07: Unit audience without descendants, reader in child unit
  // ---------------------------------------------------------------------------
  it('AV-07: Unit audience without descendants, reader in child unit -> not available', async () => {
    const p = 'av07';
    const ids = await setupBaseEntities(p);
    const parentUnit = `${p}_parent`;
    const childUnit = `${p}_child`;
    await insertOrgUnit(parentUnit, ids.org);
    await insertOrgUnit(childUnit, ids.org, parentUnit);
    await insertClosure(parentUnit, parentUnit, 0);
    await insertClosure(childUnit, childUnit, 0);
    await insertClosure(parentUnit, childUnit, 1);

    await insertPublication(ids.publication, ids.variant, ids.revision, ids.user);
    // Audience targets parent WITHOUT descendants
    await insertAudience(ids.audience, ids.publication, 'org_unit', ids.org, parentUnit, false);

    // Reader is in child; primary = child, ancestors include parent
    const ctx = makeCtx(ids, { orgUnitIds: [childUnit, parentUnit] });
    const rows = await availScoped(ctx);
    expect(rows.some((r) => r.contentResourceId === ids.resource)).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // AV-08: Future publication
  // ---------------------------------------------------------------------------
  it('AV-08: Future publication (starts_at tomorrow) -> not available', async () => {
    const p = 'av08';
    const ids = await setupBaseEntities(p);
    await insertPublication(ids.publication, ids.variant, ids.revision, ids.user, {
      startsAt: TOMORROW,
    });
    await insertAudience(ids.audience, ids.publication, 'all_eligible');

    const ctx = makeCtx(ids);
    const rows = await availScoped(ctx);
    expect(rows.some((r) => r.contentResourceId === ids.resource)).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // AV-09: Expired publication
  // ---------------------------------------------------------------------------
  it('AV-09: Expired publication (ends_at yesterday) -> not available', async () => {
    const p = 'av09';
    const ids = await setupBaseEntities(p);
    await insertPublication(ids.publication, ids.variant, ids.revision, ids.user, {
      startsAt: LAST_MONTH,
      endsAt: YESTERDAY,
    });
    await insertAudience(ids.audience, ids.publication, 'all_eligible');

    const ctx = makeCtx(ids);
    const rows = await availScoped(ctx);
    expect(rows.some((r) => r.contentResourceId === ids.resource)).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // AV-10: Withdrawn publication
  // ---------------------------------------------------------------------------
  it('AV-10: Withdrawn publication -> not available', async () => {
    const p = 'av10';
    const ids = await setupBaseEntities(p);
    await insertPublication(ids.publication, ids.variant, ids.revision, ids.user, {
      state: 'withdrawn',
      withdrawnAt: YESTERDAY,
    });
    await insertAudience(ids.audience, ids.publication, 'all_eligible');

    const ctx = makeCtx(ids);
    const rows = await availScoped(ctx);
    expect(rows.some((r) => r.contentResourceId === ids.resource)).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // AV-11: Superseded: two publications for the same variant, newer started
  // ---------------------------------------------------------------------------
  it('AV-11: Superseded - only the newer publication is available', async () => {
    const p = 'av11';
    const ids = await setupBaseEntities(p);
    const rev2 = `${p}_rev2`;
    const pub2 = `${p}_pub2`;
    const aud2 = `${p}_aud2`;

    await insertRevision(rev2, ids.variant, ids.user, 2);

    // Older publication (started last month)
    await insertPublication(ids.publication, ids.variant, ids.revision, ids.user, {
      startsAt: LAST_MONTH,
    });
    await insertAudience(ids.audience, ids.publication, 'all_eligible');

    // Newer publication (started 2 days ago, supersedes the older one)
    await insertPublication(pub2, ids.variant, rev2, ids.user, {
      startsAt: TWO_DAYS_AGO,
    });
    await insertAudience(aud2, pub2, 'all_eligible');

    const ctx = makeCtx(ids);
    const rows = await availScoped(ctx);
    const matching = rows.filter((r) => r.contentResourceId === ids.resource);
    expect(matching).toHaveLength(1);
    expect(matching[0]!.publicationId).toBe(pub2);
  });

  // ---------------------------------------------------------------------------
  // AV-12: Superseded: older publication still shows before newer starts
  // ---------------------------------------------------------------------------
  it('AV-12: Older publication available when newer has not started yet', async () => {
    const p = 'av12';
    const ids = await setupBaseEntities(p);
    const rev2 = `${p}_rev2`;
    const pub2 = `${p}_pub2`;
    const aud2 = `${p}_aud2`;

    await insertRevision(rev2, ids.variant, ids.user, 2);

    // Currently live publication (started last week)
    await insertPublication(ids.publication, ids.variant, ids.revision, ids.user, {
      startsAt: LAST_WEEK,
    });
    await insertAudience(ids.audience, ids.publication, 'all_eligible');

    // Future publication that has not started yet
    await insertPublication(pub2, ids.variant, rev2, ids.user, {
      state: 'scheduled',
      startsAt: TOMORROW,
    });
    await insertAudience(aud2, pub2, 'all_eligible');

    const ctx = makeCtx(ids);
    const rows = await availScoped(ctx);
    const matching = rows.filter((r) => r.contentResourceId === ids.resource);
    expect(matching).toHaveLength(1);
    expect(matching[0]!.publicationId).toBe(ids.publication);
  });

  // ---------------------------------------------------------------------------
  // AV-13: Required capability enabled (built through loader) (I5)
  // ---------------------------------------------------------------------------
  it('AV-13: Required capability enabled -> available (via loader)', async () => {
    const p = 'av13';
    const ids = await setupBaseEntities(p);
    await insertCapability(`${p}_cap_gq`, ids.org, ids.user, 'general_questions');
    await insertPublication(ids.publication, ids.variant, ids.revision, ids.user, {
      requiredCapability: 'general_questions',
    });
    await insertAudience(ids.audience, ids.publication, 'all_eligible');

    // Build context through loader
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock DbService for test
    const loader = new AvailabilityContextLoader({ db: owner.db } as any);
    const ctx = await loader.forReader(
      { userId: ids.user, orgId: ids.org, membershipId: ids.membership },
      'sr-Latn',
      NOW,
      owner.db as Database,
    );
    expect(ctx.capabilities).toContain('general_questions');

    const rows = await availScoped(ctx);
    expect(rows.some((r) => r.contentResourceId === ids.resource)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // AV-14: Required capability not enabled (built through loader) (I5)
  // ---------------------------------------------------------------------------
  it('AV-14: Required capability not enabled -> not available (via loader)', async () => {
    const p = 'av14';
    const ids = await setupBaseEntities(p);
    await insertPublication(ids.publication, ids.variant, ids.revision, ids.user, {
      requiredCapability: 'general_questions',
    });
    await insertAudience(ids.audience, ids.publication, 'all_eligible');

    // Build context through loader — org has only 'library'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock DbService for test
    const loader = new AvailabilityContextLoader({ db: owner.db } as any);
    const ctx = await loader.forReader(
      { userId: ids.user, orgId: ids.org, membershipId: ids.membership },
      'sr-Latn',
      NOW,
      owner.db as Database,
    );
    expect(ctx.capabilities).not.toContain('general_questions');

    const rows = await availScoped(ctx);
    expect(rows.some((r) => r.contentResourceId === ids.resource)).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // AV-15: Required capability expired (built through loader) (I5)
  // ---------------------------------------------------------------------------
  it('AV-15: Required capability expired -> not available (via loader)', async () => {
    const p = 'av15';
    const ids = await setupBaseEntities(p);
    await insertPublication(ids.publication, ids.variant, ids.revision, ids.user, {
      requiredCapability: 'event_interest',
    });
    await insertAudience(ids.audience, ids.publication, 'all_eligible');
    // Insert an expired capability for event_interest
    await insertCapability(`${p}_cap_exp`, ids.org, ids.user, 'event_interest', LAST_YEAR, YESTERDAY);

    // Build context through loader — event_interest expired
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock DbService for test
    const loader = new AvailabilityContextLoader({ db: owner.db } as any);
    const ctx = await loader.forReader(
      { userId: ids.user, orgId: ids.org, membershipId: ids.membership },
      'sr-Latn',
      NOW,
      owner.db as Database,
    );
    expect(ctx.capabilities).not.toContain('event_interest');

    const rows = await availScoped(ctx);
    expect(rows.some((r) => r.contentResourceId === ids.resource)).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // AV-16: Media not ready
  // ---------------------------------------------------------------------------
  it('AV-16: Media not ready (state=processing) -> not available', async () => {
    const p = 'av16';
    const ids = await setupBaseEntities(p);
    const assetId = `${p}_asset`;
    await insertMediaAsset(assetId, ids.user, 'processing');
    await insertRevisionMedia(`${p}_crm`, ids.revision, assetId);

    await insertPublication(ids.publication, ids.variant, ids.revision, ids.user);
    await insertAudience(ids.audience, ids.publication, 'all_eligible');

    const ctx = makeCtx(ids);
    const rows = await availScoped(ctx);
    expect(rows.some((r) => r.contentResourceId === ids.resource)).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // AV-17: Media rights expired
  // ---------------------------------------------------------------------------
  it('AV-17: Media rights expired -> not available', async () => {
    const p = 'av17';
    const ids = await setupBaseEntities(p);
    const assetId = `${p}_asset`;
    await insertMediaAsset(assetId, ids.user, 'ready', YESTERDAY);
    await insertRevisionMedia(`${p}_crm`, ids.revision, assetId);

    await insertPublication(ids.publication, ids.variant, ids.revision, ids.user);
    await insertAudience(ids.audience, ids.publication, 'all_eligible');

    const ctx = makeCtx(ids);
    const rows = await availScoped(ctx);
    expect(rows.some((r) => r.contentResourceId === ids.resource)).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // AV-18: Membership ended — loader rejects and service returns empty (C3)
  // ---------------------------------------------------------------------------
  it('AV-18: Ended membership — loader rejects with org_context_expired', async () => {
    const p = 'av18';
    const ids = await setupBaseEntities(p);
    await insertPublication(ids.publication, ids.variant, ids.revision, ids.user);
    await insertAudience(ids.audience, ids.publication, 'all_eligible');

    // End the membership
    await owner.pool.query(
      `UPDATE memberships SET status = 'ENDED', end_date = $1 WHERE id = $2`,
      [YESTERDAY, ids.membership],
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock DbService for test
    const loader = new AvailabilityContextLoader({ db: owner.db } as any);

    // Loader should reject with org_context_expired
    const rejection = loader.forReader(
      { userId: ids.user, orgId: ids.org, membershipId: ids.membership },
      'sr-Latn',
      NOW,
      owner.db as Database,
    );
    await expect(rejection).rejects.toThrow();
    await expect(rejection).rejects.toMatchObject({ code: 'org_context_expired' });

    // Even if a context is manually constructed, fail-closed via empty capabilities
    const ctx = makeCtx(ids, { capabilities: [] });
    const rows = await availScoped(ctx);
    expect(rows.some((r) => r.contentResourceId === ids.resource)).toBe(false);

    // Restore for other tests
    await owner.pool.query(
      `UPDATE memberships SET status = 'ACTIVE', end_date = NULL WHERE id = $1`,
      [ids.membership],
    );
  });

  // ---------------------------------------------------------------------------
  // AV-19: Two memberships in different orgs; publication only in org A
  // ---------------------------------------------------------------------------
  it('AV-19: Publication available in org A, not in org B', async () => {
    const p = 'av19';
    const userId = `${p}_user`;
    const orgA = `${p}_orgA`;
    const orgB = `${p}_orgB`;
    const membA = `${p}_membA`;
    const membB = `${p}_membB`;
    const catId = `${p}_cat`;
    const resourceId = `${p}_res`;
    const variantId = `${p}_var`;
    const revisionId = `${p}_rev`;
    const pubId = `${p}_pub`;

    await insertUser(userId);
    await insertOrg(orgA, 'Org A');
    await insertOrg(orgB, 'Org B');
    await insertMembership(membA, userId, orgA);
    await insertMembership(membB, userId, orgB);
    await insertCategory(catId);
    await insertResource(resourceId, catId, userId);
    await insertVariant(variantId, resourceId);
    await insertRevision(revisionId, variantId, userId);
    await insertCapability(`${p}_capA`, orgA, userId);
    await insertCapability(`${p}_capB`, orgB, userId);
    await insertPublication(pubId, variantId, revisionId, userId);
    // Audience is org A only
    await insertAudience(`${p}_aud`, pubId, 'organization', orgA);

    // Context A
    const ctxA = makeCtx({ user: userId, org: orgA, membership: membA });
    const rowsA = await availScoped(ctxA);
    expect(rowsA.some((r) => r.contentResourceId === resourceId)).toBe(true);

    // Context B
    const ctxB = makeCtx({ user: userId, org: orgB, membership: membB });
    const rowsB = await availScoped(ctxB);
    expect(rowsB.some((r) => r.contentResourceId === resourceId)).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // AV-20: Archived resource
  // ---------------------------------------------------------------------------
  it('AV-20: Archived resource (state=archived) -> not available', async () => {
    const p = 'av20';
    const ids = await setupBaseEntities(p);
    // Override resource state to archived
    await owner.pool.query(`UPDATE content_resources SET state = 'archived' WHERE id = $1`, [ids.resource]);

    await insertPublication(ids.publication, ids.variant, ids.revision, ids.user);
    await insertAudience(ids.audience, ids.publication, 'all_eligible');

    const ctx = makeCtx(ids);
    const rows = await availScoped(ctx);
    expect(rows.some((r) => r.contentResourceId === ids.resource)).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // AV-21: Multiple audience rows (OR): org row doesn't match, all_eligible exists
  // ---------------------------------------------------------------------------
  it('AV-21: Multiple audience rows (OR) - all_eligible makes it available', async () => {
    const p = 'av21';
    const ids = await setupBaseEntities(p);
    const otherOrg = `${p}_other_org`;
    await insertOrg(otherOrg);

    await insertPublication(ids.publication, ids.variant, ids.revision, ids.user);
    // Two audience rows: one for another org, one all_eligible
    await insertAudience(`${p}_aud1`, ids.publication, 'organization', otherOrg);
    await insertAudience(`${p}_aud2`, ids.publication, 'all_eligible');

    const ctx = makeCtx(ids);
    const rows = await availScoped(ctx);
    expect(rows.some((r) => r.contentResourceId === ids.resource)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // AV-22: Organization whose library capability is disabled (via loader) (I5)
  // ---------------------------------------------------------------------------
  it('AV-22: Organization whose library capability is disabled -> not available (via loader)', async () => {
    const p = 'av22';
    const userId = `${p}_user`;
    const orgId = `${p}_org`;
    const membId = `${p}_memb`;
    const catId = `${p}_cat`;
    const resId = `${p}_res`;
    const varId = `${p}_var`;
    const revId = `${p}_rev`;
    const pubId = `${p}_pub`;

    await insertUser(userId);
    await insertOrg(orgId);
    await insertMembership(membId, userId, orgId);
    await insertCategory(catId);
    await insertResource(resId, catId, userId);
    await insertVariant(varId, resId);
    await insertRevision(revId, varId, userId);
    // Deliberately do NOT insert 'library' capability for this org
    await insertPublication(pubId, varId, revId, userId);
    await insertAudience(`${p}_aud`, pubId, 'all_eligible');

    // Build context through loader — no capabilities
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock DbService for test
    const loader = new AvailabilityContextLoader({ db: owner.db } as any);
    const ctx = await loader.forReader(
      { userId, orgId, membershipId: membId },
      'sr-Latn',
      NOW,
      owner.db as Database,
    );
    expect(ctx.capabilities).toEqual([]);

    const rows = await availScoped(ctx);
    expect(rows.some((r) => r.contentResourceId === resId)).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // AV-23: sr-Cyrl reader gets the sr-Latn publication (C-28)
  //        All three authored variants present; exactly one sr-Latn row returned.
  // ---------------------------------------------------------------------------
  it('AV-23: sr-Cyrl reader gets exactly the sr-Latn publication (3 variants)', async () => {
    const p = 'av23';
    const ids = await setupBaseEntities(p);

    // sr-Latn variant + publication (already from setupBaseEntities)
    await insertPublication(ids.publication, ids.variant, ids.revision, ids.user);
    await insertAudience(ids.audience, ids.publication, 'all_eligible');

    // hu variant + publication
    const huVar = `${p}_hu_var`;
    const huRev = `${p}_hu_rev`;
    const huPub = `${p}_hu_pub`;
    await insertVariant(huVar, ids.resource, 'hu', `${p}_hu_slug`);
    await insertRevision(huRev, huVar, ids.user);
    await insertPublication(huPub, huVar, huRev, ids.user);
    await insertAudience(`${p}_hu_aud`, huPub, 'all_eligible');

    // en variant + publication
    const enVar = `${p}_en_var`;
    const enRev = `${p}_en_rev`;
    const enPub = `${p}_en_pub`;
    await insertVariant(enVar, ids.resource, 'en', `${p}_en_slug`);
    await insertRevision(enRev, enVar, ids.user);
    await insertPublication(enPub, enVar, enRev, ids.user);
    await insertAudience(`${p}_en_aud`, enPub, 'all_eligible');

    // sr-Cyrl reader should get exactly one row: the sr-Latn variant
    const ctx = makeCtx(ids, { readerLocale: 'sr-Cyrl' });
    const rows = await availScoped(ctx);
    const matching = rows.filter((r) => r.contentResourceId === ids.resource);
    expect(matching).toHaveLength(1);
    expect(matching[0]!.locale).toBe('sr-Latn');
  });

  // ---------------------------------------------------------------------------
  // AV-24: hu publication withdrawn alone; unavailable to hu readers,
  //        still available to sr-Latn readers.
  //        NOTE: logging assertion moved to T-C1.11 (observability task).
  // ---------------------------------------------------------------------------
  it('AV-24: hu publication withdrawn alone - unavailable to hu, available to sr-Latn', async () => {
    const p = 'av24';
    const ids = await setupBaseEntities(p);
    // Create variant and publication for hu
    const huVar = `${p}_hu_var`;
    const huRev = `${p}_hu_rev`;
    const huPub = `${p}_hu_pub`;
    await insertVariant(huVar, ids.resource, 'hu', `${p}_hu_slug`);
    await insertRevision(huRev, huVar, ids.user);
    await insertPublication(huPub, huVar, huRev, ids.user, {
      state: 'withdrawn',
      withdrawnAt: YESTERDAY,
    });
    await insertAudience(`${p}_hu_aud`, huPub, 'all_eligible');

    // sr-Latn publication is live
    await insertPublication(ids.publication, ids.variant, ids.revision, ids.user);
    await insertAudience(ids.audience, ids.publication, 'all_eligible');

    // hu reader: the hu publication was withdrawn -> not available
    const ctxHu = makeCtx(ids, { readerLocale: 'hu' });
    const rowsHu = await availScoped(ctxHu);
    expect(rowsHu.some((r) => r.contentResourceId === ids.resource)).toBe(false);

    // sr-Latn reader: the sr-Latn publication is still live -> available
    const ctxSr = makeCtx(ids, { readerLocale: 'sr-Latn' });
    const rowsSr = await availScoped(ctxSr);
    expect(rowsSr.some((r) => r.contentResourceId === ids.resource)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Fail-closed: publication with zero audience rows -> not available
  // ---------------------------------------------------------------------------
  it('Fail-closed: publication with zero audience rows -> not available', async () => {
    const p = 'av_fc';
    const ids = await setupBaseEntities(p);
    await insertPublication(ids.publication, ids.variant, ids.revision, ids.user);
    // No audience rows inserted

    const ctx = makeCtx(ids);
    const rows = await availScoped(ctx);
    expect(rows.some((r) => r.contentResourceId === ids.resource)).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Boundary tests (I5): ends_at = now, starts_at = now, rights_expires_at = now
  // ---------------------------------------------------------------------------
  describe('Boundary conditions (I5)', () => {
    it('ends_at = now -> not available (strict inequality: > now)', async () => {
      const p = 'bnd_end';
      const ids = await setupBaseEntities(p);
      await insertPublication(ids.publication, ids.variant, ids.revision, ids.user, {
        startsAt: LAST_WEEK,
        endsAt: NOW, // exactly now
      });
      await insertAudience(ids.audience, ids.publication, 'all_eligible');

      const ctx = makeCtx(ids);
      const rows = await availScoped(ctx);
      expect(rows.some((r) => r.contentResourceId === ids.resource)).toBe(false);
    });

    it('starts_at = now -> available (inclusive: <= now)', async () => {
      const p = 'bnd_start';
      const ids = await setupBaseEntities(p);
      await insertPublication(ids.publication, ids.variant, ids.revision, ids.user, {
        startsAt: NOW, // exactly now
      });
      await insertAudience(ids.audience, ids.publication, 'all_eligible');

      const ctx = makeCtx(ids);
      const rows = await availScoped(ctx);
      expect(rows.some((r) => r.contentResourceId === ids.resource)).toBe(true);
    });

    it('rights_expires_at = now -> not available (inclusive: <= now means expired)', async () => {
      const p = 'bnd_rights';
      const ids = await setupBaseEntities(p);
      const assetId = `${p}_asset`;
      await insertMediaAsset(assetId, ids.user, 'ready', NOW); // expires exactly now
      await insertRevisionMedia(`${p}_crm`, ids.revision, assetId);

      await insertPublication(ids.publication, ids.variant, ids.revision, ids.user);
      await insertAudience(ids.audience, ids.publication, 'all_eligible');

      const ctx = makeCtx(ids);
      const rows = await availScoped(ctx);
      expect(rows.some((r) => r.contentResourceId === ids.resource)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Mismatched org/membership test (C3)
  // ---------------------------------------------------------------------------
  it('Mismatched membership org — loader.forReader rejects', async () => {
    const p = 'mismatch';
    const userId = `${p}_user`;
    const orgA = `${p}_orgA`;
    const orgB = `${p}_orgB`;
    const membA = `${p}_membA`;

    await insertUser(userId);
    await insertOrg(orgA);
    await insertOrg(orgB);
    await insertMembership(membA, userId, orgA);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock DbService for test
    const loader = new AvailabilityContextLoader({ db: owner.db } as any);

    // Try to use membA (belongs to orgA) with orgB — should reject
    const rejection = loader.forReader(
      { userId, orgId: orgB, membershipId: membA },
      'sr-Latn',
      NOW,
      owner.db as Database,
    );
    await expect(rejection).rejects.toThrow();
    await expect(rejection).rejects.toMatchObject({ code: 'org_context_expired' });
  });

  // ---------------------------------------------------------------------------
  // forPreview tests (I6)
  // ---------------------------------------------------------------------------
  describe('AvailabilityContextLoader.forPreview', () => {
    it('builds preview context without membership validation', async () => {
      const p = 'preview_ctx';
      const userId = `${p}_user`;
      const orgId = `${p}_org`;
      const unitId = `${p}_unit`;

      await insertUser(userId);
      await insertOrg(orgId);
      await insertOrgUnit(unitId, orgId);
      await insertClosure(unitId, unitId, 0);
      await insertCapability(`${p}_cap`, orgId, userId);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock DbService for test
      const loader = new AvailabilityContextLoader({ db: owner.db } as any);
      const ctx = await loader.forPreview(
        { orgId, orgUnitId: unitId, readerLocale: 'sr-Latn', now: NOW },
        owner.db,
      );

      expect(ctx.kind).toBe('preview');
      expect(ctx.orgId).toBe(orgId);
      expect(ctx.orgUnitIds).toEqual([unitId]);
      expect(ctx.capabilities).toEqual(['library']);
    });

    it('forPreview with null orgUnitId gives empty orgUnitIds', async () => {
      const p = 'preview_null';
      const userId = `${p}_user`;
      const orgId = `${p}_org`;

      await insertUser(userId);
      await insertOrg(orgId);
      await insertCapability(`${p}_cap`, orgId, userId);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock DbService for test
      const loader = new AvailabilityContextLoader({ db: owner.db } as any);
      const ctx = await loader.forPreview(
        { orgId, orgUnitId: null, readerLocale: 'hu', now: NOW },
        owner.db,
      );

      expect(ctx.orgUnitIds).toEqual([]);
      expect(ctx.readerLocale).toBe('hu');
    });

    it('forPreview rejects when orgUnitId belongs to a different org', async () => {
      const p = 'preview_mis';
      const userId = `${p}_user`;
      const orgA = `${p}_orgA`;
      const orgB = `${p}_orgB`;
      const unitA = `${p}_unitA`;

      await insertUser(userId);
      await insertOrg(orgA);
      await insertOrg(orgB);
      await insertOrgUnit(unitA, orgA);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock DbService for test
      const loader = new AvailabilityContextLoader({ db: owner.db } as any);

      const rejection = loader.forPreview(
        { orgId: orgB, orgUnitId: unitA, readerLocale: 'sr-Latn', now: NOW },
        owner.db,
      );
      await expect(rejection).rejects.toThrow();
      await expect(rejection).rejects.toMatchObject({ code: 'org_unit_mismatch' });
    });
  });

  // ---------------------------------------------------------------------------
  // Composability test (C1): .as('avail') exposes column aliases
  // ---------------------------------------------------------------------------
  it('C1: .as("avail") exposes publicationId, variantId, contentResourceId, locale', async () => {
    const p = 'compose';
    const ids = await setupBaseEntities(p);
    await insertPublication(ids.publication, ids.variant, ids.revision, ids.user);
    await insertAudience(ids.audience, ids.publication, 'all_eligible');

    const ctx = makeCtx(ids, { kind: 'preview' });
    await withOrgScope(app.db as Database, ctx.orgId, async (tx) => {
      const sq = svc.availablePublications(ctx, tx).as('avail');

      // Should be able to reference all four columns
      const rows = await tx
        .select({
          pid: sq.publicationId,
          vid: sq.variantId,
          rid: sq.contentResourceId,
          loc: sq.locale,
        })
        .from(sq)
        .where(eq(sq.contentResourceId, ids.resource));

      expect(rows).toHaveLength(1);
      expect(rows[0]!.pid).toBe(ids.publication);
      expect(rows[0]!.vid).toBe(ids.variant);
      expect(rows[0]!.rid).toBe(ids.resource);
      expect(rows[0]!.loc).toBe('sr-Latn');
    });
  });

  // ---------------------------------------------------------------------------
  // Consistency spec
  // ---------------------------------------------------------------------------
  describe('Consistency: all helpers agree on the same data', () => {
    const cp = 'cons';
    const userId = `${cp}_user`;
    const orgA = `${cp}_orgA`;
    const orgB = `${cp}_orgB`;
    const membA = `${cp}_membA`;
    const membB = `${cp}_membB`;
    const catId = `${cp}_cat`;

    // Resources
    const availResId = `${cp}_avail_res`;
    const tenantResId = `${cp}_tenant_res`;
    const futureResId = `${cp}_future_res`;
    const withdrawnResId = `${cp}_withdrawn_res`;
    const mediaExpResId = `${cp}_media_exp_res`;
    const capOffResId = `${cp}_cap_off_res`;

    beforeAll(async () => {
      await insertUser(userId);
      await insertOrg(orgA, 'Cons Org A');
      await insertOrg(orgB, 'Cons Org B');
      await insertMembership(membA, userId, orgA);
      await insertMembership(membB, userId, orgB);
      await insertCategory(catId);
      await insertCapability(`${cp}_capA`, orgA, userId, 'library');
      await insertCapability(`${cp}_capB`, orgB, userId, 'library');

      // 1. Available resource (global audience)
      await insertResource(availResId, catId, userId);
      await insertVariant(`${cp}_avail_var`, availResId, 'sr-Latn', `${cp}_avail_slug`);
      await insertRevision(`${cp}_avail_rev`, `${cp}_avail_var`, userId);
      await insertPublication(`${cp}_avail_pub`, `${cp}_avail_var`, `${cp}_avail_rev`, userId);
      await insertAudience(`${cp}_avail_aud`, `${cp}_avail_pub`, 'all_eligible');

      // 2. Tenant-restricted resource (org A only)
      await insertResource(tenantResId, catId, userId);
      await insertVariant(`${cp}_tenant_var`, tenantResId, 'sr-Latn', `${cp}_tenant_slug`);
      await insertRevision(`${cp}_tenant_rev`, `${cp}_tenant_var`, userId);
      await insertPublication(`${cp}_tenant_pub`, `${cp}_tenant_var`, `${cp}_tenant_rev`, userId);
      await insertAudience(`${cp}_tenant_aud`, `${cp}_tenant_pub`, 'organization', orgA);

      // 3. Future resource
      await insertResource(futureResId, catId, userId);
      await insertVariant(`${cp}_future_var`, futureResId, 'sr-Latn', `${cp}_future_slug`);
      await insertRevision(`${cp}_future_rev`, `${cp}_future_var`, userId);
      await insertPublication(`${cp}_future_pub`, `${cp}_future_var`, `${cp}_future_rev`, userId, {
        startsAt: TOMORROW,
      });
      await insertAudience(`${cp}_future_aud`, `${cp}_future_pub`, 'all_eligible');

      // 4. Withdrawn resource
      await insertResource(withdrawnResId, catId, userId);
      await insertVariant(`${cp}_withdrawn_var`, withdrawnResId, 'sr-Latn', `${cp}_withdrawn_slug`);
      await insertRevision(`${cp}_withdrawn_rev`, `${cp}_withdrawn_var`, userId);
      await insertPublication(`${cp}_withdrawn_pub`, `${cp}_withdrawn_var`, `${cp}_withdrawn_rev`, userId, {
        state: 'withdrawn',
        withdrawnAt: YESTERDAY,
      });
      await insertAudience(`${cp}_withdrawn_aud`, `${cp}_withdrawn_pub`, 'all_eligible');

      // 5. Media-expired resource
      await insertResource(mediaExpResId, catId, userId);
      await insertVariant(`${cp}_mediaexp_var`, mediaExpResId, 'sr-Latn', `${cp}_mediaexp_slug`);
      await insertRevision(`${cp}_mediaexp_rev`, `${cp}_mediaexp_var`, userId);
      const assetId = `${cp}_mediaexp_asset`;
      await insertMediaAsset(assetId, userId, 'ready', YESTERDAY);
      await insertRevisionMedia(`${cp}_mediaexp_crm`, `${cp}_mediaexp_rev`, assetId);
      await insertPublication(`${cp}_mediaexp_pub`, `${cp}_mediaexp_var`, `${cp}_mediaexp_rev`, userId);
      await insertAudience(`${cp}_mediaexp_aud`, `${cp}_mediaexp_pub`, 'all_eligible');

      // 6. Capability-off resource (requires 'event_interest', not enabled)
      await insertResource(capOffResId, catId, userId);
      await insertVariant(`${cp}_capoff_var`, capOffResId, 'sr-Latn', `${cp}_capoff_slug`);
      await insertRevision(`${cp}_capoff_rev`, `${cp}_capoff_var`, userId);
      await insertPublication(`${cp}_capoff_pub`, `${cp}_capoff_var`, `${cp}_capoff_rev`, userId, {
        requiredCapability: 'event_interest',
      });
      await insertAudience(`${cp}_capoff_aud`, `${cp}_capoff_pub`, 'all_eligible');
    });

    it('availablePublications, isAvailable, availableResourceIds agree for org A', async () => {
      const ctxA: AvailabilityContext = {
        kind: 'reader',
        userId,
        orgId: orgA,
        membershipId: membA,
        orgUnitIds: [],
        capabilities: ['library'],
        readerLocale: 'sr-Latn',
        now: NOW,
      };

      const allPubs = await availScoped(ctxA);
      const allResourceIds = allPubs.map((r) => r.contentResourceId);

      // Available and tenant-restricted (org A) should be available
      expect(allResourceIds).toContain(availResId);
      expect(allResourceIds).toContain(tenantResId);
      // Future, withdrawn, media-expired, cap-off should not be
      expect(allResourceIds).not.toContain(futureResId);
      expect(allResourceIds).not.toContain(withdrawnResId);
      expect(allResourceIds).not.toContain(mediaExpResId);
      expect(allResourceIds).not.toContain(capOffResId);

      // isAvailable agrees
      await withOrgScope(app.db as Database, ctxA.orgId, async (tx) => {
        expect(await svc.isAvailable(ctxA, tx, availResId)).not.toBeNull();
        expect(await svc.isAvailable(ctxA, tx, tenantResId)).not.toBeNull();
        expect(await svc.isAvailable(ctxA, tx, futureResId)).toBeNull();
        expect(await svc.isAvailable(ctxA, tx, withdrawnResId)).toBeNull();
        expect(await svc.isAvailable(ctxA, tx, mediaExpResId)).toBeNull();
        expect(await svc.isAvailable(ctxA, tx, capOffResId)).toBeNull();
      });

      // availableResourceIds agrees
      await withOrgScope(app.db as Database, ctxA.orgId, async (tx) => {
        const filtered = await svc.availableResourceIds(ctxA, tx, [
          availResId, tenantResId, futureResId, withdrawnResId, mediaExpResId, capOffResId,
        ]);
        expect(filtered.sort()).toEqual([availResId, tenantResId].sort());
      });
    });

    it('availablePublications, isAvailable, availableResourceIds agree for org B', async () => {
      const ctxB: AvailabilityContext = {
        kind: 'reader',
        userId,
        orgId: orgB,
        membershipId: membB,
        orgUnitIds: [],
        capabilities: ['library'],
        readerLocale: 'sr-Latn',
        now: NOW,
      };

      const allPubs = await availScoped(ctxB);
      const allResourceIds = allPubs.map((r) => r.contentResourceId);

      // Available (global) should be in B; tenant-restricted to A should NOT
      expect(allResourceIds).toContain(availResId);
      expect(allResourceIds).not.toContain(tenantResId);

      // isAvailable agrees
      await withOrgScope(app.db as Database, ctxB.orgId, async (tx) => {
        expect(await svc.isAvailable(ctxB, tx, availResId)).not.toBeNull();
        expect(await svc.isAvailable(ctxB, tx, tenantResId)).toBeNull();
      });

      // availableResourceIds agrees
      await withOrgScope(app.db as Database, ctxB.orgId, async (tx) => {
        const filtered = await svc.availableResourceIds(ctxB, tx, [
          availResId, tenantResId,
        ]);
        expect(filtered).toEqual([availResId]);
      });
    });

    it('isMediaAssetAvailable for the media-expired asset returns false', async () => {
      const ctxA: AvailabilityContext = {
        kind: 'reader',
        userId,
        orgId: orgA,
        membershipId: membA,
        orgUnitIds: [],
        capabilities: ['library'],
        readerLocale: 'sr-Latn',
        now: NOW,
      };
      await withOrgScope(app.db as Database, ctxA.orgId, async (tx) => {
        const result = await svc.isMediaAssetAvailable(ctxA, tx, `${cp}_mediaexp_asset`);
        expect(result).toBe(false);
      });
    });

    it('preview of org A equals a real org A context', async () => {
      const ctxA: AvailabilityContext = {
        kind: 'reader',
        userId,
        orgId: orgA,
        membershipId: membA,
        orgUnitIds: [],
        capabilities: ['library'],
        readerLocale: 'sr-Latn',
        now: NOW,
      };

      const simulatedCtx: AvailabilityContext = {
        kind: 'preview',
        userId: 'simulated_preview_user',
        orgId: orgA,
        membershipId: 'simulated_membership',
        orgUnitIds: [],
        capabilities: ['library'],
        readerLocale: 'sr-Latn',
        now: NOW,
      };

      const realPubs = await availScoped(ctxA);
      const previewPubs = await availScoped(simulatedCtx);

      // They should return the same set of content resource ids
      const realIds = realPubs.map((r) => r.contentResourceId).sort();
      const previewIds = previewPubs.map((r) => r.contentResourceId).sort();
      expect(previewIds).toEqual(realIds);
    });
  });

  // ---------------------------------------------------------------------------
  // Context loader tests
  // ---------------------------------------------------------------------------
  describe('AvailabilityContextLoader', () => {
    it('loadOrgUnitIds returns [primary, ...ancestors where depth > 0]', async () => {
      const p = 'ctx_loader';
      const userId = `${p}_user`;
      const orgId = `${p}_org`;
      const membId = `${p}_memb`;
      const rootUnit = `${p}_root`;
      const deptUnit = `${p}_dept`;
      const teamUnit = `${p}_team`;

      await insertUser(userId);
      await insertOrg(orgId);
      await insertOrgUnit(rootUnit, orgId);
      await insertOrgUnit(deptUnit, orgId, rootUnit);
      await insertOrgUnit(teamUnit, orgId, deptUnit);
      // Closure entries
      await insertClosure(rootUnit, rootUnit, 0);
      await insertClosure(deptUnit, deptUnit, 0);
      await insertClosure(teamUnit, teamUnit, 0);
      await insertClosure(rootUnit, deptUnit, 1);
      await insertClosure(rootUnit, teamUnit, 2);
      await insertClosure(deptUnit, teamUnit, 1);
      // Membership with primary unit = team
      await insertMembership(membId, userId, orgId, 'ACTIVE', teamUnit);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock DbService for test
      const loader = new AvailabilityContextLoader({ db: owner.db } as any);
      const ctx = await loader.forReader(
        { userId, orgId, membershipId: membId },
        'sr-Latn',
        NOW,
        owner.db as Database,
      );

      // Should include: team (primary), dept (parent), root (grandparent) in order
      expect(ctx.orgUnitIds).toEqual([teamUnit, deptUnit, rootUnit]);
    });

    it('loadCapabilities returns enabled capabilities at now', async () => {
      const p = 'ctx_cap';
      const userId = `${p}_user`;
      const orgId = `${p}_org`;
      const membId = `${p}_memb`;

      await insertUser(userId);
      await insertOrg(orgId);
      await insertMembership(membId, userId, orgId);

      // library: enabled, no end
      await insertCapability(`${p}_lib`, orgId, userId, 'library', LAST_YEAR, null);
      // general_questions: enabled but expired
      await insertCapability(`${p}_gq`, orgId, userId, 'general_questions', LAST_YEAR, YESTERDAY);
      // event_interest: future start
      await insertCapability(`${p}_ei`, orgId, userId, 'event_interest', TOMORROW, null);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock DbService for test
      const loader = new AvailabilityContextLoader({ db: owner.db } as any);
      const ctx = await loader.forReader(
        { userId, orgId, membershipId: membId },
        'sr-Latn',
        NOW,
        owner.db as Database,
      );

      // Only 'library' should be active at NOW
      expect(ctx.capabilities).toEqual(['library']);
    });

    it('sr-Cyrl reader locale maps to sr-Latn in the context', async () => {
      const p = 'ctx_cyrl';
      const userId = `${p}_user`;
      const orgId = `${p}_org`;
      const membId = `${p}_memb`;

      await insertUser(userId);
      await insertOrg(orgId);
      await insertMembership(membId, userId, orgId);
      await insertCapability(`${p}_cap`, orgId, userId);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock DbService for test
      const loader = new AvailabilityContextLoader({ db: owner.db } as any);
      const ctx = await loader.forReader(
        { userId, orgId, membershipId: membId },
        'sr-Cyrl',
        NOW,
        owner.db as Database,
      );

      // readerLocale should be preserved as sr-Cyrl
      expect(ctx.readerLocale).toBe('sr-Cyrl');

      // But when used in the query, authoredLocale maps it to sr-Latn
      const { authoredLocale } = await import(
        '../../src/library/availability/availability-context.js'
      );
      expect(authoredLocale(ctx.readerLocale)).toBe('sr-Latn');
    });
  });

  // ---------------------------------------------------------------------------
  // Nest module smoke test
  // ---------------------------------------------------------------------------
  it('AvailabilityModule exports the expected providers', async () => {
    const { AvailabilityModule } = await import(
      '../../src/library/availability/availability.module.js'
    );
    // Verify the module metadata lists the expected exports
    const meta = Reflect.getMetadata('exports', AvailabilityModule);
    expect(meta).toBeDefined();
    const { AvailabilityService: AS } = await import(
      '../../src/library/availability/availability.service.js'
    );
    const { AvailabilityContextLoader: ACL } = await import(
      '../../src/library/availability/availability-context-loader.js'
    );
    const { AvailabilityVersionService: AVS } = await import(
      '../../src/library/availability/availability-version.service.js'
    );
    expect(meta).toContain(AS);
    expect(meta).toContain(ACL);
    expect(meta).toContain(AVS);
  });
});
