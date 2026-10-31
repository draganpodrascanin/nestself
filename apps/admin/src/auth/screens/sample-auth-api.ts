/**
 * Fake AuthApi for sample/dev mode.
 *
 * Walks the real sign-in screens instead of skipping straight to the
 * authenticated state:
 *
 * - Most emails -> email_otp flow. Any 6-digit code succeeds; 000000 always
 *   works; 111111 triggers the invalid-code error so that state is reviewable.
 * - user_milica@example.com / user_nikola@example.com -> password -> totp.
 * - Unknown addresses behave like employees (email_otp).
 * - There is no federated sign-in with sample data, so no sign-in is ever
 *   waiting for an email code: the confirm-email step says the link expired.
 */
import { ApiError } from '@nestself/api-client';
import type { AuthApi } from '@nestself/api-client';

const PASSWORD_EMAILS = ['user_milica@example.com', 'user_nikola@example.com'];
const FAKE_TOKEN = 'sample-challenge-token';

type Resolved<K extends keyof AuthApi> = Awaited<ReturnType<AuthApi[K]>>;

const SAMPLE_STEP_UP: Resolved<'stepUpStart'> = {
  method: 'email_otp',
  challengeToken: FAKE_TOKEN,
  ssoStartUrl: null,
  emailMasked: null,
};

/** What the API answers for a handle it does not know. */
async function noPendingSignIn(): Promise<never> {
  throw new ApiError({
    status: 400,
    code: 'invalid_challenge',
    message: 'Challenge expired or invalid',
    requestId: null,
  });
}

export function createSampleAuthApi(): AuthApi {
  return {
    discover: async (email: string) => {
      if (PASSWORD_EMAILS.some((e) => e.toLowerCase() === email.toLowerCase())) {
        return { method: 'password' as const, ssoStartUrl: null, connection: null };
      }
      return { method: 'email_otp' as const, ssoStartUrl: null, connection: null };
    },

    emailOtpStart: async () => ({
      challengeToken: FAKE_TOKEN,
      codeDeliveryMedium: 'EMAIL' as const,
    }),

    emailOtpVerify: async (_token: string, code: string) => {
      if (code === '111111') {
        throw new ApiError({
          status: 400,
          code: 'invalid_code',
          message: 'The code you entered is not valid.',
          requestId: null,
        });
      }
      // Any other 6-digit code succeeds
      return {} as Resolved<'emailOtpVerify'>;
    },

    ssoBindStart: noPendingSignIn,
    ssoBindVerify: noPendingSignIn,
    ssoBindResend: noPendingSignIn,

    password: async () =>
      // Password users always proceed to TOTP challenge
      ({ step: 'totp', challengeToken: FAKE_TOKEN }) as unknown as Resolved<'password'>,

    challenge: async () => ({}) as unknown as Resolved<'challenge'>,

    me: async () =>
      ({
        principal: { context: { kind: 'personal' }, staffTemplates: [] },
      }) as unknown as Resolved<'me'>,

    switchContext: async () => ({}) as unknown as Resolved<'switchContext'>,
    signOut: async () => undefined as unknown as Resolved<'signOut'>,
    signOutAll: async () => undefined as unknown as Resolved<'signOutAll'>,
    listSessions: async () => [] as unknown as Resolved<'listSessions'>,
    revokeSession: async () => undefined as unknown as Resolved<'revokeSession'>,

    totpEnrol: async () =>
      ({
        secretUri:
          'otpauth://totp/NestSelf:sample@example.com?secret=JBSWY3DPEHPK3PXP&issuer=NestSelf',
      }) as unknown as Resolved<'totpEnrol'>,

    totpConfirm: async () => ({ enrolled: true as const }),

    // Account settings in sample mode: nothing is stored.
    totpEnrolSignedIn: async () => ({
      secretUri: 'otpauth://totp/NestSelf:sample@example.com?secret=JBSWY3DPEHPK3PXP&issuer=NestSelf',
      challengeToken: null,
    }),
    updateLocale: async () => ({}) as unknown as Resolved<'updateLocale'>,
    updateDisplayName: async () => ({}) as unknown as Resolved<'updateDisplayName'>,

    // No address is shown in sample mode: emailMasked null keeps the general description.
    stepUpStart: async () => SAMPLE_STEP_UP,
    stepUpResend: async () => SAMPLE_STEP_UP,
    stepUpVerify: async () => undefined as unknown as Resolved<'stepUpVerify'>,

    invitationPreview: async () => ({}) as unknown as Resolved<'invitationPreview'>,
    invitationAccept: async () => ({}) as unknown as Resolved<'invitationAccept'>,

    passwordResetStart: async () => ({}) as unknown as Resolved<'passwordResetStart'>,
    passwordResetConfirm: async () => ({}) as unknown as Resolved<'passwordResetConfirm'>,
  };
}
