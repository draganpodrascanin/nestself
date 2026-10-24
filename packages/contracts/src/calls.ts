/**
 * Call sessions: timing constants, enums, join, outcome, feedback, client
 * telemetry and support diagnostics schemas, and the call error codes.
 *
 * Every numeric constant here is imported from `@nestself/contracts`, never
 * hard-coded in a service, controller, test or client module (CW-R-26).
 *
 * @see docs/tasks/calls-webinars/02-decisions.md section 7
 * @see docs/tasks/calls-webinars/06-implementation-guidelines.md section 6
 */
import { z } from 'zod';
import { AUTH_ERROR_CODES } from './auth.ts';

// ---------------------------------------------------------------------------
// Constants (decision record section 7)
// ---------------------------------------------------------------------------

/** A consultation can be joined from this many minutes before `startsAt`. */
export const CALL_JOIN_WINDOW_BEFORE_MINUTES = 15;
/** A consultation can be joined until this many minutes after `endsAt`. */
export const CALL_JOIN_WINDOW_AFTER_MINUTES = 10;
/** The room closes this many minutes after the scheduled end. */
export const CALL_ROOM_CLOSE_AFTER_MINUTES = 15;
/** Webinar hosts may join this many minutes before the scheduled start. */
export const WEBINAR_HOST_JOIN_BEFORE_MINUTES = 30;
/** Attendee limit of a single-meeting webinar. */
export const WEBINAR_SINGLE_MEETING_CAPACITY = 250;
/** Participant limit of a workshop. */
export const WORKSHOP_CAPACITY = 25;
/** Reminder offsets before `startsAt`: 24 hours and 1 hour. */
export const REMINDER_OFFSETS_MINUTES = [1440, 60] as const;
/** Lifetime of a one-time call ticket. */
export const CALL_TICKET_TTL_SECONDS = 30;

/** Feedback score range and comment cap (CW-R-22). */
export const CALL_FEEDBACK_SCORE_MIN = 1;
export const CALL_FEEDBACK_SCORE_MAX = 5;
export const CALL_FEEDBACK_COMMENT_MAX_LENGTH = 2000;

// ---------------------------------------------------------------------------
// Enums (lower-case contract spellings; the database stores UPPER_CASE)
// ---------------------------------------------------------------------------

export const CALL_SESSION_STATUSES = ['pending', 'creating', 'active', 'ended', 'failed'] as const;
export const CallSessionStatusSchema = z.enum(CALL_SESSION_STATUSES);
export type CallSessionStatus = z.infer<typeof CallSessionStatusSchema>;

export const CALL_PARTICIPANT_ROLES = [
  'expert',
  'employee',
  'presenter',
  'moderator',
  'attendee',
  'facilitator',
  'participant',
] as const;
export const CallParticipantRoleSchema = z.enum(CALL_PARTICIPANT_ROLES);
export type CallParticipantRole = z.infer<typeof CallParticipantRoleSchema>;

export const CALL_FORMATS = ['consultation', 'webinar', 'workshop'] as const;
export const CallFormatSchema = z.enum(CALL_FORMATS);
export type CallFormat = z.infer<typeof CallFormatSchema>;

export const CALL_OUTCOME_STATUSES = [
  'completed',
  'no_show_employee',
  'no_show_expert',
  'technical_failure',
  'canceled',
] as const;
export const CallOutcomeStatusSchema = z.enum(CALL_OUTCOME_STATUSES);
export type CallOutcomeStatus = z.infer<typeof CallOutcomeStatusSchema>;

export const RECORDING_STATUSES = [
  'scheduled',
  'recording',
  'processing',
  'ready',
  'handed_off',
  'failed',
] as const;
export const RecordingStatusSchema = z.enum(RECORDING_STATUSES);
export type RecordingStatus = z.infer<typeof RecordingStatusSchema>;

export const WEBINAR_MESSAGE_KINDS = ['host', 'attendee', 'question'] as const;
export const WebinarMessageKindSchema = z.enum(WEBINAR_MESSAGE_KINDS);
export type WebinarMessageKind = z.infer<typeof WebinarMessageKindSchema>;

export const WEBINAR_MESSAGE_STATUSES = ['pending', 'published', 'answered', 'dismissed'] as const;
export const WebinarMessageStatusSchema = z.enum(WEBINAR_MESSAGE_STATUSES);
export type WebinarMessageStatus = z.infer<typeof WebinarMessageStatusSchema>;

/** Values of the `VIDEO_PROVIDER` environment variable. */
export const VIDEO_PROVIDERS = ['none', 'chime'] as const;
export const VideoProviderSchema = z.enum(VIDEO_PROVIDERS);
export type VideoProvider = z.infer<typeof VideoProviderSchema>;

