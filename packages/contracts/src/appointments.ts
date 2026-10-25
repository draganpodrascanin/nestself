/**
 * Appointment spine: the seam the call layer reads, the status lifecycle and
 * the follow-up and approval request schemas.
 *
 * Contract and API spellings are lower case; the database stores the same
 * values in UPPER_CASE and the repository maps them (CW-R-19a).
 *
 * @see docs/tasks/calls-webinars/02-decisions.md D-CW-02, D-CW-37, section 7
 * @see docs/tasks/calls-webinars/06-implementation-guidelines.md section 6
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

/** Shortest follow-up an expert can propose. */
export const FOLLOW_UP_DURATION_MIN_MINUTES = 15;
/** Longest follow-up an expert can propose. */
export const FOLLOW_UP_DURATION_MAX_MINUTES = 120;
/** The employee suggests at most this many alternative windows (CALL-37). */
export const FOLLOW_UP_MAX_SUGGESTED_WINDOWS = 3;
/** Approver-visible reason on a rejected follow-up (CW-R-109). */
export const APPROVAL_SAFE_REASON_MAX_LENGTH = 300;

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const APPOINTMENT_STATUSES = [
  'proposed',
  'awaiting_approval',
  'confirmed',
  'completed',
  'canceled',
  'declined',
  'no_show',
] as const;
export const AppointmentStatusSchema = z.enum(APPOINTMENT_STATUSES);
export type AppointmentStatus = z.infer<typeof AppointmentStatusSchema>;

export const APPOINTMENT_APPROVAL_STATUSES = ['pending', 'approved', 'rejected', 'expired'] as const;
export const AppointmentApprovalStatusSchema = z.enum(APPOINTMENT_APPROVAL_STATUSES);
export type AppointmentApprovalStatus = z.infer<typeof AppointmentApprovalStatusSchema>;

/** Organisation setting `follow_up_approval_policy` (D-CW-37). */
export const FOLLOW_UP_APPROVAL_POLICIES = ['automatic', 'manager_approval'] as const;
export const FollowUpApprovalPolicySchema = z.enum(FOLLOW_UP_APPROVAL_POLICIES);
export type FollowUpApprovalPolicy = z.infer<typeof FollowUpApprovalPolicySchema>;
/** Every organisation starts here (D-CW-37; the column default is `AUTOMATIC`). */
export const FOLLOW_UP_APPROVAL_POLICY_DEFAULT: FollowUpApprovalPolicy = 'automatic';

// ---------------------------------------------------------------------------
// Status lifecycle (CALL-30)
// ---------------------------------------------------------------------------

/**
 * Allowed status transitions. Any other transition is refused with 409
 * `appointment_not_joinable` (CALL-30).
 */
export const APPOINTMENT_STATUS_TRANSITIONS: Readonly<
  Record<AppointmentStatus, readonly AppointmentStatus[]>
> = {
  // automatic policy or the expert picks a suggested window; manager_approval policy; employee declines
  proposed: ['confirmed', 'awaiting_approval', 'declined'],
  // approver approves; approver rejects
  awaiting_approval: ['confirmed', 'declined'],
  confirmed: ['completed', 'canceled', 'no_show'],
  completed: [],
  canceled: [],
  declined: [],
  no_show: [],
};

/** True when an appointment may move from `from` to `to`. */
export function canTransitionAppointment(from: AppointmentStatus, to: AppointmentStatus): boolean {
  return APPOINTMENT_STATUS_TRANSITIONS[from].includes(to);
}

// ---------------------------------------------------------------------------
// Field helpers
// ---------------------------------------------------------------------------

const idField = z.string().min(1);
const isoDateTime = z.string().datetime();

/**
 * True for an IANA time zone name the runtime knows (`Europe/Belgrade`,
 * `Europe/Kyiv`, `Etc/UTC`). Intl matches names case insensitively, so every
 * slash-separated segment must also start with an upper-case letter or a
 * digit: `europe/belgrade` is refused rather than stored in a second
 * spelling. Comparing against the resolved name is avoided on purpose: some
 * runtimes resolve newer names to older aliases (`Europe/Kyiv` to
 * `Europe/Kiev`). Fixed offsets such as `+01:00` are refused because an
 * offset cannot follow daylight saving time (CALL-29).
 */
