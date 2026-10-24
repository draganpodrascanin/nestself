/**
 * Drop and recreate the database named in DATABASE_URL (or, with --ensure,
 * only create it when it is missing).
 *
 *   DATABASE_URL=... tsx scripts/reset-database.ts <database-name> [--ensure]
 *
 * Used by the Playwright auth stack (`e2e/global-setup.ts`) to give the stub
 * API a disposable database. The name must be repeated on the command line
 * and match DATABASE_URL, so a stray DATABASE_URL (for example the one in
 * `.env`) is never dropped by accident, and only `nestself_e2e_*` /
 * `nestself_test_*` databases are accepted (never `postgres` or a
 * template). Refuses to run when NODE_ENV is production.
 */
import 'dotenv/config';
import { Pool } from 'pg';
import { assertNotProduction } from '@nestself/sample-data';
import { disposableDatabaseProblem } from '../test/db/test-database-name.js';

assertNotProduction(process.env);

const [expectedName, ...flags] = process.argv.slice(2);
const ensureOnly = flags.includes('--ensure');
const rawUrl = process.env.DATABASE_URL;

if (!rawUrl || !expectedName) {
  console.error('Usage: DATABASE_URL=... tsx scripts/reset-database.ts <database-name> [--ensure]');
  process.exit(1);
}

const target = new URL(rawUrl);
const dbName = decodeURIComponent(target.pathname.slice(1));
if (dbName !== expectedName) {
  console.error(
    `Refusing to touch "${dbName}": the command line names "${expectedName}". ` +
      'DATABASE_URL must point at the database you mean to reset.',
  );
  process.exit(1);
}
const problem = disposableDatabaseProblem(dbName);
if (problem) {
  console.error(`Refusing to reset ${problem}.`);
  process.exit(1);
}

const admin = new URL(rawUrl);
admin.pathname = '/postgres';
const pool = new Pool({ connectionString: admin.toString(), max: 1 });

/**
 * `WITH (FORCE)` (PostgreSQL 13+) disconnects the running API's sessions.
 * Older servers reject the option: terminate the backends and retry once,
 * also once more if a client reconnected in between.
 */
async function dropDatabase(): Promise<void> {
  try {
    await pool.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    return;
  } catch (err) {
    console.warn(`DROP ... WITH (FORCE) failed (${(err as Error).message}); terminating sessions.`);
  }
  for (let attempt = 0; ; attempt++) {
    await pool.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
      [dbName],
    );
    try {
      await pool.query(`DROP DATABASE IF EXISTS "${dbName}"`);
      return;
    } catch (err) {
      const busy = /being accessed by other users/.test((err as Error).message);
      if (!busy || attempt >= 1) throw err;
    }
  }
}

async function main(): Promise<void> {
  const exists =
    (await pool.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName])).rowCount === 1;
  if (ensureOnly) {
    if (!exists) await pool.query(`CREATE DATABASE "${dbName}"`);
    console.log(exists ? `Database ${dbName} exists.` : `Database ${dbName} created.`);
    return;
  }
  await dropDatabase();
  await pool.query(`CREATE DATABASE "${dbName}"`);
  console.log(`Database ${dbName} recreated.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
