import { z } from 'zod';
import type { Locale } from '@nestself/i18n';
import { loadPageContent } from '@/content/loaders';

const ctaSchema = z.object({ label: z.string(), href: z.string() });

export const schema = z.object({
  meta: z.object({ title: z.string(), description: z.string() }),
  hero: z.object({
    title: z.string(),
    lead: z.string(),
    primaryCta: ctaSchema,
  }),
  filterLabel: z.string(),
  allTopicsLabel: z.string(),
  topics: z.object({
    psychological: z.string(),
    legal: z.string(),
    financial: z.string(),
    work: z.string(),
    family: z.string(),
    managers: z.string(),
  }),
  cardLabels: z.object({
    readingTime: z.string(),
    published: z.string(),
  }),
  detail: z.object({
    breadcrumbLabel: z.string(),
    breadcrumbArticles: z.string(),
    readingTime: z.string(),
    disclaimerText: z.string(),
    disclaimerLinkText: z.string(),
    relatedTitle: z.string(),
    ctaBand: z.object({
      title: z.string(),
      body: z.string(),
      primaryLabel: z.string(),
      primaryHref: z.string(),
    }),
  }),
  serviceLinks: z.record(z.string(), z.string()),
});

export const loadContent = (locale: Locale) =>
  loadPageContent('articles', locale, schema);
