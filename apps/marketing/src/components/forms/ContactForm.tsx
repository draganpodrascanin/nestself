'use client';

import { useState, useCallback } from 'react';
import { ContactMessageSchema } from '@nestself/contracts';
import type { Locale } from '@nestself/i18n';
import { Field, Input, Textarea, Checkbox } from '@nestself/ui';
import type { FormError } from '@nestself/ui';
import { TextLink } from '@nestself/ui';
import { submitLead, describeIssues, type ValidationMessages } from '@/lib/leads';
import { LeadFormShell, type FormStatus } from './LeadFormShell';

export interface ContactFormContent {
  fields: {
    name: string;
    email: string;
    subject: string;
    message: string;
    consent: string;
  };
  privacyLinkText: string;
  submit: string;
  submitting: string;
  errorSummaryTitle: string;
  successTitle: string;
  successBody: string;
  errorTitle: string;
  errorBody: string;
  errorContactHint: string;
  fallbackErrorLabel: string;
  fallbackErrorMessage: string;
  validation: ValidationMessages;
}

export interface ContactFormProps {
  locale: Locale;
  content: ContactFormContent;
}

export function ContactForm({ locale, content }: ContactFormProps) {
  const [status, setStatus] = useState<FormStatus>('idle');
  const [errors, setErrors] = useState<FormError[]>([]);
  const [consent, setConsent] = useState(false);

  const handleSubmit = useCallback(async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrors([]);

    const form = e.currentTarget;
    const formData = new FormData(form);

    const data = {
      kind: 'contact' as const,
      name: (formData.get('name') as string) ?? '',
      email: (formData.get('email') as string) ?? '',
      subject: (formData.get('subject') as string) ?? '',
      message: (formData.get('message') as string) ?? '',
      consent,
      locale,
      website: (formData.get('website') as string) || undefined,
    };

    const result = ContactMessageSchema.safeParse(data);
    if (!result.success) {
      setErrors(describeIssues(result.error.issues, content.fields, content.validation));
      return;
    }

    setStatus('submitting');
    const res = await submitLead('contact', result.data);

    if (res.ok) {
      setStatus('success');
    } else if (res.status === 0 || res.status >= 500) {
      setStatus('error');
    } else {
      const serverErrors: FormError[] = (res.issues ?? []).map((iss) => ({
        id: `field-${String(iss.path[0] ?? 'form')}`,
        label: content.fields[String(iss.path[0]) as keyof typeof content.fields] ?? String(iss.path[0]),
        message: iss.message,
      }));
      setErrors(serverErrors.length ? serverErrors : [{ id: 'form', label: content.fallbackErrorLabel, message: content.fallbackErrorMessage }]);
      setStatus('idle');
    }
  }, [consent, locale, content]);

  return (
    <LeadFormShell
      status={status}
      errors={errors}
      errorSummaryTitle={content.errorSummaryTitle}
      submitLabel={content.submit}
      pendingLabel={content.submitting}
      successTitle={content.successTitle}
      successBody={content.successBody}
      errorTitle={content.errorTitle}
      errorBody={content.errorBody}
      errorContactHint={content.errorContactHint}
      onSubmit={handleSubmit}
    >
      <div className="flex flex-col gap-5">
        <Field label={content.fields.name} required id="field-name">
          <Input name="name" required />
        </Field>

        <Field label={content.fields.email} required id="field-email">
          <Input name="email" type="email" required />
        </Field>

        <Field label={content.fields.subject} required id="field-subject">
          <Input name="subject" required />
        </Field>

        <Field label={content.fields.message} required id="field-message">
          <Textarea name="message" rows={5} required />
        </Field>

        <div id="field-consent">
          <Checkbox
            name="consent"
            checked={consent}
            onCheckedChange={(c) => setConsent(c as boolean)}
          >
            {content.fields.consent}{' '}
            <TextLink href={`/${locale}/legal/privacy-policy`}>{content.privacyLinkText}</TextLink>
          </Checkbox>
        </div>
      </div>
    </LeadFormShell>
  );
}
