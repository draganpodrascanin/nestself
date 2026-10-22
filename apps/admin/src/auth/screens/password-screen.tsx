/**
 * Password screen -- password entry with forgot-password link.
 * CLIENT-R-34..37: autocomplete current-password, visible label.
 */
import { useState, useRef } from 'react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import {
  PasswordInput,
  Button,
  FormErrorSummary,
  Heading,
  Text,
} from '@nestself/ui';
import type { FormErrorSummaryHandle } from '@nestself/ui';
import type { AuthApi } from '@nestself/api-client';

interface Props {
  email: string;
  authApi: AuthApi;
  onSuccess: () => Promise<void>;
  onChallengeRequired: (step: string, challengeToken: string) => void;
  onError: (err: unknown) => void;
  error: string | null;
  onBack: () => void;
}

export function PasswordScreen({
  email,
  authApi,
  onSuccess,
  onChallengeRequired,
  onError,
  error,
  onBack,
}: Props) {
  const { t } = useTranslation(['auth', 'common']);
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const errorSummaryRef = useRef<FormErrorSummaryHandle>(null);

  const displayError = error ?? localError;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    if (!password) {
      setLocalError(t('common:form.required'));
      errorSummaryRef.current?.focus();
      return;
    }

    setSubmitting(true);
    try {
      const result = await authApi.password(email, password);
      if ('step' in result) {
        onChallengeRequired(result.step, result.challengeToken);
      } else {
        await onSuccess();
      }
    } catch (err) {
      setSubmitting(false);
      onError(err);
    }
  };

  const errors = displayError
    ? [
        {
          id: 'password',
          label: t('auth:password.passwordLabel'),
          message: displayError,
        },
      ]
    : [];

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-6">
      <Heading level={1} typeRole="screenTitle" className="text-center">
        {t('auth:password.title')}
      </Heading>

      <Text className="text-center text-text-secondary">{email}</Text>

      <FormErrorSummary
        ref={errorSummaryRef}
        title={t('common:form.errorSummaryTitle')}
        errors={errors}
      />

      <div className="gap-1.5 flex flex-col">
        <label htmlFor="password-input" className="type-label text-text">
          {t('auth:password.passwordLabel')}
          <span className="ml-0.5 text-danger" aria-hidden>*</span>
        </label>
        <PasswordInput
          id="password-input"
          name="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-describedby={displayError ? 'password-error' : undefined}
          aria-invalid={!!displayError}
          showLabel={t('auth:a11y.showPassword')}
          hideLabel={t('auth:a11y.hidePassword')}
        />
        {displayError ? (
          <p id="password-error" className="type-metadata text-danger">{displayError}</p>
        ) : null}
      </div>

      <Button
        type="submit"
        variant="primary"
        disabled={submitting}
        className="w-full"
      >
        {submitting ? t('auth:a11y.loading') : t('auth:password.submit')}
      </Button>

      <div className="text-center">
        <Link
          to="/reset-password"
          className="type-metadata text-primary underline hover:text-primary"
        >
          {t('auth:password.forgot')}
        </Link>
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
