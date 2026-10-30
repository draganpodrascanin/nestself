/**
 * Database-level integration tests for the CMS foundation schema (T-C1.04).
 *
 * Covers migration 0006 (enums, tables, extensions, custom SQL), RLS on the
 * five new tenant tables, constraint invariants and the seed additions.
 */
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { withOrgScope } from '../../src/db/db.service.js';
import { seed } from '../../src/db/seed/seed-lib.js';
import { SAMPLE_CATEGORY_IDS, SAMPLE_CATEGORY_LABELS } from '@nestself/sample-data';
import {
  categories,
  categoryLabels,
  contentPreferences,
  notifications,
  orgContentCapabilities,
  playbackStates,
  savedItems,
} from '../../src/db/schema/index.js';
import { connectAsAppRole, resetTestDatabase, type TestDatabase } from './test-database.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const shouldRun = !!TEST_DB_URL;

describe.skipIf(!shouldRun)('CMS foundation schema integration tests (T-C1.04)', () => {
  let owner: TestDatabase;
  let app: TestDatabase;

  beforeAll(async () => {
    owner = await resetTestDatabase(TEST_DB_URL!, 'cms');
    app = await connectAsAppRole(owner);
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await owner?.close();
  });

  // ── Migration and extensions ──────────────────────────────────────────

  it('migration applies on a fresh database', async () => {
    const { rows } = await owner.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM drizzle.__drizzle_migrations",
    );
    // 0000 through 0007 = 8 migrations (SSO domains at 0006, CMS at 0007)
    expect(Number(rows[0]!.n)).toBe(8);
  });

  it('nestself_unaccent returns unaccented text', async () => {
    const { rows } = await owner.pool.query<{ result: string }>(
      "SELECT public.nestself_unaccent('Đorđe Šarić') AS result",
    );
    expect(rows[0]!.result).toBe('Dorde Saric');
  });

  it('nestself_unaccent works under empty search_path (PG 17 index safety)', async () => {
    // Postgres 17 restricts search_path during CREATE INDEX / REINDEX / VACUUM.
    // The function must resolve when search_path is empty.
    const client = await owner.pool.connect();
    try {
      await client.query("SET LOCAL search_path = ''");
      const { rows } = await client.query<{ result: string }>(
        "SELECT public.nestself_unaccent('Āçcéntèd') AS result",
      );
      expect(rows[0]!.result).toBe('Accented');
    } finally {
      client.release();
    }
  });

  it('expression and trigram indexes using nestself_unaccent work', async () => {
    await owner.pool.query(`
      CREATE TEMP TABLE _scratch_unaccent (id serial PRIMARY KEY, name text NOT NULL);
      INSERT INTO _scratch_unaccent (name) VALUES ('Đorđe'), ('Šarić'), ('Normal');
    `);
    // Expression index
    await owner.pool.query(
      `CREATE INDEX _scratch_expr_idx ON _scratch_unaccent (public.nestself_unaccent(name))`,
    );
    // Trigram index
    await owner.pool.query(
      `CREATE INDEX _scratch_trgm_idx ON _scratch_unaccent USING gist (public.nestself_unaccent(name) gist_trgm_ops)`,
    );
    // Query using the expression
    const { rows } = await owner.pool.query<{ name: string }>(
      `SELECT name FROM _scratch_unaccent WHERE public.nestself_unaccent(name) = 'Dorde'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe('Đorđe');
  });

  it('pg_trgm extension is installed', async () => {
    const { rows } = await owner.pool.query<{ extname: string }>(
      "SELECT extname FROM pg_extension WHERE extname = 'pg_trgm'",
    );
    expect(rows).toHaveLength(1);
  });

  it('nestself_app has privileges on every new table', async () => {
    const tables = [
      'saved_items', 'playback_states', 'content_preferences',
      'org_content_capabilities', 'notifications', 'content_resources',
      'content_variants', 'content_revisions', 'content_revision_media',
      'content_publications', 'content_publication_audiences',
      'categories', 'category_labels', 'media_assets', 'media_renditions',
      'outbox_events', 'outbox_deliveries',
    ];
    for (const table of tables) {
      const { rows } = await owner.pool.query<{ has: boolean }>(
        `SELECT has_table_privilege('nestself_app', $1, 'SELECT,INSERT,UPDATE,DELETE') AS has`,
        [table],
      );
      expect(rows[0]!.has, `nestself_app missing privileges on ${table}`).toBe(true);
    }
  });

  // ── RLS on the five new tenant tables ─────────────────────────────────

  describe('row-level security on new tenant tables', () => {
    const orgA = 'cms_rls_org_a';
    const orgB = 'cms_rls_org_b';
    const userId = 'cms_rls_user';
    const memberA = 'cms_rls_membership_a';
    const memberB = 'cms_rls_membership_b';
    const resourceId = 'cms_rls_resource';

    beforeAll(async () => {
      // Set up two orgs, a user with memberships in both, and a content resource
      await owner.pool.query(`INSERT INTO users (id, email, display_name) VALUES ($1, $2, 'CMS RLS User')`, [userId, 'cms_rls@example.com']);
      await owner.pool.query(`INSERT INTO organizations (id, name, slug) VALUES ($1, 'CMS A', 'cms-a')`, [orgA]);
      await owner.pool.query(`INSERT INTO organizations (id, name, slug) VALUES ($1, 'CMS B', 'cms-b')`, [orgB]);
      await owner.pool.query(
        `INSERT INTO memberships (id, user_id, org_id, status, start_date) VALUES ($1, $2, $3, 'ACTIVE', '2026-01-01')`,
        [memberA, userId, orgA],
      );
      await owner.pool.query(
        `INSERT INTO memberships (id, user_id, org_id, status, start_date) VALUES ($1, $2, $3, 'ACTIVE', '2026-01-01')`,
        [memberB, userId, orgB],
      );
      // A category and resource for saved_items / playback_states / content_preferences
      await owner.pool.query(`INSERT INTO categories (id, slug) VALUES ('cms_rls_cat', 'cms-rls-cat')`);
      await owner.pool.query(
        `INSERT INTO content_resources (id, type, primary_category_id, owner_user_id, review_discipline) VALUES ($1, 'article', 'cms_rls_cat', $2, 'general')`,
        [resourceId, userId],
      );
    });

    it('tenant tables have RLS enabled and forced', async () => {
      const { rows } = await owner.pool.query<{ relname: string; rls: boolean; forced: boolean }>(
        `SELECT relname, relrowsecurity AS rls, relforcerowsecurity AS forced FROM pg_class
         WHERE relname IN ('saved_items','playback_states','content_preferences','org_content_capabilities','notifications')`,
      );
      expect(rows).toHaveLength(5);
      for (const row of rows) {
        expect(row.rls, row.relname).toBe(true);
        expect(row.forced, row.relname).toBe(true);
      }
    });

    it('saved_items: org B rows invisible under org A scope; insert for org B fails', async () => {
      await owner.pool.query(
        `INSERT INTO saved_items (id, user_id, membership_id, org_id, content_resource_id) VALUES ('si_a', $1, $2, $3, $4)`,
        [userId, memberA, orgA, resourceId],
      );
      await owner.pool.query(
        `INSERT INTO saved_items (id, user_id, membership_id, org_id, content_resource_id) VALUES ('si_b', $1, $2, $3, $4)`,
        [userId, memberB, orgB, resourceId],
      );

      const fromA = await withOrgScope(app.db, orgA, (tx) =>
        tx.select({ id: savedItems.id }).from(savedItems),
      );
      expect(fromA.map((r) => r.id)).toEqual(['si_a']);

      const err = await withOrgScope(app.db, orgA, (tx) =>
        tx.insert(savedItems).values({
          id: 'si_leak', userId, membershipId: memberB, orgId: orgB, contentResourceId: resourceId,
        }),
      ).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      const cause = (err as Error & { cause?: Error }).cause ?? (err as Error);
      expect(cause.message).toMatch(/row-level security policy/);
    });

    it('playback_states: org B rows invisible under org A scope; insert for org B fails', async () => {
      await owner.pool.query(
        `INSERT INTO playback_states (id, user_id, membership_id, org_id, content_resource_id, position_seconds) VALUES ('pb_a', $1, $2, $3, $4, 100)`,
        [userId, memberA, orgA, resourceId],
      );
      await owner.pool.query(
        `INSERT INTO playback_states (id, user_id, membership_id, org_id, content_resource_id, position_seconds) VALUES ('pb_b', $1, $2, $3, $4, 200)`,
        [userId, memberB, orgB, resourceId],
      );

      const fromA = await withOrgScope(app.db, orgA, (tx) =>
        tx.select({ id: playbackStates.id }).from(playbackStates),
      );
      expect(fromA.map((r) => r.id)).toEqual(['pb_a']);

      const err = await withOrgScope(app.db, orgA, (tx) =>
        tx.insert(playbackStates).values({
          id: 'pb_leak', userId, membershipId: memberB, orgId: orgB, contentResourceId: resourceId,
        }),
      ).catch((e: unknown) => e);
      const cause = (err as Error & { cause?: Error }).cause ?? (err as Error);
      expect(cause.message).toMatch(/row-level security policy/);
    });

    it('content_preferences: org B rows invisible under org A scope; insert for org B fails', async () => {
      await owner.pool.query(
        `INSERT INTO content_preferences (id, user_id, membership_id, org_id) VALUES ('cp_a', $1, $2, $3)`,
        [userId, memberA, orgA],
      );
      await owner.pool.query(
        `INSERT INTO content_preferences (id, user_id, membership_id, org_id) VALUES ('cp_b', $1, $2, $3)`,
        [userId, memberB, orgB],
      );

      const fromA = await withOrgScope(app.db, orgA, (tx) =>
        tx.select({ id: contentPreferences.id }).from(contentPreferences),
      );
      expect(fromA.map((r) => r.id)).toEqual(['cp_a']);

      const err = await withOrgScope(app.db, orgA, (tx) =>
        tx.insert(contentPreferences).values({
          id: 'cp_leak', userId, membershipId: memberB, orgId: orgB,
        }),
      ).catch((e: unknown) => e);
      const cause = (err as Error & { cause?: Error }).cause ?? (err as Error);
      expect(cause.message).toMatch(/row-level security policy/);
    });

    it('org_content_capabilities: org B rows invisible under org A scope; insert for org B fails', async () => {
      await owner.pool.query(
        `INSERT INTO org_content_capabilities (id, org_id, capability, enabled_from, configured_by_user_id)
         VALUES ('occ_a', $1, 'library', '2026-01-01', $2)`,
        [orgA, userId],
      );
      await owner.pool.query(
        `INSERT INTO org_content_capabilities (id, org_id, capability, enabled_from, configured_by_user_id)
         VALUES ('occ_b', $1, 'library', '2026-01-01', $2)`,
        [orgB, userId],
      );

      const fromA = await withOrgScope(app.db, orgA, (tx) =>
        tx.select({ id: orgContentCapabilities.id }).from(orgContentCapabilities),
      );
      expect(fromA.map((r) => r.id)).toEqual(['occ_a']);

      const err = await withOrgScope(app.db, orgA, (tx) =>
        tx.insert(orgContentCapabilities).values({
          id: 'occ_leak', orgId: orgB, capability: 'general_questions',
          enabledFrom: new Date('2026-01-01'), configuredByUserId: userId,
        }),
      ).catch((e: unknown) => e);
      const cause = (err as Error & { cause?: Error }).cause ?? (err as Error);
      expect(cause.message).toMatch(/row-level security policy/);
    });

    it('notifications: org B rows invisible under org A scope; insert for org B fails', async () => {
      await owner.pool.query(
        `INSERT INTO notifications (id, user_id, org_id, kind, target_type, target_id)
         VALUES ('notif_a', $1, $2, 'review_ready', 'content_revision', 'rev_1')`,
        [userId, orgA],
      );
      await owner.pool.query(
        `INSERT INTO notifications (id, user_id, org_id, kind, target_type, target_id)
         VALUES ('notif_b', $1, $2, 'review_ready', 'content_revision', 'rev_2')`,
        [userId, orgB],
      );

      const fromA = await withOrgScope(app.db, orgA, (tx) =>
        tx.select({ id: notifications.id }).from(notifications),
      );
      expect(fromA.map((r) => r.id)).toEqual(['notif_a']);

      const err = await withOrgScope(app.db, orgA, (tx) =>
        tx.insert(notifications).values({
          id: 'notif_leak', userId, orgId: orgB, kind: 'review_ready',
          targetType: 'content_revision', targetId: 'rev_3',
        }),
      ).catch((e: unknown) => e);
      const cause = (err as Error & { cause?: Error }).cause ?? (err as Error);
      expect(cause.message).toMatch(/row-level security policy/);
    });
  });

  // ── Constraint invariants (failing-insert tests) ──────────────────────

  describe('constraint invariants', () => {
    const userId = 'inv_user';
    const catId = 'inv_cat';
    const resourceId = 'inv_resource';
    const variantId = 'inv_variant';

    beforeAll(async () => {
      await owner.pool.query(`INSERT INTO users (id, email, display_name) VALUES ($1, 'inv@example.com', 'Inv')`, [userId]);
      await owner.pool.query(`INSERT INTO categories (id, slug) VALUES ($1, 'inv-cat')`, [catId]);
      await owner.pool.query(
        `INSERT INTO content_resources (id, type, primary_category_id, owner_user_id, review_discipline) VALUES ($1, 'article', $2, $3, 'general')`,
        [resourceId, catId, userId],
      );
      await owner.pool.query(
        `INSERT INTO content_variants (id, content_resource_id, locale, slug) VALUES ($1, $2, 'sr-Latn', 'inv-variant')`,
        [variantId, resourceId],
      );
    });

    it('unique (content_resource_id, locale) on variants rejects a duplicate', async () => {
      await expect(
        owner.pool.query(
          `INSERT INTO content_variants (id, content_resource_id, locale, slug) VALUES ('inv_v_dup', $1, 'sr-Latn', 'inv-variant-dup')`,
          [resourceId],
        ),
      ).rejects.toThrow(/content_variants_resource_locale_key/);
    });

    it('locale = sr-Cyrl rejected on content_variants', async () => {
      await expect(
        owner.pool.query(
          `INSERT INTO content_variants (id, content_resource_id, locale, slug) VALUES ('inv_v_cyrl', $1, 'sr-Cyrl', 'inv-cyrl')`,
          [resourceId],
        ),
      ).rejects.toThrow(/content_variants_authored_locale_check/);
    });

    it('locale = sr-Cyrl rejected on category_labels', async () => {
      await expect(
        owner.pool.query(
          `INSERT INTO category_labels (id, category_id, locale, name) VALUES ('inv_cl_cyrl', $1, 'sr-Cyrl', 'Test')`,
          [catId],
        ),
      ).rejects.toThrow(/category_labels_authored_locale_check/);
    });

    it('at most one working revision per variant (partial unique index)', async () => {
      await owner.pool.query(
        `INSERT INTO content_revisions (id, content_variant_id, revision_number, state, body, title, summary, author_user_id, last_editor_user_id)
         VALUES ('inv_rev_1', $1, 1, 'draft', '{}', 'Title', 'Summary', $2, $2)`,
        [variantId, userId],
      );
      await expect(
        owner.pool.query(
          `INSERT INTO content_revisions (id, content_variant_id, revision_number, state, body, title, summary, author_user_id, last_editor_user_id)
           VALUES ('inv_rev_2', $1, 2, 'draft', '{}', 'Title 2', 'Summary 2', $2, $2)`,
          [variantId, userId],
        ),
      ).rejects.toThrow(/content_revisions_working_key/);

      // A second changes_requested is also rejected
      await owner.pool.query(`UPDATE content_revisions SET state = 'approved' WHERE id = 'inv_rev_1'`);
      await owner.pool.query(
        `INSERT INTO content_revisions (id, content_variant_id, revision_number, state, body, title, summary, author_user_id, last_editor_user_id)
         VALUES ('inv_rev_3', $1, 2, 'changes_requested', '{}', 'Title 3', 'Summary 3', $2, $2)`,
        [variantId, userId],
      );
      await expect(
        owner.pool.query(
          `INSERT INTO content_revisions (id, content_variant_id, revision_number, state, body, title, summary, author_user_id, last_editor_user_id)
           VALUES ('inv_rev_4', $1, 3, 'draft', '{}', 'Title 4', 'Summary 4', $2, $2)`,
          [variantId, userId],
        ),
      ).rejects.toThrow(/content_revisions_working_key/);
    });

    // required_capability NOT NULL and default 'library' are covered by
    // dedicated tests below (item 9: pin NOT NULL + default assertion).

    it('saved items unique per (membership_id, content_resource_id)', async () => {
      const orgId = 'inv_si_org';
      const membId = 'inv_si_memb';
      await owner.pool.query(`INSERT INTO organizations (id, name, slug) VALUES ($1, 'SI Org', 'si-org')`, [orgId]);
      await owner.pool.query(
        `INSERT INTO memberships (id, user_id, org_id, status, start_date) VALUES ($1, $2, $3, 'ACTIVE', '2026-01-01')`,
        [membId, userId, orgId],
      );
      await owner.pool.query(
        `INSERT INTO saved_items (id, user_id, membership_id, org_id, content_resource_id)
         VALUES ('inv_si_1', $1, $2, $3, $4)`,
        [userId, membId, orgId, resourceId],
      );
      await expect(
        owner.pool.query(
          `INSERT INTO saved_items (id, user_id, membership_id, org_id, content_resource_id)
           VALUES ('inv_si_2', $1, $2, $3, $4)`,
          [userId, membId, orgId, resourceId],
        ),
      ).rejects.toThrow(/saved_items_membership_resource_key/);
    });

    it('related_resource_ids array length cannot exceed 3', async () => {
      await expect(
        owner.pool.query(
          `INSERT INTO content_revisions (id, content_variant_id, revision_number, state, body, title, summary, related_resource_ids, author_user_id, last_editor_user_id)
           VALUES ('inv_rev_limit', $1, 99, 'approved', '{}', 'T', 'S', '{a,b,c,d}', $2, $2)`,
          [variantId, userId],
        ),
      ).rejects.toThrow(/content_revisions_related_limit/);
    });

    it('interest_category_ids array length cannot exceed 3 on content_preferences', async () => {
      const orgId = 'inv_cp_org';
      const membId = 'inv_cp_memb';
      await owner.pool.query(`INSERT INTO organizations (id, name, slug) VALUES ($1, 'CP Org', 'cp-org')`, [orgId]);
      await owner.pool.query(
        `INSERT INTO memberships (id, user_id, org_id, status, start_date) VALUES ($1, $2, $3, 'ACTIVE', '2026-01-01')`,
        [membId, userId, orgId],
      );
      await expect(
        owner.pool.query(
          `INSERT INTO content_preferences (id, user_id, membership_id, org_id, interest_category_ids)
           VALUES ('inv_cp_limit', $1, $2, $3, '{a,b,c,d}')`,
          [userId, membId, orgId],
        ),
      ).rejects.toThrow(/content_preferences_interest_limit/);
    });

    it('review_discipline required when review_policy = professional', async () => {
      await expect(
        owner.pool.query(
          `INSERT INTO content_resources (id, type, primary_category_id, owner_user_id, review_policy, review_discipline)
           VALUES ('inv_res_chk', 'article', $1, $2, 'professional', NULL)`,
          [catId, userId],
        ),
      ).rejects.toThrow(/content_resources_discipline_check/);
    });

    it('content_revision_media unique (revision, asset)', async () => {
      // Create a media asset
      await owner.pool.query(
        `INSERT INTO media_assets (id, kind, original_filename_hash, byte_size, mime_type, uploaded_by_user_id)
         VALUES ('inv_media_1', 'image', 'hash', 1000, 'image/jpeg', $1)`,
        [userId],
      );
      await owner.pool.query(
        `INSERT INTO content_revision_media (id, content_revision_id, media_asset_id, usage_kind)
         VALUES ('inv_crm_1', 'inv_rev_1', 'inv_media_1', 'cover')`,
      );
      await expect(
        owner.pool.query(
          `INSERT INTO content_revision_media (id, content_revision_id, media_asset_id, usage_kind)
           VALUES ('inv_crm_2', 'inv_rev_1', 'inv_media_1', 'inline_image')`,
        ),
      ).rejects.toThrow(/content_revision_media_revision_asset_key/);
    });

    it('media_renditions unique (asset, kind)', async () => {
      await owner.pool.query(
        `INSERT INTO media_renditions (id, media_asset_id, kind, byte_size, mime_type, storage_key)
         VALUES ('inv_rend_1', 'inv_media_1', 'original', 1000, 'image/jpeg', 'assets/inv_media_1/original')`,
      );
      await expect(
        owner.pool.query(
          `INSERT INTO media_renditions (id, media_asset_id, kind, byte_size, mime_type, storage_key)
           VALUES ('inv_rend_2', 'inv_media_1', 'original', 1000, 'image/jpeg', 'assets/inv_media_1/original2')`,
        ),
      ).rejects.toThrow(/media_renditions_asset_kind_key/);
    });

    it('outbox_deliveries unique (event, consumer)', async () => {
      await owner.pool.query(
        `INSERT INTO outbox_events (id, type, aggregate_type, aggregate_id, payload) VALUES ('inv_oe_1', 'test.event', 'test', 'test', '{}')`,
      );
      await owner.pool.query(
        `INSERT INTO outbox_deliveries (id, outbox_event_id, consumer) VALUES ('inv_od_1', 'inv_oe_1', 'test_consumer')`,
      );
      await expect(
        owner.pool.query(
          `INSERT INTO outbox_deliveries (id, outbox_event_id, consumer) VALUES ('inv_od_2', 'inv_oe_1', 'test_consumer')`,
        ),
      ).rejects.toThrow(/outbox_deliveries_event_consumer_key/);
    });

    it('org_content_capabilities unique (org_id, capability)', async () => {
      const orgId = 'inv_occ_org';
      await owner.pool.query(`INSERT INTO organizations (id, name, slug) VALUES ($1, 'OCC Org', 'occ-org')`, [orgId]);
      await owner.pool.query(
        `INSERT INTO org_content_capabilities (id, org_id, capability, enabled_from, configured_by_user_id)
         VALUES ('inv_occ_1', $1, 'library', '2026-01-01', $2)`,
        [orgId, userId],
      );
      await expect(
        owner.pool.query(
          `INSERT INTO org_content_capabilities (id, org_id, capability, enabled_from, configured_by_user_id)
           VALUES ('inv_occ_2', $1, 'library', '2026-01-01', $2)`,
          [orgId, userId],
        ),
      ).rejects.toThrow(/org_content_capabilities_org_capability_key/);
    });

    it('playback_states unique (membership_id, content_resource_id)', async () => {
      const orgId = 'inv_pb_org';
      const membId = 'inv_pb_memb';
      await owner.pool.query(`INSERT INTO organizations (id, name, slug) VALUES ($1, 'PB Org', 'pb-org')`, [orgId]);
      await owner.pool.query(
        `INSERT INTO memberships (id, user_id, org_id, status, start_date) VALUES ($1, $2, $3, 'ACTIVE', '2026-01-01')`,
        [membId, userId, orgId],
      );
      await owner.pool.query(
        `INSERT INTO playback_states (id, user_id, membership_id, org_id, content_resource_id, position_seconds)
         VALUES ('inv_pb_1', $1, $2, $3, $4, 10)`,
        [userId, membId, orgId, resourceId],
      );
      await expect(
        owner.pool.query(
          `INSERT INTO playback_states (id, user_id, membership_id, org_id, content_resource_id, position_seconds)
           VALUES ('inv_pb_2', $1, $2, $3, $4, 20)`,
          [userId, membId, orgId, resourceId],
        ),
      ).rejects.toThrow(/playback_states_membership_resource_key/);
    });

    it('content_preferences unique (membership_id)', async () => {
      const orgId = 'inv_cpu_org';
      const membId = 'inv_cpu_memb';
      await owner.pool.query(`INSERT INTO organizations (id, name, slug) VALUES ($1, 'CPU Org', 'cpu-org')`, [orgId]);
      await owner.pool.query(
        `INSERT INTO memberships (id, user_id, org_id, status, start_date) VALUES ($1, $2, $3, 'ACTIVE', '2026-01-01')`,
        [membId, userId, orgId],
      );
      await owner.pool.query(
        `INSERT INTO content_preferences (id, user_id, membership_id, org_id) VALUES ('inv_cpu_1', $1, $2, $3)`,
        [userId, membId, orgId],
      );
      await expect(
        owner.pool.query(
          `INSERT INTO content_preferences (id, user_id, membership_id, org_id) VALUES ('inv_cpu_2', $1, $2, $3)`,
          [userId, membId, orgId],
        ),
      ).rejects.toThrow(/content_preferences_membership_key/);
    });

    // ── slug / locale uniqueness tests (item 9) ──

    it('content_variants_slug_locale_key rejects duplicate (slug, locale)', async () => {
      // inv-variant + sr-Latn already exists on resourceId. Create a separate
      // resource so resource_locale_key does not fire first.
      const res2 = 'inv_resource_slug';
      await owner.pool.query(
        `INSERT INTO content_resources (id, type, primary_category_id, owner_user_id, review_discipline) VALUES ($1, 'article', $2, $3, 'general')`,
        [res2, catId, userId],
      );
      await expect(
        owner.pool.query(
          `INSERT INTO content_variants (id, content_resource_id, locale, slug) VALUES ('inv_v_slug', $1, 'sr-Latn', 'inv-variant')`,
          [res2],
        ),
      ).rejects.toThrow(/content_variants_slug_locale_key/);
    });

    it('content_revisions_variant_number_key rejects duplicate (variant, number)', async () => {
      // inv_rev_1 is revision_number=1 on variantId (state was set to approved)
      await expect(
        owner.pool.query(
          `INSERT INTO content_revisions (id, content_variant_id, revision_number, state, body, title, summary, author_user_id, last_editor_user_id)
           VALUES ('inv_rev_dup_num', $1, 1, 'approved', '{}', 'Dup', 'Dup', $2, $2)`,
          [variantId, userId],
        ),
      ).rejects.toThrow(/content_revisions_variant_number_key/);
    });

    it('categories_slug_key rejects duplicate slug', async () => {
      // catId ('inv-cat') exists from beforeAll
      await expect(
        owner.pool.query(
          `INSERT INTO categories (id, slug) VALUES ('inv_cat_dup', 'inv-cat')`,
        ),
      ).rejects.toThrow(/categories_slug_key/);
    });

    it('category_labels_category_locale_key rejects duplicate (category, locale)', async () => {
      await owner.pool.query(
        `INSERT INTO category_labels (id, category_id, locale, name) VALUES ('inv_cl_1', $1, 'en', 'English')`,
        [catId],
      );
      await expect(
        owner.pool.query(
          `INSERT INTO category_labels (id, category_id, locale, name) VALUES ('inv_cl_dup', $1, 'en', 'Dup')`,
          [catId],
        ),
      ).rejects.toThrow(/category_labels_category_locale_key/);
    });

    // ── FK RESTRICT tests (item 9) ──

    it('FK RESTRICT prevents deleting a category with resources', async () => {
      // resourceId references catId via primary_category_id
      await expect(
        owner.pool.query(`DELETE FROM categories WHERE id = $1`, [catId]),
      ).rejects.toThrow(/content_resources_primary_category_id_categories_id_fk/);
    });

    it('FK RESTRICT prevents deleting a media asset referenced by a revision', async () => {
      // inv_media_1 is referenced by inv_crm_1 in content_revision_media
      await expect(
        owner.pool.query(`DELETE FROM media_assets WHERE id = 'inv_media_1'`),
      ).rejects.toThrow(/content_revision_media_media_asset_id_media_assets_id_fk/);
    });

    // ── required_capability defaults and NOT NULL (item 9) ──

    it('required_capability defaults to library when omitted', async () => {
      await owner.pool.query(
        `INSERT INTO content_publications (id, content_variant_id, content_revision_id, approval_hash, state, starts_at, published_by_user_id)
         VALUES ('inv_pub_def', $1, 'inv_rev_1', 'hash', 'live', now(), $2)`,
        [variantId, userId],
      );
      const { rows } = await owner.pool.query<{ cap: string }>(
        `SELECT required_capability AS cap FROM content_publications WHERE id = 'inv_pub_def'`,
      );
      expect(rows[0]!.cap).toBe('library');
    });

    it('required_capability IS NOT NULL constraint', async () => {
      await expect(
        owner.pool.query(
          `INSERT INTO content_publications (id, content_variant_id, content_revision_id, approval_hash, state, required_capability, starts_at, published_by_user_id)
           VALUES ('inv_pub_null', $1, 'inv_rev_1', 'hash', 'live', NULL, now(), $2)`,
          [variantId, userId],
        ),
      ).rejects.toThrow(/not-null|null value.*column.*required_capability/i);
    });

    // ── content_publications_window_check (item 8) ──

    it('content_publications_window_check rejects ends_at <= starts_at', async () => {
      await expect(
        owner.pool.query(
          `INSERT INTO content_publications (id, content_variant_id, content_revision_id, approval_hash, state, starts_at, ends_at, published_by_user_id)
           VALUES ('inv_pub_win', $1, 'inv_rev_1', 'hash', 'scheduled', '2026-06-01', '2026-05-01', $2)`,
          [variantId, userId],
        ),
      ).rejects.toThrow(/content_publications_window_check/);
    });

    // ── outbox_events_payload_object_check (item 8) ──

    it('outbox_events_payload_object_check rejects non-object payload', async () => {
      await expect(
        owner.pool.query(
          `INSERT INTO outbox_events (id, type, aggregate_type, aggregate_id, payload) VALUES ('inv_oe_arr', 'test', 'test', 'test', '[]')`,
        ),
      ).rejects.toThrow(/outbox_events_payload_object_check/);

      await expect(
        owner.pool.query(
          `INSERT INTO outbox_events (id, type, aggregate_type, aggregate_id, payload) VALUES ('inv_oe_str', 'test', 'test', 'test', '"hello"')`,
        ),
      ).rejects.toThrow(/outbox_events_payload_object_check/);
    });

    // ── content_publication_audiences_kind_check (item 6) ──

    describe('content_publication_audiences_kind_check', () => {
      let pubId: string;

      beforeAll(async () => {
        pubId = 'inv_pub_aud';
        await owner.pool.query(
          `INSERT INTO content_publications (id, content_variant_id, content_revision_id, approval_hash, state, starts_at, published_by_user_id)
           VALUES ($1, $2, 'inv_rev_1', 'hash', 'live', now(), $3)
           ON CONFLICT (id) DO NOTHING`,
          [pubId, variantId, userId],
        );
      });

      it('all_eligible rejects non-null org_id', async () => {
        await expect(
          owner.pool.query(
            `INSERT INTO content_publication_audiences (id, publication_id, kind, org_id)
             VALUES ('inv_cpa_1', $1, 'all_eligible', 'some_org')`,
            [pubId],
          ),
        ).rejects.toThrow(/content_publication_audiences_kind_check/);
      });

      it('all_eligible rejects non-null org_unit_id', async () => {
        await expect(
          owner.pool.query(
            `INSERT INTO content_publication_audiences (id, publication_id, kind, org_unit_id)
             VALUES ('inv_cpa_2', $1, 'all_eligible', 'some_unit')`,
            [pubId],
          ),
        ).rejects.toThrow(/content_publication_audiences_kind_check/);
      });

      it('organization rejects null org_id', async () => {
        await expect(
          owner.pool.query(
            `INSERT INTO content_publication_audiences (id, publication_id, kind)
             VALUES ('inv_cpa_3', $1, 'organization')`,
            [pubId],
          ),
        ).rejects.toThrow(/content_publication_audiences_kind_check/);
      });

      it('organization rejects non-null org_unit_id', async () => {
        const orgId = 'inv_aud_org';
        await owner.pool.query(`INSERT INTO organizations (id, name, slug) VALUES ($1, 'Aud Org', 'aud-org') ON CONFLICT DO NOTHING`, [orgId]);
        const ouId = 'inv_aud_ou';
        await owner.pool.query(`INSERT INTO org_units (id, org_id, name, kind) VALUES ($1, $2, 'Aud OU', 'TEAM') ON CONFLICT DO NOTHING`, [ouId, orgId]);
        await expect(
          owner.pool.query(
            `INSERT INTO content_publication_audiences (id, publication_id, kind, org_id, org_unit_id)
             VALUES ('inv_cpa_4', $1, 'organization', $2, $3)`,
            [pubId, orgId, ouId],
          ),
        ).rejects.toThrow(/content_publication_audiences_kind_check/);
      });

      it('org_unit rejects null org_id', async () => {
        await expect(
          owner.pool.query(
            `INSERT INTO content_publication_audiences (id, publication_id, kind, org_unit_id)
             VALUES ('inv_cpa_5', $1, 'org_unit', 'some_unit')`,
            [pubId],
          ),
        ).rejects.toThrow(/content_publication_audiences_kind_check/);
      });

      it('org_unit rejects null org_unit_id', async () => {
        const orgId = 'inv_aud_org2';
        await owner.pool.query(`INSERT INTO organizations (id, name, slug) VALUES ($1, 'Aud Org2', 'aud-org2') ON CONFLICT DO NOTHING`, [orgId]);
        await expect(
          owner.pool.query(
            `INSERT INTO content_publication_audiences (id, publication_id, kind, org_id)
             VALUES ('inv_cpa_6', $1, 'org_unit', $2)`,
            [pubId, orgId],
          ),
        ).rejects.toThrow(/content_publication_audiences_kind_check/);
      });
    });

    // ── Tenant consistency: composite FK rejects cross-org insert (item 7) ──

    it('composite FK rejects saved_items with mismatched membership/org', async () => {
      const orgX = 'inv_xorg_x';
      const orgY = 'inv_xorg_y';
      const membX = 'inv_xmemb_x';
      await owner.pool.query(`INSERT INTO organizations (id, name, slug) VALUES ($1, 'X Org', 'x-org') ON CONFLICT DO NOTHING`, [orgX]);
      await owner.pool.query(`INSERT INTO organizations (id, name, slug) VALUES ($1, 'Y Org', 'y-org') ON CONFLICT DO NOTHING`, [orgY]);
      await owner.pool.query(
        `INSERT INTO memberships (id, user_id, org_id, status, start_date) VALUES ($1, $2, $3, 'ACTIVE', '2026-01-01') ON CONFLICT DO NOTHING`,
        [membX, userId, orgX],
      );
      // membership membX belongs to orgX; inserting with orgY should fail the composite FK
      await expect(
        owner.pool.query(
          `INSERT INTO saved_items (id, user_id, membership_id, org_id, content_resource_id)
           VALUES ('inv_si_xorg', $1, $2, $3, $4)`,
          [userId, membX, orgY, resourceId],
        ),
      ).rejects.toThrow(/saved_items_membership_org_fk/);
    });
  });

  // ── Seed tests ────────────────────────────────────────────────────────

  describe('seed', () => {
    it('categories and labels are present after seeding', async () => {
      await seed(owner.db);

      const cats = await owner.db.select().from(categories);
      const expectedCatIds = Object.values(SAMPLE_CATEGORY_IDS).sort();
      // Earlier constraint tests may insert extra categories; check all sample ids are present
      const sampleCats = cats.filter((c) => (expectedCatIds as readonly string[]).includes(c.id));
      expect(sampleCats.map((c) => c.id).sort()).toEqual(expectedCatIds);

      const labels = await owner.db.select().from(categoryLabels);
      // 6 categories * 3 locales = 18 sample labels (constraint tests may add extras)
      expect(labels.length).toBeGreaterThanOrEqual(18);
      // Every SAMPLE_CATEGORY_LABELS entry is present
      for (const expected of SAMPLE_CATEGORY_LABELS) {
        const found = labels.find((l) => l.id === expected.id);
        expect(found, `Missing label ${expected.id}`).toBeDefined();
        expect(found!.name).toBe(expected.name);
      }
    });

    it('capability rows per organization, configured by client-operations staff', async () => {
      await seed(owner.db);

      const caps = await owner.db
        .select()
        .from(orgContentCapabilities);
      const sampleOrgCap = caps.find(
        (c) => c.orgId === 'org_sample' && c.capability === 'library',
      );
      expect(sampleOrgCap).toBeDefined();
      // configuredByUserId must be the client-operations staff (user_nikola
      // holds service.configure), not the HR admin.
      expect(sampleOrgCap!.configuredByUserId).toBe('user_nikola');
    });

    it('seed is idempotent (run twice, counts equal)', async () => {
      const counts1 = await seed(owner.db);
      const counts2 = await seed(owner.db);
      expect(counts2).toEqual(counts1);
    });
  });
});
