/**
 * Step-up re-authentication dialog.
 *
 * Opening it starts a challenge (`POST /auth/step-up/start`): an email code,
 * sent by Cognito or, for a federated user, by NestSelf, and the description
 * names the masked address. Submitting verifies the code
 * (`POST /auth/step-up/verify`), which refreshes the session cookies.
 *
 * - A wrong code keeps the challenge: the server allows three tries on it. An
 *   expired, spent or locked challenge is dropped, and "Send a new code" then
 *   starts a new one at once.
 * - "Send a new code" asks for a new code for the same challenge
 *   (`POST /auth/step-up/resend`), at most once a minute counted from the
 *   last code, as the server enforces; a countdown says how long is left. A
 *   resend the server refuses as too soon counts down from the wait it names.
 * - One request at a time: start, resend and verify never overlap (a verify
 *   during a resend would find the challenge taken), and Cancel waits for a
 *   verify in flight. An answer that arrives after the dialog was closed
 *   (through its close button) is ignored, and the next opening starts afresh.
 *
 * Every failure renders translated copy in the `FormErrorSummary` and on the
 * code field.
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
import type { StepUpStartResponse } from '@nestself/contracts';

interface Props {
  open: boolean;
  authApi: AuthApi;
  onVerified: () => void;
  onCancel: () => void;
}

/** The server's resend cooldown (`OTP_RESEND_COOLDOWN_SECONDS`), counted from the last code. */
const RESEND_COOLDOWN_SECONDS = 60;

/** Answers after which the server no longer has the challenge. */
const DEAD_CHALLENGE_CODES = new Set(['invalid_challenge', 'expired_code', 'too_many_attempts']);

/** Seconds a `rate_limited` answer asks to wait (`details.retryAfter`), else null. */
function retryAfterSeconds(err: unknown): number | null {
  if (!(err instanceof ApiError) || err.code !== 'rate_limited') return null;
  const retryAfter = err.details?.retryAfter;
  return typeof retryAfter === 'number' && retryAfter > 0 ? Math.ceil(retryAfter) : null;
}

function stepUpErrorMessage(err: unknown, t: TFunction<['auth', 'common']>): string {
  if (err instanceof ApiError) {
    if (err.status === 429) {
      const retryAfter = err.details?.retryAfter as number | undefined;
      return retryAfter
        ? t('auth:lockout.retryAfter', { minutes: Math.ceil(retryAfter / 60) })
        : t('auth:lockout.body');
    }
    if (err.code === 'invalid_code') return t('auth:error.invalidCode');
    if (err.code === 'invalid_challenge' || err.code === 'expired_code') return t('auth:error.challengeExpired');
    if (err.code === 'step_up_unavailable') return t('auth:stepUp.unavailable');
    if (err.code === 'unavailable') return t('auth:error.unavailable');
    if (err.code === 'network') return t('auth:error.network');
  }
  return t('auth:error.unknown');
}

