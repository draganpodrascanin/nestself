import { z } from 'zod';
import type { Locale } from '@nestself/i18n';
import { loadPageContent } from '@/content/loaders';

const CtaLink = z.object({ label: z.string(), href: z.string() });

const schema = z.object({
  meta: z.object({ title: z.string(), description: z.string() }),
  hero: z.object({
    title: z.string(),
    lead: z.string(),
    primaryCta: CtaLink,
    secondaryCta: CtaLink.optional(),
  }),
  pillars: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      paragraphs: z.array(z.string()),
      photo: z.object({ key: z.string(), alt: z.string() }),
      cta: CtaLink.optional(),
      icon: z.string().optional(),
    }),
  ),
  steps: z.object({
    title: z.string(),
    items: z.array(z.object({ title: z.string(), body: z.string() })),
  }),
  faq: z.object({
    title: z.string(),
    items: z.array(z.object({ question: z.string(), answer: z.string() })),
  }),
  cta: z.object({
    title: z.string(),
    body: z.string().optional(),
    primary: CtaLink,
    secondary: CtaLink.optional(),
  }),
});

export type ServicesContent = z.infer<typeof schema>;

export const loadContent = (locale: Locale) =>
  loadPageContent('services', locale, schema);
