/**
 * Dedicated database for the content e2e suite (T-C1.15).
 *
 * Follows the same naming convention as the auth suite (`e2e/e2e-database.ts`):
 *
 *   - `E2E_DATABASE_URL` when set (must name a disposable database);
 *   - otherwise `TEST_DATABASE_URL` server with
 *     `nestself_e2e_<prefix>_content`, where `<prefix>` is the worktree hash
 *     so two checkouts never collide, and the `_content` suffix avoids
 *     colliding with the auth suite's database.
 *
 * Playwright starts `webServer` entries before `globalSetup`, so the API
 * webServer command runs this module first (via tsx) to drop, recreate,
 * migrate and seed the database before the API boots.
 *
 *   pnpm --filter @nestself/api exec tsx ../../e2e/content/database.ts && pnpm --filter @nestself/api dev
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  disposableDatabaseProblem,
  testDatabaseName,
} from '../../apps/api/test/db/test-database-name.ts';

// ---------------------------------------------------------------------------
// Name and URL helpers
// ---------------------------------------------------------------------------

const CONTENT_SUFFIX = 'content';

/**
 * The database name for the content suite:
 * `nestself_e2e_<prefix>_content` (always disposable).
 */
export function contentE2eDatabaseName(
  env: Record<string, string | undefined> = process.env,
): string {
  return testDatabaseName('nestself_e2e', CONTENT_SUFFIX, { env });
}

function databaseNameOf(url: string): string {
  return decodeURIComponent(new URL(url).pathname.slice(1));
}

/**
 * The content suite's database URL.
 *
 * - `E2E_DATABASE_URL` when set — must name a disposable
 *   `nestself_e2e_*` / `nestself_test_*` database.
 * - Otherwise `TEST_DATABASE_URL` server + `contentE2eDatabaseName()`.
 *
 * Returns `null` when neither variable is set. Throws on a
 * non-disposable name so the run stops before any server starts.
 */
export function contentE2eDatabaseUrl(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const explicit = env.E2E_DATABASE_URL?.trim();
  if (explicit) {
    const problem = disposableDatabaseProblem(databaseNameOf(explicit));
    if (problem) {
      throw new Error(
        `E2E_DATABASE_URL is refused: ${problem}. The content suite drops and ` +
          'recreates this database, so it must be a disposable ' +
          'nestself_e2e_* or nestself_test_* database.',
      );
    }
    return explicit;
  }
  const base = env.TEST_DATABASE_URL?.trim();
  if (!base) return null;
  const url = new URL(base);
  url.pathname = `/${contentE2eDatabaseName(env)}`;
  return url.toString();
}

// ---------------------------------------------------------------------------
// Database preparation
// ---------------------------------------------------------------------------

export const MISSING_DATABASE_MESSAGE =
  'pnpm e2e:content needs a disposable database: set TEST_DATABASE_URL ' +
  '(for example postgresql://nestself:nestself_dev@localhost:54329/nestself_test) ' +
  'or E2E_DATABASE_URL. The run drops and recreates that database; ' +
  'it never uses DATABASE_URL from apps/api/.env.';

function apiScript(script: string, args: string[], databaseUrl: string): void {
  const root = resolve(fileURLToPath(import.meta.url), '../../..');
  execFileSync(
    'pnpm',
    ['--filter', '@nestself/api', 'exec', 'tsx', script, ...args],
    {
      stdio: 'inherit',
      cwd: root,
      env: { ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: 'development' },
    },
  );
}

/** Drop and recreate the suite database, then migrate and seed it. */
export function prepareContentDatabase(): string {
  const url = contentE2eDatabaseUrl();
  if (!url) throw new Error(MISSING_DATABASE_MESSAGE);
  const name = databaseNameOf(url);
  apiScript('scripts/reset-database.ts', [name], url);
  apiScript('scripts/migrate.ts', [], url);
  apiScript('scripts/seed.ts', [], url);
  return name;
}

// ---------------------------------------------------------------------------
// CLI entry point (run by the API webServer command)
// ---------------------------------------------------------------------------

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  try {
    const name = prepareContentDatabase();
    console.log(`[content-e2e] ${name} migrated and seeded`);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
