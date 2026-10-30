/**
 * Grant backfill from the legacy role columns (T-2.7).
 *
 * The backfill runs against a database that still has `users.platform_role`
 * and `memberships.role`, i.e. before migration 0005 drops them. The test
 * database has every migration applied, so the suite restores those two
 * columns and fills them from the fixtures to recreate the pre-0005 state.
 *
 * Runs against TEST_DATABASE_URL. Skipped when it is unset.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import { SAMPLE_PEOPLE } from '@nestself/sample-data';
import { editorialStaffGrantIds, extraSampleGrantIds, seed } from '../../src/db/seed/seed-lib.js';
import { backfillGrants } from '../../src/db/seed/backfill-grants.js';
import { grants, memberships, organizations } from '../../src/db/schema/index.js';
import { resetTestDatabase, type TestDatabase } from './test-database.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const NOW = new Date('2026-10-24T12:00:00Z');

/** Migration 0005's statements; the first one is the backfill guard. */
const MIGRATION_0005 = readFileSync(
  new URL('../../drizzle/0005_drop_legacy_roles.sql', import.meta.url),
  'utf8',
)
  .split('--> statement-breakpoint')
  .map((statement) => statement.trim())
  .filter(Boolean);

async function restoreLegacyRoleColumns(db: TestDatabase): Promise<void> {
  await db.pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'org_role') THEN
        CREATE TYPE org_role AS ENUM ('EMPLOYEE', 'MANAGER', 'HR_ADMIN');
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'platform_role') THEN
        CREATE TYPE platform_role AS ENUM ('EXPERT', 'OPERATIONS', 'ADMIN');
      END IF;
    END
    $$;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS platform_role platform_role;
    ALTER TABLE memberships ADD COLUMN IF NOT EXISTS role org_role NOT NULL DEFAULT 'EMPLOYEE';
  `);
  for (const person of SAMPLE_PEOPLE) {
    await db.pool.query('UPDATE users SET platform_role = $2 WHERE id = $1', [
      person.id,
      person.platformRole?.toUpperCase() ?? null,
    ]);
    if (person.orgRole) {
      await db.pool.query('UPDATE memberships SET role = $2 WHERE user_id = $1', [
        person.id,
        person.orgRole.toUpperCase(),
      ]);
    }
  }
}

const comparable = (rows: (typeof grants.$inferSelect)[]) =>
  rows.map((g) => ({
    id: g.id,
    subjectUserId: g.subjectUserId,
    templateKey: g.templateKey,
    actions: g.actions,
    scopeType: g.scopeType,
    scopeOrgId: g.scopeOrgId,
    scopeOrgUnitId: g.scopeOrgUnitId,
    includeDescendants: g.includeDescendants,
    conditions: g.conditions,
  }));

describe.skipIf(!TEST_DB_URL)('backfillGrants', () => {
  let testDb: TestDatabase;
  let seeded: (typeof grants.$inferSelect)[];

  beforeAll(async () => {
    testDb = await resetTestDatabase(TEST_DB_URL!, 'backfill');
    await seed(testDb.db);
    await restoreLegacyRoleColumns(testDb);
    // The backfill recreates the legacy-mapped grants only; the explicit
    // extra templates (the sample HR admin's employer_owner, the editorial staff) are not derived.
    const extraIds = new Set([...extraSampleGrantIds(), ...editorialStaffGrantIds()]);
    seeded = (await testDb.db.select().from(grants).orderBy(asc(grants.id))).filter(
      (g) => !extraIds.has(g.id),
    );
    await testDb.db.delete(grants);
  }, 180_000);

  afterAll(async () => {
    await testDb?.close();
  });

  it('0005 refuses to drop the legacy roles before the backfill', async () => {
    expect(MIGRATION_0005[0]).toContain('DO $$');
    // The first such user in id order: the sample platform administrator since it joined SAMPLE_PEOPLE (T-CW-2.1).
    await expect(testDb.pool.query(MIGRATION_0005[0]!)).rejects.toThrow(
      /user user_admin holds a legacy role without a backfilled grant/,
    );
  });

  it('recreates the grants the seed derives from the legacy roles', async () => {
    const result = await backfillGrants(testDb.db, NOW);

    const backfilled = await testDb.db.select().from(grants).orderBy(asc(grants.id));
    expect(seeded.length).toBeGreaterThan(0);
    expect(comparable(backfilled)).toEqual(comparable(seeded));
    expect([...result.created].sort()).toEqual(seeded.map((g) => g.id));
    expect(result.skipped).toEqual([]);
  });

  it('dates each grant at the run and names the granting user', async () => {
    const rows = await testDb.db.select().from(grants);
    for (const g of rows) {
      expect(g.grantedAt).toEqual(NOW);
      expect(g.validFrom).toEqual(NOW);
      // Organization A grants: its first HR admin. Organization B has no HR
      // admin, and platform grants have no organization: the user grants.
      const expected = g.scopeOrgId === 'org_sample' ? 'user_ivana' : g.subjectUserId;
      expect({ id: g.id, by: g.grantedByUserId }).toEqual({ id: g.id, by: expected });
    }
  });

  it('is idempotent: a second run creates nothing', async () => {
    const before = await testDb.db.select({ id: grants.id }).from(grants).orderBy(asc(grants.id));
    const result = await backfillGrants(testDb.db, new Date('2026-10-25T00:00:00Z'));

    expect(result.created).toEqual([]);
    expect([...result.skipped].sort()).toEqual(before.map((g) => g.id));
    const after = await testDb.db.select().from(grants);
    expect(after).toHaveLength(before.length);
    expect(after.every((g) => g.grantedAt.getTime() === NOW.getTime())).toBe(true);
  });

  it('skips ended memberships', async () => {
    await testDb.pool.query("UPDATE memberships SET status = 'ENDED' WHERE user_id = 'user_ana'");
    await testDb.pool.query("DELETE FROM grants WHERE subject_user_id = 'user_ana'");

    const result = await backfillGrants(testDb.db, NOW);

    expect(result.created).toEqual([]);
  });

  it('keeps the grants of a second active organization under org-suffixed ids', async () => {
    await testDb.db.insert(organizations).values({ id: 'org_second', name: 'Second Org', slug: 'second-org' });
    await testDb.db.insert(memberships).values({
      userId: 'user_stefan',
      orgId: 'org_second',
      status: 'ACTIVE',
      startDate: NOW,
    });
    await testDb.pool.query(
      "UPDATE memberships SET role = 'MANAGER' WHERE user_id = 'user_stefan' AND org_id = 'org_second'",
    );

    const result = await backfillGrants(testDb.db, NOW);

    expect([...result.created].sort()).toEqual([
      'grant_user_stefan_org_second_employee',
      'grant_user_stefan_org_second_team_manager',
    ]);
    const stefan = await testDb.db
      .select({ id: grants.id, org: grants.scopeOrgId, by: grants.grantedByUserId })
      .from(grants)
      .where(eq(grants.subjectUserId, 'user_stefan'))
      .orderBy(asc(grants.id));
    expect(stefan).toEqual([
      { id: 'grant_user_stefan_employee', org: 'org_sample', by: 'user_ivana' },
      { id: 'grant_user_stefan_org_second_employee', org: 'org_second', by: 'user_stefan' },
      { id: 'grant_user_stefan_org_second_team_manager', org: 'org_second', by: 'user_stefan' },
      { id: 'grant_user_stefan_team_manager', org: 'org_sample', by: 'user_ivana' },
    ]);

    const again = await backfillGrants(testDb.db, NOW);
    expect(again.created).toEqual([]);
    expect(again.skipped).toEqual(
      expect.arrayContaining([
        'grant_user_stefan_org_second_employee',
        'grant_user_stefan_org_second_team_manager',
      ]),
    );
  });

  it('scopes a MANAGER grant to the organization when the membership has no org unit, and reports it', async () => {
    await testDb.db.insert(organizations).values({ id: 'org_third', name: 'Third Org', slug: 'third-org' });
    await testDb.db.insert(memberships).values({
      userId: 'user_jovan',
      orgId: 'org_third',
      orgUnitId: null,
      status: 'ACTIVE',
      startDate: NOW,
    });
    await testDb.pool.query(
      "UPDATE memberships SET role = 'MANAGER' WHERE user_id = 'user_jovan' AND org_id = 'org_third'",
    );
    const warnings: string[] = [];

    const result = await backfillGrants(testDb.db, NOW, (message) => warnings.push(message));

    const thirdOrgGrants = await testDb.db.select().from(grants).where(eq(grants.scopeOrgId, 'org_third'));
    const row = thirdOrgGrants.find((g) => g.templateKey === 'team_manager');
    expect(row).toBeDefined();
    const widenedId = row!.id;
    expect(result.created).toContain(widenedId);
    expect(result.widened).toEqual([widenedId]);
    expect(row).toMatchObject({
      templateKey: 'team_manager',
      scopeType: 'organization',
      scopeOrgId: 'org_third',
      scopeOrgUnitId: null,
      includeDescendants: false,
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('user_jovan');
    expect(warnings[0]).not.toContain('@');

    const again = await backfillGrants(testDb.db, NOW, () => {});
    expect(again.widened).toEqual([]);
    expect(again.skipped).toContain(widenedId);
  });

  it('0005 applies after the backfill and drops the legacy columns', async () => {
    for (const statement of MIGRATION_0005) await testDb.pool.query(statement);

    const { rows } = await testDb.pool.query<{ column_name: string }>(`
      SELECT column_name FROM information_schema.columns
      WHERE (table_name = 'users' AND column_name = 'platform_role')
         OR (table_name = 'memberships' AND column_name = 'role')
    `);
    expect(rows).toEqual([]);
  });
});
