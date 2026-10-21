import { z } from 'zod';
import type { Locale } from '@nestself/i18n';
import { loadPageContent } from '@/content/loaders';

const CtaLink = z.object({ label: z.string(), href: z.string() });
const IconName = z.string();

const CrisisLine = z.object({ label: z.string(), value: z.string() });
const CrisisCountry = z.object({
  country: z.string(),
  items: z.array(CrisisLine),
});

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
  whoYouTalkTo: z.object({
    id: z.string().optional(),
    title: z.string(),
    paragraphs: z.array(z.string()),
    photo: z.object({ key: z.string(), alt: z.string() }),
  }),
  crisis: z.object({
    title: z.string(),
    body: z.string(),
    lines: z.array(CrisisCountry),
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

export type TherapyContent = z.infer<typeof schema>;

export const loadContent = (locale: Locale) =>
  loadPageContent('services-therapy', locale, schema);
