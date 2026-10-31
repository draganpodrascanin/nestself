/**
 * Authentication request/response schemas and error codes.
 *
 * @see Sections 5.1, 5.2, 5.9 of auth-strategy.md
 */
import { z } from 'zod';
import { LocaleSchema } from './locale.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const emailField = z.string().trim().toLowerCase().email();

/**
 * Cognito's EMAIL_OTP challenge (the USER_AUTH flow) delivers an EIGHT digit
 * code, unlike the six digit codes it uses for sign-up confirmation, forgot
 * password and authenticator apps. The stub identity provider still issues six
 * (`FAKE_IDP_FIXED_OTP`), so the email code accepts the whole range and lets
 * the provider decide. Hard-coding six here truncated the real code in the
 * input and produced a CodeMismatchException that read as a broken endpoint.
 */
export const EMAIL_OTP_MIN_LENGTH = 6;
export const EMAIL_OTP_MAX_LENGTH = 8;

// ---------------------------------------------------------------------------
// Sign-in schemas (5.1)
// ---------------------------------------------------------------------------

export const DiscoverRequestSchema = z.object({
  email: emailField,
});
export type DiscoverRequest = z.infer<typeof DiscoverRequestSchema>;

export const DiscoverResponseSchema = z.object({
  method: z.enum(['email_otp', 'password', 'sso']),
  ssoStartUrl: z.string().url().nullable(),
  connection: z.string().nullable(),
});
export type DiscoverResponse = z.infer<typeof DiscoverResponseSchema>;

// ---------------------------------------------------------------------------
// Enterprise SSO redirect (API-R-06, API-R-07)
// ---------------------------------------------------------------------------

/**
 * API-R-06: a return path is relative. It starts with a single `/`, contains
 * no `//` (protocol-relative or authority), no backslash (browsers read `/\`
 * as `//`) and no control characters.
 */
export function isRelativeReturnPath(value: string): boolean {
  if (!value.startsWith('/')) return false;
  if (value.includes('//') || value.includes('\\')) return false;
  // eslint-disable-next-line no-control-regex -- rejecting control characters is the point
  return !/[\u0000-\u001f\u007f]/.test(value);
}

export const SsoReturnPathSchema = z
  .string()
  .max(2048)
  .refine(isRelativeReturnPath, 'returnPath must be a relative path');

/** `GET /auth/sso/start` query. `connection` is the connection's `cognitoProviderName`. */
export const SsoStartQuerySchema = z.object({
  connection: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/),
  surface: z.enum(['workspace', 'admin']),
  returnPath: SsoReturnPathSchema.optional(),
  /**
   * Staff test sign-in of a TESTING connection: the single-use nonce
   * `POST /ops/sso-connections/:id/test` put into its `startUrl`.
   */
  test: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/).optional(),
});
export type SsoStartQuery = z.infer<typeof SsoStartQuerySchema>;

/** `GET /auth/sso/callback` query as Cognito sends it (`error` instead of `code` on failure). */
export const SsoCallbackQuerySchema = z.object({
  code: z.string().min(1).max(2048).optional(),
  state: z.string().min(1).max(256).optional(),
  error: z.string().max(256).optional(),
});
export type SsoCallbackQuery = z.infer<typeof SsoCallbackQuerySchema>;

/** `?reason=` values the SSO callback puts on the surface's `/sign-in` URL. */
export const SSO_SIGN_IN_REASONS = ['sso_denied', 'sso_email_unverified'] as const;
export type SsoSignInReason = (typeof SSO_SIGN_IN_REASONS)[number];

export const EmailOtpStartRequestSchema = z.object({
  email: emailField,
  /** Language of the code email (Cognito CustomMessage trigger). Pool default when absent. */
  locale: LocaleSchema.optional(),
});
export type EmailOtpStartRequest = z.infer<typeof EmailOtpStartRequestSchema>;

