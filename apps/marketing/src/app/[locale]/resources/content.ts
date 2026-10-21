import { z } from 'zod';
import type { Locale } from '@nestself/i18n';
import { loadPageContent } from '@/content/loaders';

const ctaSchema = z.object({ label: z.string(), href: z.string() });

const sectionSchema = z.object({
  title: z.string(),
  seeAllLabel: z.string(),
  seeAllHref: z.string(),
});

export const schema = z.object({
  meta: z.object({ title: z.string(), description: z.string() }),
  hero: z.object({
    title: z.string(),
    lead: z.string(),
    primaryCta: ctaSchema,
  }),
  sections: z.object({
    webinars: sectionSchema,
    articles: sectionSchema,
    tools: sectionSchema,
  }),
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
    live: z.string(),
    onDemand: z.string(),
    minutes: z.string(),
    languages: z.string(),
    questionsLabel: z.string(),
  }),
});

export const loadContent = (locale: Locale) =>
  loadPageContent('resources', locale, schema);
