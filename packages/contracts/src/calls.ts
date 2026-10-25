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
import {
  AppointmentStatusSchema,
  FOLLOW_UP_DURATION_MAX_MINUTES,
  FOLLOW_UP_DURATION_MIN_MINUTES,
  FOLLOW_UP_MAX_SUGGESTED_WINDOWS,
} from './appointments.ts';
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
/** Replica meetings per primary: the default Chime service quota (WEB-08). */
export const WEBINAR_MAX_REPLICAS = 4;
/**
 * Attendee limit of a webinar with media replication, four replicas of 250
 * (D-CW-14). Above it the IVS live connector path is documented, not built.
 */
export const WEBINAR_REPLICATED_CAPACITY = WEBINAR_SINGLE_MEETING_CAPACITY * WEBINAR_MAX_REPLICAS;
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

/**
 * Values of the `VIDEO_PROVIDER` environment variable. Named `...Name` so the
 * canonical `VideoProvider` stays the API adapter class (apps/api/src/video).
 */
export const VIDEO_PROVIDER_NAMES = ['none', 'chime'] as const;
export const VideoProviderNameSchema = z.enum(VIDEO_PROVIDER_NAMES);
export type VideoProviderName = z.infer<typeof VideoProviderNameSchema>;

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
 * (D-CW-13, CW-R-48). Audio host is `host:port`, not a URL. The SDK marks
 * `TurnControlUrl` deprecated, so a meeting without it is still joinable.
 */
