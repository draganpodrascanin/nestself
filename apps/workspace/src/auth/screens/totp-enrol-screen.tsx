/**
 * TOTP enrolment screen -- QR code + manual key + confirmation code.
 *
 * Uses the `qrcode` package to render a data-URL <img>.
 * Calls `POST /auth/totp/enrol` with the sign-in challengeToken, then completes
 * the MFA_SETUP step with `POST /auth/challenge` and the authenticator code.
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import QRCode from 'qrcode';
import {
  Button,
  Heading,
  Text,
  OtpInput,
  FormErrorSummary,
} from '@nestself/ui';
import type { FormErrorSummaryHandle } from '@nestself/ui';
import type { AuthApi } from '@nestself/api-client';
import type { TotpEnrolResponse } from '@nestself/contracts';

interface Props {
  challengeToken: string;
  authApi: AuthApi;
  onSuccess: () => Promise<void>;
  onError: (err: unknown) => void;
  /** Error raised by the parent sign-in page; rendered together with local validation. */
  error?: string | null;
}

/** Extracts the secret from an otpauth:// URI for manual entry. */
function extractSecret(uri: string): string {
  try {
    const url = new URL(uri);
    return url.searchParams.get('secret') ?? '';
  } catch {
    return '';
  }
}

export function TotpEnrolScreen({
  challengeToken,
  authApi,
  onSuccess,
  onError,
  error: externalError = null,
}: Props) {
  const { t } = useTranslation('auth');
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const displayError = externalError ?? error;
  const [secretUri, setSecretUri] = useState<string | null>(null);
  // The enrol call rotates the challengeToken; the rotated one completes the step.
  const [activeToken, setActiveToken] = useState<string>(challengeToken);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const errorRef = useRef<FormErrorSummaryHandle>(null);

  // The enrol call consumes the single-use challenge token, so it must be
  // issued exactly once per token. React StrictMode runs effects twice in
  // development; the ref survives that and the second run reuses the same
  // in-flight request instead of spending an already-consumed token.
  const enrolRequest = useRef<{ token: string; promise: Promise<TotpEnrolResponse> } | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!enrolRequest.current || enrolRequest.current.token !== challengeToken) {
      enrolRequest.current = { token: challengeToken, promise: authApi.totpEnrol(challengeToken) };
    }
    const request = enrolRequest.current.promise;
    void (async () => {
      try {
        const result = await request;
        if (cancelled) return;
        setSecretUri(result.secretUri);
        if (result.challengeToken) setActiveToken(result.challengeToken);
        const dataUrl = await QRCode.toDataURL(result.secretUri, { width: 200, margin: 2 });
        if (!cancelled) setQrDataUrl(dataUrl);
      } catch (err) {
        if (!cancelled) onError(err);
      }
    })();
    return () => { cancelled = true; };
  }, [authApi, challengeToken, onError]);

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setError(null);

      if (code.length !== 6) {
        setError(t('error.invalidCode'));
        errorRef.current?.focus();
        return;
      }

      setSubmitting(true);
      try {
        await authApi.challenge(activeToken, code);
        await onSuccess();
      } catch (err) {
        onError(err);
      } finally {
        setSubmitting(false);
      }
    },
    [code, activeToken, authApi, onSuccess, onError, t],
  );

  const manualKey = secretUri ? extractSecret(secretUri) : '';

  const errors = displayError
    ? [{ id: 'enrol-code', label: t('totpEnrol.codeLabel'), message: displayError }]
    : [];

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-6">
      <Heading level={1} typeRole="screenTitle" className="text-center">
        {t('totpEnrol.title')}
      </Heading>

      {qrDataUrl ? (
        <div className="flex flex-col items-center gap-4">
          <Text className="text-text-secondary text-center">
            {t('totpEnrol.scanQr')}
          </Text>
          <img src={qrDataUrl} alt="TOTP QR code" width={200} height={200} />
          {manualKey ? (
            <Text className="type-metadata text-text-secondary text-center break-all">
              {t('totpEnrol.manualKey', { key: manualKey })}
            </Text>
          ) : null}
        </div>
      ) : (
        <Text className="text-center text-text-secondary">
          {t('a11y.loading')}
        </Text>
      )}

      <FormErrorSummary
        ref={errorRef}
        title={t('common:form.errorSummaryTitle')}
        errors={errors}
      />

      <div className="gap-1.5 flex flex-col">
        <label htmlFor="enrol-code-input" className="type-label text-text">
          {t('totpEnrol.codeLabel')}
          <span className="ml-0.5 text-danger" aria-hidden>*</span>
        </label>
        <OtpInput
          id="enrol-code-input"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          aria-describedby={displayError ? 'enrol-code-error' : undefined}
          aria-invalid={!!displayError}
        />
        {displayError ? (
          <p id="enrol-code-error" className="type-metadata text-danger">{displayError}</p>
        ) : null}
      </div>

      <Button type="submit" variant="primary" className="w-full" disabled={submitting}>
        {submitting ? t('a11y.loading') : t('totpEnrol.confirm')}
      </Button>
    </form>
  );
}
