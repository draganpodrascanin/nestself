/**
 * TOTP enrolment screen -- QR code + manual key + confirmation code.
 *
 * Uses the `qrcode` package to render a data-URL <img>.
 * Calls `POST /auth/totp/confirm` then `POST /auth/challenge` on success.
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

interface Props {
  challengeToken: string;
  authApi: AuthApi;
  onSuccess: () => Promise<void>;
  onError: (err: unknown) => void;
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
}: Props) {
  const { t } = useTranslation('auth');
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secretUri, setSecretUri] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const errorRef = useRef<FormErrorSummaryHandle>(null);

  // Fetch the TOTP secret on mount
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await authApi.totpEnrol();
        if (cancelled) return;
        setSecretUri(result.secretUri);
        const dataUrl = await QRCode.toDataURL(result.secretUri, { width: 200, margin: 2 });
        if (!cancelled) setQrDataUrl(dataUrl);
      } catch (err) {
        if (!cancelled) onError(err);
      }
    })();
    return () => { cancelled = true; };
  }, [authApi, onError]);

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
        await authApi.totpConfirm(code);
        await authApi.challenge(challengeToken, code);
        await onSuccess();
      } catch (err) {
        onError(err);
      } finally {
        setSubmitting(false);
      }
    },
    [code, challengeToken, authApi, onSuccess, onError, t],
  );

  const manualKey = secretUri ? extractSecret(secretUri) : '';

  const errors = error
    ? [{ id: 'enrol-code', label: t('totpEnrol.codeLabel'), message: error }]
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
          aria-describedby={error ? 'enrol-code-error' : undefined}
          aria-invalid={!!error}
        />
        {error ? (
          <p id="enrol-code-error" className="type-metadata text-danger">{error}</p>
        ) : null}
      </div>

      <Button type="submit" variant="primary" className="w-full" disabled={submitting}>
        {submitting ? t('a11y.loading') : t('totpEnrol.confirm')}
      </Button>
    </form>
  );
}
