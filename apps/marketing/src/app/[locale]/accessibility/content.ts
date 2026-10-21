import { z } from 'zod';
import type { Locale } from '@nestself/i18n';
import { loadPageContent } from '@/content/loaders';

export const schema = z.object({
  meta: z.object({ title: z.string(), description: z.string() }),
  hero: z.object({ title: z.string(), lead: z.string() }),
  breadcrumb: z.object({ label: z.string(), home: z.string() }),
  contactHint: z.string(),
  sections: z.array(z.object({
    heading: z.string(),
    paragraphs: z.array(z.string()),
    bullets: z.array(z.string()).optional(),
  })),
});

export const loadContent = (locale: Locale) => loadPageContent('accessibility', locale, schema);
