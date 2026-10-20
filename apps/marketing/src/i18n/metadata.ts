import { locales, localeMeta } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import type { Metadata } from 'next';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export function localeAlternates(pathname: string) {
  const canonical = `${SITE_URL}/en${pathname}`;
  const languages: Record<string, string> = {};
  for (const locale of locales) {
    languages[localeMeta[locale].hreflang] = `${SITE_URL}/${locale}${pathname}`;
  }
  languages['x-default'] = `${SITE_URL}/en${pathname}`;
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
  const alternates = localeAlternates(pathname);
  return {
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
    },
  };
}