// ---------------------------------------------------------------------------
// Error codes (CW-R-27)
// ---------------------------------------------------------------------------

/** Error codes of the calls and webinars epic. Kept apart from AUTH_ERROR_CODES. */
export const CALL_ERROR_CODES = [
  'join_window_closed',
  'appointment_not_joinable',
  'appointment_not_proposed',
  'approval_not_pending',
  'approver_missing',
  'follow_up_not_allowed',
  'video_provider_unavailable',
  'webinar_full',
  'webinar_not_open',
  'registration_closed',
  'already_registered',
  'not_eligible',
  'floor_not_available',
  'recording_not_allowed',
  'capacity_above_limit',
  'invalid_ticket',
] as const;
export type CallErrorCode = (typeof CALL_ERROR_CODES)[number];

/** Every error code the API can return: auth codes followed by call codes. */
export const API_ERROR_CODES = [...AUTH_ERROR_CODES, ...CALL_ERROR_CODES] as const;
export const ApiErrorCodeSchema = z.enum(API_ERROR_CODES);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

// ---------------------------------------------------------------------------
// Join (POST /appointments/:id/join): Chime SDK credentials
// ---------------------------------------------------------------------------

/**
 * Media placement of a Chime SDK meeting. `EventIngestionUrl` is deliberately
 * absent: parsing drops it, so no client telemetry reaches a third endpoint
 * (D-CW-13, CW-R-48). Audio host is `host:port`, not a URL.
 */
const ChimeMediaPlacementSchema = z.object({
  AudioHostUrl: z.string().min(1),
  AudioFallbackUrl: z.string().min(1),
  SignalingUrl: z.string().min(1),
  TurnControlUrl: z.string().min(1),
  ScreenDataUrl: z.string().min(1).optional(),
  ScreenViewingUrl: z.string().min(1).optional(),
  ScreenSharingUrl: z.string().min(1).optional(),
});

const ChimeMeetingFeaturesSchema = z.object({
  Audio: z.object({ EchoReduction: z.string().min(1).optional() }).optional(),
  Video: z.object({ MaxResolution: z.string().min(1).optional() }).optional(),
  Content: z.object({ MaxResolution: z.string().min(1).optional() }).optional(),
  Attendee: z.object({ MaxCount: z.number().int().positive().optional() }).optional(),
});

const ChimeCapabilitySchema = z.enum(['SendReceive', 'Send', 'Receive', 'None']);

export const ChimeMeetingSchema = z.object({
  MeetingId: z.string().min(1),
  ExternalMeetingId: z.string().min(1).optional(),
  MediaRegion: z.string().min(1),
  MediaPlacement: ChimeMediaPlacementSchema,
  MeetingFeatures: ChimeMeetingFeaturesSchema.optional(),
});
export type ChimeMeeting = z.infer<typeof ChimeMeetingSchema>;

/**
 * The attendee credentials. `JoinToken` appears only in the join response:
 * never in PostgreSQL, logs, audit details or client storage (CW-R-69).
 */
export const ChimeAttendeeSchema = z.object({
  AttendeeId: z.string().min(1),
  /** Always the `call_participants.id`, never a user id, name or email (CW-R-71). */
  ExternalUserId: z.string().min(1),
  JoinToken: z.string().min(1),
  Capabilities: z
    .object({
      Audio: ChimeCapabilitySchema,
      Video: ChimeCapabilitySchema,
      Content: ChimeCapabilitySchema,
    })
    .optional(),
});
export type ChimeAttendee = z.infer<typeof ChimeAttendeeSchema>;

/** Served with `Cache-Control: no-store` (CW-R-70). */
export const CallJoinResponseSchema = z.object({
  sessionId: z.string().min(1),
  participantId: z.string().min(1),
  role: CallParticipantRoleSchema,
  format: CallFormatSchema,
  /** Scheduled window, for the session timer. */
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  meeting: ChimeMeetingSchema,
  attendee: ChimeAttendeeSchema,
});
export type CallJoinResponse = z.infer<typeof CallJoinResponseSchema>;

// ---------------------------------------------------------------------------
// Outcome and feedback
// ---------------------------------------------------------------------------

/** `POST /appointments/:id/outcome` (expert). No free text (CW-R-21). */
export const CallOutcomeRequestSchema = z.strictObject({
  status: CallOutcomeStatusSchema,
});
export type CallOutcomeRequest = z.infer<typeof CallOutcomeRequestSchema>;

