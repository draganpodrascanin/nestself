/**
 * Password reset route -- start and confirm screens.
 */
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Field,
  Input,
  OtpInput,
  PasswordInput,
  Button,
  FormErrorSummary,
  Heading,
  Text,
  Alert,
} from '@nestself/ui';
import type { FormErrorSummaryHandle } from '@nestself/ui';
import { createAuthApi, ApiError } from '@nestself/api-client';
import { api } from '../../api';

export const Route = createFileRoute('/_public/reset-password')({
  component: ResetPasswordRoute,
});

type Screen =
  | { kind: 'start' }
  | { kind: 'confirm'; email: string }
  | { kind: 'success' };

function ResetPasswordRoute() {
  const { t } = useTranslation(['auth', 'common']);
  const navigate = useNavigate();
  const authApi = useMemo(() => createAuthApi(api), []);
  const [screen, setScreen] = useState<Screen>({ kind: 'start' });

  switch (screen.kind) {
    case 'start':
      return (
        <StartScreen
          authApi={authApi}
          onSent={(email) => setScreen({ kind: 'confirm', email })}
        />
      );
    case 'confirm':
      return (
        <ConfirmScreen
          email={screen.email}
          authApi={authApi}
          onSuccess={() => setScreen({ kind: 'success' })}
        />
      );
    case 'success':
      return (
        <div className="space-y-6 text-center">
          <Alert tone="success">{t('auth:reset.success')}</Alert>
          <Button
            variant="primary"
            onClick={() => navigate({ to: '/sign-in' })}
            className="w-full"
          >
            {t('auth:password.submit')}
          </Button>
        </div>
      );
  }
}

function StartScreen({
  authApi,
  onSent,
}: {
  authApi: ReturnType<typeof createAuthApi>;
  onSent: (email: string) => void;
}) {
  const { t } = useTranslation(['auth', 'common']);
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorSummaryRef = useRef<FormErrorSummaryHandle>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!email.trim() || !email.includes('@')) {
      setError(t('common:form.invalidEmail'));
      errorSummaryRef.current?.focus();
      return;
    }

    setSubmitting(true);
    try {
      await authApi.passwordResetStart(email.trim());
      onSent(email.trim());
    } catch (err) {
      setSubmitting(false);
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError(t('auth:error.unknown'));
      }
    }
  };

  const errors = error
    ? [{ id: 'reset-email', label: t('auth:reset.emailLabel'), message: error }]
    : [];

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-6">
      <Heading level={1} typeRole="screenTitle" className="text-center">
        {t('auth:reset.title')}
      </Heading>

      <FormErrorSummary
        ref={errorSummaryRef}
        title={t('common:form.errorSummaryTitle')}
        errors={errors}
      />

      <Field
        label={t('auth:reset.emailLabel')}
        error={error ?? undefined}
        required
      >
        <Input
          id="reset-email"
          type="email"
          name="email"
          autoComplete="email"
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
        {submitting ? t('auth:a11y.loading') : t('auth:reset.submit')}
      </Button>
    </form>
  );
}

function ConfirmScreen({
  email,
  authApi,
  onSuccess,
}: {
  email: string;
  authApi: ReturnType<typeof createAuthApi>;
  onSuccess: () => void;
}) {
  const { t } = useTranslation(['auth', 'common']);
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
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

    if (newPassword.length < 8) {
      setError(t('auth:error.passwordTooShort'));
      errorSummaryRef.current?.focus();
      return;
    }

    setSubmitting(true);
    try {
      await authApi.passwordResetConfirm(email, code, newPassword);
      onSuccess();
    } catch (err) {
      setSubmitting(false);
      if (err instanceof ApiError) {
        if (err.code === 'invalid_code' || err.code === 'expired_code') {
          setError(t('auth:error.invalidCode'));
        } else {
          setError(err.message);
        }
      } else {
        setError(t('auth:error.unknown'));
      }
    }
  };

  const errors = error
    ? [{ id: 'reset-code', label: t('auth:reset.codeLabel'), message: error }]
    : [];

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-6">
      <Heading level={1} typeRole="screenTitle" className="text-center">
        {t('auth:reset.confirmTitle')}
      </Heading>

      <Text className="text-center text-text-secondary">
        {t('auth:reset.instructions', { email })}
      </Text>

      <FormErrorSummary
        ref={errorSummaryRef}
        title={t('common:form.errorSummaryTitle')}
        errors={errors}
      />

      <Field
        label={t('auth:reset.codeLabel')}
        error={error ?? undefined}
        required
      >
        <OtpInput
          id="reset-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
      </Field>

      <Field label={t('auth:reset.newPasswordLabel')} required>
        <PasswordInput
          id="reset-new-password"
          name="new-password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          showLabel={t('auth:a11y.showPassword')}
          hideLabel={t('auth:a11y.hidePassword')}
        />
      </Field>

      <Button
        type="submit"
        variant="primary"
        disabled={submitting}
        className="w-full"
      >
        {submitting ? t('auth:a11y.loading') : t('auth:reset.confirmSubmit')}
      </Button>
    </form>
  );
}
