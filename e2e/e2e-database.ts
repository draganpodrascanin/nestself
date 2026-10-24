/**
 * The database the Playwright auth stack gives its stub API.
 *
 * `E2E_DATABASE_URL` when set; otherwise the `TEST_DATABASE_URL` server with
 * database `nestself_e2e_<prefix>`, where `<prefix>` follows the integration
 * suites' rule (`TEST_DATABASE_PREFIX`, else a hash of the repository root)
 * so worktrees never share, and never drop, one another's database.
 */
import { testDatabasePrefix } from '../apps/api/test/db/test-database-name.ts';

export const MISSING_DATABASE_MESSAGE =
  'pnpm e2e:auth needs a disposable database: set TEST_DATABASE_URL (for example ' +
  'postgresql://nestself:nestself_dev@localhost:54329/nestself_test) or E2E_DATABASE_URL. ' +
  'The run drops and recreates that database; it never uses DATABASE_URL from apps/api/.env.';

export function e2eDatabaseUrl(env: Record<string, string | undefined> = process.env): string | null {
  const explicit = env.E2E_DATABASE_URL?.trim();
  if (explicit) return explicit;
  const base = env.TEST_DATABASE_URL?.trim();
  if (!base) return null;
  const url = new URL(base);
  url.pathname = `/nestself_e2e_${testDatabasePrefix({ env })}`;
  return url.toString();
}

export function databaseNameOf(url: string): string {
  return decodeURIComponent(new URL(url).pathname.slice(1));
}
