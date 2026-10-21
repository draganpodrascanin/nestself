import { describe, it, expect } from 'vitest';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROUTES } from './sitemap';

const APP_LOCALE_DIR = join(import.meta.dirname, '[locale]');

/**
 * Redirect-only page directories that are handled by next.config redirects
 * and intentionally excluded from the sitemap.
 */
const REDIRECT_ONLY_DIRS = new Set(['employers', 'support']);

/**
 * Walk the `[locale]` directory tree and collect every route that has a
 * `page.tsx`. Dynamic segments (`[slug]` etc.) and redirect-only directories
 * are skipped.
 */
function collectPageRoutes(dir: string, base = ''): string[] {
  const routes: string[] = [];
  if (!existsSync(dir)) return routes;

  const entries = readdirSync(dir, { withFileTypes: true });

  const hasPage = entries.some((e) => e.isFile() && e.name === 'page.tsx');
  if (hasPage) {
    routes.push(base === '' ? '' : `/${base}`);
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    // Skip dynamic segments like [slug]
    if (entry.name.startsWith('[')) continue;
    // Skip redirect-only directories at the top level
    if (base === '' && REDIRECT_ONLY_DIRS.has(entry.name)) continue;

    const subPath = base ? `${base}/${entry.name}` : entry.name;
    routes.push(...collectPageRoutes(join(dir, entry.name), subPath));
  }

  return routes;
}

describe('sitemap ROUTES', () => {
  it('includes every page.tsx directory under [locale]', () => {
    const pageRoutes = collectPageRoutes(APP_LOCALE_DIR);
    const missing = pageRoutes.filter((r) => !ROUTES.includes(r));
    expect(
      missing,
      `Routes with a page.tsx but missing from ROUTES: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('ROUTES has no duplicates', () => {
    const dupes = ROUTES.filter((r, i) => ROUTES.indexOf(r) !== i);
    expect(dupes).toEqual([]);
  });

  it('every ROUTES entry starts with / or is the empty string', () => {
    for (const r of ROUTES) {
      expect(
        r === '' || r.startsWith('/'),
        `Route "${r}" must be empty or start with /`,
      ).toBe(true);
    }
  });
});
