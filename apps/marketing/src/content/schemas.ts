import { z } from 'zod';
import type { ContentType } from './types';

// ---------- shared primitives ----------

export const TopicSchema = z.enum([
  'psychological',
  'legal',
  'financial',
  'work',
  'family',
  'managers',
]);

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const IsoDateTime = z.string().datetime({ offset: true });

// ---------- article ----------

export const ArticleFrontmatterSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(200),
  topic: TopicSchema,
  publishedAt: IsoDate,
  updatedAt: IsoDate.optional(),
  cover: z.string().min(1),
  coverAlt: z.string().min(1),
  author: z.string().default('NestSelf editorial team'),
  related: z.array(z.string()).default([]),
  draft: z.boolean().default(false),
});

export type ArticleFrontmatter = z.infer<typeof ArticleFrontmatterSchema>;

// ---------- webinar ----------

export const WebinarFrontmatterSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(200),
  topic: TopicSchema,
  startsAt: IsoDateTime,
  durationMinutes: z.number().int().positive(),
  format: z.enum(['live', 'on-demand']),
  speaker: z.object({ role: z.string().min(1), area: TopicSchema }),
  languages: z.array(z.enum(['en', 'sr', 'hu'])).min(1),
  cover: z.string().min(1),
  coverAlt: z.string().min(1),
  registrationOpen: z.boolean().default(true),
  recordingAvailable: z.boolean().default(false),
  draft: z.boolean().default(false),
});

export type WebinarFrontmatter = z.infer<typeof WebinarFrontmatterSchema>;

// ---------- tool ----------

export const ToolFrontmatterSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(200),
  topic: TopicSchema,
  kind: z.enum(['guide', 'planner', 'checklist']),
  cover: z.string().min(1),
  coverAlt: z.string().min(1),
  order: z.number().int().default(100),
  draft: z.boolean().default(false),
});

export type ToolFrontmatter = z.infer<typeof ToolFrontmatterSchema>;

// ---------- assessment ----------

export const AssessmentSchema = z.object({
  title: z.string().min(1),
  intro: z.string().min(1),
  durationMinutes: z.number().int().positive(),
  topic: TopicSchema,
  instrument: z.object({
    name: z.string(),
    source: z.string().url(),
    licence: z.string(),
  }),
  questions: z
    .array(z.object({ id: z.string(), text: z.string() }))
    .min(1),
  options: z
    .array(z.object({ label: z.string(), score: z.number() }))
    .min(2),
  scoring: z.object({
    min: z.number(),
    max: z.number(),
    method: z
      .enum(['sum', 'mean', 'sum-scaled-100'])
      .optional(),
    bands: z
      .array(
        z.object({
          min: z.number(),
          max: z.number(),
          title: z.string(),
          body: z.string(),
          nextStep: z.string(),
        }),
      )
      .min(1),
  }),
  disclaimer: z.string().min(1),
  crisis: z.object({
    title: z.string(),
    body: z.string(),
    lines: z.array(z.object({ label: z.string(), value: z.string() })),
  }),
});

export type Assessment = z.infer<typeof AssessmentSchema>;

// ---------- type-level mapping ----------

export type FrontmatterOf<T extends ContentType> = T extends 'articles'
  ? ArticleFrontmatter
  : T extends 'webinars'
    ? WebinarFrontmatter
    : ToolFrontmatter;

export const frontmatterSchemas = {
  articles: ArticleFrontmatterSchema,
  webinars: WebinarFrontmatterSchema,
  tools: ToolFrontmatterSchema,
} as const;
