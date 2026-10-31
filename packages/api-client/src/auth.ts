/**
 * Typed wrappers for the authentication API endpoints.
 *
 * Each function parses the response through the matching contracts schema
 * so callers get validated, typed data. The `createAuthApi` factory takes
 * an `ApiClient` and returns a single object with one method per endpoint.
 *
 * @see Sections 5.1, 5.2 of auth-strategy.md
 */
import {
  DiscoverResponseSchema,
  EmailOtpStartResponseSchema,
  MeResponseSchema,
  PasswordResponseSchema,
  SessionListResponseSchema,
  TotpEnrolResponseSchema,
  TotpConfirmResponseSchema,
  StepUpStartResponseSchema,
  InvitationPreviewResponseSchema,
  InvitationAcceptResponseSchema,
  PasswordResetStartResponseSchema,
  PasswordResetConfirmResponseSchema,
  SsoBindStartResponseSchema,
  SsoBindVerifyResponseSchema,
  SsoBindResendResponseSchema,
} from '@nestself/contracts';
import type { ActiveContext, Locale } from '@nestself/contracts';
import type { ApiClient } from './client';
import { z } from 'zod';

function jsonPost(body: unknown): RequestInit {
  return jsonSend('POST', body);
}

function jsonSend(method: 'POST' | 'PATCH', body: unknown): RequestInit {
  return {
    method,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  };
}

