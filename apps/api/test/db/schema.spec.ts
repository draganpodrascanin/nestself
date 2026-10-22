/**
 * Database-level integration tests for the auth schema.
 *
 * Runs against TEST_DATABASE_URL (nestself_test).
 * Prerequisites: PostgreSQL running on the configured port.
 */
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { seed } from '../../prisma/seed-lib.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;

const shouldRun = !!TEST_DB_URL;

describe.skipIf(!shouldRun)('schema integration tests', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    // Drop and recreate the test database, then apply migrations (no seed).
    // We cannot use `prisma migrate reset` because Prisma 7 removed --skip-seed
    // and auto-runs the configured seed command.
    const testUrl = new URL(TEST_DB_URL!);
    const dbName = testUrl.pathname.slice(1); // e.g. "nestself_test"
    const adminUrl = `${testUrl.protocol}//${testUrl.username}:${testUrl.password}@${testUrl.host}/postgres`;

    // Connect to the default "postgres" database to drop/create the test db.
    const adminAdapter = new PrismaPg(adminUrl);
    const adminPrisma = new PrismaClient({ adapter: adminAdapter });
    try {
      // Terminate existing connections to the test database.
      await adminPrisma.$executeRawUnsafe(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${dbName}' AND pid <> pg_backend_pid()`,
      );
      await adminPrisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}"`);
      await adminPrisma.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
    } finally {
      await adminPrisma.$disconnect();
    }

    // Apply migrations (deploy does not seed).
    execFileSync(
      'pnpm',
      ['--filter', '@nestself/api', 'exec', 'prisma', 'migrate', 'deploy'],
      {
        env: { ...process.env, DATABASE_URL: TEST_DB_URL },
        stdio: 'pipe',
        timeout: 120_000,
      },
    );

    const adapter = new PrismaPg(TEST_DB_URL!);
    prisma = new PrismaClient({ adapter });
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('migrations apply cleanly on a fresh database', () => {
    // If we get here, beforeAll succeeded, which means migrations applied.
    expect(true).toBe(true);
  });

  it('"teams" view returns one row per TEAM org unit', async () => {
    // Insert an org, an org unit of kind TEAM, then query the view.
    await prisma.organization.create({
      data: { id: 'test_org', name: 'Test Org', slug: 'test-org' },
    });
    await prisma.orgUnit.create({
      data: {
        id: 'ou_test_team',
        orgId: 'test_org',
        kind: 'TEAM',
        name: 'Test Team',
      },
    });
    await prisma.orgUnit.create({
      data: {
        id: 'ou_test_dept',
        orgId: 'test_org',
        kind: 'DEPARTMENT',
        name: 'Test Dept',
      },
    });

    const viewRows: Array<{ id: string; name: string; org_id: string }> =
      await prisma.$queryRawUnsafe('SELECT * FROM teams WHERE org_id = $1', 'test_org');
    expect(viewRows).toHaveLength(1);
    expect(viewRows[0]!.id).toBe('ou_test_team');
    expect(viewRows[0]!.name).toBe('Test Team');

    // Cleanup
    await prisma.orgUnit.deleteMany({ where: { orgId: 'test_org' } });
    await prisma.organization.delete({ where: { id: 'test_org' } });
  });

  it('audit trigger rejects UPDATE', async () => {
    const now = new Date();
    const retainUntil = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

    // Insert an audit event.
    await prisma.$executeRawUnsafe(
      `INSERT INTO audit_events (id, occurred_at, actor_kind, action, record_type, record_id, result, category, details, retain_until)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      'audit_test_1',
      now,
      'SYSTEM',
      'test.action',
      'Test',
      'test_1',
      'NONE',
      'ADMIN',
      JSON.stringify({}),
      retainUntil,
    );

    // Attempt UPDATE - should fail.
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE audit_events SET action = 'modified' WHERE id = 'audit_test_1' AND occurred_at = $1`,
        now,
      ),
    ).rejects.toThrow(/append-only.*UPDATE is not allowed/i);
  });

  it('audit trigger rejects DELETE', async () => {
    const now = new Date();
    const retainUntil = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

    await prisma.$executeRawUnsafe(
      `INSERT INTO audit_events (id, occurred_at, actor_kind, action, record_type, record_id, result, category, details, retain_until)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      'audit_test_2',
      now,
      'SYSTEM',
      'test.action',
      'Test',
      'test_2',
      'NONE',
      'ADMIN',
      JSON.stringify({}),
      retainUntil,
    );

    await expect(
      prisma.$executeRawUnsafe(
        `DELETE FROM audit_events WHERE id = 'audit_test_2' AND occurred_at = $1`,
        now,
      ),
    ).rejects.toThrow(/append-only.*DELETE is not allowed/i);
  });

  it('audit event lands in the correct monthly partition', async () => {
    const oct2026 = new Date('2026-10-15T12:00:00Z');
    const retainUntil = new Date('2029-10-15T12:00:00Z');

    await prisma.$executeRawUnsafe(
      `INSERT INTO audit_events (id, occurred_at, actor_kind, action, record_type, record_id, result, category, details, retain_until)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      'audit_partition_test',
      oct2026,
      'SYSTEM',
      'test.partition',
      'Test',
      'part_1',
      'NONE',
      'ADMIN',
      JSON.stringify({}),
      retainUntil,
    );

    const result: Array<{ partition: string }> = await prisma.$queryRawUnsafe(
      `SELECT tableoid::regclass::text AS partition FROM audit_events WHERE id = 'audit_partition_test' AND occurred_at = $1`,
      oct2026,
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.partition).toBe('audit_events_y2026m10');
  });

  it('users_email_lowercase_check rejects mixed-case email', async () => {
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO users (id, email, display_name, locale, created_at, updated_at)
         VALUES ('user_casetest', 'MixedCase@Example.com', 'Test', 'en', NOW(), NOW())`,
      ),
    ).rejects.toThrow(/users_email_lowercase_check/);
  });

  it('closure invariant AUTHZ-R-09: every org unit is its own ancestor at depth 0 after seed', async () => {
    // Run the seed against the test database.
    const counts = await seed(prisma);
    expect(counts.orgUnits).toBeGreaterThan(0);

    // Check that every org unit has a self-entry at depth 0.
    const orgUnits: Array<{ id: string }> = await prisma.$queryRawUnsafe(
      'SELECT id FROM org_units',
    );
    for (const ou of orgUnits) {
      const closure: Array<{ depth: number }> = await prisma.$queryRawUnsafe(
        `SELECT depth FROM org_unit_closure WHERE ancestor_id = $1 AND descendant_id = $1`,
        ou.id,
      );
      expect(closure).toHaveLength(1);
      expect(closure[0]!.depth).toBe(0);
    }
  });

  it('seed is idempotent (run twice, row counts equal)', async () => {
    const counts1 = await seed(prisma);
    const counts2 = await seed(prisma);

    for (const key of Object.keys(counts1)) {
      expect(counts2[key]).toBe(counts1[key]);
    }
  });
});
