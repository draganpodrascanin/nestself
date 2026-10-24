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

export const AppointmentResponseSchema = AppointmentSchema;
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

export const FollowUpTimeWindowSchema = z
  .object({
    startsAt: isoDateTime,
    endsAt: isoDateTime,
  })
  .refine(endsAfterStart, endsAfterStartIssue);
export type FollowUpTimeWindow = z.infer<typeof FollowUpTimeWindowSchema>;

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
 * `POST /appointment-approvals/:id/reject` body. Approve takes no body.
 */
export const AppointmentApprovalDecisionRequestSchema = z.object({
  safeReason: z.string().trim().min(1).max(APPROVAL_SAFE_REASON_MAX_LENGTH),
});
export type AppointmentApprovalDecisionRequest = z.infer<
  typeof AppointmentApprovalDecisionRequestSchema
>;
