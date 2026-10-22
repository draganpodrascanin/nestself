/**
 * Apply pending database migrations.
 *
 *   pnpm --filter @nestself/api db:migrate
 *
 * Uses DATABASE_URL (the migration/owner role). Safe to run repeatedly.
 */
import 'dotenv/config';
import { runMigrations } from '../src/db/migrate.js';

const url =
  process.env.DATABASE_URL ??
  'postgresql://nestself:nestself_dev@localhost:5432/nestself';

runMigrations(url)
  .then(() => {
    console.log('Migrations applied.');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
