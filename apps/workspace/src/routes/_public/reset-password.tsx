/**
 * /reset-password route -- password reset flow (start + confirm screens).
 */
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState, useMemo, useRef, useCallback } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { createAuthApi, ApiError } from '@nestself/api-client';
import {
  Field,
  Input,
  Button,
  Heading,
  Text,
  PasswordInput,
  OtpInput,
  FormErrorSummary,
  Alert,
} from '@nestself/ui';
import type { FormErrorSummaryHandle } from '@nestself/ui';
import { api } from '../../api';

export const Route = createFileRoute('/_public/reset-password')({
  component: ResetPasswordRoute,
});

type Screen =
  | { kind: 'start' }
  | { kind: 'confirm'; email: string };

function ResetPasswordRoute() {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const authApi = useMemo(() => createAuthApi(api), []);

  const [screen, setScreen] = useState<Screen>({ kind: 'start' });
  const [success, setSuccess] = useState(false);

  if (success) {
    return (
      <div className="space-y-6 text-center">
        <Alert tone="success">{t('reset.success')}</Alert>
        <Button variant="primary" onClick={() => void navigate({ to: '/sign-in' })}>
          {t('signIn.title')}
        </Button>
      </div>
    );
  }

  if (screen.kind === 'start') {
    return (
      <StartScreen
        authApi={authApi}
        onSent={(email) => setScreen({ kind: 'confirm', email })}
      />
    );
  }

  return (
    <ConfirmScreen
      email={screen.email}
      authApi={authApi}
      onSuccess={() => setSuccess(true)}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Start screen: enter email                                          */
/* ------------------------------------------------------------------ */

function StartScreen({
  authApi,
  onSent,
}: {
  authApi: ReturnType<typeof createAuthApi>;
  onSent: (email: string) => void;
}) {
  const { t } = useTranslation('auth');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef<FormErrorSummaryHandle>(null);

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setError(null);

      const trimmed = email.trim();
      if (!trimmed || !trimmed.includes('@')) {
        setError(t('common:form.invalidEmail'));
        errorRef.current?.focus();
        return;
      }

      setSubmitting(true);
      try {
        await authApi.passwordResetStart(trimmed);
        onSent(trimmed);
      } catch (err) {
        if (err instanceof ApiError) {
          setError(err.message);
        } else {
          setError(t('error.unknown'));
        }
      } finally {
        setSubmitting(false);
      }
    },
    [email, authApi, onSent, t],
  );

  const errors = error
    ? [{ id: 'reset-email', label: t('reset.emailLabel'), message: error }]
    : [];

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-6">
      <Heading level={1} typeRole="screenTitle" className="text-center">
        {t('reset.title')}
      </Heading>

      <FormErrorSummary
        ref={errorRef}
        title={t('common:form.errorSummaryTitle')}
        errors={errors}
      />

      <Field label={t('reset.emailLabel')} error={error ?? undefined} required id="reset-email">
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

      <Button type="submit" variant="primary" className="w-full" disabled={submitting}>
        {submitting ? t('a11y.loading') : t('reset.submit')}
      </Button>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Confirm screen: code + new password                                */
/* ------------------------------------------------------------------ */

function ConfirmScreen({
  email,
  authApi,
  onSuccess,
}: {
  email: string;
  authApi: ReturnType<typeof createAuthApi>;
  onSuccess: () => void;
}) {
  const { t } = useTranslation('auth');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

      if (password.length < 8) {
        setError(t('error.passwordTooShort'));
        errorRef.current?.focus();
        return;
      }

      setSubmitting(true);
      try {
        await authApi.passwordResetConfirm(email, code, password);
        onSuccess();
      } catch (err) {
        if (err instanceof ApiError) {
          if (err.code === 'invalid_code' || err.code === 'expired_code') {
            setError(t('error.invalidCode'));
          } else {
            setError(err.message);
          }
        } else {
          setError(t('error.unknown'));
        }
        errorRef.current?.focus();
      } finally {
        setSubmitting(false);
      }
    },
    [code, password, email, authApi, onSuccess, t],
  );

  const errors = error
    ? [{ id: 'reset-code', label: t('reset.codeLabel'), message: error }]
    : [];

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-6">
      <Heading level={1} typeRole="screenTitle" className="text-center">
        {t('reset.confirmTitle')}
      </Heading>

      <Text className="text-center text-text-secondary">
        {t('reset.instructions', { email })}
      </Text>

      <FormErrorSummary
        ref={errorRef}
        title={t('common:form.errorSummaryTitle')}
        errors={errors}
      />

      <Field label={t('reset.codeLabel')} error={error ?? undefined} required id="reset-code">
        <OtpInput
          id="reset-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
      </Field>

      <Field label={t('reset.newPasswordLabel')} required id="reset-new-password">
        <PasswordInput
          id="reset-new-password"
          name="new-password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          showLabel={t('a11y.showPassword')}
          hideLabel={t('a11y.hidePassword')}
        />
      </Field>

      <Button type="submit" variant="primary" className="w-full" disabled={submitting}>
        {submitting ? t('a11y.loading') : t('reset.confirmSubmit')}
      </Button>
    </form>
  );
}
