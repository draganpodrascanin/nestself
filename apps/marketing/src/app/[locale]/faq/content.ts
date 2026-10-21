import { z } from 'zod';
import type { Locale } from '@nestself/i18n';
import { loadPageContent } from '@/content/loaders';

const ctaSchema = z.object({ label: z.string(), href: z.string() });

const schema = z.object({
  meta: z.object({ title: z.string(), description: z.string() }),
  hero: z.object({
    title: z.string(),
    lead: z.string(),
    primaryCta: ctaSchema,
  }),
  employerFaq: z.object({
    title: z.string(),
    items: z.array(z.object({ question: z.string(), answer: z.string() })),
  }),
  employeeFaq: z.object({
    title: z.string(),
    items: z.array(z.object({ question: z.string(), answer: z.string() })),
  }),
  cta: z.object({
    title: z.string(),
    body: z.string().optional(),
    primary: ctaSchema,
    secondary: ctaSchema.optional(),
  }),
});

export type FaqPageContent = z.infer<typeof schema>;

export const loadContent = (locale: Locale) =>
  loadPageContent('faq', locale, schema);
