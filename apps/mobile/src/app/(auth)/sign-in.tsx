/**
 * Sign-in screen: identifier-first flow.
 *
 * 1. User enters email, taps Continue.
 * 2. `POST /auth/discover` resolves the method:
 *    - `email_otp`: Cognito InitiateAuth then code input.
 *    - `sso`: PKCE authorization via expo-auth-session.
 *    - `password`: message that this account signs in on the web.
 * 3. In sample mode, a "Sign in as sample employee" button appears.
 *
 * Errors never reveal whether an address exists (CLIENT-R-18).
 *
 * @see auth-strategy.md 6.2, CLIENT-R-17..26
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { EMAIL_OTP_MIN_LENGTH, EMAIL_OTP_MAX_LENGTH } from '@nestself/contracts';
import {
  View,
  KeyboardAvoidingView,
  Platform,
  AccessibilityInfo,
  ScrollView,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import * as WebBrowser from 'expo-web-browser';
import { Screen, Text, Button, Field, Input, Alert, Card } from '@nestself/ui-native';
import { useTheme } from '@nestself/ui-native';
import { ApiError } from '@nestself/api-client';

import { useAuth } from '@/auth/use-auth';
import { getCognitoConfig } from '@/auth/config';
import { useSsoSignIn } from '@/auth/sso';
import type { CognitoConfig } from '@/auth/config';
import { SampleDataBanner } from '@/components/SampleDataBanner';
import { CognitoError } from '@/auth/cognito-public-client';

// Needed for expo-auth-session to complete the redirect
WebBrowser.maybeCompleteAuthSession();

// ---------------------------------------------------------------------------
// Step enum
// ---------------------------------------------------------------------------

type SignInStep = 'email' | 'otp' | 'sso_pending' | 'password_web';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OTP_RESEND_COOLDOWN_SECONDS = 60;
// Cognito EMAIL_OTP codes are eight digits; the stub provider issues six.
const OTP_CODE_LENGTH = EMAIL_OTP_MAX_LENGTH;
const OTP_CODE_MIN_LENGTH = EMAIL_OTP_MIN_LENGTH;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SignInScreen() {
  const { t } = useTranslation('auth');
  const { space } = useTheme();
  const auth = useAuth();

  const [step, setStep] = useState<SignInStep>('email');
  const [email, setEmail] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [ssoConnection, setSsoConnection] = useState<string | null>(null);
  const [resendCountdown, setResendCountdown] = useState(0);

  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // SSO hook - only initialised when we have a connection
  const cognitoConfig = getCognitoConfigSafe();
  const sso = useSsoSignIn(
    cognitoConfig ?? { region: '', userPoolId: '', clientId: '', domain: '' },
    ssoConnection,
  );

  // Resend countdown timer
  useEffect(() => {
    if (resendCountdown <= 0) {
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
      return;
    }
    countdownRef.current = setInterval(() => {
      setResendCountdown((prev) => {
        if (prev <= 1) {
          if (countdownRef.current) clearInterval(countdownRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [resendCountdown]);

  // ---------------------------------------------------------------------------
  // Error display helper
  // ---------------------------------------------------------------------------

  function displayError(err: unknown): void {
    let message: string;
    if (err instanceof CognitoError) {
      switch (err.code) {
        case 'invalid_code':
          message = t('error.invalidCode');
          break;
        case 'expired_code':
          message = t('otp.expired');
          break;
        case 'too_many_attempts':
          message = t('lockout.body');
          break;
        case 'not_authorized':
          // Never reveal whether the email exists
          message = t('error.expired');
          break;
        default:
          message = t('error.unknown');
      }
    } else if (err instanceof ApiError) {
      if (err.code === 'network' || err.status === 0) {
        message = t('error.network');
      } else {
        message = t('error.unknown');
      }
    } else {
      message = t('error.unknown');
    }
    setErrorMessage(message);
    AccessibilityInfo.announceForAccessibility(message);
  }

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleEmailSubmit = useCallback(async () => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) return;

    setLoading(true);
    setErrorMessage(null);

    try {
      if (auth.isSampleMode) {
        auth.sampleSignIn();
        return;
      }

      const result = await auth.discover(trimmed);

      switch (result.method) {
        case 'email_otp': {
          await auth.signInWithEmailOtp.start(trimmed);
          setStep('otp');
          setResendCountdown(OTP_RESEND_COOLDOWN_SECONDS);
          break;
        }
        case 'sso': {
          if (result.connection) {
            setSsoConnection(result.connection);
            setStep('sso_pending');
          }
          break;
        }
        case 'password': {
          setStep('password_web');
          break;
        }
      }
    } catch (err) {
      displayError(err);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, auth.isSampleMode]);

  const handleOtpSubmit = useCallback(async () => {
    const trimmed = otpCode.trim();
    if (trimmed.length < OTP_CODE_MIN_LENGTH) return;

    setLoading(true);
    setErrorMessage(null);

    try {
      await auth.signInWithEmailOtp.verify(trimmed);
    } catch (err) {
      displayError(err);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otpCode]);

  const handleResendOtp = useCallback(async () => {
    if (resendCountdown > 0) return;

    setLoading(true);
    setErrorMessage(null);
    setOtpCode('');

    try {
      await auth.signInWithEmailOtp.start(email.trim().toLowerCase());
      setResendCountdown(OTP_RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      displayError(err);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, resendCountdown]);

  const handleSsoPress = useCallback(async () => {
    if (!sso.promptAsync) return;

    setLoading(true);
    setErrorMessage(null);

    try {
      const tokens = await sso.promptAsync();
      await auth.completeSsoSignIn(tokens);
    } catch (err) {
      displayError(err);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sso.promptAsync]);

  const handleSampleSignIn = useCallback(() => {
    auth.sampleSignIn();
  }, [auth]);

  const handleBackToEmail = useCallback(() => {
    setStep('email');
    setOtpCode('');
    setErrorMessage(null);
    setSsoConnection(null);
  }, []);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: 'center',
            paddingBottom: space[32],
            gap: space[24],
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <SampleDataBanner />

          <Text role="screenTitle">{t('signIn.title')}</Text>

          {/* Error banner */}
          {errorMessage ? (
            <Alert
              tone="danger"
              message={errorMessage}
              accessibilityLiveRegion="assertive"
            />
          ) : null}

          {/* Email step */}
          {step === 'email' ? (
            <View style={{ gap: space[16] }}>
              <Field label={t('signIn.emailLabel')}>
                <Input
                  value={email}
                  onChangeText={setEmail}
                  placeholder={t('signIn.emailPlaceholder')}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  textContentType="emailAddress"
                  returnKeyType="go"
                  onSubmitEditing={() => void handleEmailSubmit()}
                  editable={!loading}
                  label={t('signIn.emailLabel')}
                />
              </Field>
              <Button
                variant="primary"
                onPress={() => void handleEmailSubmit()}
                disabled={loading || !email.trim()}
                label={loading ? t('a11y.loading') : t('signIn.submit')}
                loading={loading}
              />

              {auth.isSampleMode ? (
                <Button
                  variant="secondary"
                  onPress={handleSampleSignIn}
                  label={t('mobile.sampleSignIn')}
                />
              ) : null}
            </View>
          ) : null}

          {/* OTP step */}
          {step === 'otp' ? (
            <View style={{ gap: space[16] }}>
              <Card>
                <Text role="body" tone="secondary">
                  {t('otp.instructions', { email: email.trim().toLowerCase() })}
                </Text>
              </Card>

              <Field label={t('otp.codeLabel')}>
                <Input
                  value={otpCode}
                  onChangeText={(text: string) =>
                    setOtpCode(text.replace(/\D/g, '').slice(0, OTP_CODE_LENGTH))
                  }
                  placeholder="000000"
                  inputMode="numeric"
                  textContentType="oneTimeCode"
                  autoComplete="one-time-code"
                  autoFocus
                  maxLength={OTP_CODE_LENGTH}
                  returnKeyType="go"
                  onSubmitEditing={() => void handleOtpSubmit()}
                  editable={!loading}
                  label={t('a11y.otpInput')}
                />
              </Field>

              <Button
                variant="primary"
                onPress={() => void handleOtpSubmit()}
                disabled={loading || otpCode.length < OTP_CODE_MIN_LENGTH}
                label={loading ? t('a11y.loading') : t('otp.submit')}
                loading={loading}
              />

              <Button
                variant="ghost"
                onPress={() => void handleResendOtp()}
                disabled={loading || resendCountdown > 0}
                label={
                  resendCountdown > 0
                    ? t('otp.resendCountdown', { seconds: resendCountdown })
                    : t('otp.resend')
                }
              />

              <Button variant="ghost" onPress={handleBackToEmail} label={t('mobile.backToEmail')} />
            </View>
          ) : null}

          {/* SSO pending */}
          {step === 'sso_pending' ? (
            <View style={{ gap: space[16] }}>
              <Card>
                <Text role="body" tone="secondary">
                  {t('signIn.ssoRedirect')}
                </Text>
              </Card>

              <Button
                variant="primary"
                onPress={() => void handleSsoPress()}
                disabled={loading || !sso.isReady}
                label={loading ? t('a11y.loading') : t('mobile.ssoButton')}
                loading={loading}
              />

              <Button variant="ghost" onPress={handleBackToEmail} label={t('mobile.backToEmail')} />
            </View>
          ) : null}

          {/* Password (web only) */}
          {step === 'password_web' ? (
            <View style={{ gap: space[16] }}>
              <Card>
                <Text role="body" tone="secondary">
                  {t('mobile.passwordWebOnly')}
                </Text>
              </Card>

              <Button variant="ghost" onPress={handleBackToEmail} label={t('mobile.backToEmail')} />
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Try to get CognitoConfig; return null if env vars are missing. */
function getCognitoConfigSafe(): CognitoConfig | null {
  try {
    return getCognitoConfig();
  } catch {
    return null;
  }
}
