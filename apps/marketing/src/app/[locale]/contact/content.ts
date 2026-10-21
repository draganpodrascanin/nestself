import { z } from 'zod';
import type { Locale } from '@nestself/i18n';
import { loadPageContent } from '@/content/loaders';

const validationSchema = z.object({
  required: z.string(),
  email: z.string(),
  consent: z.string(),
  select: z.string(),
  tooLong: z.string(),
});

export const schema = z.object({
  meta: z.object({ title: z.string(), description: z.string() }),
  hero: z.object({ title: z.string(), lead: z.string() }),
  form: z.object({
    fields: z.object({
      name: z.string(),
      email: z.string(),
      subject: z.string(),
      message: z.string(),
      consent: z.string(),
    }),
    privacyLinkText: z.string(),
    submit: z.string(),
    submitting: z.string(),
    errorSummaryTitle: z.string(),
    successTitle: z.string(),
    successBody: z.string(),
    errorTitle: z.string(),
    errorBody: z.string(),
    errorContactHint: z.string(),
    fallbackErrorLabel: z.string(),
    fallbackErrorMessage: z.string(),
    validation: validationSchema,
  }),
  aside: z.object({
    emailTitle: z.string(),
    officesTitle: z.string(),
    officesBody: z.string(),
    note: z.string(),
  }),
});

export const loadContent = (locale: Locale) => loadPageContent('contact', locale, schema);
