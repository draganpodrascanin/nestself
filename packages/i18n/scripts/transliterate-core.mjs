/**
 * Re-export the shared transliteration implementation from @nestself/i18n.
 *
 * The canonical implementation lives in packages/i18n/src/transliterate.ts (I11).
 * This shim lets .mjs callers (e.g. marketing scripts) reach it.
 * Requires Node 24 --experimental-strip-types or a vitest/bundler transform.
 */
export { transliterate, transliterateObject } from '../src/transliterate.ts';
