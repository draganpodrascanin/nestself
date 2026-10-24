/**
 * Parse the Accept-Language header to a reader locale (C-28, LIB-R-31).
 *
 * Restricted to the four interface locales: sr-Latn, sr-Cyrl, hu, en.
 * Default: sr-Latn.
 */
import type { ReaderLocale } from './availability/availability-context.js';

const VALID_LOCALES = new Set<string>(['sr-Latn', 'sr-Cyrl', 'hu', 'en']);

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

  for (const { tag } of entries) {
    if (VALID_LOCALES.has(tag)) {
      return tag as ReaderLocale;
    }
    // Map common aliases
    if (tag === 'sr' || tag === 'sr-Latn-RS') return 'sr-Latn';
    if (tag === 'sr-Cyrl-RS') return 'sr-Cyrl';
    if (tag.startsWith('hu')) return 'hu';
    if (tag.startsWith('en')) return 'en';
  }

  return 'sr-Latn';
}
