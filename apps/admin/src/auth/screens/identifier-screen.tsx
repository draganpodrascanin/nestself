/**
 * Identifier screen -- email-first sign-in form.
 * CLIENT-R-09: neutral copy; never reveals whether an address is registered.
 * CLIENT-R-34..37: visible label, aria-describedby on error, autocomplete.
 */
import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Field,
  Input,
  Button,
  FormErrorSummary,
  Heading,
  Text,
} from '@nestself/ui';
import type { FormErrorSummaryHandle } from '@nestself/ui';

interface Props {
  onSubmit: (email: string) => Promise<void>;
  error: string | null;
  /** Prefills the address (e.g. after an SSO sign-in that did not confirm it). */
  initialEmail?: string;
}

export function IdentifierScreen({ onSubmit, error, initialEmail }: Props) {
  const { t } = useTranslation(['auth', 'common']);
  const [email, setEmail] = useState(initialEmail ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const errorSummaryRef = useRef<FormErrorSummaryHandle>(null);

  const displayError = error ?? localError;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    if (!email.trim() || !email.includes('@')) {
      setLocalError(t('common:form.invalidEmail'));
      errorSummaryRef.current?.focus();
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit(email.trim());
    } finally {
      setSubmitting(false);
    }
  };

  const errors = displayError
    ? [{ id: 'email', label: t('auth:signIn.emailLabel'), message: displayError }]
    : [];

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-6">
      <div className="text-center space-y-2">
        <Heading level={1} typeRole="screenTitle">
          {t('auth:signIn.title')}
        </Heading>
        <Text className="type-body text-text-secondary">
          {t('auth:signIn.helper')}
        </Text>
      </div>

      <FormErrorSummary
        ref={errorSummaryRef}
        title={t('common:form.errorSummaryTitle')}
        errors={errors}
      />

      <Field
        label={t('auth:signIn.emailLabel')}
        error={displayError ?? undefined}
      >
        <Input
          id="email"
          type="email"
          name="email"
          autoComplete="email"
          placeholder={t('auth:signIn.emailPlaceholder')}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </Field>

      <Button
        type="submit"
        variant="primary"
        disabled={submitting}
        className="w-full"
      >
        {submitting ? t('auth:a11y.loading') : t('auth:signIn.submit')}
      </Button>
    </form>
  );
}
