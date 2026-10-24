/**
 * TOTP challenge screen -- authenticator app code entry.
 * CLIENT-R-34: autocomplete="one-time-code", visible label.
 */
import { useState, useRef, useCallback } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Heading,
  Text,
  OtpInput,
  FormErrorSummary,
} from '@nestself/ui';
import type { FormErrorSummaryHandle } from '@nestself/ui';
import type { AuthApi } from '@nestself/api-client';

interface Props {
  challengeToken: string;
  authApi: AuthApi;
  onSuccess: () => Promise<void>;
  onError: (err: unknown) => void;
  /** Error raised by the parent sign-in page; rendered together with local validation. */
  error?: string | null;
}

export function TotpScreen({ challengeToken, authApi, onSuccess, onError, error: externalError = null }: Props) {
  const { t } = useTranslation('auth');
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const displayError = externalError ?? error;
  const errorRef = useRef<FormErrorSummaryHandle>(null);

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setError(null);

      if (code.length !== 6) {
        setError(t('error.invalidCode'));
        errorRef.current?.focus();
        return;
      }

      setSubmitting(true);
      try {
        await authApi.challenge(challengeToken, code);
        await onSuccess();
      } catch (err) {
        onError(err);
      } finally {
        setSubmitting(false);
      }
    },
    [code, challengeToken, authApi, onSuccess, onError, t],
  );

  const errors = displayError
    ? [{ id: 'totp-code-input', label: t('totp.codeLabel'), message: displayError }]
    : [];

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-6">
      <Heading level={1} typeRole="screenTitle" className="text-center">
        {t('totp.title')}
      </Heading>

      <Text className="text-center text-text-secondary">
        {t('totp.instructions')}
      </Text>

      <FormErrorSummary
        ref={errorRef}
        title={t('common:form.errorSummaryTitle')}
        errors={errors}
      />

      <div className="gap-1.5 flex flex-col">
        <label htmlFor="totp-code-input" className="type-label text-text">
          {t('totp.codeLabel')}
          <span className="ml-0.5 text-danger" aria-hidden>*</span>
        </label>
        <OtpInput
          id="totp-code-input"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          aria-describedby={displayError ? 'totp-code-error' : undefined}
          aria-invalid={!!displayError}
        />
        {displayError ? (
          <p id="totp-code-error" className="type-metadata text-danger">{displayError}</p>
        ) : null}
      </div>

      <Button type="submit" variant="primary" className="w-full" disabled={submitting}>
        {submitting ? t('a11y.loading') : t('totp.submit')}
      </Button>
    </form>
  );
}
