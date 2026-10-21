import { z } from 'zod';
import type { Locale } from '@nestself/i18n';
import { loadPageContent } from '@/content/loaders';

const CtaLink = z.object({ label: z.string(), href: z.string() });
const IconName = z.string();

const schema = z.object({
  meta: z.object({ title: z.string(), description: z.string() }),
  hero: z.object({
    title: z.string(),
    lead: z.string(),
    primaryCta: CtaLink,
    secondaryCta: CtaLink.optional(),
  }),
  covers: z.object({
    eyebrow: z.string().optional(),
    title: z.string(),
    columns: z.union([z.literal(2), z.literal(3)]),
    items: z.array(
      z.object({
        icon: IconName,
        title: z.string(),
        body: z.string(),
        href: z.string().optional(),
      }),
    ),
  }),
  howItWorks: z.object({
    title: z.string(),
    steps: z.array(z.object({ title: z.string(), body: z.string() })),
  }),
  whatItIsNot: z.object({
    id: z.string().optional(),
    title: z.string(),
    paragraphs: z.array(z.string()),
    bullets: z.array(z.string()).optional(),
    photo: z.object({ key: z.string(), alt: z.string() }),
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

export type LegalConsultationContent = z.infer<typeof schema>;

export const loadContent = (locale: Locale) =>
  loadPageContent('services-legal-consultation', locale, schema);
