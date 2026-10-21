import type { MetadataRoute } from 'next';
import { locales, localeMeta, localePath } from '@nestself/i18n';
import { listSlugs, listAssessmentSlugs, getEntry } from '@/content/loaders';
import { SITE_URL } from '@/i18n/metadata';

/**
 * Every static route in the marketing site plan.
 * The sitemap test checks that each `page.tsx` under `app/[locale]`
 * is represented here; failing the test means a page was added but
 * not registered for search engines.
 */
export const ROUTES: string[] = [
  '',
  '/for-employers',
  '/for-employees',
  '/for-managers',
  '/services',
  '/services/therapy',
  '/services/legal-consultation',
  '/services/financial-guidance',
  '/resources',
  '/articles',
  '/webinars',
  '/tools',
  '/plans',
  '/about',
  '/faq',
  '/demo',
  '/contact',
  '/privacy-model',
  '/accessibility',
  '/legal/privacy-policy',
  '/legal/terms',
  '/legal/cookies',
  '/legal/imprint',
];

// ---------------------------------------------------------------------------

function alternatesForRoute(route: string): Record<string, string> {
  const languages: Record<string, string> = {};
  for (const locale of locales) {
    languages[localeMeta[locale].hreflang] = `${SITE_URL}${localePath(locale, route)}`;
  }
  return languages;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [];

  // ---- Static routes ----
  for (const route of ROUTES) {
    for (const locale of locales) {
      entries.push({
        url: `${SITE_URL}${localePath(locale, route)}`,
        alternates: { languages: alternatesForRoute(route) },
      });
    }
  }

  // ---- Dynamic: articles ----
  const articleSlugs = await listSlugs('articles');
  for (const slug of articleSlugs) {
    const entry = await getEntry('articles', slug, 'en');
    const dateStr =
      entry?.frontmatter.updatedAt ?? entry?.frontmatter.publishedAt;
    const route = `/articles/${slug}`;
    for (const locale of locales) {
      entries.push({
        url: `${SITE_URL}${localePath(locale, route)}`,
        alternates: { languages: alternatesForRoute(route) },
        ...(dateStr ? { lastModified: dateStr } : {}),
      });
    }
  }

  // ---- Dynamic: webinars ----
  const webinarSlugs = await listSlugs('webinars');
  for (const slug of webinarSlugs) {
    const entry = await getEntry('webinars', slug, 'en');
    const startsAt = entry?.frontmatter.startsAt;
    const lastModified = startsAt
      ? new Date(startsAt).toISOString().split('T')[0]
      : undefined;
    const route = `/webinars/${slug}`;
    for (const locale of locales) {
      entries.push({
        url: `${SITE_URL}${localePath(locale, route)}`,
        alternates: { languages: alternatesForRoute(route) },
        ...(lastModified ? { lastModified } : {}),
      });
    }
  }

  // ---- Dynamic: tools ----
  const toolSlugs = await listSlugs('tools');
  for (const slug of toolSlugs) {
    const route = `/tools/${slug}`;
    for (const locale of locales) {
      entries.push({
        url: `${SITE_URL}${localePath(locale, route)}`,
        alternates: { languages: alternatesForRoute(route) },
      });
    }
  }

  // ---- Dynamic: assessments (served under /tools/) ----
  const assessmentSlugs = await listAssessmentSlugs();
  for (const slug of assessmentSlugs) {
    // Skip if a tool with the same slug already generated an entry.
    if (toolSlugs.includes(slug)) continue;
    const route = `/tools/${slug}`;
    for (const locale of locales) {
      entries.push({
        url: `${SITE_URL}${localePath(locale, route)}`,
        alternates: { languages: alternatesForRoute(route) },
      });
    }
  }

  return entries;
}
