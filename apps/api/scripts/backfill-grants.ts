/**
 * Create grants from the legacy role columns, once, before migration 0005
 * drops them (T-2.7).
 *
 *   pnpm --filter @nestself/api db:backfill-grants
 *
 * Idempotent: an existing grant id is reported as skipped, never overwritten.
 */
import 'dotenv/config';
import { Pool } from 'pg';
import { createDatabase } from '../src/db/db.service.js';
import { backfillGrants } from '../src/db/seed/backfill-grants.js';

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    'postgresql://nestself:nestself_dev@localhost:5432/nestself',
  max: 1,
});

backfillGrants(createDatabase(pool), new Date())
  .then(({ created, skipped }) => {
    console.log(`Grant backfill complete: ${created.length} created, ${skipped.length} skipped`);
    for (const id of created) console.log(`  created ${id}`);
  })
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