export function isIanaTimeZone(value: string): boolean {
  if (!value.split('/').every((segment) => /^[A-Z0-9][A-Za-z0-9_+-]*$/.test(segment))) return false;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const TimeZoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(isIanaTimeZone, { message: 'Expected an IANA time zone name' });

function endsAfterStart(value: { startsAt: string; endsAt: string }): boolean {
  return Date.parse(value.endsAt) > Date.parse(value.startsAt);
}

const endsAfterStartIssue = { path: ['endsAt'], message: 'endsAt must be after startsAt' };

/**
 * One time window: an employee's alternative for a proposed follow-up
 * (CALL-37). Times only, never free text (D-CW-04, D-22).
 */
export const FollowUpTimeWindowSchema = z
  .object({
    startsAt: isoDateTime,
    endsAt: isoDateTime,
  })
  .refine(endsAfterStart, endsAfterStartIssue);
export type FollowUpTimeWindow = z.infer<typeof FollowUpTimeWindowSchema>;

// ---------------------------------------------------------------------------
// Appointment seam (D-CW-02, CALL-31)
// ---------------------------------------------------------------------------

/**
 * The fields the call layer reads. The booking epic (NS-BOOKING-01) may add
 * columns but must not change these.
 */
export const APPOINTMENT_SEAM_FIELDS = [
  'id',
  'orgId',
  'expertUserId',
  'employeeUserId',
  'startsAt',
  'endsAt',
  'status',
  'serviceCategory',
  'timeZone',
  'fundingRef',
  'followUpOf',
] as const;
export type AppointmentSeamField = (typeof APPOINTMENT_SEAM_FIELDS)[number];

export const AppointmentSchema = z.object({
  id: idField,
  orgId: idField,
  expertUserId: idField,
  employeeUserId: idField,
  startsAt: isoDateTime,
  endsAt: isoDateTime,
  status: AppointmentStatusSchema,
  serviceCategory: z.string().min(1),
  timeZone: TimeZoneSchema,
  fundingRef: z.string().min(1).nullable(),
  /** The earlier appointment this one follows up (D-CW-37). */
  followUpOf: idField.nullable(),
});
export type Appointment = z.infer<typeof AppointmentSchema>;

/**
 * How the API names a participant to the other one and to operations: the
 * first name only, never a surname or an address. The expert may also carry a
 * photo and a credentials line once the expert record holds them.
 */
export const AppointmentEmployeeDisplaySchema = z.strictObject({
  firstName: z.string().min(1).max(100),
});
export type AppointmentEmployeeDisplay = z.infer<typeof AppointmentEmployeeDisplaySchema>;

export const AppointmentExpertDisplaySchema = AppointmentEmployeeDisplaySchema.extend({
  photoUrl: z.string().url().optional(),
  credentials: z.string().min(1).max(200).optional(),
});
export type AppointmentExpertDisplay = z.infer<typeof AppointmentExpertDisplaySchema>;

/**
 * An appointment as the API returns it: the seam, plus
 * - the participants' display names (`expert`, `employee`), which the
 *   appointment routes always fill; optional because other routes that
 *   answer an appointment (the outcome) return the seam only;
 * - the windows the employee suggested for a `proposed` follow-up (CALL-37),
 *   present only when there are some, so the expert can pick one
 *   (`POST /appointments/:id/schedule` takes its index).
 * None of these is part of the seam.
 */
export const AppointmentResponseSchema = AppointmentSchema.extend({
  expert: AppointmentExpertDisplaySchema.optional(),
  employee: AppointmentEmployeeDisplaySchema.optional(),
  suggestedWindows: z.array(FollowUpTimeWindowSchema).min(1).max(FOLLOW_UP_MAX_SUGGESTED_WINDOWS).optional(),
});
export type AppointmentResponse = z.infer<typeof AppointmentResponseSchema>;

/** Default page size of `GET /appointments`. */
export const APPOINTMENT_LIST_DEFAULT_LIMIT = 50;
/** Largest page size of `GET /appointments`. */
export const APPOINTMENT_LIST_MAX_LIMIT = 100;

/**
 * `GET /appointments` query (CALL-18, CALL-28). Every filter is optional; the
 * dates bound `startsAt` (`from` inclusive, `to` exclusive). Pages follow
 * `(startsAt, id)`; `cursor` is the opaque `nextCursor` of the previous page.
 */
export const AppointmentListQuerySchema = z
  .object({
    cursor: z.string().min(1).max(512).optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(APPOINTMENT_LIST_MAX_LIMIT)
      .default(APPOINTMENT_LIST_DEFAULT_LIMIT),
    orgId: idField.optional(),
    status: AppointmentStatusSchema.optional(),
    from: isoDateTime.optional(),
    to: isoDateTime.optional(),
    /** Only the follow-ups of this consultation (T-CW-1.9). */
    followUpOf: idField.optional(),
  })
  .refine((q) => !q.from || !q.to || Date.parse(q.to) > Date.parse(q.from), {
    path: ['to'],
    message: 'to must be after from',
  });
export type AppointmentListQuery = z.infer<typeof AppointmentListQuerySchema>;

export const AppointmentListResponseSchema = z.object({
  items: z.array(AppointmentResponseSchema),
  /** Pass as `cursor` for the next page; null on the last page. */
  nextCursor: z.string().nullable(),
});
export type AppointmentListResponse = z.infer<typeof AppointmentListResponseSchema>;

/** `POST /orgs/:orgId/appointments` */
export const AppointmentCreateRequestSchema = z
  .object({
    orgId: idField,
    expertUserId: idField,
    employeeUserId: idField,
    startsAt: isoDateTime,
    endsAt: isoDateTime,
    serviceCategory: z.string().min(1).max(64),
    timeZone: TimeZoneSchema,
    fundingRef: z.string().min(1).max(200).optional(),
  })
  .refine(endsAfterStart, endsAfterStartIssue);
export type AppointmentCreateRequest = z.infer<typeof AppointmentCreateRequestSchema>;

// ---------------------------------------------------------------------------
// Follow-up requests (D-CW-37, CALL-35 to CALL-38)
// ---------------------------------------------------------------------------

/**
 * `POST /appointments/:id/follow-up` (expert). The client converts the picked
 * wall-clock date and time in `timeZone` to the UTC instant `startsAt`. There
 * is no free-text field: nothing travels from expert to employee but the
 * time (D-CW-04, D-22; the card copy is fixed, D-CW-37).
 */
export const AppointmentFollowUpRequestSchema = z.object({
  startsAt: isoDateTime,
  durationMinutes: z
    .number()
    .int()
    .min(FOLLOW_UP_DURATION_MIN_MINUTES)
    .max(FOLLOW_UP_DURATION_MAX_MINUTES),
  timeZone: TimeZoneSchema,
});
export type AppointmentFollowUpRequest = z.infer<typeof AppointmentFollowUpRequestSchema>;

/** Alias used by T-CW-1.9. */
export const FollowUpProposeRequestSchema = AppointmentFollowUpRequestSchema;
export type FollowUpProposeRequest = AppointmentFollowUpRequest;

/** `POST /appointments/:id/confirm` (employee). Empty body. */
export const FollowUpConfirmRequestSchema = z.strictObject({});
export type FollowUpConfirmRequest = z.infer<typeof FollowUpConfirmRequestSchema>;

/** `POST /appointments/:id/decline` (employee). Empty body. */
export const FollowUpDeclineRequestSchema = z.strictObject({});
export type FollowUpDeclineRequest = z.infer<typeof FollowUpDeclineRequestSchema>;

/** `POST /appointments/:id/suggest-times` (employee): one to three windows. */
export const AppointmentSuggestTimesRequestSchema = z.object({
  windows: z.array(FollowUpTimeWindowSchema).min(1).max(FOLLOW_UP_MAX_SUGGESTED_WINDOWS),
});
export type AppointmentSuggestTimesRequest = z.infer<typeof AppointmentSuggestTimesRequestSchema>;

/** Alias used by T-CW-1.9. */
export const FollowUpSuggestTimesRequestSchema = AppointmentSuggestTimesRequestSchema;
export type FollowUpSuggestTimesRequest = AppointmentSuggestTimesRequest;

/** `POST /appointments/:id/schedule` (expert picks one suggested window). */
export const FollowUpScheduleRequestSchema = z.object({
  selectedWindowIndex: z
    .number()
    .int()
    .min(0)
    .max(FOLLOW_UP_MAX_SUGGESTED_WINDOWS - 1),
});
export type FollowUpScheduleRequest = z.infer<typeof FollowUpScheduleRequestSchema>;

// ---------------------------------------------------------------------------
// Approval decision (CALL-39, CW-R-109)
// ---------------------------------------------------------------------------

/**
 * C0 and C1 control characters and the bidirectional formatting characters
 * (U+200E, U+200F, U+202A to U+202E, U+2066 to U+2069) of a safe text.
 */
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const UNSAFE_TEXT_CHARACTERS = /[\u0000-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

/**
 * A safe free text as stored and shown: every line break and tab becomes a
 * space, every other control or bidirectional formatting character is
 * dropped (T-CW-1.10). The caller trims.
 */
export function stripControlCharacters(value: string): string {
  return value.replace(/[\t\n\r]/g, ' ').replace(UNSAFE_TEXT_CHARACTERS, '');
}

/**
 * `POST /appointment-approvals/:id/reject` body. Approve takes no body. The
 * reason is the one free text of the approval flow (D-CW-37): shown to the
 * employee, never written to the audit log; stripped of control characters,
 * trimmed, 1 to 300 characters.
 */
export const AppointmentApprovalDecisionRequestSchema = z.strictObject({
  safeReason: z
    .string()
    .transform(stripControlCharacters)
    .pipe(z.string().trim().min(1).max(APPROVAL_SAFE_REASON_MAX_LENGTH)),
});
export type AppointmentApprovalDecisionRequest = z.infer<
  typeof AppointmentApprovalDecisionRequestSchema
>;

// ---------------------------------------------------------------------------
// Socket.IO room `user:{userId}` (CALL-42, CALL-01 criterion 5)
// ---------------------------------------------------------------------------

/**
 * One user's own room: only that user may subscribe. It carries what must
 * reach the user wherever they are in the app, not only on a call page: a
 * follow-up proposal made after the employee left the post-call screen
 * (`appointment.follow_up.proposed`, to the employee), the employee's
 * alternative windows (`appointment.times_suggested`, to the expert), both
 * with the call room's payloads (`FollowUpProposedPayloadSchema`,
 * `TimesSuggestedPayloadSchema`), and the in-app reminder toast
 * (`appointment.remind`).
 */
export function userRoomName(userId: string): string {
  return `user:${userId}`;
}

export const USER_ROOM_EVENT_NAMES = [
  'appointment.follow_up.proposed',
  'appointment.times_suggested',
  'appointment.remind',
] as const;
export const UserRoomEventNameSchema = z.enum(USER_ROOM_EVENT_NAMES);
export type UserRoomEventName = z.infer<typeof UserRoomEventNameSchema>;

/**
 * `appointment.remind` on `user:{userId}`: a reminder fired while the user is
 * online (D-CW-26, guidelines 10.4). Ids, times and the appointment's time
 * zone, in which the toast shows the start: no category, no other
 * participant.
 */
export const AppointmentRemindPayloadSchema = z.strictObject({
  appointmentId: idField,
  startsAt: isoDateTime,
  /** Minutes before `startsAt` this reminder belongs to (`REMINDER_OFFSETS_MINUTES`). */
  offsetMinutes: z.number().int().positive(),
  timeZone: TimeZoneSchema,
});
export type AppointmentRemindPayload = z.infer<typeof AppointmentRemindPayloadSchema>;

// ---------------------------------------------------------------------------
// Approval items (T-CW-1.10, D-CW-37, CW-R-119, LAW-14)
// ---------------------------------------------------------------------------

/**
 * What the approver is told the session is, in the API's fixed English; the
 * apps render their own translation (`calls:approval.followUpLabel`). Never
 * the service category, the expert or their specialty.
 */
export const APPROVAL_FOLLOW_UP_DESCRIPTION = 'follow-up session with a NestSelf expert';

/**
 * The approval-authority category that covers follow-ups (D-CW-37): an
 * authority routes them when its `categories` are empty or contain it.
 */
export const FOLLOW_UP_APPROVAL_CATEGORY = 'consultation_follow_up';

/**
 * Every field an approver sees: the item and appointment ids, the status and
 * four facts (the employee's display name, the fixed description, the start
 * and the duration). A serialisation test in the API asserts nothing else
 * leaves the server.
 */
export const APPOINTMENT_APPROVAL_ITEM_FIELDS = [
  'id',
  'appointmentId',
  'status',
  'employeeDisplayName',
  'description',
  'startsAt',
  'durationMinutes',
] as const;

/** One approval item as the approver sees it (`GET /orgs/:orgId/appointment-approvals`, approve, reject). */
export const AppointmentApprovalItemSchema = z.strictObject({
  id: idField,
  appointmentId: idField,
  status: AppointmentApprovalStatusSchema,
  employeeDisplayName: z.string().min(1).max(200),
  description: z.literal(APPROVAL_FOLLOW_UP_DESCRIPTION),
  startsAt: isoDateTime,
  durationMinutes: z.number().int().positive(),
});
export type AppointmentApprovalItem = z.infer<typeof AppointmentApprovalItemSchema>;

/** `GET /orgs/:orgId/appointment-approvals`: the caller's items, pending first, then decided, newest first. */
export const AppointmentApprovalListResponseSchema = z.object({
  items: z.array(AppointmentApprovalItemSchema),
});
export type AppointmentApprovalListResponse = z.infer<typeof AppointmentApprovalListResponseSchema>;

/** `PATCH /orgs/:orgId/settings/follow-up-approval` body (CALL-41). */
export const FollowUpApprovalPolicyRequestSchema = z.strictObject({
  policy: FollowUpApprovalPolicySchema,
});
export type FollowUpApprovalPolicyRequest = z.infer<typeof FollowUpApprovalPolicyRequestSchema>;

/** `GET` and `PATCH /orgs/:orgId/settings/follow-up-approval` response. */
export const FollowUpApprovalPolicyResponseSchema = z.object({
  policy: FollowUpApprovalPolicySchema,
});
export type FollowUpApprovalPolicyResponse = z.infer<typeof FollowUpApprovalPolicyResponseSchema>;
