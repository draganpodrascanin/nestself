/**
 * Parse the Accept-Language header to a reader locale (C-28, LIB-R-31).
 *
 * Restricted to the four interface locales: sr-Latn, sr-Cyrl, hu, en.
 * Case-insensitive matching, q=0 excluded. Default: sr-Latn.
 *
 * Serbian aliases (minor 5):
 * - `sr`, `sr-Latn-*`, `sr-RS`, `sr-ME`, `sr-BA` -> sr-Latn
 * - `sr-Cyrl-*` -> sr-Cyrl
 */
import { ContentLocaleSchema } from '@nestself/contracts';
import type { ReaderLocale } from './availability/availability-context.js';

/** Canonical locales from the contract schema (lowercased for lookup). */
const CANONICAL_BY_LOWER = new Map<string, ReaderLocale>(
  ContentLocaleSchema.options.map((l) => [l.toLowerCase(), l as ReaderLocale]),
);

/** Static alias map: Accept-Language tag (lowercased) -> canonical locale. */
const ALIAS_MAP: Record<string, ReaderLocale> = {
  'sr': 'sr-Latn',
  'sr-latn': 'sr-Latn',
  'sr-rs': 'sr-Latn',
  'sr-me': 'sr-Latn',
  'sr-ba': 'sr-Latn',
  'sr-cyrl': 'sr-Cyrl',
};

/**
 * Extract the first matching reader locale from the Accept-Language header.
 * Falls back to `sr-Latn`.
 */
export function parseAcceptLanguageLocale(
  header: string | undefined | null,
): ReaderLocale {
  if (!header) return 'sr-Latn';

  // Parse Accept-Language entries with optional quality values
  const entries = header.split(',').map((entry) => {
    const [tag, ...rest] = entry.trim().split(';');
    const qPart = rest.find((p) => p.trim().startsWith('q='));
    const q = qPart ? parseFloat(qPart.split('=')[1] ?? '1') : 1;
    return { tag: tag!.trim(), q: Number.isFinite(q) ? q : 1 };
  });

  // Sort by quality descending
  entries.sort((a, b) => b.q - a.q);

  for (const { tag, q } of entries) {
    if (q === 0) continue;

    const lower = tag.toLowerCase();

    // Exact canonical match (case-insensitive)
    const canonical = CANONICAL_BY_LOWER.get(lower);
    if (canonical) return canonical;

    // Static alias match
    const alias = ALIAS_MAP[lower];
    if (alias) return alias;

    // Prefix-based matching for sr-Latn-*, sr-Cyrl-*, hu-*, en-*
    if (lower.startsWith('sr-cyrl')) return 'sr-Cyrl';
    if (lower.startsWith('sr-latn') || lower.startsWith('sr-')) return 'sr-Latn';
    if (lower.startsWith('hu')) return 'hu';
    if (lower.startsWith('en')) return 'en';
  }

  return 'sr-Latn';
}
