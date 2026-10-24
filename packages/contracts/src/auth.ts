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
  z.object({ kind: z.literal('personal') }),
  z.object({ kind: z.literal('organization'), orgId: z.string().min(1) }),
  z.object({ kind: z.literal('expert') }),
  z.object({ kind: z.literal('operations') }),
]);
export type ActiveContext = z.infer<typeof ActiveContextSchema>;

export const PrincipalMembershipSchema = z.object({
  membershipId: z.string().min(1),
  orgId: z.string().min(1),
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

export const MeResponseSchema = z.object({
  principal: PrincipalSchema,
  effectiveActions: z.array(z.string()),
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

export const ProfileDisplayNameRequestSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
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
  'owner_exists',
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