export function createAuthApi(client: ApiClient) {
  return {
    /** POST /auth/discover — identifier-first method resolution. */
    discover: (email: string) =>
      client.request('/api/auth/discover', {
        ...jsonPost({ email }),
        schema: DiscoverResponseSchema,
      }),

    /**
     * POST /auth/email-otp/start — request an email OTP code, written in
     * `locale` when given.
     */
    emailOtpStart: (email: string, locale?: Locale) =>
      client.request('/api/auth/email-otp/start', {
        ...jsonPost({ email, locale }),
        schema: EmailOtpStartResponseSchema,
      }),

    /** POST /auth/email-otp/verify — verify an email OTP code. */
    emailOtpVerify: (challengeToken: string, code: string) =>
      client.request('/api/auth/email-otp/verify', {
        ...jsonPost({ challengeToken, code }),
        schema: MeResponseSchema,
      }),

    /**
     * POST /auth/sso/bind/start — a federated sign-in whose address the
     * identity provider did not confirm (`/sign-in?bind=<handle>`): mails a
     * code to that address, written in `locale` when given. 400
     * `invalid_challenge` when the handle is unknown or has expired.
     */
    ssoBindStart: (handle: string, locale?: Locale) =>
      client.request('/api/auth/sso/bind/start', {
        ...jsonPost({ handle, locale }),
        schema: SsoBindStartResponseSchema,
      }),

    /**
     * POST /auth/sso/bind/verify — confirms the code: binds the identity,
     * sets the session cookies and answers where to continue. 403
     * `sso_denied` when the organisation does not take the sign-in.
     */
    ssoBindVerify: (challengeToken: string, code: string) =>
      client.request('/api/auth/sso/bind/verify', {
        ...jsonPost({ challengeToken, code }),
        schema: SsoBindVerifyResponseSchema,
      }),

    /**
     * POST /auth/sso/bind/resend — a new code for the same challenge, at most
     * one a minute (429 `rate_limited` with `details.retryAfter`).
     */
    ssoBindResend: (challengeToken: string, locale?: Locale) =>
      client.request('/api/auth/sso/bind/resend', {
        ...jsonPost({ challengeToken, locale }),
        schema: SsoBindResendResponseSchema,
      }),

    /**
     * POST /auth/sso/bind-token — the mobile app's federated sign-in: the ID
     * token of its own hosted-UI exchange, once, before anything else; the API
     * binds the identity under the web's rules (204). 403 `sso_denied` when
     * the organisation does not take the sign-in, 403 `sso_email_unverified`
     * when the address has to be confirmed on the web first.
     */
    ssoBindToken: (idToken: string) =>
      client.request('/api/auth/sso/bind-token', {
        ...jsonPost({ idToken }),
        schema: z.undefined(),
        expectBody: false,
      }),

    /** POST /auth/password — password sign-in (may require a second step). */
    password: (email: string, password: string) =>
      client.request('/api/auth/password', {
        ...jsonPost({ email, password }),
        schema: PasswordResponseSchema,
      }),

    /** POST /auth/challenge — complete a TOTP / new-password / TOTP-enrol step. */
    challenge: (challengeToken: string, response: string) =>
      client.request('/api/auth/challenge', {
        ...jsonPost({ challengeToken, response }),
        schema: PasswordResponseSchema,
      }),

    /** GET /auth/me — current principal and effective actions. */
    me: () =>
      client.request('/api/auth/me', {
        method: 'GET',
        schema: MeResponseSchema,
      }),

    /** POST /auth/context — switch active context (CLIENT-R-04). */
    switchContext: (context: ActiveContext) =>
      client.request('/api/auth/context', {
        ...jsonPost({ context }),
        schema: MeResponseSchema,
      }),

    /** POST /auth/sign-out — end the current session (204). */
    signOut: () =>
      client.request('/api/auth/sign-out', {
        method: 'POST',
        schema: z.undefined(),
        expectBody: false,
      }),

    /** POST /auth/sign-out-all — end all sessions for this user (204). */
    signOutAll: () =>
      client.request('/api/auth/sign-out-all', {
        method: 'POST',
        schema: z.undefined(),
        expectBody: false,
      }),

    /** GET /auth/sessions — list active sessions. */
    listSessions: () =>
      client.request('/api/auth/sessions', {
        method: 'GET',
        schema: SessionListResponseSchema,
      }),

    /** DELETE /auth/sessions/:sessionId — revoke a session (204). */
    revokeSession: (sessionId: string) =>
      client.request(`/api/auth/sessions/${sessionId}`, {
        method: 'DELETE',
        schema: z.undefined(),
        expectBody: false,
      }),

    /**
     * POST /auth/totp/enrol — sign-in TOTP enrolment (MFA_SETUP step). Pass the
     * `totp_enrol` challengeToken; the response carries a fresh challengeToken
     * to use with `challenge()` and the authenticator code. Signed-in users
     * call `totpEnrolSignedIn()` instead.
     */
    totpEnrol: (challengeToken: string) =>
      client.request('/api/auth/totp/enrol', {
        ...jsonPost({ challengeToken }),
        schema: TotpEnrolResponseSchema,
      }),

    /**
     * POST /auth/me/totp/enrol — start authenticator enrolment for the
     * signed-in user (session token, no challenge). `challengeToken` is null;
     * finish with `totpConfirm(code)`. 409 `totp_already_enrolled` when the
     * account already has an authenticator.
     */
    totpEnrolSignedIn: () =>
      client.request('/api/auth/me/totp/enrol', {
        ...jsonPost({}),
        schema: TotpEnrolResponseSchema,
      }),

    /** PATCH /auth/me/locale — persist the preferred locale; returns the refreshed principal. */
    updateLocale: (locale: Locale) =>
      client.request('/api/auth/me/locale', {
        ...jsonSend('PATCH', { locale }),
        schema: MeResponseSchema,
      }),

    /** PATCH /auth/me/display-name — change the display name; returns the refreshed principal. */
    updateDisplayName: (displayName: string) =>
      client.request('/api/auth/me/display-name', {
        ...jsonSend('PATCH', { displayName }),
        schema: MeResponseSchema,
      }),

    /** POST /auth/totp/confirm — confirm signed-in enrolment with a code; answers `{ enrolled: true }`. */
    totpConfirm: (code: string) =>
      client.request('/api/auth/totp/confirm', {
        ...jsonPost({ code }),
        schema: TotpConfirmResponseSchema,
      }),

    /** POST /auth/step-up/start — initiate a step-up challenge. */
    stepUpStart: () =>
      client.request('/api/auth/step-up/start', {
        method: 'POST',
        schema: StepUpStartResponseSchema,
      }),

    /**
     * POST /auth/step-up/resend — a new code for the challenge of an earlier
     * start, at most one a minute (429 `rate_limited` with
     * `details.retryAfter`). Continue with the answer's `challengeToken`: it
     * may be a new one.
     */
    stepUpResend: (challengeToken: string) =>
      client.request('/api/auth/step-up/resend', {
        ...jsonPost({ challengeToken }),
        schema: StepUpStartResponseSchema,
      }),

    /** POST /auth/step-up/verify — complete a step-up challenge (204). */
    stepUpVerify: (challengeToken: string, response: string) =>
      client.request('/api/auth/step-up/verify', {
        ...jsonPost({ challengeToken, response }),
        schema: z.undefined(),
        expectBody: false,
      }),

    /** GET /invitations/:token/preview — preview an invitation. */
    invitationPreview: (token: string) =>
      client.request(`/api/invitations/${token}/preview`, {
        method: 'GET',
        schema: InvitationPreviewResponseSchema,
      }),

    /**
     * POST /invitations/accept — accept an invitation. `locale` is the
     * language of the code email the acceptance may send.
     */
    invitationAccept: (token: string, locale?: Locale) =>
      client.request('/api/invitations/accept', {
        ...jsonPost({ token, locale }),
        schema: InvitationAcceptResponseSchema,
      }),

    /** POST /auth/password-reset/start — request a password reset code. */
    passwordResetStart: (email: string) =>
      client.request('/api/auth/password-reset/start', {
        ...jsonPost({ email }),
        schema: PasswordResetStartResponseSchema,
      }),

    /** POST /auth/password-reset/confirm — confirm a password reset. */
    passwordResetConfirm: (email: string, code: string, newPassword: string) =>
      client.request('/api/auth/password-reset/confirm', {
        ...jsonPost({ email, code, newPassword }),
        schema: PasswordResetConfirmResponseSchema,
      }),
  };
}

export type AuthApi = ReturnType<typeof createAuthApi>;