export const EmailOtpStartResponseSchema = z.object({
  challengeToken: z.string().min(1),
  codeDeliveryMedium: z.literal('EMAIL'),
});
export type EmailOtpStartResponse = z.infer<typeof EmailOtpStartResponseSchema>;

export const EmailOtpVerifyRequestSchema = z.object({
  challengeToken: z.string().min(1),
  code: z.string().min(EMAIL_OTP_MIN_LENGTH).max(EMAIL_OTP_MAX_LENGTH),
});
export type EmailOtpVerifyRequest = z.infer<typeof EmailOtpVerifyRequestSchema>;

export const PasswordRequestSchema = z.object({
  email: emailField,
  password: z.string().min(1),
});
export type PasswordRequest = z.infer<typeof PasswordRequestSchema>;

export const ChallengeRequiredResponseSchema = z.object({
  step: z.enum(['totp', 'new_password', 'totp_enrol']),
  challengeToken: z.string().min(1),
});
export type ChallengeRequiredResponse = z.infer<typeof ChallengeRequiredResponseSchema>;

export const ChallengeRequestSchema = z.object({
  challengeToken: z.string().min(1),
  response: z.string().min(1),
});
export type ChallengeRequest = z.infer<typeof ChallengeRequestSchema>;

export const InvitationPreviewResponseSchema = z.object({
  organizationName: z.string().min(1),
});
export type InvitationPreviewResponse = z.infer<typeof InvitationPreviewResponseSchema>;

export const InvitationAcceptRequestSchema = z.object({
  token: z.string().min(1),
});
export type InvitationAcceptRequest = z.infer<typeof InvitationAcceptRequestSchema>;

export const InvitationAcceptResponseSchema = z.object({
  method: z.enum(['email_otp', 'sso', 'password']),
  challengeToken: z.string().nullable(),
  ssoStartUrl: z.string().url().nullable(),
  step: z.enum(['new_password', 'totp_enrol']).nullable(),
});
export type InvitationAcceptResponse = z.infer<typeof InvitationAcceptResponseSchema>;

export const PasswordResetStartRequestSchema = z.object({
  email: emailField,
});
export type PasswordResetStartRequest = z.infer<typeof PasswordResetStartRequestSchema>;

export const PasswordResetStartResponseSchema = z.object({
  codeDeliveryMedium: z.literal('EMAIL'),
});
export type PasswordResetStartResponse = z.infer<typeof PasswordResetStartResponseSchema>;

export const PasswordResetConfirmRequestSchema = z.object({
  email: emailField,
  code: z.string().min(6).max(6),
  newPassword: z.string().min(8),
});
export type PasswordResetConfirmRequest = z.infer<typeof PasswordResetConfirmRequestSchema>;

export const PasswordResetConfirmResponseSchema = z.object({
  reset: z.literal(true),
});
export type PasswordResetConfirmResponse = z.infer<typeof PasswordResetConfirmResponseSchema>;

// ---------------------------------------------------------------------------
// Principal and session schemas (5.2)
// ---------------------------------------------------------------------------

export const ActiveContextSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('personal'), orgId: z.string().min(1).optional() }),
  z.object({ kind: z.literal('organization'), orgId: z.string().min(1) }),
  z.object({ kind: z.literal('expert') }),
  z.object({ kind: z.literal('operations') }),
]);
export type ActiveContext = z.infer<typeof ActiveContextSchema>;

export const PrincipalMembershipSchema = z.object({
  membershipId: z.string().min(1),
  orgId: z.string().min(1),
  /** Display name of the organization, for the context picker. */
  orgName: z.string().min(1),
  orgUnitId: z.string().min(1).nullable(),
  status: z.enum(['INVITED', 'ACTIVE']),
  startDate: z.string().datetime(),
  endDate: z.string().datetime().nullable(),
});
export type PrincipalMembership = z.infer<typeof PrincipalMembershipSchema>;

