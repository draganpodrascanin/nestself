/**
 * Identifier screen -- email-first entry point.
 * CLIENT-R-09: neutral copy (never reveals whether an address is registered).
 * CLIENT-R-34: visible <label>, autocomplete="email".
 * CLIENT-R-35: FormErrorSummary with role="alert" and focus.
 */
import { useState, useRef, useCallback } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Field,
  Input,
  Button,
  Heading,
  Text,
  FormErrorSummary,
} from '@nestself/ui';
import type { FormErrorSummaryHandle } from '@nestself/ui';

interface Props {
  onSubmit: (email: string) => Promise<void>;
  error: string | null;
  /** Prefills the address (e.g. after an SSO sign-in that did not confirm it). */
  initialEmail?: string;
}

export function IdentifierScreen({ onSubmit, error, initialEmail }: Props) {
  const { t } = useTranslation('auth');
  const [email, setEmail] = useState(initialEmail ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const errorRef = useRef<FormErrorSummaryHandle>(null);

  const displayError = error ?? localError;

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setLocalError(null);

      const trimmed = email.trim();
      if (!trimmed || !trimmed.includes('@')) {
        setLocalError(t('common:form.invalidEmail'));
        errorRef.current?.focus();
        return;
      }

      setSubmitting(true);
      try {
        await onSubmit(trimmed);
      } finally {
        setSubmitting(false);
      }
    },
    [email, onSubmit, t],
  );

  const errors = displayError
    ? [{ id: 'email', label: t('signIn.emailLabel'), message: displayError }]
    : [];

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-6">
      <div className="text-center space-y-2">
        <Heading level={1} typeRole="screenTitle">
          {t('signIn.title')}
        </Heading>
        <Text className="type-body text-text-secondary">
          {t('signIn.helper')}
        </Text>
      </div>

      <FormErrorSummary
        ref={errorRef}
        title={t('common:form.errorSummaryTitle')}
        errors={errors}
      />

      <Field
        label={t('signIn.emailLabel')}
        error={displayError ?? undefined}
      >
        <Input
          id="email"
          type="email"
          name="email"
          autoComplete="email"
          placeholder={t('signIn.emailPlaceholder')}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </Field>

      <Button type="submit" variant="primary" className="w-full" disabled={submitting}>
        {submitting ? t('a11y.loading') : t('signIn.submit')}
      </Button>
    </form>
  );
}
