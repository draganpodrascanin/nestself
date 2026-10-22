/**
 * Sign-in page -- identifier-first state machine.
 *
 * SESS-R-01: NestSelf-owned sign-in, identifier-first.
 * SESS-R-02: four locales, neutral copy.
 * SESS-R-04: rate limits surface as lockout screen.
 * SESS-R-06: accessible forms.
 * CLIENT-R-09: neutral copy (never reveals whether an address is registered).
 * CLIENT-R-34..37: a11y requirements on every screen.
 */
import { useState, useMemo, useCallback } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { createAuthApi, ApiError } from '@nestself/api-client';
import { Heading, Text } from '@nestself/ui';
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
  const { refreshPrincipal } = useAuth();
  const authApi = useMemo(
    () => (isSampleDataMode ? createSampleAuthApi() : createAuthApi(api)),
    [],
  );

  const [screen, setScreen] = useState<Screen>(resolveInitialScreen);
  const [error, setError] = useState<string | null>(null);

  const handleSuccess = useCallback(async () => {
    await refreshPrincipal();
    void navigate({ to: returnPath ?? '/' });
  }, [refreshPrincipal, navigate, returnPath]);

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
        if (err.code === 'invalid_credentials') {
          setError(t('error.invalidCredentials'));
          return;
        }
        if (err.code === 'network') {
          setError(t('error.network'));
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

  const handleChallengeRequired = useCallback(
    (step: string, challengeToken: string) => {
      switch (step) {
        case 'totp':
          setScreen({ kind: 'totp', challengeToken });
          break;
        case 'totp_enrol':
          setScreen({ kind: 'totp_enrol', challengeToken });
          break;
        case 'new_password':
          setScreen({ kind: 'new_password', challengeToken });
          break;
      }
    },
    [],
  );

  switch (screen.kind) {
    case 'identifier':
      return <IdentifierScreen onSubmit={handleIdentifier} error={error} />;

    case 'email_otp':
      return (
        <OtpScreen
          email={screen.email}
          challengeToken={screen.challengeToken}
          authApi={authApi}
          onSuccess={handleSuccess}
          onError={handleApiError}
          onBack={() => {
            setError(null);
            setScreen({ kind: 'identifier' });
          }}
        />
      );

    case 'password':
      return (
        <PasswordScreen
          email={screen.email}
          authApi={authApi}
          onSuccess={handleSuccess}
          onChallengeRequired={handleChallengeRequired}
          onError={handleApiError}
          error={error}
          onBack={() => {
            setError(null);
            setScreen({ kind: 'identifier' });
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
        />
      );

    case 'totp_enrol':
      return (
        <TotpEnrolScreen
          challengeToken={screen.challengeToken}
          authApi={authApi}
          onSuccess={handleSuccess}
          onError={handleApiError}
        />
      );

    case 'new_password':
      return (
        <NewPasswordScreen
          challengeToken={screen.challengeToken}
          authApi={authApi}
          onChallengeRequired={handleChallengeRequired}
          onError={handleApiError}
        />
      );

    case 'sso':
      return (
        <Text className="text-center type-body text-text-secondary">
          {t('signIn.ssoRedirect')}
        </Text>
      );

    case 'lockout':
      return (
        <div className="text-center space-y-4">
          <Heading level={1} typeRole="screenTitle" className="text-danger">
            {t('lockout.title')}
          </Heading>
          <Text className="text-text-secondary">{t('lockout.body')}</Text>
          {screen.retryAfter != null ? (
            <Text className="type-metadata text-text-secondary">
              {t('lockout.retryAfter', {
                minutes: Math.ceil(screen.retryAfter / 60),
              })}
            </Text>
          ) : null}
        </div>
      );
  }
}