const ChimeMediaPlacementSchema = z.object({
  AudioHostUrl: z.string().min(1),
  AudioFallbackUrl: z.string().min(1),
  SignalingUrl: z.string().min(1),
  TurnControlUrl: z.string().min(1).optional(),
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

/** Longest location text the employee may share before a psychological consultation (CALL-34). */
export const CALL_LOCATION_TEXT_MAX_LENGTH = 300;

/**
 * `POST /appointments/:id/join` body. Empty for everyone, except that the
 * employee of a psychological consultation may share a free-text location
 * for crisis readiness (CALL-34, F-CW-04). The text lives on the session
 * until it ends and never reaches audit details, logs or diagnostics.
 */
export const CallJoinRequestSchema = z.strictObject({
  locationText: z.string().trim().min(1).max(CALL_LOCATION_TEXT_MAX_LENGTH).optional(),
});
export type CallJoinRequest = z.infer<typeof CallJoinRequestSchema>;

/**
 * `GET /appointments/:id/location`: the location the employee shared, for
 * the assigned expert only while the session is live; null until shared
 * (CALL-34 criterion 3). Served with `Cache-Control: no-store`.
 */
export const CallLocationResponseSchema = z.strictObject({
  locationText: z.string().min(1).max(CALL_LOCATION_TEXT_MAX_LENGTH).nullable(),
});
export type CallLocationResponse = z.infer<typeof CallLocationResponseSchema>;

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
// Quick signals (POST /appointments/:id/signal, D-CW-27)
// ---------------------------------------------------------------------------

/**
 * The consultation's only in-call messages: the expert's "running late" and
 * either party's "I cannot hear you" or "I cannot see you". Delivered over
 * Socket.IO as `call.signal` and never persisted (CW-R-35).
 */
export const CALL_SIGNAL_TYPES = ['running_late', 'cannot_hear', 'cannot_see'] as const;
export const CallSignalTypeSchema = z.enum(CALL_SIGNAL_TYPES);
export type CallSignalType = z.infer<typeof CallSignalTypeSchema>;

/** Largest "running late" estimate, in minutes: the join window stays open 10 minutes after the end. */
export const CALL_SIGNAL_ETA_MAX_MINUTES = 60;

const etaMinutesField = z.number().int().min(1).max(CALL_SIGNAL_ETA_MAX_MINUTES);

/** No free text: a signal is its type, plus an ETA for "running late". */
export const CallSignalRequestSchema = z
  .strictObject({
    type: CallSignalTypeSchema,
    etaMinutes: etaMinutesField.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.etaMinutes !== undefined && value.type !== 'running_late') {
      ctx.addIssue({ code: 'custom', path: ['etaMinutes'], message: 'Only a running-late signal carries an ETA' });
    }
  });
export type CallSignalRequest = z.infer<typeof CallSignalRequestSchema>;

/**
 * The `call.signal` event on the `call:{sessionId}` room: the type, the ETA
 * and the sender's role, so each client can tell its own signal from the
 * other party's. No name and no user id (CW-R-35).
 */
export const CallSignalPayloadSchema = z.strictObject({
  type: CallSignalTypeSchema,
  etaMinutes: etaMinutesField.optional(),
  fromRole: CallParticipantRoleSchema,
});
export type CallSignalPayload = z.infer<typeof CallSignalPayloadSchema>;

// ---------------------------------------------------------------------------
// Socket.IO room `call:{sessionId}` (D-CW-16, D-CW-37, CW-R-36)
// ---------------------------------------------------------------------------

/**
 * The Socket.IO room of a call session. A client subscribes with
 * `{ room: callRoomName(sessionId) }`; the server derives the authorisation
 * (`consultation.join` on the session's appointment, participants only).
 */
export function callRoomName(sessionId: string): string {
  return `call:${sessionId}`;
}

/**
 * Every payload on the call room is strict and carries ids, roles, statuses
 * and times only: never a name, an email, the location text, a note or a
 * token. The API validates each payload against its schema before emitting
 * and drops one that fails.
 */
const roomId = z.string().min(1);
const instant = z.string().datetime();

/** `call.participant.joined`: on every join, a rejoin included. */
export const CallParticipantJoinedPayloadSchema = z.strictObject({
  participantId: roomId,
  role: CallParticipantRoleSchema,
});
export type CallParticipantJoinedPayload = z.infer<typeof CallParticipantJoinedPayloadSchema>;

/** `call.participant.left`: the provider reported the attendee left or dropped. */
export const CallParticipantLeftPayloadSchema = z.strictObject({
  participantId: roomId,
  role: CallParticipantRoleSchema,
});
export type CallParticipantLeftPayload = z.infer<typeof CallParticipantLeftPayloadSchema>;

/** `call.session.ended`: the expert ended the session for everyone (D-CW-09). */
export const CallSessionEndedPayloadSchema = z.strictObject({
  sessionId: roomId,
  endedAt: instant,
});
export type CallSessionEndedPayload = z.infer<typeof CallSessionEndedPayloadSchema>;

/**
 * `call.location.shared`: the employee shared a location (CALL-34). Content
 * free: the expert's client then reads `GET /appointments/:id/location`.
 */
export const CallLocationSharedPayloadSchema = z.strictObject({
  sessionId: roomId,
});
export type CallLocationSharedPayload = z.infer<typeof CallLocationSharedPayloadSchema>;

/**
 * `appointment.follow_up.proposed`: the expert proposed a follow-up (D-CW-37).
 * `appointmentId` is the finished appointment, `followUpId` the new one.
 */
export const FollowUpProposedPayloadSchema = z.strictObject({
  appointmentId: roomId,
  followUpId: roomId,
  startsAt: instant,
  durationMinutes: z.number().int().min(FOLLOW_UP_DURATION_MIN_MINUTES).max(FOLLOW_UP_DURATION_MAX_MINUTES),
});
export type FollowUpProposedPayload = z.infer<typeof FollowUpProposedPayloadSchema>;

/**
 * `appointment.follow_up.confirmed`: the employee confirmed. The status is
 * `awaiting_approval` when the organisation requires a manager's approval.
 */
export const FollowUpConfirmedPayloadSchema = z.strictObject({
  appointmentId: roomId,
  followUpId: roomId,
  status: AppointmentStatusSchema.extract(['confirmed', 'awaiting_approval']),
});
export type FollowUpConfirmedPayload = z.infer<typeof FollowUpConfirmedPayloadSchema>;

/** `appointment.follow_up.declined`: the employee declined the proposal. */
export const FollowUpDeclinedPayloadSchema = z.strictObject({
  appointmentId: roomId,
  followUpId: roomId,
});
export type FollowUpDeclinedPayload = z.infer<typeof FollowUpDeclinedPayloadSchema>;

const SuggestedWindowPayloadSchema = z
  .strictObject({ startsAt: instant, endsAt: instant })
  .refine((window) => Date.parse(window.endsAt) > Date.parse(window.startsAt), {
    path: ['endsAt'],
    message: 'endsAt must be after startsAt',
  });

/** `appointment.times_suggested`: the employee suggested one to three other windows (CALL-37). */
export const TimesSuggestedPayloadSchema = z.strictObject({
  appointmentId: roomId,
  followUpId: roomId,
  windows: z.array(SuggestedWindowPayloadSchema).min(1).max(FOLLOW_UP_MAX_SUGGESTED_WINDOWS),
});
export type TimesSuggestedPayload = z.infer<typeof TimesSuggestedPayloadSchema>;

/** The events of the `call:{sessionId}` room (decision record section 7, plus `call.location.shared`). */
export const CALL_ROOM_EVENT_NAMES = [
  'call.participant.joined',
  'call.participant.left',
  'call.session.ended',
  'call.signal',
  'call.location.shared',
  'appointment.follow_up.proposed',
  'appointment.follow_up.confirmed',
  'appointment.follow_up.declined',
  'appointment.times_suggested',
] as const;
export const CallRoomEventNameSchema = z.enum(CALL_ROOM_EVENT_NAMES);
export type CallRoomEventName = z.infer<typeof CallRoomEventNameSchema>;

/** The payload schema of each call room event, for the API's emitter and the clients' listeners. */
export const CALL_ROOM_EVENT_PAYLOAD_SCHEMAS = {
  'call.participant.joined': CallParticipantJoinedPayloadSchema,
  'call.participant.left': CallParticipantLeftPayloadSchema,
  'call.session.ended': CallSessionEndedPayloadSchema,
  'call.signal': CallSignalPayloadSchema,
  'call.location.shared': CallLocationSharedPayloadSchema,
  'appointment.follow_up.proposed': FollowUpProposedPayloadSchema,
  'appointment.follow_up.confirmed': FollowUpConfirmedPayloadSchema,
  'appointment.follow_up.declined': FollowUpDeclinedPayloadSchema,
  'appointment.times_suggested': TimesSuggestedPayloadSchema,
} as const satisfies { readonly [E in CallRoomEventName]: z.ZodType };

export type CallRoomEventPayloads = {
  [E in CallRoomEventName]: z.infer<(typeof CALL_ROOM_EVENT_PAYLOAD_SCHEMAS)[E]>;
};
export type CallRoomEventPayload<E extends CallRoomEventName> = CallRoomEventPayloads[E];

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

/** Most client events one request may carry (a 30-second aggregate plus the events in between). */
export const CLIENT_EVENT_BATCH_MAX = 50;

/** `POST /calls/:sessionId/client-events` body: a bounded batch of strict events. */
export const ClientEventBatchRequestSchema = z.strictObject({
  events: z.array(ClientEventRequestSchema).min(1).max(CLIENT_EVENT_BATCH_MAX),
});
export type ClientEventBatchRequest = z.infer<typeof ClientEventBatchRequestSchema>;

// ---------------------------------------------------------------------------
// Technical problem reports (POST /calls/:sessionId/problem-report, CALL-16)
// ---------------------------------------------------------------------------

/** What a participant reports; a fixed category, never free text (D-CW-04, CALL-16). */
export const CALL_PROBLEM_CATEGORIES = ['audio', 'video', 'connection', 'other'] as const;
export const CallProblemCategorySchema = z.enum(CALL_PROBLEM_CATEGORIES);
export type CallProblemCategory = z.infer<typeof CallProblemCategorySchema>;

/**
 * The connection metadata the client attaches from its event log (CALL-16
 * criterion 3), with the field shapes of {@link ClientEventRequestSchema}:
 * the call's duration, its reconnects, the average quality, browser and OS.
 * Strict, so no device label, name or content can ride along.
 */
export const CallProblemSummarySchema = z.strictObject({
  durationMs: z.number().int().nonnegative().optional(),
  reconnectCount: z.number().int().nonnegative().optional(),
  metrics: CallQualityMetricsSchema.optional(),
  browser: z.string().min(1).max(64).optional(),
  os: z.string().min(1).max(64).optional(),
});
export type CallProblemSummary = z.infer<typeof CallProblemSummarySchema>;

/** `POST /calls/:sessionId/problem-report` body. Strict: a `note` or any other text is refused. */
export const CallProblemReportRequestSchema = z.strictObject({
  category: CallProblemCategorySchema,
  summary: CallProblemSummarySchema,
});
export type CallProblemReportRequest = z.infer<typeof CallProblemReportRequestSchema>;

/** Default and largest page size of `GET /ops/calls/problem-reports`. */
export const PROBLEM_REPORT_LIST_DEFAULT_LIMIT = 50;
export const PROBLEM_REPORT_LIST_MAX_LIMIT = 100;

/**
 * `GET /ops/calls/problem-reports` query (CALL-16 criterion 5, T-CW-1.5):
 * support's queue of reports, newest first. `orgId` narrows to one client
 * organization; `from` (inclusive) and `to` (exclusive) bound `reportedAt`;
 * `cursor` is the opaque `nextCursor` of the previous page.
 */
export const ProblemReportListQuerySchema = z
  .object({
    orgId: z.string().min(1).optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(PROBLEM_REPORT_LIST_MAX_LIMIT)
      .default(PROBLEM_REPORT_LIST_DEFAULT_LIMIT),
    cursor: z.string().min(1).max(512).optional(),
  })
  .refine((q) => !q.from || !q.to || Date.parse(q.to) > Date.parse(q.from), {
    path: ['to'],
    message: 'to must be after from',
  });
export type ProblemReportListQuery = z.infer<typeof ProblemReportListQuerySchema>;

/** One report as support lists it: ids, time, the reporter's role, the category and the summary; no names. */
export const ProblemReportListItemSchema = z.strictObject({
  sessionId: z.string().min(1),
  appointmentId: z.string().min(1).nullable(),
  reportedAt: z.string().datetime(),
  role: CallParticipantRoleSchema,
  category: CallProblemCategorySchema,
  summary: CallProblemSummarySchema,
});
export type ProblemReportListItem = z.infer<typeof ProblemReportListItemSchema>;

export const ProblemReportListResponseSchema = z.strictObject({
  items: z.array(ProblemReportListItemSchema),
  /** Pass as `cursor` for the next page; null on the last page. */
  nextCursor: z.string().nullable(),
});
export type ProblemReportListResponse = z.infer<typeof ProblemReportListResponseSchema>;

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
  'problemReports',
] as const;

/** Frozen allowlist of one diagnostics problem report entry (CALL-16 criterion 5). */
export const DIAGNOSTICS_PROBLEM_REPORT_FIELDS = ['category', 'reportedAt', 'role'] as const;

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

/** A problem report as support sees it: the category, when, and the reporter's role only. */
export const DiagnosticsProblemReportSchema = z.strictObject({
  category: CallProblemCategorySchema,
  reportedAt: z.string().datetime(),
  role: CallParticipantRoleSchema,
});
export type DiagnosticsProblemReport = z.infer<typeof DiagnosticsProblemReportSchema>;

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
  provider: VideoProviderNameSchema,
  providerMeetingId: z.string().min(1).nullable(),
  participants: z.array(DiagnosticsParticipantSchema),
  /**
   * The participants' technical problem reports (CALL-16), oldest first.
   * Defaults to none, so the base DTO built from the session alone parses;
   * the diagnostics route always fills it.
   */
  problemReports: z.array(DiagnosticsProblemReportSchema).default([]),
});
export type DiagnosticsResponse = z.infer<typeof DiagnosticsResponseSchema>;
