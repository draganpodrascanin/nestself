/**
 * The authenticator secret as a QR code plus the key for manual entry. Shared
 * by the sign-in enrolment step and the signed-in enrolment in Settings.
 *
 * Uses the `qrcode` package to render the otpauth URI as a data-URL image.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import QRCode from 'qrcode';
import { Text } from '@nestself/ui';

/** Extracts the secret from an otpauth:// URI for manual entry. */
function extractTotpSecret(uri: string): string {
  try {
    return new URL(uri).searchParams.get('secret') ?? '';
  } catch {
    return '';
  }
}

export interface TotpSecretProps {
  /** The otpauth:// URI; `null` while the enrolment call is still running. */
  secretUri: string | null;
  /** Shown while `secretUri` is null; defaults to the sign-in loading copy. */
  loadingLabel?: string;
}

export function TotpSecret({ secretUri, loadingLabel }: TotpSecretProps) {
  const { t } = useTranslation('auth');
  const [qr, setQr] = useState<{ uri: string; dataUrl: string } | null>(null);

  useEffect(() => {
    if (!secretUri) return;
    let cancelled = false;
    QRCode.toDataURL(secretUri, { width: 200, margin: 2 })
      .then((dataUrl) => {
        if (!cancelled) setQr({ uri: secretUri, dataUrl });
      })
      .catch(() => {
        // The manual key below still lets the user enrol.
      });
    return () => {
      cancelled = true;
    };
  }, [secretUri]);

  if (!secretUri) {
    return <Text className="text-center text-text-secondary">{loadingLabel ?? t('a11y.loading')}</Text>;
  }

  const manualKey = extractTotpSecret(secretUri);
  const dataUrl = qr?.uri === secretUri ? qr.dataUrl : null;

  return (
    <div className="flex flex-col items-center gap-4">
      <Text className="text-text-secondary text-center">{t('totpEnrol.scanQr')}</Text>
      {dataUrl ? (
        <img src={dataUrl} alt={t('totpEnrol.qrAlt')} width={200} height={200} className="rounded-control" />
      ) : (
        <div className="h-[200px] w-[200px] animate-pulse rounded-control bg-tint" aria-hidden />
      )}
      {manualKey ? (
        <Text className="type-metadata text-text-secondary text-center break-all">
          {t('totpEnrol.manualKey', { key: manualKey })}
        </Text>
      ) : null}
    </div>
  );
}
