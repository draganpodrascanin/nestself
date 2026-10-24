/**
 * TOTP enrolment screen -- QR code + manual key + confirmation.
 * Uses the `qrcode` package to render the otpauth URI as a data-URL image.
 */
import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import QRCode from 'qrcode';
import {
  OtpInput,
  Button,
  FormErrorSummary,
  Heading,
  Text,
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

/** Extracts the secret parameter from an otpauth:// URI. */
function extractSecret(uri: string): string | null {
  try {
    const parsed = new URL(uri);
    return parsed.searchParams.get('secret');
  } catch {
    return null;
  }
}

export function TotpEnrolScreen({
  challengeToken,
  authApi,
  onSuccess,
  onError,
  error: externalError = null,
}: Props) {
  const { t } = useTranslation(['auth', 'common']);
  const [secretUri, setSecretUri] = useState<string | null>(null);
  // The enrol call rotates the challengeToken; the rotated one completes the step.
  const [activeToken, setActiveToken] = useState<string>(challengeToken);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const displayError = externalError ?? error;
  const errorSummaryRef = useRef<FormErrorSummaryHandle>(null);

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
        const dataUrl = await QRCode.toDataURL(result.secretUri, {
          width: 200,
          margin: 2,
        });
        if (!cancelled) setQrDataUrl(dataUrl);
      } catch (err) {
        if (!cancelled) onError(err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authApi, challengeToken, onError]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (code.length !== 6) {
      setError(t('auth:error.invalidCode'));
      errorSummaryRef.current?.focus();
      return;
    }

    setSubmitting(true);
    try {
      // Verifies the software token and completes the MFA_SETUP challenge
      await authApi.challenge(activeToken, code);
      await onSuccess();
    } catch (err) {
      setSubmitting(false);
      onError(err);
    }
  };

  const manualKey = secretUri ? extractSecret(secretUri) : null;

  const errors = displayError
    ? [
        {
          id: 'totp-enrol-code-input',
          label: t('auth:totpEnrol.codeLabel'),
          message: displayError,
        },
      ]
    : [];

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-6">
      <Heading level={1} typeRole="screenTitle" className="text-center">
        {t('auth:totpEnrol.title')}
      </Heading>

      <Text className="text-center text-text-secondary">
        {t('auth:totpEnrol.scanQr')}
      </Text>

      {qrDataUrl ? (
        <div className="flex justify-center">
          <img
            src={qrDataUrl}
            alt="QR code for authenticator app"
            width={200}
            height={200}
            className="rounded-control"
          />
        </div>
      ) : (
        <div className="flex justify-center">
          <div className="h-[200px] w-[200px] animate-pulse rounded-control bg-tint" />
        </div>
      )}

      {manualKey ? (
        <Text className="text-center type-metadata text-text-secondary break-all">
          {t('auth:totpEnrol.manualKey', { key: manualKey })}
        </Text>
      ) : null}

      <FormErrorSummary
        ref={errorSummaryRef}
        title={t('common:form.errorSummaryTitle')}
        errors={errors}
      />

      <div className="gap-1.5 flex flex-col">
        <label htmlFor="totp-enrol-code-input" className="type-label text-text">
          {t('auth:totpEnrol.codeLabel')}
          <span className="ml-0.5 text-danger" aria-hidden>*</span>
        </label>
        <OtpInput
          id="totp-enrol-code-input"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          aria-describedby={displayError ? 'totp-enrol-code-error' : undefined}
          aria-invalid={!!displayError}
        />
        {displayError ? (
          <p id="totp-enrol-code-error" className="type-metadata text-danger">{displayError}</p>
        ) : null}
      </div>

      <Button
        type="submit"
        variant="primary"
        disabled={submitting || !secretUri}
        className="w-full"
      >
        {submitting ? t('auth:a11y.loading') : t('auth:totpEnrol.confirm')}
      </Button>
    </form>
  );
}
