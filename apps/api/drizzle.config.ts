import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit configuration.
 *
 * - `pnpm --filter @nestself/api db:generate` diffs `src/db/schema` against the
 *   last snapshot in `drizzle/meta` and writes a new SQL migration.
 * - `pnpm --filter @nestself/api db:generate -- --custom --name=<name>` writes
 *   an empty migration for hand-written SQL (partitions, triggers, roles).
 * - Migrations are applied by `scripts/migrate.ts` (drizzle-orm migrator),
 *   never by `drizzle-kit push`.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  casing: 'snake_case',
  strict: true,
  verbose: true,
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      'postgresql://nestself:nestself_dev@localhost:5432/nestself',
  },
});
