/**
 * PostgreSQL enum types. Names are snake_case; values are UPPER_CASE to match
 * the contracts package and the sample fixtures.
 */
import { pgEnum } from 'drizzle-orm/pg-core';

// ─── Identity, organization, authorization (phase 0) ─────────────────────

/** Org-unit node type [D-16]. */
export const orgUnitKind = pgEnum('org_unit_kind', ['COMPANY', 'DEPARTMENT', 'TEAM']);

/** Membership lifecycle state [D-03]. */
export const membershipStatus = pgEnum('membership_status', ['INVITED', 'ACTIVE', 'ENDED']);

/** SSO identity-provider protocol [D-12]. */
export const ssoProtocol = pgEnum('sso_protocol', ['SAML', 'OIDC']);

/** SSO connection lifecycle state [D-12]. */
export const ssoConnectionStatus = pgEnum('sso_connection_status', [
  'DRAFT',
  'TESTING',
  'ACTIVE',
  'SUSPENDED',
]);

/** Assignment target type [D-15, D-19]. ACTIVITY: facilitator or supplier (EVT-05). */
export const assignmentKind = pgEnum('assignment_kind', [
  'CASE',
  'QUEUE',
  'CLIENT',
  'PRACTICE_GROUP',
  'COLLECTION',
  'SUPPORT_CASE',
  'SUPERVISION',
  'ACTIVITY',
]);

/** Audit-event category; determines the retention tier [D-21]. */
export const auditCategory = pgEnum('audit_category', [
  'SECURITY',
  'AUTHORIZATION',
  'FINANCIAL',
  'CONTENT_ACCESS',
  'ADMIN',
]);

/** Audit-event authorization outcome [D-21]. */
export const auditResult = pgEnum('audit_result', ['ALLOWED', 'DENIED', 'NONE']);

/** Audit-event actor type [D-21]. */
export const actorKind = pgEnum('actor_kind', ['USER', 'SYSTEM', 'JOB']);

/** Emergency-access scope type [D-20]. */
export const emergencyScopeKind = pgEnum('emergency_scope_kind', ['CASE', 'USER_RECORDS']);

/** Expert-credential review lifecycle [LEAD-01]. */
export const expertCredentialStatus = pgEnum('expert_credential_status', [
  'PENDING_REVIEW',
  'APPROVED',
  'EXPIRED',
  'REVOKED',
]);

// ─── Retained enums ──────────────────────────────────────────────────────

export const supportArea = pgEnum('support_area', ['PSYCHOLOGICAL', 'LEGAL', 'FINANCIAL']);
export const channelScope = pgEnum('channel_scope', ['ORGANIZATION', 'TEAM']);
export const contentKind = pgEnum('content_kind', ['ARTICLE', 'FAQ', 'VIDEO']);
export const leadKind = pgEnum('lead_kind', ['DEMO_REQUEST', 'CONTACT', 'WEBINAR_REGISTRATION']);
export const eventRequestStatus = pgEnum('event_request_status', [
  'REQUESTED',
  'OFFERS_READY',
  'SELECTED',
  'CLOSED',
]);

// ─── Consultations and webinars (NS-CALLS-01) ────────────────────────────

/**
 * Appointment lifecycle [D-CW-02, D-CW-37]. The contract spellings are lower
 * case (`proposed`, `confirmed`); the appointments repository maps them
 * (CW-R-19a).
 */
export const appointmentStatus = pgEnum('appointment_status', [
  'PROPOSED',
  'AWAITING_APPROVAL',
  'CONFIRMED',
  'COMPLETED',
  'CANCELED',
  'DECLINED',
  'NO_SHOW',
]);

/** Follow-up approval item lifecycle [D-CW-37]; the table arrives with the approval flow. */
export const appointmentApprovalStatus = pgEnum('appointment_approval_status', [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'EXPIRED',
]);

/** Call session lifecycle [D-CW-07, guidelines 4.9]: PENDING -> CREATING -> ACTIVE -> ENDED, or CREATING -> FAILED. */
export const callSessionStatus = pgEnum('call_session_status', [
  'PENDING',
  'CREATING',
  'ACTIVE',
  'ENDED',
  'FAILED',
]);

/**
 * What closed an ENDED call session [D-CW-09, T-CW-1.2]: the expert's "end for
 * everyone", the provider's own `MeetingEnded` (Chime ends an empty meeting,
 * OPS-03), or the `calls.cleanup` and `calls.reconcile` jobs. Only a
 * `PROVIDER` end leaves the appointment free for a new session inside the
 * join window (`call_sessions_appointment_id_live_idx`).
 */
export const callSessionEndReason = pgEnum('call_session_end_reason', ['EXPERT', 'PROVIDER', 'CLEANUP', 'RECONCILE']);

/** Role of a participant in a call session [D-CW-10]. */
export const callParticipantRole = pgEnum('call_participant_role', [
  'EXPERT',
  'EMPLOYEE',
  'PRESENTER',
  'MODERATOR',
  'ATTENDEE',
  'FACILITATOR',
  'PARTICIPANT',
]);

/** Format of a real-time session; selects the meeting features [D-CW-10]. */
export const callFormat = pgEnum('call_format', ['CONSULTATION', 'WEBINAR', 'WORKSHOP']);

/** Delivery outcome the expert records; no free text exists beside it [D-CW-25, CW-R-21]. */
export const callOutcomeStatus = pgEnum('call_outcome_status', [
  'COMPLETED',
  'NO_SHOW_EMPLOYEE',
  'NO_SHOW_EXPERT',
  'TECHNICAL_FAILURE',
  'CANCELED',
]);

/** Webinar recording pipeline [D-CW-18]; the `webinar_recordings` table arrives with T-CW-2.5. */
export const recordingStatus = pgEnum('recording_status', [
  'SCHEDULED',
  'RECORDING',
  'PROCESSING',
  'READY',
  'HANDED_OFF',
  'FAILED',
]);

/** Consent kinds of `call_consents`, schema only in this epic [D-CW-19, CW-R-79b]. */
export const callConsentType = pgEnum('call_consent_type', ['RECORDING', 'TRANSCRIPTION']);
