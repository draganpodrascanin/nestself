import { z } from 'zod';
import type { Locale } from '@nestself/i18n';
import { loadPageContent } from '@/content/loaders';

const ctaSchema = z.object({ label: z.string(), href: z.string() });

const validationSchema = z.object({
  required: z.string(),
  email: z.string(),
  consent: z.string(),
  select: z.string(),
  tooLong: z.string(),
  consentField: z.string().optional(),
});

export const schema = z.object({
  meta: z.object({ title: z.string(), description: z.string() }),
  hero: z.object({
    title: z.string(),
    lead: z.string(),
    primaryCta: ctaSchema,
  }),
  upcoming: z.object({ title: z.string() }),
  onDemand: z.object({ title: z.string() }),
  cardLabels: z.object({
    live: z.string(),
    onDemand: z.string(),
    minutes: z.string(),
    languages: z.string(),
    noUpcoming: z.string(),
  }),
  topics: z.object({
    psychological: z.string(),
    legal: z.string(),
    financial: z.string(),
    work: z.string(),
    family: z.string(),
    managers: z.string(),
  }),
  detail: z.object({
    breadcrumbLabel: z.string(),
    breadcrumbWebinars: z.string(),
    dateLabel: z.string(),
    durationLabel: z.string(),
    formatLabel: z.string(),
    languagesLabel: z.string(),
    speakerLabel: z.string(),
    timeZoneLabel: z.string(),
    minutesSuffix: z.string(),
    readingTime: z.string(),
    relatedTitle: z.string(),
    watchRecordingTitle: z.string(),
    watchRecordingBody: z.string(),
    registerTitle: z.string(),
  }),
  form: z.object({
    nameLabel: z.string(),
    namePlaceholder: z.string(),
    emailLabel: z.string(),
    emailPlaceholder: z.string(),
    companyLabel: z.string(),
    companyPlaceholder: z.string(),
    optionalLabel: z.string(),
    consentShortLabel: z.string(),
    consentLabel: z.string(),
    privacyLinkText: z.string(),
    privacyLinkHref: z.string(),
    submitLabel: z.string(),
    errorSummaryTitle: z.string(),
    nameRequired: z.string(),
    emailRequired: z.string(),
    consentRequired: z.string(),
    successTitle: z.string(),
    successBody: z.string(),
    failureTitle: z.string(),
    failureBody: z.string(),
    validation: validationSchema,
  }),
});

export const loadContent = (locale: Locale) => loadPageContent('webinars', locale, schema);
