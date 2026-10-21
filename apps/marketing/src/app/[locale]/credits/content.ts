import { z } from 'zod';
import type { Locale } from '@nestself/i18n';
import { loadPageContent } from '@/content/loaders';

export const schema = z.object({
  meta: z.object({ title: z.string(), description: z.string() }),
  hero: z.object({ title: z.string(), lead: z.string() }),
  breadcrumb: z.object({ label: z.string(), home: z.string() }),
  generatedImagery: z.object({
    title: z.string(),
    lead: z.string(),
    tableCaption: z.string(),
    colImage: z.string(),
    colGenerator: z.string(),
  }),
  photography: z.object({
    title: z.string(),
    lead: z.string(),
    tableCaption: z.string(),
    colPhoto: z.string(),
    colPhotographer: z.string(),
    colSource: z.string(),
    colLicence: z.string(),
    sourceLinkText: z.string(),
    licenceLinkText: z.string(),
  }),
  fonts: z.object({ title: z.string(), body: z.string() }),
  icons: z.object({ title: z.string(), body: z.string() }),
});

export const loadContent = (locale: Locale) => loadPageContent('credits', locale, schema);
