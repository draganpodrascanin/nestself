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
  StepUpStartResponseSchema,
  InvitationPreviewResponseSchema,
  InvitationAcceptResponseSchema,
  PasswordResetStartResponseSchema,
  PasswordResetConfirmResponseSchema,
} from '@nestself/contracts';
import type { ActiveContext, Locale } from '@nestself/contracts';
import type { ApiClient } from './client';
import { z } from 'zod';

function jsonPost(body: unknown): RequestInit {
  return {
    method: 'POST',
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
     * POST /auth/totp/enrol — start TOTP enrolment (returns secretUri).
     * During sign-in pass the `totp_enrol` challengeToken; the response carries
     * a fresh challengeToken to use with `challenge()` and the authenticator code.
     */
    totpEnrol: (challengeToken?: string) =>
      client.request('/api/auth/totp/enrol', {
        ...jsonPost(challengeToken ? { challengeToken } : {}),
        schema: TotpEnrolResponseSchema,
      }),

    /** POST /auth/totp/confirm — confirm TOTP enrolment with a code (204). */
    totpConfirm: (code: string) =>
      client.request('/api/auth/totp/confirm', {
        ...jsonPost({ code }),
        schema: z.undefined(),
        expectBody: false,
      }),

    /** POST /auth/step-up/start — initiate a step-up challenge. */
    stepUpStart: () =>
      client.request('/api/auth/step-up/start', {
        method: 'POST',
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

    /** POST /invitations/accept — accept an invitation. */
    invitationAccept: (token: string) =>
      client.request('/api/invitations/accept', {
        ...jsonPost({ token }),
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
