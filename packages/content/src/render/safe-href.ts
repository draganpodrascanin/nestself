/**
 * Safe href utilities for the renderer layer.
 *
 * `isValidHref` is the single source of truth, defined in `schema/blocks.ts`
 * and re-exported here. The renderer calls it as defense-in-depth: a link
 * that somehow bypasses schema validation (e.g. a document fed directly to
 * the renderer) renders as plain text instead of an anchor (6.9).
 *
 * `isSafeAppHref` validates hrefs returned by host resolvers (CTA, related
 * resource, internal link). These are app-generated paths or URLs, not
 * user-supplied content, but we still guard against open-redirect patterns.
 */

import { isValidHref } from '../schema/blocks.ts';

// Re-export the canonical predicate
export { isValidHref };

/** Backward-compatible alias for `isValidHref`. */
export const isSafeHref = isValidHref;

/** Internal content link pattern: `nestself:content/<ContentId>`. */
const INTERNAL_LINK_RE = /^nestself:content\/[A-Za-z0-9_-]{1,64}$/;

/**
 * Returns true if the href is an internal content link.
 */
export function isInternalHref(href: string): boolean {
  return typeof href === 'string' && INTERNAL_LINK_RE.test(href);
}

/**
 * Extracts the content resource id from an internal href.
 * Returns null if the href is not internal.
 */
export function extractContentId(href: string): string | null {
  if (!isInternalHref(href)) return null;
  return href.slice('nestself:content/'.length);
}

/**
 * Validates an href returned by a host resolver (CTA, related resource,
 * internal link). Accepts:
 * - Same-origin relative paths: starts with `/` but not `//` (prevents
 *   protocol-relative URLs like `//evil.example`).
 * - Any href that passes `isValidHref` (https or internal).
 *
 * Rejects `javascript:`, `data:`, protocol-relative, and other schemes.
 */
export function isSafeAppHref(href: string): boolean {
  if (typeof href !== 'string' || href.length === 0) return false;
  // Same-origin relative path (starts with / but not //)
  if (href[0] === '/' && href[1] !== '/') return true;
  // Full URL — delegate to the canonical predicate
  return isValidHref(href);
}
