/**
 * New-password screen -- set a new password (NEW_PASSWORD_REQUIRED challenge).
 * CLIENT-R-34..37: autocomplete new-password, visible labels.
 */
import { useState, useRef } from 'react';
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
  const { t } = useTranslation(['auth', 'common']);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const displayError = externalError ?? error;
  const errorSummaryRef = useRef<FormErrorSummaryHandle>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (newPassword.length < 8) {
      setError(t('auth:error.passwordTooShort'));
      errorSummaryRef.current?.focus();
      return;
    }

    if (newPassword !== confirmPassword) {
      setError(t('auth:error.passwordMismatch'));
      errorSummaryRef.current?.focus();
      return;
    }

    setSubmitting(true);
    try {
      const result = await authApi.challenge(challengeToken, newPassword);
      // challenge may return MeResponse or ChallengeRequired
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
  };

  const errors = displayError
    ? [
        {
          id: 'new-password',
          label: t('auth:newPassword.newPasswordLabel'),
          message: displayError,
        },
      ]
    : [];

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-6">
      <Heading level={1} typeRole="screenTitle" className="text-center">
        {t('auth:newPassword.title')}
      </Heading>

      <Text className="text-center type-metadata text-text-secondary">
        {t('auth:newPassword.requirements')}
      </Text>

      <FormErrorSummary
        ref={errorSummaryRef}
        title={t('common:form.errorSummaryTitle')}
        errors={errors}
      />

      <div className="gap-1.5 flex flex-col">
        <label htmlFor="new-password-input" className="type-label text-text">
          {t('auth:newPassword.newPasswordLabel')}
          <span className="ml-0.5 text-danger" aria-hidden>*</span>
        </label>
        <PasswordInput
          id="new-password-input"
          name="new-password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          aria-describedby={displayError ? 'new-password-error' : undefined}
          aria-invalid={!!displayError}
          showLabel={t('auth:a11y.showPassword')}
          hideLabel={t('auth:a11y.hidePassword')}
        />
        {displayError ? (
          <p id="new-password-error" className="type-metadata text-danger">{displayError}</p>
        ) : null}
      </div>

      <div className="gap-1.5 flex flex-col">
        <label htmlFor="confirm-password-input" className="type-label text-text">
          {t('auth:newPassword.confirmPasswordLabel')}
          <span className="ml-0.5 text-danger" aria-hidden>*</span>
        </label>
        <PasswordInput
          id="confirm-password-input"
          name="confirm-password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          showLabel={t('auth:a11y.showPassword')}
          hideLabel={t('auth:a11y.hidePassword')}
        />
      </div>

      <Button
        type="submit"
        variant="primary"
        disabled={submitting}
        className="w-full"
      >
        {submitting ? t('auth:a11y.loading') : t('auth:newPassword.submit')}
      </Button>
    </form>
  );
}
