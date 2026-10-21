'use client';

import { useState, useCallback } from 'react';
import { DemoRequestSchema } from '@nestself/contracts';
import type { Locale } from '@nestself/i18n';
import { Field, Input, Select, Textarea, Checkbox } from '@nestself/ui';
import type { FormError } from '@nestself/ui';
import { TextLink } from '@nestself/ui';
import { submitLead } from '@/lib/leads';
import { LeadFormShell, type FormStatus } from './LeadFormShell';

const FREE_MAIL_DOMAINS = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com', 'icloud.com', 'mail.com', 'protonmail.com', 'yandex.com', 'live.com'];

function isFreeMailDomain(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase();
  return domain ? FREE_MAIL_DOMAINS.includes(domain) : false;
}

function localeToCountry(locale: Locale): 'RS' | 'HU' | 'OTHER' {
  if (locale === 'sr-Latn' || locale === 'sr-Cyrl') return 'RS';
  if (locale === 'hu') return 'HU';
  return 'OTHER';
}

export interface SelectOption {
  value: string;
  label: string;
}

export interface DemoRequestFormContent {
  fields: {
    name: string;
    email: string;
    company: string;
    role: string;
    companySize: string;
    country: string;
    heardAbout: string;
    message: string;
    consent: string;
  };
  privacyLinkText: string;
  selectPlaceholder: string;
  options: {
    companySize: SelectOption[];
    country: SelectOption[];
    heardAbout: SelectOption[];
  };
  emailHint: string;
  optional: string;
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
}

export interface DemoRequestFormProps {
  locale: Locale;
  content: DemoRequestFormContent;
}

export function DemoRequestForm({ locale, content }: DemoRequestFormProps) {
  const [status, setStatus] = useState<FormStatus>('idle');
  const [errors, setErrors] = useState<FormError[]>([]);
  const [emailHint, setEmailHint] = useState('');
  const [consent, setConsent] = useState(false);
  const [country, setCountry] = useState<string>(localeToCountry(locale));
  const [companySize, setCompanySize] = useState<string>('');
  const [heardAbout, setHeardAbout] = useState<string>('');

  const heardAboutOptions: SelectOption[] = [
    { value: '', label: content.selectPlaceholder },
    ...content.options.heardAbout,
  ];

  const handleSubmit = useCallback(async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrors([]);
    setEmailHint('');

    const form = e.currentTarget;
    const formData = new FormData(form);

    const data = {
      kind: 'demo_request' as const,
      name: (formData.get('name') as string) ?? '',
      email: (formData.get('email') as string) ?? '',
      company: (formData.get('company') as string) ?? '',
      role: (formData.get('role') as string) || undefined,
      companySize: companySize || undefined,
      country: (country as 'RS' | 'HU' | 'OTHER') || undefined,
      heardAbout: heardAbout || undefined,
      message: (formData.get('message') as string) || undefined,
      consent,
      locale,
      website: (formData.get('website') as string) || undefined,
    };

    const result = DemoRequestSchema.safeParse(data);
    if (!result.success) {
      const fieldErrors: FormError[] = result.error.issues.map((iss) => {
        const fieldName = String(iss.path?.[0] ?? 'form');
        return {
          id: `field-${fieldName}`,
          label: content.fields[fieldName as keyof typeof content.fields] ?? fieldName,
          message: iss.message,
        };
      });
      setErrors(fieldErrors);
      return;
    }

    // Soft hint for free email domains (not blocking)
    if (isFreeMailDomain(data.email)) {
      setEmailHint(content.emailHint);
    }

    setStatus('submitting');
    const res = await submitLead('demo-requests', result.data);

    if (res.ok) {
      setStatus('success');
    } else if (res.status === 0 || res.status >= 500) {
      setStatus('error');
    } else {
      // Validation errors from server
      const serverErrors: FormError[] = (res.issues ?? []).map((iss) => ({
        id: `field-${String(iss.path[0] ?? 'form')}`,
        label: content.fields[String(iss.path[0]) as keyof typeof content.fields] ?? String(iss.path[0]),
        message: iss.message,
      }));
      setErrors(serverErrors.length ? serverErrors : [{ id: 'form', label: content.fallbackErrorLabel, message: content.fallbackErrorMessage }]);
      setStatus('idle');
    }
  }, [consent, country, companySize, heardAbout, locale, content]);

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

        <Field
          label={content.fields.email}
          required
          id="field-email"
          description={emailHint || undefined}
        >
          <Input name="email" type="email" required />
        </Field>

        <Field label={content.fields.company} required id="field-company">
          <Input name="company" required />
        </Field>

        <Field label={content.fields.role} id="field-role" optionalLabel={content.optional}>
          <Input name="role" />
        </Field>

        <Field label={content.fields.companySize} required id="field-companySize">
          <Select
            options={content.options.companySize}
            placeholder={content.selectPlaceholder}
            value={companySize || undefined}
            onValueChange={(v) => setCompanySize(v ?? '')}
            name="companySize"
          />
        </Field>

        <Field label={content.fields.country} required id="field-country">
          <Select
            options={content.options.country}
            value={country}
            onValueChange={(v) => setCountry(v ?? '')}
            name="country"
          />
        </Field>

        <Field label={content.fields.heardAbout} id="field-heardAbout" optionalLabel={content.optional}>
          <Select
            options={heardAboutOptions}
            value={heardAbout || undefined}
            onValueChange={(v) => setHeardAbout(v ?? '')}
            name="heardAbout"
          />
        </Field>

        <Field label={content.fields.message} id="field-message" optionalLabel={content.optional}>
          <Textarea name="message" rows={4} />
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
