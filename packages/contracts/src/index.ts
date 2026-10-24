// ---------------------------------------------------------------------------
// Legacy exports (kept for phase 2 migration, D-36)
// ---------------------------------------------------------------------------

export {
  /** @deprecated Use template-based grants instead. */
  orgRoles,
  /** @deprecated Use template-based grants instead. */
  OrgRoleSchema,
  /** @deprecated Use template-based grants instead. */
  platformRoles,
  /** @deprecated Use template-based grants instead. */
  PlatformRoleSchema,
  /** @deprecated Use PrincipalSchema instead. */
  SessionSchema,
  /** @deprecated Use can() from principal.ts instead. */
  canAccessHr,
  /** @deprecated Use can() from principal.ts instead. */
  canManageTeam,
} from './roles.ts';
export type { OrgRole, PlatformRole, Session } from './roles.ts';

/** @deprecated Alias for SessionSchema during migration. */
export { SessionSchema as LegacySessionSchema } from './roles.ts';

export { locales, LocaleSchema, defaultLocale } from './locale.ts';
export type { Locale } from './locale.ts';

export { supportAreas, SupportAreaSchema, supportAreaIcon } from './support.ts';
export type { SupportArea } from './support.ts';

export { HealthResponseSchema } from './health.ts';
export type { HealthResponse } from './health.ts';

/** @deprecated Use the authorization types in authorization.ts instead. */
export { accessModel } from './access-model.ts';

export {
  CompanySizeSchema,
  HeardAboutSchema,
  CountrySchema,
  DemoRequestSchema,
  ContactMessageSchema,
  WebinarRegistrationSchema,
  LeadSchema,
  LeadAcceptedSchema,
} from './leads.ts';
export type {
  DemoRequest,
  ContactMessage,
  WebinarRegistration,
  Lead,
  LeadAccepted,
} from './leads.ts';

// ---------------------------------------------------------------------------
// Actions (4.3)
// ---------------------------------------------------------------------------

export { ACTIONS, ACTION_LIST, isAction, CONFIDENTIAL_ACTIONS, APPROVAL_ACTIONS } from './actions.ts';
export type { Action } from './actions.ts';

// ---------------------------------------------------------------------------
// Templates (4.4)
// ---------------------------------------------------------------------------

export { TEMPLATE_KEYS, PERMISSION_TEMPLATES } from './templates.ts';
export type { TemplateKey, PermissionTemplateDefinition } from './templates.ts';

// ---------------------------------------------------------------------------
// Authorization types (4.5, 5.8.2)
// ---------------------------------------------------------------------------

export {
  WorkspaceSchema,
  PopulationSchema,
  ScopeTypeSchema,
  GrantConditionSchema,
  AssignmentKindSchema,
  DecisionSchema,
  STEP_UP_MAX_AGE_SECONDS,
  STEP_UP_CLASS_BY_ACTION,
} from './authorization.ts';
export type {
  Workspace,
  Population,
  ScopeType,
  GrantCondition,
  AssignmentKind,
  Resource,
  Decision,
  DelegationEnvelope,
  EffectiveAccessEntry,
  GrantInput,
  AssignmentInput,
  EmergencyAccessInput,
  AuthorizationContext,
  AuthorizationRequest,
  StepUpClass,
} from './authorization.ts';

// ---------------------------------------------------------------------------
// Auth schemas (5.1, 5.2, 5.9)
// ---------------------------------------------------------------------------

export {
  DiscoverRequestSchema,
  DiscoverResponseSchema,
  EmailOtpStartRequestSchema,
  EmailOtpStartResponseSchema,
  EmailOtpVerifyRequestSchema,
  PasswordRequestSchema,
  ChallengeRequiredResponseSchema,
  ChallengeRequestSchema,
  InvitationPreviewResponseSchema,
  InvitationAcceptRequestSchema,
  InvitationAcceptResponseSchema,
  PasswordResetStartRequestSchema,
  PasswordResetStartResponseSchema,
  PasswordResetConfirmRequestSchema,
  PasswordResetConfirmResponseSchema,
  ActiveContextSchema,
  PrincipalMembershipSchema,
  AuthInfoSchema,
  PrincipalSchema,
  AvailableContextEntrySchema,
  MeResponseSchema,
  EmailOtpVerifyResponseSchema,
  ChallengeResponseSchema,
  ContextSwitchResponseSchema,
  PasswordResponseSchema,
  ContextSwitchRequestSchema,
  StepUpStartResponseSchema,
  StepUpVerifyRequestSchema,
  SessionListItemSchema,
  SessionListResponseSchema,
  WsTicketResponseSchema,
  TotpEnrolResponseSchema,
  TotpConfirmRequestSchema,
  TotpEnrolRequestSchema,
  ProfileLocaleRequestSchema,
  ProfileDisplayNameRequestSchema,
  ApiErrorResponseSchema,
  StepUpRequiredErrorSchema,
  AUTH_ERROR_CODES,
  EMAIL_OTP_MIN_LENGTH,
  EMAIL_OTP_MAX_LENGTH,
} from './auth.ts';
export type {
  DiscoverRequest,
  DiscoverResponse,
  EmailOtpStartRequest,
  EmailOtpStartResponse,
  EmailOtpVerifyRequest,
  PasswordRequest,
  ChallengeRequiredResponse,
  ChallengeRequest,
  InvitationPreviewResponse,
  InvitationAcceptRequest,
  InvitationAcceptResponse,
  PasswordResetStartRequest,
  PasswordResetStartResponse,
  PasswordResetConfirmRequest,
  PasswordResetConfirmResponse,
  ActiveContext,
  PrincipalMembership,
  AuthInfo,
  Principal,
  AvailableContextEntry,
  MeResponse,
  PasswordResponse,
  ContextSwitchRequest,
  StepUpStartResponse,
  StepUpVerifyRequest,
  SessionListItem,
  SessionListResponse,
  WsTicketResponse,
  TotpEnrolResponse,
  TotpConfirmRequest,
  TotpEnrolRequest,
  ProfileLocaleRequest,
  ProfileDisplayNameRequest,
  ApiErrorResponse,
  StepUpRequiredError,
  AuthErrorCode,
} from './auth.ts';

// ---------------------------------------------------------------------------
// Principal helpers (5.8.1)
// ---------------------------------------------------------------------------

export { can } from './principal.ts';

// ---------------------------------------------------------------------------
// Organization administration and operations schemas (5.3, 5.4)
// ---------------------------------------------------------------------------

export * from './org-admin.ts';
