import { z } from 'zod';
import type { Locale } from '@nestself/i18n';
import { loadPageContent } from '@/content/loaders';

const photoSchema = z.object({ key: z.string(), alt: z.string() });
const ctaSchema = z.object({ label: z.string(), href: z.string() });

export const schema = z.object({
  meta: z.object({ title: z.string(), description: z.string() }),
  hero: z.object({
    eyebrow: z.string(),
    title: z.string(),
    lead: z.string(),
    primaryCta: z.string(),
    secondaryCta: z.string(),
    photos: z.tuple([photoSchema, photoSchema, photoSchema]),
  }),
  trust: z.array(z.object({ icon: z.string(), label: z.string() })),
  services: z.object({
    eyebrow: z.string(),
    title: z.string(),
    lead: z.string(),
    items: z.array(
      z.object({
        icon: z.string(),
        title: z.string(),
        body: z.string(),
        href: z.string(),
      }),
    ),
  }),
  steps: z.object({
    eyebrow: z.string(),
    title: z.string(),
    lead: z.string().optional(),
    photo: photoSchema.optional(),
    steps: z.array(z.object({ title: z.string(), body: z.string() })),
  }),
  employers: z.object({
    eyebrow: z.string(),
    title: z.string(),
    paragraphs: z.array(z.string()),
    bullets: z.array(z.string()),
    photo: photoSchema,
    cta: ctaSchema,
  }),
  life: z.object({
    eyebrow: z.string(),
    title: z.string(),
    paragraphs: z.array(z.string()),
    photo: photoSchema,
  }),
  resources: z.object({
    title: z.string(),
    moreLabel: z.string(),
  }),
  assessments: z.object({
    title: z.string(),
  }).optional(),
  testimonials: z.object({
    title: z.string(),
    lead: z.string().optional(),
    badge: z.string().optional(),
  }),
  faq: z.object({
    title: z.string(),
    moreLabel: z.string().optional(),
    items: z.array(z.object({ question: z.string(), answer: z.string() })),
  }),
  ctaBand: z.object({
    title: z.string(),
    body: z.string().optional(),
    primary: ctaSchema,
    secondary: ctaSchema.optional(),
  }),
});

export type HomeContent = z.infer<typeof schema>;

export const loadContent = (locale: Locale) =>
  loadPageContent('home', locale, schema);
