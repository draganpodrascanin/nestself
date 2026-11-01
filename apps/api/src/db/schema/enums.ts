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

// ─── CMS and employee experience (epic 5) ────────────────────────────────

/** Resource type [C-06]. */
export const contentType = pgEnum('content_type', [
  'article', 'video', 'audio', 'practical', 'qa', 'collection',
]);

/** Resource lifecycle state [C-06]. */
export const contentResourceState = pgEnum('content_resource_state', [
  'active', 'archived',
]);

/** Revision lifecycle state [C-06]. */
export const contentRevisionState = pgEnum('content_revision_state', [
  'draft', 'in_review', 'changes_requested', 'approved', 'superseded',
]);

/** Publication lifecycle state [C-06]. */
export const contentPublicationState = pgEnum('content_publication_state', [
  'scheduled', 'live', 'expired', 'withdrawn',
]);

/** Review policy governing which discipline checks a revision [C-08]. */
export const contentReviewPolicy = pgEnum('content_review_policy', [
  'professional', 'editorial',
]);

/** Professional review discipline [C-08]. */
export const reviewDiscipline = pgEnum('review_discipline', [
  'psychological', 'legal', 'financial', 'health', 'nutrition', 'general',
]);

/** Authored locale for content variants and category labels [C-28]. */
export const contentLocale = pgEnum('content_locale', [
  'sr-Latn', 'sr-Cyrl', 'hu', 'en',
]);

/** Reading-time band derived from `duration_seconds`. */
export const durationBand = pgEnum('duration_band', [
  'under_5', '5_to_15', 'over_15',
]);

/** Audience row kind for publication and poll audiences [C-12]. */
export const contentAudienceKind = pgEnum('content_audience_kind', [
  'all_eligible', 'organization', 'org_unit',
]);

/** Organization content capability [C-11]. */
export const contentCapability = pgEnum('content_capability', [
  'library', 'general_questions', 'event_interest',
]);

/** Home module type for the employee home screen [C-16]. */
export const homeModule = pgEnum('home_module', [
  'greeting_search', 'featured', 'quick_needs', 'under_five_minutes',
  'saved_continue', 'explore_topics', 'collection_of_month',
  'ask_professional', 'shape_topics', 'additional_support',
]);

/** Home editorial pin slot kind [C-16]. */
export const homeSlotKind = pgEnum('home_slot_kind', [
  'featured', 'quick_need', 'collection_of_month',
  'ask_professional', 'shape_topics',
]);

/** Media asset kind [C-14]. */
export const mediaKind = pgEnum('media_kind', [
  'image', 'audio', 'video', 'captions', 'pdf',
]);

/** Media asset processing state [C-14]. */
export const mediaAssetState = pgEnum('media_asset_state', [
  'uploaded', 'quarantined', 'processing', 'ready', 'rejected', 'expired',
]);

/** Malware scan status [C-14]. */
export const mediaScanStatus = pgEnum('media_scan_status', [
  'pending', 'no_threats_found', 'threats_found',
  'unsupported', 'failed', 'not_scanned_local',
]);

/** Media license type. */
export const mediaLicenseKind = pgEnum('media_license_kind', [
  'owned', 'licensed', 'stock', 'generated',
]);

/** How a media asset is used within a revision. */
export const mediaUsageKind = pgEnum('media_usage_kind', [
  'cover', 'inline_image', 'body_media', 'captions', 'attachment',
]);

/** Processed rendition kind. */
export const mediaRenditionKind = pgEnum('media_rendition_kind', [
  'original', 'card_webp', 'card_jpeg', 'detail_webp', 'detail_jpeg',
  'poster_webp', 'audio', 'video', 'captions_vtt', 'pdf',
]);

/** Usefulness feedback value. */
export const feedbackUsefulness = pgEnum('feedback_usefulness', [
  'yes', 'partly', 'no',
]);

/** Predefined feedback reason. */
export const feedbackReason = pgEnum('feedback_reason', [
  'too_general', 'not_relevant', 'hard_to_follow',
  'outdated', 'media_problem', 'other_predefined',
]);

/** Poll purpose. */
export const pollPurpose = pgEnum('poll_purpose', [
  'topic_interest', 'format_preference',
]);

/** Poll instance lifecycle state [C-19]. */
export const pollInstanceState = pgEnum('poll_instance_state', [
  'draft', 'open', 'closed', 'decided',
]);

/** Editorial request kind [C-20]. */
export const editorialRequestKind = pgEnum('editorial_request_kind', [
  'new_topic', 'other_format', 'translation',
  'event_interest', 'content_issue',
]);

