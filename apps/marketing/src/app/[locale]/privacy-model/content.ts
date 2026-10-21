import { z } from 'zod';
import type { Locale } from '@nestself/i18n';
import { loadPageContent } from '@/content/loaders';

export const schema = z.object({
  meta: z.object({ title: z.string(), description: z.string() }),
  hero: z.object({ title: z.string(), lead: z.string() }),
  breadcrumb: z.object({ label: z.string(), home: z.string() }),
  inPractice: z.object({
    eyebrow: z.string(),
    title: z.string(),
    steps: z.array(z.object({ title: z.string(), body: z.string() })),
  }),
});

export const loadContent = (locale: Locale) => loadPageContent('privacy-model', locale, schema);
