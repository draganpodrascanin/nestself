export const locales = ['en', 'sr-Latn', 'sr-Cyrl', 'hu'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'en';

export const namespaces = [
  'common',
  'marketing',
  'workspace',
  'admin',
  'mobile',
] as const;
export type Namespace = (typeof namespaces)[number];

export const localeMeta: Record<
  Locale,
  {
    htmlLang: string;
    hreflang: string;
    intl: string;
    nativeName: string;
    script: 'Latn' | 'Cyrl';
    dir: 'ltr';
  }
> = {
  en: {
    htmlLang: 'en',
    hreflang: 'en',
    intl: 'en-GB',
    nativeName: 'English',
    script: 'Latn',
    dir: 'ltr',
  },
  'sr-Latn': {
    htmlLang: 'sr-Latn',
    hreflang: 'sr-Latn',
    intl: 'sr-Latn-RS',
    nativeName: 'Srpski',
    script: 'Latn',
    dir: 'ltr',
  },
  'sr-Cyrl': {
    htmlLang: 'sr-Cyrl',
    hreflang: 'sr-Cyrl',
    intl: 'sr-Cyrl-RS',
    nativeName: 'Српски',
    script: 'Cyrl',
    dir: 'ltr',
  },
  hu: {
    htmlLang: 'hu',
    hreflang: 'hu',
    intl: 'hu-HU',
    nativeName: 'Magyar',
    script: 'Latn',
    dir: 'ltr',
  },
};

export function isLocale(v: unknown): v is Locale {
  return typeof v === 'string' && (locales as readonly string[]).includes(v);
}

/**
 * Parses an Accept-Language header into a quality-sorted array of BCP 47 tags.
 * Example: `"sr-Latn;q=0.8, en;q=0.9"` -> `["en", "sr-Latn"]`
 */
export function parseAcceptLanguage(header: string): string[] {
  return header
    .split(',')
    .map((entry) => {
      const parts = entry.trim().split(';');
      const tag = parts[0]?.trim() ?? '';
      const qPart = parts.find((p) => p.trim().startsWith('q='));
      const q = qPart ? parseFloat(qPart.trim().slice(2)) : 1;
      return { tag, q: Number.isFinite(q) ? q : 0 };
    })
    .filter((e) => e.tag.length > 0)
    .sort((a, b) => b.q - a.q)
    .map((e) => e.tag);
}

/**
 * Picks the best supported locale from BCP 47 tags such as
 * "sr-Latn-RS", "sr-RS", "sr", "en-US". Bare "sr" maps to sr-Latn.
 */
export function negotiateLocale(
  candidates: readonly string[],
  fallback: Locale = defaultLocale,
): Locale {
  const supported = locales as readonly string[];

  for (const candidate of candidates) {
    // Exact match
    if (supported.includes(candidate)) {
      return candidate as Locale;
    }

    // Strip region: "sr-Latn-RS" -> "sr-Latn", "en-US" -> "en"
    const parts = candidate.split('-');
    if (parts.length >= 3) {
      const langScript = `${parts[0]}-${parts[1]}`;
      if (supported.includes(langScript)) {
        return langScript as Locale;
      }
    }

    // Language only: "sr-*" -> "sr-Latn", "en-*" -> "en"
    const lang = parts[0];
    if (lang === 'sr') {
      // Check if candidate specifies Cyrillic script
      if (parts.some((p) => p === 'Cyrl')) {
        return 'sr-Cyrl';
      }
      return 'sr-Latn';
    }
    if (lang !== undefined && supported.includes(lang)) {
      return lang as Locale;
    }
  }

  return fallback;
}
