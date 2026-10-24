/**
 * Safe href check for the renderer layer.
 *
 * Even though validation already rejects unsafe hrefs, the renderer
 * provides defense-in-depth: it only renders hrefs that pass the
 * same check used by the schema. A link that somehow bypasses
 * validation (e.g. a document fed directly to the renderer) renders
 * as plain text instead of an anchor (6.9).
 */

/** Matches the INTERNAL_LINK_RE from blocks.ts. */
const INTERNAL_LINK_RE = /^nestself:content\/[A-Za-z0-9_-]{1,64}$/;

/** Matches the NON_ASCII_RE from blocks.ts (T-C1.06 hardening). */
// eslint-disable-next-line no-control-regex -- intentionally matching all non-ASCII
const NON_ASCII_RE = /[^\x00-\x7f]/;

/**
 * Returns true if the href is safe to render as a link.
 * Mirrors the Zod-layer checks: must be `nestself:content/<id>` or
 * literally start with `https://`, be ASCII-only, have no userinfo,
 * and have no non-default port.
 */
export function isSafeHref(href: string): boolean {
  if (INTERNAL_LINK_RE.test(href)) return true;

  // ASCII-only
  if (NON_ASCII_RE.test(href)) return false;

  // Must literally start with 'https://'
  if (!href.startsWith('https://')) return false;

  try {
    const url = new URL(href);
    if (url.protocol !== 'https:') return false;
    if (url.username || url.password) return false;
    if (url.port !== '') return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns true if the href is an internal content link.
 */
export function isInternalHref(href: string): boolean {
  return INTERNAL_LINK_RE.test(href);
}

/**
 * Extracts the content resource id from an internal href.
 * Returns null if the href is not internal.
 */
export function extractContentId(href: string): string | null {
  if (!INTERNAL_LINK_RE.test(href)) return null;
  return href.slice('nestself:content/'.length);
}
