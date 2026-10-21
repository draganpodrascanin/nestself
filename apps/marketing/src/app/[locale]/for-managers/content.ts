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
  features: z.object({
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
  steps: z.object({
    eyebrow: z.string().optional(),
    title: z.string(),
    steps: z.array(z.object({ title: z.string(), body: z.string() })),
  }),
  resources: z.object({
    title: z.string(),
    moreHref: z.string(),
    moreLabel: z.string(),
  }),
  cta: z.object({
    title: z.string(),
    body: z.string().optional(),
    primary: ctaSchema,
    secondary: ctaSchema.optional(),
  }),
});

export type ForManagersContent = z.infer<typeof schema>;

export const loadContent = (locale: Locale) =>
  loadPageContent('for-managers', locale, schema);
