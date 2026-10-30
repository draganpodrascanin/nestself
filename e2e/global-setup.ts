/**
 * Playwright global setup for `pnpm e2e:auth`: drop and recreate the
 * dedicated e2e database (`e2e-database.ts`), apply the migrations and run
 * the sample seed, all through the API's own scripts with `DATABASE_URL`
 * overridden (dotenv never overrides a variable that is already set, so
 * `apps/api/.env` cannot redirect them).
 *
 * Playwright starts `webServer` entries before global setup, and the API
 * pings its database on boot, so the API web server command first runs this
 * file with `--ensure` (create the database if missing and migrate it). The
 * full reset below then runs before the first test; the running API's pool
 * reconnects to the recreated database.
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MISSING_DATABASE_MESSAGE, databaseNameOf, e2eDatabaseUrl } from './e2e-database.ts';

function apiScript(script: string, args: string[], databaseUrl: string): void {
  execFileSync('pnpm', ['--filter', '@nestself/api', 'exec', 'tsx', script, ...args], {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: 'development' },
  });
}

export function prepareE2eDatabase({ ensureOnly = false } = {}): string {
  const url = e2eDatabaseUrl();
  if (!url) throw new Error(MISSING_DATABASE_MESSAGE);
  const name = databaseNameOf(url);
  apiScript('scripts/reset-database.ts', ensureOnly ? [name, '--ensure'] : [name], url);
  apiScript('scripts/migrate.ts', [], url);
  if (!ensureOnly) apiScript('scripts/seed.ts', [], url);
  return name;
}

export default function globalSetup(): void {
  const name = prepareE2eDatabase();
  console.log(`e2e database ${name} reset, migrated and seeded.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    prepareE2eDatabase({ ensureOnly: process.argv.includes('--ensure') });
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
