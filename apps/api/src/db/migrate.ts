/**
 * Programmatic migration runner shared by `scripts/migrate.ts`, the Docker
 * `migrate` service and the integration tests.
 *
 * Applies every SQL file in `apps/api/drizzle` that is not yet recorded in
 * `drizzle.__drizzle_migrations`. Idempotent.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { createDatabase } from './db.service.js';

const MIGRATIONS_FOLDER = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'drizzle',
);

export async function runMigrations(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, max: 1, application_name: 'nestself-migrate' });
  try {
    await migrate(createDatabase(pool), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await pool.end();
  }
}
