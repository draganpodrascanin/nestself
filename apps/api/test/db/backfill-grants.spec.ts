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
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { asc } from 'drizzle-orm';
import { SAMPLE_PEOPLE } from '@nestself/sample-data';
import { seed } from '../../src/db/seed/seed-lib.js';
import { backfillGrants } from '../../src/db/seed/backfill-grants.js';
import { grants } from '../../src/db/schema/index.js';
import { resetTestDatabase, type TestDatabase } from './test-database.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const NOW = new Date('2026-10-24T12:00:00Z');

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
    seeded = await testDb.db.select().from(grants).orderBy(asc(grants.id));
    await testDb.db.delete(grants);
  }, 180_000);

  afterAll(async () => {
    await testDb?.close();
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
      // Org grants: the organization's first HR admin. Platform grants: the user.
      const expected = g.scopeOrgId ? 'user_ivana' : g.subjectUserId;
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
});
