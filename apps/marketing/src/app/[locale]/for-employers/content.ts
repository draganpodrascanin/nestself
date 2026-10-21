import { z } from 'zod';
import type { Locale } from '@nestself/i18n';
import { loadPageContent } from '@/content/loaders';

const ctaSchema = z.object({ label: z.string(), href: z.string() });
const photoSchema = z.object({ key: z.string(), alt: z.string() });

const schema = z.object({
  meta: z.object({ title: z.string(), description: z.string() }),
  hero: z.object({
    eyebrow: z.string(),
    title: z.string(),
    lead: z.string(),
    primaryCta: ctaSchema,
    secondaryCta: ctaSchema.optional(),
    photo: photoSchema,
  }),
  whatYourPeopleGet: z.object({
    eyebrow: z.string().optional(),
    title: z.string(),
    columns: z.number(),
    items: z.array(
      z.object({
        icon: z.string(),
        title: z.string(),
        body: z.string(),
        href: z.string().optional(),
      }),
    ),
  }),
  whatHrGets: z.object({
    eyebrow: z.string().optional(),
    title: z.string(),
    paragraphs: z.array(z.string()),
    bullets: z.array(z.string()).optional(),
    photo: photoSchema,
  }),
  howALaunchWorks: z.object({
    eyebrow: z.string().optional(),
    title: z.string(),
    steps: z.array(z.object({ title: z.string(), body: z.string() })),
  }),
  confidentiality: z.object({
    title: z.string(),
    paragraphs: z.array(z.string()),
    bullets: z.array(z.string()).optional(),
    photo: photoSchema,
  }),
  faq: z.object({
    title: z.string(),
    items: z.array(z.object({ question: z.string(), answer: z.string() })),
  }),
  cta: z.object({
    title: z.string(),
    body: z.string().optional(),
    primary: ctaSchema,
    secondary: ctaSchema.optional(),
  }),
  whoBenchmark: z
    .object({
      source: z.string(),
      sourceUrl: z.string(),
      quote: z.string(),
    })
    .optional(),
});

export type ForEmployersContent = z.infer<typeof schema>;

export const loadContent = (locale: Locale) =>
  loadPageContent('for-employers', locale, schema);
