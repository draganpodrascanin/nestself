/**
 * OTP verification screen.
 * CLIENT-R-34: visible label, autocomplete="one-time-code".
 * CLIENT-R-37: aria-live="polite" on resend countdown.
 */
import { useState, useRef, useCallback, useEffect } from 'react';
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

const RESEND_COOLDOWN_SECONDS = 60;

interface Props {
  email: string;
  challengeToken: string;
  authApi: AuthApi;
  onSuccess: () => Promise<void>;
  onError: (err: unknown) => void;
  onBack: () => void;
}

export function OtpScreen({
  email,
  challengeToken,
  authApi,
  onSuccess,
  onError,
  onBack,
}: Props) {
  const { t } = useTranslation('auth');
  const [code, setCode] = useState('');
  const [token, setToken] = useState(challengeToken);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(RESEND_COOLDOWN_SECONDS);
  const errorRef = useRef<FormErrorSummaryHandle>(null);

  // Countdown timer for resend
  useEffect(() => {
    if (countdown <= 0) return;
    const id = setInterval(() => setCountdown((c) => c - 1), 1000);
    return () => clearInterval(id);
  }, [countdown]);

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
        await authApi.emailOtpVerify(token, code);
        await onSuccess();
      } catch (err) {
        onError(err);
      } finally {
        setSubmitting(false);
      }
    },
    [code, token, authApi, onSuccess, onError, t],
  );

  const handleResend = useCallback(async () => {
    try {
      const result = await authApi.emailOtpStart(email);
      setToken(result.challengeToken);
      setCountdown(RESEND_COOLDOWN_SECONDS);
      setCode('');
      setError(null);
    } catch (err) {
      onError(err);
    }
  }, [authApi, email, onError]);

  const errors = error
    ? [{ id: 'otp-code', label: t('otp.codeLabel'), message: error }]
    : [];

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-6">
      <Heading level={1} typeRole="screenTitle" className="text-center">
        {t('otp.title')}
      </Heading>

      <Text className="text-center text-text-secondary">
        {t('otp.instructions', { email })}
      </Text>

      <FormErrorSummary
        ref={errorRef}
        title={t('common:form.errorSummaryTitle')}
        errors={errors}
      />

      <div className="gap-1.5 flex flex-col">
        <label htmlFor="otp-code-input" className="type-label text-text">
          {t('otp.codeLabel')}
          <span className="ml-0.5 text-danger" aria-hidden>*</span>
        </label>
        <OtpInput
          id="otp-code-input"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          aria-describedby={error ? 'otp-code-error' : undefined}
          aria-invalid={!!error}
        />
        {error ? (
          <p id="otp-code-error" className="type-metadata text-danger">{error}</p>
        ) : null}
      </div>

      <Button type="submit" variant="primary" className="w-full" disabled={submitting}>
        {submitting ? t('a11y.loading') : t('otp.submit')}
      </Button>

      <div className="text-center" aria-live="polite">
        {countdown > 0 ? (
          <Text className="type-metadata text-text-secondary">
            {t('otp.resendCountdown', { seconds: countdown })}
          </Text>
        ) : (
          <button
            type="button"
            onClick={handleResend}
            className="type-metadata text-primary underline hover:text-primary"
          >
            {t('otp.resend')}
          </button>
        )}
      </div>

      <div className="text-center">
        <button
          type="button"
          onClick={onBack}
          className="type-metadata text-primary underline hover:text-primary-hover"
        >
          {t('common:nav.back')}
        </button>
      </div>
    </form>
  );
}
