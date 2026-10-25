/**
 * Authenticator app for password users (`principal.auth.method ===
 * 'password_totp'`). Without a second factor the user can enrol from here:
 * `POST /auth/me/totp/enrol` gives the secret (QR + manual key), and
 * `POST /auth/totp/confirm` with a code from the app finishes it. A 409
 * `totp_already_enrolled` shows the "already set up" message.
 *
 * The session's `secondFactor` flag only changes at the next sign-in, so a
 * successful enrolment is remembered here until then.
 */
import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, FormErrorSummary, Heading, OtpInput, Text } from '@nestself/ui';
import type { FormErrorSummaryHandle } from '@nestself/ui';
import { useAuth } from '../../auth';
import { TotpSecret } from '../../auth/totp-secret';
import { accountErrorKey } from './account-errors';
import type { AccountApi } from './use-account';
import { useTotpConfirm, useTotpEnrolSignedIn } from './use-account';

const CODE_LENGTH = 6;
const CODE_ID = 'account-totp-code';

type Step =
  | { kind: 'idle' }
  | { kind: 'enrolling'; secretUri: string | null }
  | { kind: 'done' };

export interface AuthenticatorSectionProps {
  authApi: AccountApi;
  sampleMode: boolean;
}

export function AuthenticatorSection({ authApi, sampleMode }: AuthenticatorSectionProps) {
  const { t } = useTranslation(['auth', 'common']);
  const { principal } = useAuth();
  const enrol = useTotpEnrolSignedIn(authApi);
  const confirm = useTotpConfirm(authApi);
  const summaryRef = useRef<FormErrorSummaryHandle>(null);

  const [step, setStep] = useState<Step>({ kind: 'idle' });
  const [code, setCode] = useState('');
  const [startError, setStartError] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);

  if (!principal || principal.auth.method !== 'password_totp') return null;

  const heading = <Heading level={3}>{t('auth:account.authenticator.title')}</Heading>;

  if (principal.auth.secondFactor || step.kind === 'done') {
    return (
      <div className="space-y-3">
        {heading}
        {step.kind === 'done' ? (
          <Alert tone="success" title={t('auth:account.authenticator.enabled')}>
            {t('auth:account.authenticator.success')}
          </Alert>
        ) : (
          <Alert tone="success" title={t('auth:account.authenticator.enabled')}>
            {t('auth:account.authenticator.enabledBody')}
          </Alert>
        )}
      </div>
    );
  }

  const start = async () => {
    setStartError(null);
    setCodeError(null);
    setCode('');
    setStep({ kind: 'enrolling', secretUri: null });
    try {
      const result = await enrol.mutateAsync();
      setStep({ kind: 'enrolling', secretUri: result.secretUri });
    } catch (err) {
      setStep({ kind: 'idle' });
      setStartError(t(accountErrorKey(err)));
    }
  };

  const failCode = (message: string) => {
    setCodeError(message);
    queueMicrotask(() => summaryRef.current?.focus());
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (confirm.isPending) return;
    if (code.length !== CODE_LENGTH) return failCode(t('auth:error.invalidCode'));
    setCodeError(null);
    try {
      await confirm.mutateAsync(code);
      setStep({ kind: 'done' });
    } catch (err) {
      failCode(t(accountErrorKey(err)));
    }
  };

  if (step.kind === 'enrolling') {
    const errors = codeError
      ? [{ id: CODE_ID, label: t('auth:account.authenticator.codeLabel'), message: codeError }]
      : [];
    return (
      <form noValidate onSubmit={(e) => void submit(e)} className="space-y-4 max-w-form">
        {heading}
        <TotpSecret secretUri={step.secretUri} loadingLabel={t('auth:account.authenticator.preparing')} />
        <FormErrorSummary ref={summaryRef} title={t('common:form.errorSummaryTitle')} errors={errors} />
        <div className="gap-1.5 flex flex-col">
          <label htmlFor={CODE_ID} className="type-label text-text">
            {t('auth:account.authenticator.codeLabel')}
            <span className="ml-0.5 text-danger" aria-hidden>*</span>
          </label>
          <OtpInput
            id={CODE_ID}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            aria-describedby={codeError ? `${CODE_ID}-error` : undefined}
            aria-invalid={!!codeError}
          />
          {codeError ? (
            <p id={`${CODE_ID}-error`} className="type-metadata text-danger">{codeError}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={step.secretUri === null || confirm.isPending}>
            {confirm.isPending ? t('auth:account.authenticator.confirming') : t('auth:account.authenticator.confirm')}
          </Button>
          <Button type="button" variant="secondary" onClick={() => setStep({ kind: 'idle' })}>
            {t('auth:account.authenticator.cancel')}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="space-y-3">
      {heading}
      <Text tone="secondary">{t('auth:account.authenticator.notSetUp')}</Text>
      {sampleMode ? <Alert tone="info">{t('auth:account.authenticator.sampleNote')}</Alert> : null}
      {startError ? <Alert tone="danger">{startError}</Alert> : null}
      <Button variant="secondary" disabled={sampleMode || enrol.isPending} onClick={() => void start()}>
        {t('auth:account.authenticator.setUp')}
      </Button>
    </div>
  );
}
