import { z } from 'zod';
import type { Locale } from '@nestself/i18n';
import { loadPageContent } from '@/content/loaders';

export const legalPageSchema = z.object({
  draft: z.boolean().optional(),
  meta: z.object({ title: z.string(), description: z.string() }),
  title: z.string(),
  updatedAt: z.string(),
  updatedAtLabel: z.string(),
  breadcrumb: z.object({ label: z.string(), home: z.string() }),
  relatedHeading: z.string(),
  intro: z.string(),
  sections: z.array(z.object({
    heading: z.string(),
    paragraphs: z.array(z.string()),
    bullets: z.array(z.string()).optional(),
  })),
});

export type LegalPageData = z.infer<typeof legalPageSchema>;

export const LEGAL_PAGES = {
  'privacy-policy': 'legal-privacy-policy',
  'terms': 'legal-terms',
  'cookies': 'legal-cookies',
  'imprint': 'legal-imprint',
} as const;

export type LegalPageSlug = keyof typeof LEGAL_PAGES;

export function isLegalPageSlug(slug: string): slug is LegalPageSlug {
  return slug in LEGAL_PAGES;
}

export function loadLegalContent(slug: LegalPageSlug, locale: Locale) {
  return loadPageContent(LEGAL_PAGES[slug], locale, legalPageSchema);
}
