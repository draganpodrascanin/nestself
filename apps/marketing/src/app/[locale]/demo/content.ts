import { z } from 'zod';
import type { Locale } from '@nestself/i18n';
import { loadPageContent } from '@/content/loaders';

const selectOptionSchema = z.object({ value: z.string(), label: z.string() });

const validationSchema = z.object({
  required: z.string(),
  email: z.string(),
  consent: z.string(),
  select: z.string(),
  tooLong: z.string(),
});

const formFieldsSchema = z.object({
  name: z.string(),
  email: z.string(),
  company: z.string(),
  role: z.string(),
  companySize: z.string(),
  country: z.string(),
  heardAbout: z.string(),
  message: z.string(),
  consent: z.string(),
});

export const schema = z.object({
  meta: z.object({ title: z.string(), description: z.string() }),
  hero: z.object({ title: z.string(), lead: z.string() }),
  form: z.object({
    fields: formFieldsSchema,
    privacyLinkText: z.string(),
    selectPlaceholder: z.string(),
    options: z.object({
      companySize: z.array(selectOptionSchema),
      country: z.array(selectOptionSchema),
      heardAbout: z.array(selectOptionSchema),
    }),
    emailHint: z.string(),
    optional: z.string(),
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
    title: z.string(),
    steps: z.array(z.object({ title: z.string(), body: z.string() })),
    contactTitle: z.string(),
    contactBody: z.string(),
  }),
});

export const loadContent = (locale: Locale) => loadPageContent('demo', locale, schema);
