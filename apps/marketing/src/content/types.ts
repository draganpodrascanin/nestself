import type { Locale } from '@nestself/i18n';

export type ContentType = 'articles' | 'webinars' | 'tools';

export interface ContentEntry<F> {
  type: ContentType;
  slug: string;
  /** Locale actually served. */
  locale: Locale;
  requestedLocale: Locale;
  fallback: boolean;
  frontmatter: F;
  body: string;
  readingMinutes: number;
}

export interface LocalisedData<T> {
  data: T;
  locale: Locale;
  fallback: boolean;
}
