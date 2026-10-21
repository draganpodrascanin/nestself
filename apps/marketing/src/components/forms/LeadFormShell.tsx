'use client';

import { type ReactNode, type FormEvent, useRef, useEffect } from 'react';
import { Button, FormErrorSummary, Text, Heading, LiveRegion } from '@nestself/ui';
import type { FormErrorSummaryHandle, FormError } from '@nestself/ui';
import { CONTACT_EMAIL } from '@/lib/contact';

export type FormStatus = 'idle' | 'submitting' | 'success' | 'error';

export interface LeadFormShellProps {
  status: FormStatus;
  errors: FormError[];
  errorSummaryTitle: string;
  submitLabel: string;
  pendingLabel: string;
  successTitle: string;
  successBody: string;
  errorTitle: string;
  errorBody: string;
  errorContactHint: string;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  children: ReactNode;
  className?: string;
}

export function LeadFormShell({
  status,
  errors,
  errorSummaryTitle,
  submitLabel,
  pendingLabel,
  successTitle,
  successBody,
  errorTitle,
  errorBody,
  errorContactHint,
  onSubmit,
  children,
  className,
}: LeadFormShellProps) {
  const summaryRef = useRef<FormErrorSummaryHandle>(null);

  // Focus the error summary whenever validation errors appear after a submit.
  // This replaces the unconditional requestAnimationFrame call so that focus
  // only shifts when there are actually errors to announce.
  useEffect(() => {
    if (errors.length > 0 && summaryRef.current) {
      summaryRef.current.focus();
    }
  }, [errors]);

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    onSubmit(e);
  };

  if (status === 'success') {
    return (
      <div role="status" className={className}>
        <Heading level={2} typeRole="sectionTitle" className="mb-2">
          {successTitle}
        </Heading>
        <Text tone="secondary">{successBody}</Text>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div role="alert" className={className}>
        <Heading level={2} typeRole="sectionTitle" className="mb-2 text-danger">
          {errorTitle}
        </Heading>
        <Text tone="secondary" className="mb-4">{errorBody}</Text>
        <Text tone="secondary">
          {errorContactHint}{' '}
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary underline">
            {CONTACT_EMAIL}
          </a>.
        </Text>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className={className}>
      <FormErrorSummary
        ref={summaryRef}
        title={errorSummaryTitle}
        errors={errors}
        className="mb-6"
      />

      {children}

      {/* Honeypot field: invisible to humans, bots fill it */}
      <div aria-hidden="true" className="absolute -left-[9999px] -top-[9999px]">
        <label htmlFor="website">Website</label>
        <input
          type="text"
          id="website"
          name="website"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      <LiveRegion politeness="polite">
        {status === 'submitting' ? pendingLabel : ''}
      </LiveRegion>

      <Button
        type="submit"
        disabled={status === 'submitting'}
        className="mt-6 @max-[760px]:w-full"
      >
        {status === 'submitting' ? pendingLabel : submitLabel}
      </Button>
    </form>
  );
}
