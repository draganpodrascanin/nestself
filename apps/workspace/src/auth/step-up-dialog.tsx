/**
 * Step-up re-authentication dialog (auth phase 2).
 *
 * Opening it starts an email OTP challenge (`POST /auth/step-up/start`);
 * submitting verifies the code (`POST /auth/step-up/verify`), which refreshes
 * the session cookies. Every failure renders translated copy in the
 * `FormErrorSummary` and on the code field.
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  Button,
  Dialog,
  DialogContent,
  DialogActions,
  OtpInput,
  FormErrorSummary,
} from '@nestself/ui';
import type { FormErrorSummaryHandle } from '@nestself/ui';
import { ApiError } from '@nestself/api-client';
import type { AuthApi } from '@nestself/api-client';
import { EMAIL_OTP_MIN_LENGTH, EMAIL_OTP_MAX_LENGTH } from '@nestself/contracts';

interface Props {
  open: boolean;
  authApi: AuthApi;
  onVerified: () => void;
  onCancel: () => void;
}

function stepUpErrorMessage(err: unknown, t: TFunction<['auth', 'common']>): string {
  if (err instanceof ApiError) {
    if (err.status === 429) {
      const retryAfter = err.details?.retryAfter as number | undefined;
      return retryAfter
        ? t('auth:lockout.retryAfter', { minutes: Math.ceil(retryAfter / 60) })
        : t('auth:lockout.body');
    }
    if (err.code === 'invalid_code' || err.code === 'expired_code') return t('auth:error.invalidCode');
    if (err.code === 'invalid_challenge') return t('auth:error.challengeExpired');
    if (err.code === 'forbidden') return t('auth:stepUp.unavailable');
    if (err.code === 'network') return t('auth:error.network');
  }
  return t('auth:error.unknown');
}

export function StepUpDialog({ open, authApi, onVerified, onCancel }: Props) {
  const { t } = useTranslation(['auth', 'common']);
  const [code, setCode] = useState('');
  /** Null until a challenge is started, and again once a wrong code consumed it. */
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef<FormErrorSummaryHandle>(null);
  /** Guards against a second email when StrictMode re-runs the open effect. */
  const startedRef = useRef(false);

  const showError = useCallback((message: string) => {
    setError(message);
    errorRef.current?.focus();
  }, []);

  const startChallenge = useCallback(async () => {
    try {
      const result = await authApi.stepUpStart();
      setChallengeToken(result.challengeToken);
      setCode('');
      setError(null);
    } catch (err) {
      showError(stepUpErrorMessage(err, t));
    }
  }, [authApi, showError, t]);

  useEffect(() => {
    if (!open) {
      startedRef.current = false;
      return;
    }
    if (startedRef.current) return;
    startedRef.current = true;
    void startChallenge();
  }, [open, startChallenge]);

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setError(null);

      if (code.length < EMAIL_OTP_MIN_LENGTH) {
        showError(t('auth:error.invalidCode'));
        return;
      }
      if (!challengeToken) {
        showError(t('auth:error.challengeExpired'));
        return;
      }

      setSubmitting(true);
      try {
        await authApi.stepUpVerify(challengeToken, code);
        onVerified();
      } catch (err) {
        // The server consumes the challenge before checking the code, so a
        // wrong code needs a fresh challenge from "send a new code".
        if (err instanceof ApiError && (err.code === 'invalid_code' || err.code === 'invalid_challenge')) {
          setChallengeToken(null);
        }
        showError(stepUpErrorMessage(err, t));
      } finally {
        setSubmitting(false);
      }
    },
    [code, challengeToken, authApi, onVerified, showError, t],
  );

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) onCancel();
    },
    [onCancel],
  );

  const errors = error
    ? [{ id: 'step-up-code-input', label: t('auth:stepUp.codeLabel'), message: error }]
    : [];

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        title={t('auth:stepUp.title')}
        description={t('auth:stepUp.description')}
        closeLabel={t('common:nav.close')}
      >
        <form onSubmit={handleSubmit} noValidate className="space-y-6">
          <FormErrorSummary
            ref={errorRef}
            title={t('common:form.errorSummaryTitle')}
            errors={errors}
          />

          <div className="gap-1.5 flex flex-col">
            <label htmlFor="step-up-code-input" className="type-label text-text">
              {t('auth:stepUp.codeLabel')}
              <span className="ml-0.5 text-danger" aria-hidden>*</span>
            </label>
            <OtpInput
              length={EMAIL_OTP_MAX_LENGTH}
              minLength={EMAIL_OTP_MIN_LENGTH}
              id="step-up-code-input"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              aria-describedby={error ? 'step-up-code-error' : undefined}
              aria-invalid={!!error}
            />
            {error ? (
              <p id="step-up-code-error" className="type-metadata text-danger">{error}</p>
            ) : null}
          </div>

          <div className="text-center">
            <button
              type="button"
              onClick={() => void startChallenge()}
              className="type-metadata text-primary underline hover:text-primary-hover"
            >
              {t('auth:stepUp.resend')}
            </button>
          </div>

          <DialogActions>
            <Button type="button" variant="secondary" onClick={onCancel}>
              {t('auth:stepUp.cancel')}
            </Button>
            <Button type="submit" variant="primary" disabled={submitting}>
              {submitting ? t('auth:a11y.loading') : t('auth:stepUp.submit')}
            </Button>
          </DialogActions>
        </form>
      </DialogContent>
    </Dialog>
  );
}