/** Editorial request status [C-20]. */
export const editorialRequestStatus = pgEnum('editorial_request_status', [
  'submitted', 'needs_information', 'triaged', 'planned',
  'in_progress', 'fulfilled', 'closed_with_reason', 'withdrawn',
]);

/** Outcome type when an editorial request is fulfilled [C-20]. */
export const editorialOutcomeKind = pgEnum('editorial_outcome_kind', [
  'existing_resource', 'published_resource', 'response_only',
]);

/** System-generated editorial task kind. */
export const editorialTaskKind = pgEnum('editorial_task_kind', [
  'review_due', 'rights_expiring', 'rights_expired',
  'category_below_threshold', 'collection_below_minimum',
  'permission_withdrawn', 'delivery_failed',
]);

/** Editorial task status. */
export const editorialTaskStatus = pgEnum('editorial_task_status', [
  'open', 'resolved', 'dismissed',
]);

/** Editorial brief status [C-20]. */
export const editorialBriefStatus = pgEnum('editorial_brief_status', [
  'open', 'in_progress', 'fulfilled', 'closed',
]);

/** Intake record kind [C-17]. */
export const intakeRecordKind = pgEnum('intake_record_kind', [
  'general_question', 'editorial_note',
]);

/** Intake record state [C-17]. */
export const intakeRecordState = pgEnum('intake_record_state', [
  'submitted', 'claimed', 'awaiting_sender',
  'answered', 'closed', 'withdrawn',
]);

/** Intake message role [C-17]. */
export const intakeMessageRole = pgEnum('intake_message_role', [
  'sender', 'professional', 'system',
]);

/** Intake-specific discipline [C-17]. */
export const intakeDiscipline = pgEnum('intake_discipline', [
  'psychological', 'legal', 'financial', 'general', 'editorial_notes',
]);

/** Intake reply review status. */
export const intakeReviewStatus = pgEnum('intake_review_status', [
  'pending_review', 'approved', 'returned',
]);

/** Intake retention class [C-17]. */
export const intakeRetentionClass = pgEnum('intake_retention_class', [
  'general_education', 'reclassified_professional_case',
]);

/** Publication permission state for derived Q&A [C-18]. */
export const publicationPermissionState = pgEnum('publication_permission_state', [
  'pending', 'granted', 'declined', 'withdrawn',
]);

/** In-app notification kind [C-23]. */
export const notificationKind = pgEnum('notification_kind', [
  'request_update', 'question_update', 'poll_decision',
  'publication_permission_requested', 'review_ready',
  'content_approved', 'content_changes_requested', 'overdue_alert',
]);

/** Outbox delivery state [C-23]. */
export const outboxDeliveryState = pgEnum('outbox_delivery_state', [
  'pending', 'delivered', 'failed', 'dead',
]);

/** Telemetry event kind [C-26]. */
export const contentEventKind = pgEnum('content_event_kind', [
  'opened', 'meaningful_consumption', 'saved',
  'feedback_given', 'practical_step_tried',
  'search_performed', 'search_no_result',
]);

// ─── Employee listening (ADR 0002) ───────────────────────────────────────

/** Questionnaire version lifecycle (spec SUR-01, section 8). */
export const questionnaireStatus = pgEnum('questionnaire_status', [
  'draft', 'in_review', 'published', 'archived',
]);

/** Survey cycle lifecycle (spec SUR-02..04, section 8). */
export const surveyCycleStatus = pgEnum('survey_cycle_status', [
  'scheduled', 'open', 'closing', 'published', 'canceled', 'failed',
]);

/** Private participation state (spec section 8); never an employer status list. */
export const surveyParticipationState = pgEnum('survey_participation_state', [
  'invited', 'draft', 'submitted', 'ineligible',
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

/** Webinar occurrence lifecycle [D-CW-17, decision record section 7]: DRAFT -> PUBLISHED -> LIVE -> ENDED, or CANCELED. */
export const webinarStatus = pgEnum('webinar_status', ['DRAFT', 'PUBLISHED', 'LIVE', 'ENDED', 'CANCELED']);

/** Who wrote a webinar chat message [D-CW-35]: a host to everyone, or an attendee (message or question) to the hosts. */
export const webinarMessageKind = pgEnum('webinar_message_kind', ['HOST', 'ATTENDEE', 'QUESTION']);

/** Webinar chat moderation state [D-CW-35, CW-R-103]: attendee messages start PENDING; host messages are PUBLISHED. */
export const webinarMessageStatus = pgEnum('webinar_message_status', ['PENDING', 'PUBLISHED', 'ANSWERED', 'DISMISSED']);

/**
 * Webinar recording pipeline [D-CW-18, D-CW-34]: `webinars.recording_status`
 * and `webinar_recordings.status` (T-CW-2.1); the pipeline that moves them
 * arrives with T-CW-2.5.
 */
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
