#!/usr/bin/env node
/**
 * Web parity check. The workspace and admin apps keep byte-identical copies of
 * a few auth and listening files, because a ruling kept them app-local (a shared package
 * would need an install). This script compares each pair byte for byte and
 * fails (exit 1) naming both paths of every pair that drifted: change both.
 *
 * The pairs (workspace, then admin):
 *   apps/workspace/src/auth/session-unavailable.tsx       apps/admin/src/auth/session-unavailable.tsx
 *   apps/workspace/src/auth/route-auth.ts                 apps/admin/src/auth/route-auth.ts
 *   apps/workspace/src/auth/step-up-dialog.tsx            apps/admin/src/auth/step-up-dialog.tsx
 *   apps/workspace/src/auth/screens/sso-bind-screen.tsx   apps/admin/src/auth/screens/sso-bind-screen.tsx
 *   apps/workspace/src/features/access/use-debounced.ts   apps/admin/src/use-debounced.ts
 *   apps/workspace/src/auth/with-step-up.ts              apps/admin/src/auth/with-step-up.ts
 *   apps/workspace/src/query-retry.ts                     apps/admin/src/query-retry.ts
 *   apps/workspace/src/features/listening/listening-errors.ts  apps/admin/src/features/listening/listening-errors.ts
 *   apps/workspace/src/features/listening/score-tone.ts   apps/admin/src/features/reviews/score-tone.ts
 *   apps/workspace/src/features/reviews/review-labels.ts  apps/admin/src/features/reviews/review-labels.ts
 *
 * Run by `pnpm check` as the turbo task `@nestself/workspace#check`, whose
 * inputs include `apps/admin/src` (turbo.json), so a change to an admin copy
 * alone is not answered from the cache. Node only, no dependency.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const PAIRS = [
  ['apps/workspace/src/auth/session-unavailable.tsx', 'apps/admin/src/auth/session-unavailable.tsx'],
  ['apps/workspace/src/auth/route-auth.ts', 'apps/admin/src/auth/route-auth.ts'],
  ['apps/workspace/src/auth/step-up-dialog.tsx', 'apps/admin/src/auth/step-up-dialog.tsx'],
  ['apps/workspace/src/auth/screens/sso-bind-screen.tsx', 'apps/admin/src/auth/screens/sso-bind-screen.tsx'],
  ['apps/workspace/src/features/access/use-debounced.ts', 'apps/admin/src/use-debounced.ts'],
  ['apps/workspace/src/auth/with-step-up.ts', 'apps/admin/src/auth/with-step-up.ts'],
  ['apps/workspace/src/query-retry.ts', 'apps/admin/src/query-retry.ts'],
  ['apps/workspace/src/features/listening/listening-errors.ts', 'apps/admin/src/features/listening/listening-errors.ts'],
  ['apps/workspace/src/features/listening/score-tone.ts', 'apps/admin/src/features/reviews/score-tone.ts'],
  ['apps/workspace/src/features/reviews/review-labels.ts', 'apps/admin/src/features/reviews/review-labels.ts'],
];

/** The file's bytes, or null when it does not exist. */
function read(path) {
  try {
    return readFileSync(join(repoRoot, path));
  } catch {
    return null;
  }
}

const problems = [];
for (const [workspaceCopy, adminCopy] of PAIRS) {
  const left = read(workspaceCopy);
  const right = read(adminCopy);
  if (left === null || right === null) {
    problems.push(`${left === null ? workspaceCopy : adminCopy} is missing (its pair: ${left === null ? adminCopy : workspaceCopy})`);
  } else if (!left.equals(right)) {
    problems.push(`${workspaceCopy} and ${adminCopy} differ`);
  }
}

if (problems.length > 0) {
  console.error('Web parity check failed. These workspace and admin copies must stay byte-identical; change both:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(`Web parity: ${PAIRS.length} file pairs identical in the workspace and admin apps.`);
