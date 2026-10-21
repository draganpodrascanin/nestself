'use client';

import { useRef, useState } from 'react';
import { WebinarRegistrationSchema } from '@nestself/contracts';
import type { Locale } from '@nestself/i18n';
import {
  Field,
  Input,
  Checkbox,
  FormErrorSummary,
  Heading,
  Text,
  TextLink,
  Button,
} from '@nestself/ui';
import type { FormErrorSummaryHandle, FormError } from '@nestself/ui';
import { CONTACT_EMAIL } from '@/lib/contact';
import { submitLead, describeIssues, type ValidationMessages } from '@/lib/leads';

export interface WebinarRegistrationFormLabels {
  nameLabel: string;
  namePlaceholder: string;
  emailLabel: string;
  emailPlaceholder: string;
  companyLabel: string;
  companyPlaceholder: string;
  optionalLabel: string;
  consentShortLabel: string;
  consentLabel: string;
  privacyLinkText: string;
  privacyLinkHref: string;
  submitLabel: string;
  errorSummaryTitle: string;
  nameRequired: string;
  emailRequired: string;
  consentRequired: string;
  successTitle: string;
  successBody: string;
  failureTitle: string;
  failureBody: string;
  validation: ValidationMessages;
  /** Translatable label for the server-error entry in the error summary. */
  serverErrorLabel?: string;
}

export interface WebinarRegistrationFormProps {
  webinarSlug: string;
  locale: Locale;
  labels: WebinarRegistrationFormLabels;
}

type FormState = 'idle' | 'submitting' | 'success' | 'error';

export function WebinarRegistrationForm({
  webinarSlug,
  locale,
  labels,
}: WebinarRegistrationFormProps) {
  const errorSummaryRef = useRef<FormErrorSummaryHandle>(null);
  const [state, setState] = useState<FormState>('idle');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formErrors, setFormErrors] = useState<FormError[]>([]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFieldErrors({});
    setFormErrors([]);

    const formData = new FormData(e.currentTarget);
    const raw = {
      kind: 'webinar_registration' as const,
      webinarSlug,
      name: (formData.get('name') as string) ?? '',
      email: (formData.get('email') as string) ?? '',
      company: (formData.get('company') as string) || undefined,
      consent: formData.get('consent') === 'on' ? (true as const) : undefined,
      locale,
      website: (formData.get('website') as string) || undefined,
    };

    const result = WebinarRegistrationSchema.safeParse(raw);

    if (!result.success) {
      // Build a labels map keyed by zod path names for the shared helper
      const fieldLabels: Record<string, string> = {
        name: labels.nameLabel,
        email: labels.emailLabel,
        company: labels.companyLabel,
        consent: labels.consentShortLabel,
      };

      const described = describeIssues(result.error.issues, fieldLabels, labels.validation);

      // Remap IDs from `field-X` to `reg-X` to match this form's field ids
      const summary = described.map((err) => ({
        ...err,
        id: err.id.replace(/^field-/, 'reg-'),
      }));

      const errors: Record<string, string> = {};
      for (const err of summary) {
        const fieldName = err.id.replace(/^reg-/, '');
        errors[fieldName] = err.message;
      }

      setFieldErrors(errors);
      setFormErrors(summary);
      // Focus the error summary after state update
      setTimeout(() => {
        errorSummaryRef.current?.focus();
      }, 0);
      return;
    }

    setState('submitting');

    const res = await submitLead('webinar-registrations', result.data);

    if (res.ok) {
      setState('success');
    } else if (res.status >= 400 && res.status < 500) {
      // Validation issues from the server
      setState('idle');
      setFormErrors([
        { id: 'reg-server', label: labels.serverErrorLabel ?? labels.failureTitle, message: labels.failureBody.replace('{email}', CONTACT_EMAIL) },
      ]);
      setTimeout(() => {
        errorSummaryRef.current?.focus();
      }, 0);
    } else {
      // 503, other server errors or network failure (status 0)
      setState('error');
    }
  }

  if (state === 'success') {
    return (
      <div role="status" className="text-center py-4">
        <Heading level={3} typeRole="sectionTitle" className="mb-2">
          {labels.successTitle}
        </Heading>
        <Text tone="secondary">{labels.successBody}</Text>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div role="alert" className="text-center py-4">
        <Heading level={3} typeRole="sectionTitle" className="mb-2 text-danger">
          {labels.failureTitle}
        </Heading>
        <Text tone="secondary">
          {labels.failureBody.replace('{email}', CONTACT_EMAIL)}
        </Text>
      </div>
    );
  }

  const consentLabelParts = labels.consentLabel.split('{privacyLink}');

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
      <FormErrorSummary
        ref={errorSummaryRef}
        title={labels.errorSummaryTitle}
        errors={formErrors}
      />

      <Field
        label={labels.nameLabel}
        error={fieldErrors.name}
        required
        id="reg-name"
      >
        <Input
          name="name"
          id="reg-name"
          required
          placeholder={labels.namePlaceholder}
          aria-describedby={fieldErrors.name ? 'reg-name-error' : undefined}
        />
      </Field>

      <Field
        label={labels.emailLabel}
        error={fieldErrors.email}
        required
        id="reg-email"
      >
        <Input
          name="email"
          id="reg-email"
          type="email"
          required
          placeholder={labels.emailPlaceholder}
          aria-describedby={fieldErrors.email ? 'reg-email-error' : undefined}
        />
      </Field>

      <Field
        label={labels.companyLabel}
        optionalLabel={labels.optionalLabel}
        id="reg-company"
      >
        <Input
          name="company"
          id="reg-company"
          placeholder={labels.companyPlaceholder}
        />
      </Field>

      {/* Honeypot field - visually hidden, tabIndex -1, aria-hidden */}
      <div className="absolute -left-[9999px] h-0 w-0 overflow-hidden" aria-hidden="true">
        <label htmlFor="reg-website">Website</label>
        <input
          name="website"
          id="reg-website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      <div id="reg-consent">
        <Checkbox name="consent">
          <span>
            {consentLabelParts[0]}
            <TextLink href={labels.privacyLinkHref}>
              {labels.privacyLinkText}
            </TextLink>
            {consentLabelParts[1]}
          </span>
        </Checkbox>
        {fieldErrors.consent && (
          <Text typeRole="metadata" className="text-danger mt-1">
            {fieldErrors.consent}
          </Text>
        )}
      </div>

      <Button type="submit" disabled={state === 'submitting'}>
        {labels.submitLabel}
      </Button>
    </form>
  );
}
