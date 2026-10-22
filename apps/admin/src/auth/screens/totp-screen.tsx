/**
 * TOTP screen -- authenticator app code entry.
 * CLIENT-R-34..37: inputMode numeric, one-time-code autocomplete.
 */
import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  OtpInput,
  Button,
  FormErrorSummary,
  Heading,
  Text,
} from '@nestself/ui';
import type { FormErrorSummaryHandle } from '@nestself/ui';
import type { AuthApi } from '@nestself/api-client';

interface Props {
  challengeToken: string;
  authApi: AuthApi;
  onSuccess: () => Promise<void>;
  onError: (err: unknown) => void;
}

export function TotpScreen({
  challengeToken,
  authApi,
  onSuccess,
  onError,
}: Props) {
  const { t } = useTranslation(['auth', 'common']);
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorSummaryRef = useRef<FormErrorSummaryHandle>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (code.length !== 6) {
      setError(t('auth:error.invalidCode'));
      errorSummaryRef.current?.focus();
      return;
    }

    setSubmitting(true);
    try {
      await authApi.challenge(challengeToken, code);
      await onSuccess();
    } catch (err) {
      setSubmitting(false);
      onError(err);
    }
  };

  const errors = error
    ? [{ id: 'totp-code', label: t('auth:totp.codeLabel'), message: error }]
    : [];

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-6">
      <Heading level={1} typeRole="screenTitle" className="text-center">
        {t('auth:totp.title')}
      </Heading>

      <Text className="text-center text-text-secondary">
        {t('auth:totp.instructions')}
      </Text>

      <FormErrorSummary
        ref={errorSummaryRef}
        title={t('common:form.errorSummaryTitle')}
        errors={errors}
      />

      <div className="gap-1.5 flex flex-col">
        <label htmlFor="totp-code-input" className="type-label text-text">
          {t('auth:totp.codeLabel')}
          <span className="ml-0.5 text-danger" aria-hidden>*</span>
        </label>
        <OtpInput
          id="totp-code-input"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          aria-describedby={error ? 'totp-code-error' : undefined}
          aria-invalid={!!error}
        />
        {error ? (
          <p id="totp-code-error" className="type-metadata text-danger">{error}</p>
        ) : null}
      </div>

      <Button
        type="submit"
        variant="primary"
        disabled={submitting}
        className="w-full"
      >
        {submitting ? t('auth:a11y.loading') : t('auth:totp.submit')}
      </Button>
    </form>
  );
}
