import { z } from 'zod';
import type { Locale } from '@nestself/i18n';
import { loadPageContent } from '@/content/loaders';

const ctaSchema = z.object({ label: z.string(), href: z.string() });
const photoSchema = z.object({ key: z.string(), alt: z.string() });

const schema = z.object({
  meta: z.object({ title: z.string(), description: z.string() }),
  hero: z.object({
    eyebrow: z.string().optional(),
    title: z.string(),
    lead: z.string(),
    primaryCta: ctaSchema,
    photo: photoSchema,
  }),
  mission: z.object({
    title: z.string(),
    paragraphs: z.array(z.string()),
    photo: photoSchema,
  }),
  howWeWorkWithProfessionals: z.object({
    eyebrow: z.string().optional(),
    title: z.string(),
    steps: z.array(z.object({ title: z.string(), body: z.string() })),
  }),
  team: z.object({
    eyebrow: z.string().optional(),
    title: z.string(),
    lead: z.string().optional(),
    columns: z.number(),
    members: z.array(
      z.object({
        initials: z.string(),
        role: z.string(),
        body: z.string(),
      }),
    ),
  }),
  whereWeAre: z.object({
    title: z.string(),
    paragraphs: z.array(z.string()),
    photo: photoSchema,
  }),
  cta: z.object({
    title: z.string(),
    body: z.string().optional(),
    primary: ctaSchema,
    secondary: ctaSchema.optional(),
  }),
});

export type AboutContent = z.infer<typeof schema>;

export const loadContent = (locale: Locale) =>
  loadPageContent('about', locale, schema);
