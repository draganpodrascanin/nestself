/**
 * New-password screen -- shown when the server returns NEW_PASSWORD_REQUIRED.
 * CLIENT-R-34: autocomplete="new-password", visible labels.
 * CLIENT-R-35: FormErrorSummary with role="alert" and focus.
 */
import { useState, useRef, useCallback } from 'react';
import type { FormEvent } from 'react';
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
  challengeToken: string;
  authApi: AuthApi;
  onChallengeRequired: (step: string, challengeToken: string) => void;
  /** Called when the challenge completed the sign-in (no second factor required). */
  onSuccess: () => Promise<void>;
  onError: (err: unknown) => void;
  /** Error raised by the parent sign-in page; rendered together with local validation. */
  error?: string | null;
}

export function NewPasswordScreen({
  challengeToken,
  authApi,
  onChallengeRequired,
  onSuccess,
  onError,
  error: externalError = null,
}: Props) {
  const { t } = useTranslation('auth');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const displayError = externalError ?? error;
  const errorRef = useRef<FormErrorSummaryHandle>(null);

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setError(null);

      if (password.length < 8) {
        setError(t('error.passwordTooShort'));
        errorRef.current?.focus();
        return;
      }

      if (password !== confirm) {
        setError(t('error.passwordMismatch'));
        errorRef.current?.focus();
        return;
      }

      setSubmitting(true);
      try {
        const result = await authApi.challenge(challengeToken, password);

        // challenge may return MeResponse or another ChallengeRequired
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
    [password, confirm, challengeToken, authApi, onChallengeRequired, onSuccess, onError, t],
  );

  const errors = displayError
    ? [{ id: 'new-password', label: t('newPassword.newPasswordLabel'), message: displayError }]
    : [];

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-6">
      <Heading level={1} typeRole="screenTitle" className="text-center">
        {t('newPassword.title')}
      </Heading>

      <Text className="text-center type-metadata text-text-secondary">
        {t('newPassword.requirements')}
      </Text>

      <FormErrorSummary
        ref={errorRef}
        title={t('common:form.errorSummaryTitle')}
        errors={errors}
      />

      <div className="gap-1.5 flex flex-col">
        <label htmlFor="new-password-input" className="type-label text-text">
          {t('newPassword.newPasswordLabel')}
          <span className="ml-0.5 text-danger" aria-hidden>*</span>
        </label>
        <PasswordInput
          id="new-password-input"
          name="new-password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          showLabel={t('a11y.showPassword')}
          hideLabel={t('a11y.hidePassword')}
          aria-describedby={displayError ? 'new-password-error' : undefined}
          aria-invalid={!!displayError}
        />
        {displayError ? (
          <p id="new-password-error" className="type-metadata text-danger">{displayError}</p>
        ) : null}
      </div>

      <div className="gap-1.5 flex flex-col">
        <label htmlFor="confirm-password-input" className="type-label text-text">
          {t('newPassword.confirmPasswordLabel')}
          <span className="ml-0.5 text-danger" aria-hidden>*</span>
        </label>
        <PasswordInput
          id="confirm-password-input"
          name="confirm-password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          showLabel={t('a11y.showPassword')}
          hideLabel={t('a11y.hidePassword')}
        />
      </div>

      <Button type="submit" variant="primary" className="w-full" disabled={submitting}>
        {submitting ? t('a11y.loading') : t('newPassword.submit')}
      </Button>
    </form>
  );
}
