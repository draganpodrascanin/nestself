/**
 * Confirm-email step of a federated sign-in (SSO-R-08). The organisation's
 * OIDC provider did not mark the address verified, so the API kept the
 * sign-in pending under an opaque handle
 * (`/sign-in?reason=sso_email_unverified&bind=<handle>`) and NestSelf proves
 * the mailbox with a code before it binds the account.
 *
 * - On mount it asks for the code once (`POST /auth/sso/bind/start`; a ref
 *   keeps StrictMode from mailing twice) and names the masked address.
 * - Confirm checks the code (`POST /auth/sso/bind/verify`), which binds the
 *   account and sets the session cookies; the page then continues to the
 *   return path the API answers.
 * - "Resend code" mails a new code for the same challenge
 *   (`POST /auth/sso/bind/resend`), at most once a minute counted from the
 *   last code, as the server enforces; a resend refused as too soon counts
 *   down from the wait the server names. A challenge the server no longer has
 *   (expired, or three wrong codes) is dropped, and the button then asks for
 *   a new code from the same handle at once.
 * - One request at a time: Confirm is disabled while a code is being sent (a
 *   verify during a resend would find the challenge taken), and resend while
 *   a code is being checked.
 * - A pending sign-in that expired, or that the organisation does not take,
 *   ends the step: the message and a link back to the sign-in page.
 *
 * Every failure renders translated copy in the `FormErrorSummary`.
 *
 * Kept byte-identical in the workspace and the admin app.
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Button, Heading, LinkButton, OtpInput, FormErrorSummary, Text } from '@nestself/ui';
import type { FormErrorSummaryHandle } from '@nestself/ui';
import { ApiError } from '@nestself/api-client';
import type { AuthApi } from '@nestself/api-client';
import { EMAIL_OTP_MIN_LENGTH, EMAIL_OTP_MAX_LENGTH } from '@nestself/contracts';
import { negotiateLocale } from '@nestself/i18n';

interface Props {
  /** `bind` from the sign-in URL. */
  handle: string;
  authApi: AuthApi;
  /** Called with the API's return path once the session exists. */
  onSuccess: (returnPath: string) => Promise<void>;
}

/** The server's resend cooldown (`OTP_RESEND_COOLDOWN_SECONDS`), counted from the last code. */
const RESEND_COOLDOWN_SECONDS = 60;

/** Answers after which the server no longer has the challenge. */
const DEAD_CHALLENGE_CODES = new Set(['invalid_challenge', 'expired_code', 'too_many_attempts']);

const CODE_FIELD_ID = 'sso-bind-code-input';
const SIGN_IN_LINK_ID = 'sso-bind-sign-in';

/** Seconds a `rate_limited` answer asks to wait (`details.retryAfter`), else null. */
function retryAfterSeconds(err: unknown): number | null {
  if (!(err instanceof ApiError) || err.code !== 'rate_limited') return null;
  const retryAfter = err.details?.retryAfter;
  return typeof retryAfter === 'number' && retryAfter > 0 ? Math.ceil(retryAfter) : null;
}

/** Copy for a failure the user can still act on here. */
function codeErrorMessage(err: unknown, t: TFunction<['auth', 'common']>): string {
  if (err instanceof ApiError) {
    if (err.status === 429) {
      const retryAfter = err.details?.retryAfter as number | undefined;
      return retryAfter
        ? t('auth:lockout.retryAfter', { minutes: Math.ceil(retryAfter / 60) })
        : t('auth:lockout.body');
    }
    if (err.code === 'invalid_code') return t('auth:error.invalidCode');
    if (err.code === 'invalid_challenge' || err.code === 'expired_code') return t('auth:error.challengeExpired');
    if (err.code === 'unavailable') return t('auth:error.unavailable');
    if (err.code === 'network') return t('auth:error.network');
  }
  return t('auth:error.unknown');
}

