export const locales = ['sr-Latn', 'sr-Cyrl', 'hu', 'en'] as const;
export type Locale = (typeof locales)[number];
/** Serbian Latin is the default: it is served when nothing in the cookie or Accept-Language matches. */
export const defaultLocale: Locale = 'sr-Latn';

export const namespaces = [
  'common',
  'marketing',
  'workspace',
  'admin',
  'mobile',
  'auth',
  'calls',
] as const;
export type Namespace = (typeof namespaces)[number];

export const localeMeta: Record<
  Locale,
  {
    htmlLang: string;
    hreflang: string;
    intl: string;
    nativeName: string;
    /** Script qualifier shown next to the native name where two scripts of one language are offered. */
    scriptLabel?: string;
    script: 'Latn' | 'Cyrl';
    dir: 'ltr';
  }
> = {
  'sr-Latn': {
    htmlLang: 'sr-Latn',
    hreflang: 'sr-Latn',
    intl: 'sr-Latn-RS',
    nativeName: 'Srpski',
    scriptLabel: 'latinica',
    script: 'Latn',
    dir: 'ltr',
  },
  'sr-Cyrl': {
    htmlLang: 'sr-Cyrl',
    hreflang: 'sr-Cyrl',
    intl: 'sr-Cyrl-RS',
    nativeName: 'Српски',
    scriptLabel: 'ћирилица',
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
  en: {
    htmlLang: 'en',
    hreflang: 'en',
    intl: 'en-GB',
    nativeName: 'English',
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

/**
 * Builds the public path for a locale. The default locale lives at the root
 * (`/`, `/plans`); every other locale is prefixed (`/en/plans`, `/hu`).
 */
export function localePath(locale: Locale, path = ''): string {
  const normalized = path === '/' ? '' : path;
  if (locale === defaultLocale) return normalized || '/';
  return `/${locale}${normalized}`;
}

/**
 * Splits a public pathname into its locale and the locale-free path.
 * `/hu/plans` -> { locale: 'hu', path: '/plans' }; `/plans` -> { locale: defaultLocale, path: '/plans' }.
 */
export function stripLocalePrefix(pathname: string): { locale: Locale; path: string } {
  const [, first = '', ...rest] = pathname.split('/');
  if (isLocale(first)) {
    const path = `/${rest.join('/')}`.replace(/\/+$/, '');
    return { locale: first, path: path || '/' };
  }
  const path = pathname.replace(/\/+$/, '');
  return { locale: defaultLocale, path: path || '/' };
}
