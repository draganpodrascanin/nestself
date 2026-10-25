/**
 * Parse the Accept-Language header to a reader locale (C-28, LIB-R-31).
 *
 * Restricted to the four interface locales: sr-Latn, sr-Cyrl, hu, en.
 * Case-insensitive matching, q=0 excluded. Default: sr-Latn.
 */
import { ContentLocaleSchema } from '@nestself/contracts';
import type { ReaderLocale } from './availability/availability-context.js';

/** Canonical locales from the contract schema. */
const VALID_LOCALES: Set<string> = new Set(ContentLocaleSchema.options);

/** Map Accept-Language tag (lowercased) to a canonical locale. */
const ALIAS_MAP: Record<string, ReaderLocale> = {
  'sr': 'sr-Latn',
  'sr-latn': 'sr-Latn',
  'sr-latn-rs': 'sr-Latn',
  'sr-rs': 'sr-Latn',
  'sr-cyrl': 'sr-Cyrl',
  'sr-cyrl-rs': 'sr-Cyrl',
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

  // Sort by quality descending, then filter out q=0
  entries.sort((a, b) => b.q - a.q);

  for (const { tag, q } of entries) {
    if (q === 0) continue;

    const lower = tag.toLowerCase();

    // Direct match (case-insensitive)
    if (VALID_LOCALES.has(tag)) {
      return tag as ReaderLocale;
    }

    // Alias match (lowercased)
    const alias = ALIAS_MAP[lower];
    if (alias) return alias;

    // Prefix match for language subtags
    if (lower.startsWith('hu')) return 'hu';
    if (lower.startsWith('en')) return 'en';
  }

  return 'sr-Latn';
}
