/**
 * Integration-test helpers for a disposable PostgreSQL database.
 *
 * `TEST_DATABASE_URL` points at a database the tests may drop and recreate.
 * The connecting role must be allowed to create databases and roles (the
 * local Docker Compose / Homebrew owner role is).
 */
import { Pool } from 'pg';
import { createDatabase, type Database } from '../../src/db/db.service.js';
import { runMigrations } from '../../src/db/migrate.js';
import { testDatabaseName } from './test-database-name.js';

export interface TestDatabase {
  url: string;
  pool: Pool;
  db: Database;
  close(): Promise<void>;
}

function adminUrlFor(url: string): string {
  const parsed = new URL(url);
  parsed.pathname = '/postgres';
  return parsed.toString();
}

function databaseNameOf(url: string): string {
  return new URL(url).pathname.slice(1);
}

/**
 * Drop and recreate the test database, apply every migration, and connect.
 * Each suite passes its own `suffix` so that vitest workers running in
 * parallel never share (and drop) one another's database; the name also
 * carries a per-worktree prefix (`testDatabaseName`) so two worktrees
 * running the same suite never collide either.
 */
export async function resetTestDatabase(baseUrl: string, suffix: string): Promise<TestDatabase> {
  const parsed = new URL(baseUrl);
  parsed.pathname = `/${testDatabaseName(databaseNameOf(baseUrl), suffix)}`;
  const url = parsed.toString();
  const dbName = databaseNameOf(url);
  const admin = new Pool({ connectionString: adminUrlFor(url), max: 1 });
  try {
    await admin.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
      [dbName],
    );
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}"`);
    await admin.query(`CREATE DATABASE "${dbName}"`);
  } finally {
    await admin.end();
  }

  await runMigrations(url);

  const pool = new Pool({ connectionString: url, max: 4 });
  return {
    url,
    pool,
    db: createDatabase(pool),
    close: () => pool.end(),
  };
}

/**
 * Create (or reuse) a non-superuser login role that is a member of
 * `nestself_app`, so that row-level security applies, and connect as it.
 */
export async function connectAsAppRole(
  owner: TestDatabase,
  roleName = 'nestself_api_test',
): Promise<TestDatabase> {
  const password = 'nestself_api_test';
  await owner.pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${roleName}') THEN
        CREATE ROLE ${roleName} LOGIN PASSWORD '${password}';
      END IF;
    END
    $$;
  `);
  await owner.pool.query(`GRANT nestself_app TO ${roleName}`);

  const url = new URL(owner.url);
  url.username = roleName;
  url.password = password;
  const pool = new Pool({ connectionString: url.toString(), max: 2 });
  return {
    url: url.toString(),
    pool,
    db: createDatabase(pool),
    close: () => pool.end(),
  };
}
