import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { locales, isLocale, localeMeta } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import { themeBootScript } from '@nestself/tokens/theme';
import { getServerT } from '@/i18n/server';
import { localizedMetadata } from '@/i18n/metadata';
import { Providers } from '@/components/providers';
import { SiteChrome } from '@/components/site-chrome';
import { DevThemeStudio } from '@/components/dev-theme-studio';
import { SkipLinkWrapper } from '@/components/skip-link-wrapper';
import { JsonLd } from '@/components/seo/JsonLd';
import { SITE_URL } from '@/lib/site';
import '@/app/globals.css';

interface Params {
  locale: string;
}

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const { t } = await getServerT(locale as Locale);
  return localizedMetadata({
    locale: locale as Locale,
    title: t('marketing:meta.title'),
    description: t('marketing:meta.description'),
    pathname: '',
  });
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<Params>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) {
    notFound();
  }
  const meta = localeMeta[locale as Locale];

  const organizationLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'NestSelf',
    url: SITE_URL,
    areaServed: ['RS', 'HU'],
    availableLanguage: ['en', 'sr', 'hu'],
  };

  const webSiteLd = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'NestSelf',
    url: SITE_URL,
    inLanguage: meta.intl,
  };

  return (
    <html
      lang={meta.htmlLang}
      dir={meta.dir}
      data-palette="forest"
      data-mode="light"
      data-font="onest"
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{ __html: themeBootScript() }}
        />
        <JsonLd data={organizationLd} />
        <JsonLd data={webSiteLd} />
      </head>
      <body data-app-root>
        <Providers locale={locale as Locale}>
          <SkipLinkWrapper />
          <SiteChrome locale={locale as Locale}>
            {children}
          </SiteChrome>
          <DevThemeStudio />
        </Providers>
      </body>
    </html>
  );
}