export function StepUpDialog({ open, authApi, onVerified, onCancel }: Props) {
  const { t } = useTranslation(['auth', 'common']);
  const [code, setCode] = useState('');
  /** Null until a challenge is started, and again once the server no longer has it. */
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  /** Where the code went (`d***@intesa.example`), as the last start or resend said. */
  const [emailMasked, setEmailMasked] = useState<string | null>(null);
  /** Seconds until "Send a new code" is offered again. */
  const [countdown, setCountdown] = useState(0);
  /** A start or resend is in flight. */
  const [sending, setSending] = useState(false);
  /** A verify is in flight. */
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef<FormErrorSummaryHandle>(null);
  /** Guards against a second email when StrictMode re-runs the open effect. */
  const startedRef = useRef(false);
  /** One request at a time; set before the next render disables the buttons. */
  const busyRef = useRef(false);
  /**
   * Counts the openings. A request answered after its opening ended (the
   * dialog was closed meanwhile) changes nothing, and does not hold up the
   * next opening.
   */
  const openingRef = useRef(0);

  useEffect(() => {
    if (countdown <= 0) return;
    const id = setInterval(() => setCountdown((c) => c - 1), 1000);
    return () => clearInterval(id);
  }, [countdown]);

  const showError = useCallback((message: string) => {
    setError(message);
    errorRef.current?.focus();
  }, []);

  /** Shows the failure; a challenge the server no longer has is dropped, so a new one can be asked for at once. */
  const fail = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && DEAD_CHALLENGE_CODES.has(err.code)) {
        setChallengeToken(null);
        setCountdown(0);
      }
      showError(stepUpErrorMessage(err, t));
    },
    [showError, t],
  );

  /** A start or a resend: either answers with the challenge to verify against. */
  const sendCode = useCallback(
    async (request: () => Promise<StepUpStartResponse>) => {
      if (busyRef.current) return;
      const opening = openingRef.current;
      busyRef.current = true;
      setSending(true);
      try {
        const result = await request();
        if (opening !== openingRef.current) return;
        setChallengeToken(result.challengeToken);
        setEmailMasked(result.emailMasked);
        setCountdown(RESEND_COOLDOWN_SECONDS);
        setCode('');
        setError(null);
      } catch (err) {
        if (opening !== openingRef.current) return;
        fail(err);
        // Too soon for another code: offer it again when the server allows one.
        const retryAfter = retryAfterSeconds(err);
        if (retryAfter) setCountdown(retryAfter);
      } finally {
        if (opening === openingRef.current) {
          busyRef.current = false;
          setSending(false);
        }
      }
    },
    [fail],
  );

  useEffect(() => {
    if (!open) {
      startedRef.current = false;
      return;
    }
    if (startedRef.current) return;
    startedRef.current = true;
    // A new opening: whatever the previous one still has in flight no longer counts.
    openingRef.current += 1;
    busyRef.current = false;
    setSubmitting(false);
    setSending(false);
    void sendCode(() => authApi.stepUpStart());
  }, [open, authApi, sendCode]);

  const handleResend = useCallback(() => {
    void sendCode(() => (challengeToken ? authApi.stepUpResend(challengeToken) : authApi.stepUpStart()));
  }, [authApi, challengeToken, sendCode]);

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (busyRef.current) return;
      setError(null);

      if (code.length < EMAIL_OTP_MIN_LENGTH) {
        showError(t('auth:error.invalidCode'));
        return;
      }
      if (!challengeToken) {
        showError(t('auth:error.challengeExpired'));
        return;
      }

      const opening = openingRef.current;
      busyRef.current = true;
      setSubmitting(true);
      try {
        await authApi.stepUpVerify(challengeToken, code);
        if (opening === openingRef.current) onVerified();
      } catch (err) {
        if (opening === openingRef.current) fail(err);
      } finally {
        if (opening === openingRef.current) {
          busyRef.current = false;
          setSubmitting(false);
        }
      }
    },
    [code, challengeToken, authApi, onVerified, showError, fail, t],
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
        description={
          emailMasked
            ? t('auth:stepUp.descriptionMasked', { email: emailMasked })
            : t('auth:stepUp.description')
        }
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

          <div className="gap-1 flex flex-col items-center text-center">
            <button
              type="button"
              onClick={handleResend}
              disabled={countdown > 0 || sending || submitting}
              className="type-metadata text-primary underline hover:text-primary-hover disabled:cursor-not-allowed disabled:text-disabled-text disabled:no-underline"
            >
              {t('auth:stepUp.resend')}
            </button>
            <p className="type-metadata text-text-secondary" aria-live="polite">
              {countdown > 0 ? t('auth:otp.resendCountdown', { seconds: countdown }) : null}
            </p>
          </div>

          <DialogActions>
            <Button type="button" variant="secondary" onClick={onCancel} disabled={submitting}>
              {t('auth:stepUp.cancel')}
            </Button>
            <Button type="submit" variant="primary" disabled={submitting || sending}>
              {submitting ? t('auth:a11y.loading') : t('auth:stepUp.submit')}
            </Button>
          </DialogActions>
        </form>
      </DialogContent>
    </Dialog>
  );
}
