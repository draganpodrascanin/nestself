/**
 * OTP verification screen -- email one-time code.
 * CLIENT-R-34..37: aria-live countdown, autocomplete one-time-code.
 */
import { useState, useRef, useEffect, useCallback } from 'react';
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

const RESEND_COOLDOWN = 60;

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
  const { t } = useTranslation(['auth', 'common']);
  const [code, setCode] = useState('');
  const [token, setToken] = useState(challengeToken);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN);
  const errorSummaryRef = useRef<FormErrorSummaryHandle>(null);

  // Countdown timer for resend
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = window.setInterval(() => {
      setCooldown((c) => Math.max(0, c - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [cooldown]);

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
      await authApi.emailOtpVerify(token, code);
      await onSuccess();
    } catch (err) {
      setSubmitting(false);
      onError(err);
    }
  };

  const handleResend = useCallback(async () => {
    try {
      const result = await authApi.emailOtpStart(email);
      setToken(result.challengeToken);
      setCooldown(RESEND_COOLDOWN);
      setCode('');
      setError(null);
    } catch (err) {
      onError(err);
    }
  }, [authApi, email, onError]);

  const errors = error
    ? [{ id: 'otp-code', label: t('auth:otp.codeLabel'), message: error }]
    : [];

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-6">
      <Heading level={1} typeRole="screenTitle" className="text-center">
        {t('auth:otp.title')}
      </Heading>

      <Text className="text-center text-text-secondary">
        {t('auth:otp.instructions', { email })}
      </Text>

      <FormErrorSummary
        ref={errorSummaryRef}
        title={t('common:form.errorSummaryTitle')}
        errors={errors}
      />

      <div className="gap-1.5 flex flex-col">
        <label htmlFor="otp-code-input" className="type-label text-text">
          {t('auth:otp.codeLabel')}
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

      <Button
        type="submit"
        variant="primary"
        disabled={submitting}
        className="w-full"
      >
        {submitting ? t('auth:a11y.loading') : t('auth:otp.submit')}
      </Button>

      <div className="text-center">
        {cooldown > 0 ? (
          <p
            className="type-metadata text-text-secondary"
            aria-live="polite"
          >
            {t('auth:otp.resendCountdown', { seconds: cooldown })}
          </p>
        ) : (
          <button
            type="button"
            onClick={handleResend}
            className="type-metadata text-primary underline hover:text-primary"
          >
            {t('auth:otp.resend')}
          </button>
        )}
      </div>

      <button
        type="button"
        onClick={onBack}
        className="w-full type-metadata text-text-secondary underline hover:text-text"
      >
        {t('common:action.cancel')}
      </button>
    </form>
  );
}