export function SsoBindScreen({ handle, authApi, onSuccess }: Props) {
  const { t, i18n } = useTranslation(['auth', 'common']);
  const [code, setCode] = useState('');
  /** Null until a code was sent, and again once the server no longer has the challenge. */
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  /** Where the code went (`m***@acme.example`). */
  const [emailMasked, setEmailMasked] = useState<string | null>(null);
  /** Seconds until "Resend code" is offered again. */
  const [countdown, setCountdown] = useState(0);
  /** A start or resend is in flight. */
  const [sending, setSending] = useState(false);
  /** A verify is in flight. */
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Set when the pending sign-in cannot finish here: the message next to the way back. */
  const [ended, setEnded] = useState<string | null>(null);
  const errorRef = useRef<FormErrorSummaryHandle>(null);
  /** Guards against a second email when StrictMode re-runs the mount effect. */
  const startedRef = useRef(false);
  /** One request at a time; set before the next render disables the buttons. */
  const busyRef = useRef(false);

  useEffect(() => {
    if (countdown <= 0) return;
    const id = setInterval(() => setCountdown((c) => c - 1), 1000);
    return () => clearInterval(id);
  }, [countdown]);

  // Move focus to the summary whenever it says something new.
  useEffect(() => {
    if (error || ended) errorRef.current?.focus();
  }, [error, ended]);

  const locale = useCallback(() => negotiateLocale([i18n.resolvedLanguage ?? i18n.language]), [i18n]);

  /** Shows the failure; a refused sign-in ends the step, a dead challenge can be replaced at once. */
  const fail = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.code === 'sso_denied') {
        setEnded(t('auth:error.ssoDenied'));
        return;
      }
      if (err instanceof ApiError && DEAD_CHALLENGE_CODES.has(err.code)) {
        setChallengeToken(null);
        setCountdown(0);
      }
      setError(codeErrorMessage(err, t));
    },
    [t],
  );

  /** Asks for a code for the pending sign-in (a new challenge each time). */
  const start = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setSending(true);
    try {
      const result = await authApi.ssoBindStart(handle, locale());
      setChallengeToken(result.challengeToken);
      setEmailMasked(result.emailMasked);
      setCountdown(RESEND_COOLDOWN_SECONDS);
      setCode('');
      setError(null);
    } catch (err) {
      // The handle is unknown or expired: only a new sign-in helps.
      if (err instanceof ApiError && err.code === 'invalid_challenge') {
        setEnded(t('auth:error.ssoBindExpired'));
      } else {
        fail(err);
        const retryAfter = retryAfterSeconds(err);
        if (retryAfter) setCountdown(retryAfter);
      }
    } finally {
      busyRef.current = false;
      setSending(false);
    }
  }, [authApi, handle, locale, fail, t]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void start();
  }, [start]);

  const handleResend = useCallback(async () => {
    if (!challengeToken) {
      void start();
      return;
    }
    if (busyRef.current) return;
    busyRef.current = true;
    setSending(true);
    try {
      const result = await authApi.ssoBindResend(challengeToken, locale());
      setEmailMasked(result.emailMasked);
      setCountdown(RESEND_COOLDOWN_SECONDS);
      setCode('');
      setError(null);
    } catch (err) {
      fail(err);
      // Too soon for another code: offer it again when the server allows one.
      const retryAfter = retryAfterSeconds(err);
      if (retryAfter) setCountdown(retryAfter);
    } finally {
      busyRef.current = false;
      setSending(false);
    }
  }, [authApi, challengeToken, locale, start, fail]);

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (busyRef.current) return;
      setError(null);

      if (code.length < EMAIL_OTP_MIN_LENGTH) {
        setError(t('auth:error.invalidCode'));
        return;
      }
      if (!challengeToken) {
        setError(t('auth:error.challengeExpired'));
        return;
      }

      busyRef.current = true;
      setSubmitting(true);
      try {
        const result = await authApi.ssoBindVerify(challengeToken, code);
        await onSuccess(result.returnPath);
      } catch (err) {
        fail(err);
      } finally {
        busyRef.current = false;
        setSubmitting(false);
      }
    },
    [code, challengeToken, authApi, onSuccess, fail, t],
  );

  if (ended) {
    return (
      <div className="space-y-6">
        <Heading level={1} typeRole="screenTitle" className="text-center">
          {t('auth:ssoBind.title')}
        </Heading>
        {/* The summary entry points at the way back, under a name of its own. */}
        <FormErrorSummary
          ref={errorRef}
          title={t('common:form.errorSummaryTitle')}
          errors={[{ id: SIGN_IN_LINK_ID, label: t('auth:signIn.title'), message: ended }]}
        />
        {/* A full page load: the sign-in starts again from a clean state. */}
        <LinkButton href="/sign-in" id={SIGN_IN_LINK_ID} variant="primary" fullWidth>
          {t('auth:ssoBind.backToSignIn')}
        </LinkButton>
      </div>
    );
  }

  const errors = error ? [{ id: CODE_FIELD_ID, label: t('auth:otp.codeLabel'), message: error }] : [];

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-6">
      <Heading level={1} typeRole="screenTitle" className="text-center">
        {t('auth:ssoBind.title')}
      </Heading>

      <div aria-live="polite">
        {emailMasked ? (
          <Text className="text-center text-text-secondary">
            {t('auth:ssoBind.instructions', { email: emailMasked })}
          </Text>
        ) : null}
      </div>

      <FormErrorSummary ref={errorRef} title={t('common:form.errorSummaryTitle')} errors={errors} />

      <div className="gap-1.5 flex flex-col">
        <label htmlFor={CODE_FIELD_ID} className="type-label text-text">
          {t('auth:otp.codeLabel')}
          <span className="ml-0.5 text-danger" aria-hidden>*</span>
        </label>
        <OtpInput
          length={EMAIL_OTP_MAX_LENGTH}
          minLength={EMAIL_OTP_MIN_LENGTH}
          id={CODE_FIELD_ID}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          aria-describedby={error ? 'sso-bind-code-error' : undefined}
          aria-invalid={!!error}
        />
        {error ? (
          <p id="sso-bind-code-error" className="type-metadata text-danger">{error}</p>
        ) : null}
      </div>

      <Button type="submit" variant="primary" className="w-full" disabled={submitting || sending}>
        {submitting ? t('auth:a11y.loading') : t('auth:ssoBind.submit')}
      </Button>

      <div className="gap-1 flex flex-col items-center text-center">
        <button
          type="button"
          onClick={handleResend}
          disabled={countdown > 0 || sending || submitting}
          className="type-metadata text-primary underline hover:text-primary-hover disabled:cursor-not-allowed disabled:text-disabled-text disabled:no-underline"
        >
          {t('auth:otp.resend')}
        </button>
        <p className="type-metadata text-text-secondary" aria-live="polite">
          {countdown > 0 ? t('auth:otp.resendCountdown', { seconds: countdown }) : null}
        </p>
      </div>
    </form>
  );
}
