import type { MetadataRoute } from 'next';
import { locales, localeMeta } from '@nestself/i18n';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

const routes = ['', '/support', '/employers', '/privacy-model', '/credits'];

export default function sitemap(): MetadataRoute.Sitemap {
  const entries: MetadataRoute.Sitemap = [];

  for (const route of routes) {
    for (const locale of locales) {
      const languages: Record<string, string> = {};
      for (const alt of locales) {
        languages[localeMeta[alt].hreflang] = `${SITE_URL}/${alt}${route}`;
      }
      entries.push({
        url: `${SITE_URL}/${locale}${route}`,
        alternates: { languages },
      });
    }
  }

  return entries;
}
