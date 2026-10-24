/**
 * Sign-in page -- identifier-first state machine for the admin app.
 * SESS-R-01, SESS-R-02, SESS-R-04, SESS-R-06, CLIENT-R-09, CLIENT-R-34..37
 *
 * Admin-specific: after successful sign-in, if the principal's context is
 * not 'operations' and staffTemplates.length > 0, switches to operations
 * context before navigating.
 */
import { useState, useMemo, useCallback } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { createAuthApi, ApiError } from '@nestself/api-client';
import { useAuth } from '../auth-context';
import { isSampleDataMode } from '../../data-source';
import { api } from '../../api';
import { createSampleAuthApi } from './sample-auth-api';
import { IdentifierScreen } from './identifier-screen';
import { OtpScreen } from './otp-screen';
import { PasswordScreen } from './password-screen';
import { TotpScreen } from './totp-screen';
import { TotpEnrolScreen } from './totp-enrol-screen';
import { NewPasswordScreen } from './new-password-screen';

type Screen =
  | { kind: 'identifier' }
  | { kind: 'email_otp'; email: string; challengeToken: string }
  | { kind: 'password'; email: string }
  | { kind: 'totp'; challengeToken: string }
  | { kind: 'totp_enrol'; challengeToken: string }
  | { kind: 'new_password'; challengeToken: string }
  | { kind: 'sso'; url: string }
  | { kind: 'lockout'; retryAfter?: number };

/**
 * In sample/dev mode, `?step=totp_enrol` or `?step=new_password` on /sign-in
 * jumps directly to those screens so they can be screenshotted.
 */
function resolveInitialScreen(): Screen {
  if (isSampleDataMode && typeof window !== 'undefined') {
    const step = new URLSearchParams(window.location.search).get('step');
    if (step === 'totp_enrol') return { kind: 'totp_enrol', challengeToken: 'sample' };
    if (step === 'new_password') return { kind: 'new_password', challengeToken: 'sample' };
  }
  return { kind: 'identifier' };
}

interface Props {
  returnPath?: string;
}

export function SignInPage({ returnPath }: Props) {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const { refreshPrincipal, switchContext } = useAuth();
  const authApi = useMemo(
    () => (isSampleDataMode ? createSampleAuthApi() : createAuthApi(api)),
    [],
  );

  const [screen, setScreen] = useState<Screen>(resolveInitialScreen);
  const [error, setError] = useState<string | null>(null);

  const handleSuccess = useCallback(async () => {
    await refreshPrincipal();

    // Admin-specific: switch to operations context when appropriate
    // We need to re-read principal after refresh but we can't await state.
    // Instead we fetch /me directly to check.
    try {
      const me = await authApi.me();
      if (
        me.principal.context.kind !== 'operations' &&
        me.principal.staffTemplates.length > 0
      ) {
        await switchContext({ kind: 'operations' });
      }
    } catch {
      // Best effort -- proceed with navigation anyway
    }

    void navigate({ to: returnPath ?? '/' });
  }, [refreshPrincipal, switchContext, authApi, navigate, returnPath]);

  const handleApiError = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError) {
        if (err.status === 429) {
          const retryAfter = err.details?.retryAfter as number | undefined;
          setScreen({ kind: 'lockout', retryAfter });
          return;
        }
        if (err.code === 'invalid_code' || err.code === 'expired_code') {
          setError(t('error.invalidCode'));
          return;
        }
        // The challenge token is single-use and is consumed before the code is
        // checked, so a wrong digit ends it. Tell the user to ask for a new code
        // instead of leaking the API's English "Challenge expired or invalid".
        if (err.code === 'invalid_challenge') {
          setError(t('error.challengeExpired'));
          return;
        }
        if (err.code === 'invalid_credentials') {
          setError(t('error.invalidCredentials'));
          return;
        }
        setError(err.message);
        return;
      }
      setError(t('error.unknown'));
    },
    [t],
  );

  const handleIdentifier = useCallback(
    async (email: string) => {
      setError(null);

      try {
        const result = await authApi.discover(email);
        switch (result.method) {
          case 'email_otp': {
            const otp = await authApi.emailOtpStart(email);
            setScreen({
              kind: 'email_otp',
              email,
              challengeToken: otp.challengeToken,
            });
            break;
          }
          case 'password':
            setScreen({ kind: 'password', email });
            break;
          case 'sso':
            if (result.ssoStartUrl) {
              setScreen({ kind: 'sso', url: result.ssoStartUrl });
              window.location.assign(result.ssoStartUrl);
            }
            break;
        }
      } catch (err) {
        handleApiError(err);
      }
    },
    [authApi, handleApiError],
  );

  switch (screen.kind) {
    case 'identifier':
      return (
        <IdentifierScreen onSubmit={handleIdentifier} error={error} />
      );

    case 'email_otp':
      return (
        <OtpScreen
          email={screen.email}
          challengeToken={screen.challengeToken}
          authApi={authApi}
          onSuccess={handleSuccess}
          onError={handleApiError}
          error={error}
          onBack={() => {
            setScreen({ kind: 'identifier' });
            setError(null);
          }}
        />
      );

    case 'password':
      return (
        <PasswordScreen
          email={screen.email}
          authApi={authApi}
          onSuccess={handleSuccess}
          onChallengeRequired={(step, token) => {
            setError(null);
            if (step === 'totp')
              setScreen({ kind: 'totp', challengeToken: token });
            else if (step === 'totp_enrol')
              setScreen({ kind: 'totp_enrol', challengeToken: token });
            else if (step === 'new_password')
              setScreen({ kind: 'new_password', challengeToken: token });
          }}
          onError={handleApiError}
          error={error}
          onBack={() => {
            setScreen({ kind: 'identifier' });
            setError(null);
          }}
        />
      );

    case 'totp':
      return (
        <TotpScreen
          challengeToken={screen.challengeToken}
          authApi={authApi}
          onSuccess={handleSuccess}
          onError={handleApiError}
          error={error}
        />
      );

    case 'totp_enrol':
      return (
        <TotpEnrolScreen
          challengeToken={screen.challengeToken}
          authApi={authApi}
          onSuccess={handleSuccess}
          onError={handleApiError}
          error={error}
        />
      );

    case 'new_password':
      return (
        <NewPasswordScreen
          challengeToken={screen.challengeToken}
          authApi={authApi}
          onSuccess={handleSuccess}
          onChallengeRequired={(step, token) => {
            setError(null);
            if (step === 'totp')
              setScreen({ kind: 'totp', challengeToken: token });
            else if (step === 'totp_enrol')
              setScreen({ kind: 'totp_enrol', challengeToken: token });
          }}
          onError={handleApiError}
          error={error}
        />
      );

    case 'sso':
      return (
        <p className="text-center type-body text-text-secondary">
          {t('signIn.ssoRedirect')}
        </p>
      );

    case 'lockout':
      return (
        <div className="text-center space-y-4">
          <h1 className="type-label text-danger">{t('lockout.title')}</h1>
          <p className="type-body text-text-secondary">
            {t('lockout.body')}
          </p>
          {screen.retryAfter ? (
            <p className="type-metadata text-text-secondary">
              {t('lockout.retryAfter', {
                minutes: Math.ceil(screen.retryAfter / 60),
              })}
            </p>
          ) : null}
        </div>
      );
  }
}