/** `POST /appointments/:id/feedback` (employee). Never shown to the employer. */
export const CallFeedbackRequestSchema = z.object({
  score: z.number().int().min(CALL_FEEDBACK_SCORE_MIN).max(CALL_FEEDBACK_SCORE_MAX),
  comment: z.string().trim().max(CALL_FEEDBACK_COMMENT_MAX_LENGTH).nullish(),
});
export type CallFeedbackRequest = z.infer<typeof CallFeedbackRequestSchema>;

// ---------------------------------------------------------------------------
// Client telemetry (POST /calls/:sessionId/client-events, D-CW-13)
// ---------------------------------------------------------------------------

/**
 * The Chime SDK client events of D-CW-13, plus `connectionStats` for the
 * 30-second `getStats()` aggregate.
 */
export const CLIENT_EVENT_NAMES = [
  'meetingStartSucceeded',
  'meetingStartFailed',
  'meetingFailed',
  'meetingReconnected',
  'audioInputFailed',
  'videoInputFailed',
  'signalingDropped',
  'connectionStats',
] as const;
export const ClientEventNameSchema = z.enum(CLIENT_EVENT_NAMES);
export type ClientEventName = z.infer<typeof ClientEventNameSchema>;

/**
 * Aggregated connection quality (CW-R-22b). `rtt` and `jitter` in
 * milliseconds, `packetLoss` as a fraction from 0 to 1, `outgoingBitrate` in
 * bits per second.
 */
export const CallQualityMetricsSchema = z.strictObject({
  rtt: z.number().nonnegative().optional(),
  jitter: z.number().nonnegative().optional(),
  packetLoss: z.number().min(0).max(1).optional(),
  outgoingBitrate: z.number().nonnegative().optional(),
});
export type CallQualityMetrics = z.infer<typeof CallQualityMetricsSchema>;

/**
 * One client event. Strict, so a device label, a name or any content cannot
 * ride along; `deviceError` is an error name such as `NotAllowedError`, never
 * a message (D-CW-13, CW-R-80).
 */
export const ClientEventRequestSchema = z.strictObject({
  eventName: ClientEventNameSchema,
  durationMs: z.number().int().nonnegative().optional(),
  metrics: CallQualityMetricsSchema.optional(),
  deviceError: z
    .string()
    .max(64)
    .regex(/^[A-Za-z][A-Za-z0-9_]*$/)
    .optional(),
  browser: z.string().min(1).max(64).optional(),
  os: z.string().min(1).max(64).optional(),
});
export type ClientEventRequest = z.infer<typeof ClientEventRequestSchema>;

// ---------------------------------------------------------------------------
// Support diagnostics (GET /ops/calls/:sessionId/diagnostics, D-CW-28)
// ---------------------------------------------------------------------------

/** Frozen allowlist of the diagnostics response (auth strategy 4.7.5, CW-R-86). */
export const DIAGNOSTICS_RESPONSE_FIELDS = [
  'sessionId',
  'appointmentId',
  'webinarId',
  'startedAt',
  'endedAt',
  'status',
  'provider',
  'providerMeetingId',
  'participants',
] as const;

/** Frozen allowlist of one diagnostics participant entry (CW-R-86). */
export const DIAGNOSTICS_PARTICIPANT_FIELDS = [
  'role',
  'joinedAt',
  'leftAt',
  'reconnectCount',
  'qualityMetrics',
  'errorCodes',
  'browser',
  'os',
] as const;

export const DiagnosticsParticipantSchema = z.strictObject({
  role: CallParticipantRoleSchema,
  joinedAt: z.string().datetime().nullable(),
  leftAt: z.string().datetime().nullable(),
  reconnectCount: z.number().int().nonnegative(),
  qualityMetrics: CallQualityMetricsSchema.nullable(),
  /** Provider and client error codes; codes only, no messages. */
  errorCodes: z.array(z.string().min(1).max(100)),
  browser: z.string().min(1).nullable(),
  os: z.string().min(1).nullable(),
});
export type DiagnosticsParticipant = z.infer<typeof DiagnosticsParticipantSchema>;

/**
 * Strict at both levels: a field outside the 4.7.5 set fails the parse, so
 * no content, category or identity can leak through (CONF-R-07, CW-R-73).
 */
export const DiagnosticsResponseSchema = z.strictObject({
  sessionId: z.string().min(1),
  appointmentId: z.string().min(1).nullable(),
  webinarId: z.string().min(1).nullable(),
  startedAt: z.string().datetime().nullable(),
  endedAt: z.string().datetime().nullable(),
  status: CallSessionStatusSchema,
  provider: VideoProviderSchema,
  providerMeetingId: z.string().min(1).nullable(),
  participants: z.array(DiagnosticsParticipantSchema),
});
export type DiagnosticsResponse = z.infer<typeof DiagnosticsResponseSchema>;