export const AuthInfoSchema = z.object({
  method: z.enum(['email_otp', 'password_totp', 'sso', 'passkey']),
  time: z.string().datetime(),
  secondFactor: z.boolean(),
  lastStepUpAt: z.string().datetime().nullable(),
});
export type AuthInfo = z.infer<typeof AuthInfoSchema>;

export const PrincipalSchema = z.object({
  userId: z.string().min(1),
  displayName: z.string().min(1),
  initials: z.string().min(1).max(3),
  locale: z.string(),
  memberships: z.array(PrincipalMembershipSchema),
  staffTemplates: z.array(z.string()),
  expert: z
    .object({
      id: z.string().min(1),
      approvedCategories: z.array(z.string()),
    })
    .nullable(),
  context: ActiveContextSchema,
  auth: AuthInfoSchema,
  sessionId: z.string().nullable(),
  tokenFamily: z.string().nullable(),
});
export type Principal = z.infer<typeof PrincipalSchema>;

export const AvailableContextEntrySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('personal'), orgId: z.string().min(1), orgName: z.string().optional() }),
  z.object({ kind: z.literal('organization'), orgId: z.string().min(1), orgName: z.string().optional() }),
  z.object({ kind: z.literal('expert') }),
  z.object({ kind: z.literal('operations') }),
]);
export type AvailableContextEntry = z.infer<typeof AvailableContextEntrySchema>;

