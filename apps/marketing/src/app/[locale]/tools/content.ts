import { z } from 'zod';
import { loadPageContent } from '@/content/loaders';
import type { Locale } from '@nestself/i18n';

const ctaSchema = z.object({ label: z.string(), href: z.string() });

export const schema = z.object({
  meta: z.object({ title: z.string(), description: z.string() }),
  hero: z.object({
    title: z.string(),
    lead: z.string(),
    primaryCta: ctaSchema,
    secondaryCta: ctaSchema.optional(),
  }),
  assessments: z.object({
    eyebrow: z.string(),
    title: z.string(),
    intro: z.string(),
    durationLabel: z.string(),
    questionsLabel: z.string(),
  }),
  guides: z.object({
    eyebrow: z.string(),
    title: z.string(),
    intro: z.string(),
  }),
  runner: z.object({
    start: z.string(),
    next: z.string(),
    back: z.string(),
    finish: z.string(),
    restart: z.string(),
    questionOf: z.string(),
    result: z.string(),
    yourScore: z.string(),
    nothingStored: z.string(),
    talkToSomeone: z.string(),
    relatedReading: z.string(),
  }),
  introPhotoAlt: z.record(z.string(), z.string()),
  breadcrumbs: z.object({
    home: z.string(),
    tools: z.string(),
  }),
  guideCtaLabel: z.string(),
  guideCta: z.record(z.string(), ctaSchema),
});

export type ToolsPageContent = z.infer<typeof schema>;

export const loadContent = (locale: Locale) =>
  loadPageContent('tools', locale, schema);
