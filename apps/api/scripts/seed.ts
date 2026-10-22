/**
 * Seed the database with the fictional fixtures from @nestself/sample-data.
 *
 *   pnpm --filter @nestself/api db:seed
 *
 * Refuses to run when NODE_ENV is production (sample-data rule).
 */
import 'dotenv/config';
import { Pool } from 'pg';
import { assertNotProduction } from '@nestself/sample-data';
import { createDatabase } from '../src/db/db.service.js';
import { seed } from '../src/db/seed/seed-lib.js';

assertNotProduction(process.env);

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    'postgresql://nestself:nestself_dev@localhost:5432/nestself',
  max: 1,
});

seed(createDatabase(pool))
  .then((counts) => {
    console.log('Seed complete:', counts);
  })
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