export const MeResponseSchema = z.object({
  principal: PrincipalSchema,
  effectiveActions: z.array(z.string()),
  availableContexts: z.array(AvailableContextEntrySchema),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

export const EmailOtpVerifyResponseSchema = MeResponseSchema;
// Defined after PasswordResponseSchema (same union: next step or the principal).
export const ContextSwitchResponseSchema = MeResponseSchema;

export const PasswordResponseSchema = z.union([
  ChallengeRequiredResponseSchema,
  MeResponseSchema,
]);
export type PasswordResponse = z.infer<typeof PasswordResponseSchema>;

/** `POST /auth/challenge`: either a further step or the signed-in principal. */
export const ChallengeResponseSchema = PasswordResponseSchema;
export type ChallengeResponse = z.infer<typeof ChallengeResponseSchema>;

export const ContextSwitchRequestSchema = z.object({
  context: ActiveContextSchema,
});
export type ContextSwitchRequest = z.infer<typeof ContextSwitchRequestSchema>;

export const StepUpStartResponseSchema = z.object({
  method: z.enum(['totp', 'email_otp', 'sso']),
  challengeToken: z.string().min(1),
  ssoStartUrl: z.string().url().nullable(),
});
export type StepUpStartResponse = z.infer<typeof StepUpStartResponseSchema>;

export const StepUpVerifyRequestSchema = z.object({
  challengeToken: z.string().min(1),
  response: z.string().min(1),
});
export type StepUpVerifyRequest = z.infer<typeof StepUpVerifyRequestSchema>;

export const SessionListItemSchema = z.object({
  sessionId: z.string().min(1),
  surface: z.enum(['workspace', 'admin']),
  createdAt: z.string().datetime(),
  lastActivityAt: z.string().datetime(),
  ipHash: z.string(),
  userAgentFamily: z.string(),
  isCurrent: z.boolean(),
});
export type SessionListItem = z.infer<typeof SessionListItemSchema>;

export const SessionListResponseSchema = z.object({
  sessions: z.array(SessionListItemSchema),
});
export type SessionListResponse = z.infer<typeof SessionListResponseSchema>;

export const WsTicketResponseSchema = z.object({
  ticket: z.string().min(1),
});
export type WsTicketResponse = z.infer<typeof WsTicketResponseSchema>;

export const TotpEnrolResponseSchema = z.object({
  secretUri: z.string().min(1),
  challengeToken: z.string().min(1).nullable(),
});
export type TotpEnrolResponse = z.infer<typeof TotpEnrolResponseSchema>;

export const TotpConfirmRequestSchema = z.object({
  code: z.string().min(6).max(6),
});
export type TotpConfirmRequest = z.infer<typeof TotpConfirmRequestSchema>;

/** `POST /auth/totp/confirm` (200). */
export const TotpConfirmResponseSchema = z.object({
  enrolled: z.literal(true),
});
export type TotpConfirmResponse = z.infer<typeof TotpConfirmResponseSchema>;

// --- Profile (PATCH /auth/me/locale, PATCH /auth/me/display-name) ---
export const ProfileLocaleRequestSchema = z.object({
  locale: LocaleSchema,
});
export type ProfileLocaleRequest = z.infer<typeof ProfileLocaleRequestSchema>;

/** Longest display name the profile route accepts (after trimming). */
export const DISPLAY_NAME_MAX_LENGTH = 120;

export const ProfileDisplayNameRequestSchema = z.object({
  displayName: z.string().trim().min(1).max(DISPLAY_NAME_MAX_LENGTH),
});
export type ProfileDisplayNameRequest = z.infer<typeof ProfileDisplayNameRequestSchema>;

// ---------------------------------------------------------------------------
// Error schemas (5.9)
// ---------------------------------------------------------------------------

export const ApiErrorResponseSchema = z.object({
  status: z.number().int(),
  code: z.string().min(1),
  message: z.string(),
  requestId: z.string().nullable(),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;

export const StepUpRequiredErrorSchema = ApiErrorResponseSchema.extend({
  code: z.literal('step_up_required'),
  details: z.object({
    stepUpClass: z.string().min(1),
    maxAge: z.number().int(),
    method: z.enum(['totp', 'email_otp', 'sso']),
  }),
});
export type StepUpRequiredError = z.infer<typeof StepUpRequiredErrorSchema>;

/**
 * Canonical error codes returned by the API.
 * [5.9, orchestrator ruling #6]
 */
export const AUTH_ERROR_CODES = [
  'unauthenticated',
  'invalid_code',
  'invalid_credentials',
  'invalid_challenge',
  'expired_code',
  'too_many_attempts',
  'step_up_required',
  'org_context_expired',
  'invalid_context',
  'totp_already_enrolled',
  'session_required',
  'forbidden',
  'not_found',
  'validation',
  'rate_limited',
  'csrf_rejected',
  'session_expired',
  /** The identity provider failed for a reason the caller did not cause (503). */
  'unavailable',
  'context_mismatch',
  'delegation_exceeds_boundary',
  'conflict',
  'locked',
  'subject_not_member',
  'template_inactive',
  'missing_conditions',
  'self_approval_denied',
  'emergency_not_active',
  'idempotency_conflict',
  'owner_exists',
  /** `POST /ops/users/:userId/suspend` on the caller's own account (409). */
  'cannot_suspend_self',
  /** `POST .../members/:id/end` on the caller's own membership (409). */
  'cannot_end_self',
  /** An SSO connection is not in the status the operation needs, e.g. test without a verified domain (409). */
  'sso_connection_state',
  /** A public email domain (`PUBLIC_EMAIL_DOMAINS`) cannot be bound to an SSO connection (422). */
  'domain_blocklisted',
  /** The `_nestself-verify` DNS TXT record was missing or did not match (422). */
  'domain_unverified',
  /** The IdP did not assert a verified email (SSO-R-08); the user continues with the email code. */
  'sso_email_unverified',
] as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];

/**
 * `POST /auth/totp/enrol` (sign-in MFA_SETUP step): the `totp_enrol`
 * challengeToken is required. Signed-in users enrol through
 * `POST /auth/me/totp/enrol` instead.
 */
export const TotpEnrolRequestSchema = z.object({
  challengeToken: z.string().min(1),
});
export type TotpEnrolRequest = z.infer<typeof TotpEnrolRequestSchema>;
