/**
 * Password screen -- shown after discover returns method='password'.
 * CLIENT-R-34: autocomplete="current-password", visible label.
 * CLIENT-R-35: FormErrorSummary with role="alert" and focus.
 */
import { useState, useRef, useCallback } from 'react';
import type { FormEvent } from 'react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Heading,
  Text,
  PasswordInput,
  FormErrorSummary,
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
  const { t } = useTranslation('auth');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const errorRef = useRef<FormErrorSummaryHandle>(null);

  const displayError = error ?? localError;

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setLocalError(null);

      if (!password) {
        setLocalError(t('common:form.required'));
        errorRef.current?.focus();
        return;
      }

      setSubmitting(true);
      try {
        const result = await authApi.password(email, password);

        // PasswordResponseSchema is a union: ChallengeRequired | MeResponse
        if ('step' in result) {
          onChallengeRequired(result.step, result.challengeToken);
        } else {
          await onSuccess();
        }
      } catch (err) {
        onError(err);
      } finally {
        setSubmitting(false);
      }
    },
    [password, email, authApi, onSuccess, onChallengeRequired, onError, t],
  );

  const errors = displayError
    ? [{ id: 'password-input', label: t('password.passwordLabel'), message: displayError }]
    : [];

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-6">
      <Heading level={1} typeRole="screenTitle" className="text-center">
        {t('password.title')}
      </Heading>

      <Text className="text-center text-text-secondary">{email}</Text>

      <FormErrorSummary
        ref={errorRef}
        title={t('common:form.errorSummaryTitle')}
        errors={errors}
      />

      <div className="gap-1.5 flex flex-col">
        <label htmlFor="password-input" className="type-label text-text">
          {t('password.passwordLabel')}
          <span className="ml-0.5 text-danger" aria-hidden>*</span>
        </label>
        <PasswordInput
          id="password-input"
          name="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          showLabel={t('a11y.showPassword')}
          hideLabel={t('a11y.hidePassword')}
          aria-describedby={displayError ? 'password-error' : undefined}
          aria-invalid={!!displayError}
        />
        {displayError ? (
          <p id="password-error" className="type-metadata text-danger">{displayError}</p>
        ) : null}
      </div>

      <Button type="submit" variant="primary" className="w-full" disabled={submitting}>
        {submitting ? t('a11y.loading') : t('password.submit')}
      </Button>

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="type-metadata text-primary underline hover:text-primary-hover"
        >
          {t('common:nav.back')}
        </button>
        <Link to="/reset-password" className="type-metadata text-primary underline">
          {t('password.forgot')}
        </Link>
      </div>
    </form>
  );
}
