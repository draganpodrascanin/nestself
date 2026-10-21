import { locales, defaultLocale, localeMeta, localePath } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import type { Metadata } from 'next';

export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

const metadataBase = new URL(SITE_URL);

export function localeAlternates(pathname: string, locale: Locale) {
  const canonical = `${SITE_URL}${localePath(locale, pathname)}`;
  const languages: Record<string, string> = {};
  for (const loc of locales) {
    languages[localeMeta[loc].hreflang] = `${SITE_URL}${localePath(loc, pathname)}`;
  }
  languages['x-default'] = `${SITE_URL}${localePath(defaultLocale, pathname)}`;
  return { canonical, languages };
}

export function localizedMetadata({
  locale,
  title,
  description,
  pathname,
}: {
  locale: Locale;
  title: string;
  description?: string;
  pathname: string;
}): Metadata {
  const alternates = localeAlternates(pathname, locale);
  return {
    metadataBase,
    title,
    description,
    alternates: {
      canonical: alternates.canonical,
      languages: alternates.languages,
    },
    openGraph: {
      title,
      description,
      locale: localeMeta[locale].intl,
      type: 'website',
      images: [localePath(locale, '/opengraph-image')],
    },
    twitter: {
      card: 'summary_large_image',
    },
  };
}
