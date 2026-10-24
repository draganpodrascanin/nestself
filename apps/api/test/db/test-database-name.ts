/**
 * Test database naming, shared by the API integration suites
 * (`test-database.ts`) and the Playwright auth stack (`e2e/global-setup.ts`).
 *
 * Several git worktrees of this repository may run the same suite against
 * one PostgreSQL server at the same time. A per-worktree prefix keeps their
 * databases apart: `<base>_<prefix>_<suffix>`, where `prefix` is
 * `TEST_DATABASE_PREFIX` when set, otherwise the first eight hex characters
 * of the SHA-1 of the repository root path. Dependency-free on purpose so
 * the Playwright config can import it.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** PostgreSQL truncates identifiers longer than this many bytes. */
export const MAX_IDENTIFIER_LENGTH = 63;

const SAFE_PART = /^[a-z0-9_]+$/;

export interface TestDatabaseNameOptions {
  /** Defaults to `process.env`. */
  env?: Record<string, string | undefined>;
  /** Directory to walk up from to find `pnpm-workspace.yaml`. Defaults to `process.cwd()`. */
  cwd?: string;
}

/** Nearest ancestor of `start` (inclusive) that contains `pnpm-workspace.yaml`. */
export function findRepositoryRoot(start: string = process.cwd()): string {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`No pnpm-workspace.yaml found above ${start}`);
    }
    dir = parent;
  }
}

/** `TEST_DATABASE_PREFIX`, or an 8-character hash of the repository root. */
export function testDatabasePrefix(opts: TestDatabaseNameOptions = {}): string {
  const env = opts.env ?? process.env;
  const override = env.TEST_DATABASE_PREFIX?.trim();
  if (override) {
    const lowered = override.toLowerCase();
    if (!SAFE_PART.test(lowered)) {
      throw new Error(
        `TEST_DATABASE_PREFIX must contain only letters, digits and underscores (got "${override}")`,
      );
    }
    return lowered;
  }
  const root = findRepositoryRoot(opts.cwd ?? process.cwd());
  return createHash('sha1').update(root).digest('hex').slice(0, 8);
}

/**
 * `<base>_<prefix>_<suffix>`, with `base` shortened when the whole name
 * would exceed PostgreSQL's 63-byte identifier limit.
 */
export function testDatabaseName(
  baseName: string,
  suffix: string,
  opts: TestDatabaseNameOptions = {},
): string {
  if (!SAFE_PART.test(suffix)) {
    throw new Error(`Test database suffix must match ${SAFE_PART} (got "${suffix}")`);
  }
  const tail = `_${testDatabasePrefix(opts)}_${suffix}`;
  const room = MAX_IDENTIFIER_LENGTH - tail.length;
  if (room < 1) {
    throw new Error(`Test database suffix "${suffix}" is too long for a PostgreSQL identifier`);
  }
  return `${baseName.slice(0, room)}${tail}`;
}
