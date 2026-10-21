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
  whatYouCanUse: z.object({
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
  howToStart: z.object({
    eyebrow: z.string().optional(),
    title: z.string(),
    photo: z.object({ key: z.string(), alt: z.string() }).optional(),
    steps: z.array(z.object({ title: z.string(), body: z.string() })),
  }),
  whoSeesWhat: z.object({
    title: z.string(),
    paragraphs: z.array(z.string()),
    bullets: z.array(z.string()).optional(),
    cta: ctaSchema.optional(),
    photo: photoSchema,
  }),
  forYourFamily: z.object({
    title: z.string(),
    paragraphs: z.array(z.string()),
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
});

export type ForEmployeesContent = z.infer<typeof schema>;

export const loadContent = (locale: Locale) =>
  loadPageContent('for-employees', locale, schema);
