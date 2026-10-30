/**
 * Sample appointments and call sessions for the calls and webinars epic
 * (NS-CALLS-01, T-CW-0.7). Shaped after the `appointments`, `call_sessions`,
 * `call_participants`, `call_outcomes` and `call_feedback` tables
 * (implementation guidelines 5.1) with the lower-case contract spellings.
 *
 * Every person is an existing sample person (`user_milica` is the sample
 * expert, `user_jovan` the sample employee of `org_sample`), so the seed can
 * satisfy foreign keys. Times are UTC instants of wall-clock times in
 * Europe/Belgrade: 16:00 in October is 14:00Z (summer time), in November
 * 15:00Z (winter time; the clocks go back on 2026-10-25).
 */
import type {
  Appointment,
  CallFormat,
  CallOutcomeStatus,
  CallParticipantRole,
  CallQualityMetrics,
  CallSessionStatus,
} from '@nestself/contracts';

/** A sample appointment; `sample: true` is the fixture marker, not part of the API shape. */
export type SampleAppointment = Appointment & { readonly sample: true };

/** A `call_participants` row of a sample session. */
export interface SampleCallParticipant {
  readonly id: string;
  readonly userId: string;
  readonly role: CallParticipantRole;
  readonly firstJoinedAt: string | null;
  readonly lastLeftAt: string | null;
  readonly reconnectCount: number;
}

/** A `call_outcomes` row: no free text (CW-R-21). */
export interface SampleCallOutcome {
  readonly id: string;
  readonly status: CallOutcomeStatus;
  readonly recordedByUserId: string;
  readonly connectionMetrics: CallQualityMetrics | null;
}

/** A `call_feedback` row: never shown to the employer (CW-R-22). */
export interface SampleCallFeedback {
  readonly id: string;
  readonly userId: string;
  readonly score: number;
  readonly comment: string | null;
}

/** A `call_sessions` row with its participants, outcome and feedback. */
export interface SampleCallSession {
  readonly id: string;
  readonly appointmentId: string | null;
  readonly webinarId: string | null;
  readonly orgId: string | null;
  readonly format: CallFormat;
  readonly providerMeetingId: string | null;
  readonly status: CallSessionStatus;
  /** Scheduled window, copied from the appointment or the webinar. */
  readonly startsAt: string;
  readonly endsAt: string;
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly participants: readonly SampleCallParticipant[];
  readonly outcome: SampleCallOutcome | null;
  readonly feedback: readonly SampleCallFeedback[];
  readonly sample: true;
}

const ORG_ID = 'org_sample';
const EXPERT_USER_ID = 'user_milica';
const EMPLOYEE_USER_ID = 'user_jovan';
const TIME_ZONE = 'Europe/Belgrade';
const SERVICE_CATEGORY = 'psychological';

const COMPLETED_ID = 'appt_sample_completed';

const base = {
  orgId: ORG_ID,
  expertUserId: EXPERT_USER_ID,
  employeeUserId: EMPLOYEE_USER_ID,
  serviceCategory: SERVICE_CATEGORY,
  timeZone: TIME_ZONE,
  fundingRef: null,
  sample: true,
} as const;

export const SAMPLE_APPOINTMENTS: readonly SampleAppointment[] = [
  {
    // 14 October 2026, 16:00 to 16:50 in Belgrade.
    ...base,
    id: COMPLETED_ID,
    startsAt: '2026-10-14T14:00:00.000Z',
    endsAt: '2026-10-14T14:50:00.000Z',
    status: 'completed',
    followUpOf: null,
  },
  {
    // 21 October 2026, 10:00 to 10:50 in Belgrade.
    ...base,
    id: 'appt_sample_canceled',
    startsAt: '2026-10-21T08:00:00.000Z',
    endsAt: '2026-10-21T08:50:00.000Z',
    status: 'canceled',
    followUpOf: null,
  },
  {
    // Follow-up the expert proposed; the employee has not answered yet.
    // 4 November 2026, 16:00 to 16:50 in Belgrade.
    ...base,
    id: 'appt_sample_follow_up_proposed',
    startsAt: '2026-11-04T15:00:00.000Z',
    endsAt: '2026-11-04T15:50:00.000Z',
    status: 'proposed',
    followUpOf: COMPLETED_ID,
  },
  {
    // Follow-up the employee confirmed under the manager_approval policy.
    // 11 November 2026, 16:00 to 16:50 in Belgrade.
    ...base,
    id: 'appt_sample_follow_up_awaiting',
    startsAt: '2026-11-11T15:00:00.000Z',
    endsAt: '2026-11-11T15:50:00.000Z',
    status: 'awaiting_approval',
    followUpOf: COMPLETED_ID,
  },
  {
    // The upcoming confirmed consultation. 18 November 2026, 17:00 to 17:50 in Belgrade.
    ...base,
    id: 'appt_sample_upcoming',
    startsAt: '2026-11-18T16:00:00.000Z',
    endsAt: '2026-11-18T16:50:00.000Z',
    status: 'confirmed',
    followUpOf: null,
  },
];

/**
 * One ended consultation (the completed appointment, with its outcome and the
 * employee's feedback) and one ended webinar session (`webinar_sample_ended`
 * in `webinars.ts`), which `webinar_messages.session_id` and the poll need.
 * Webinar sessions have no outcome and no feedback.
 */
export const SAMPLE_CALL_SESSIONS: readonly SampleCallSession[] = [
  {
    id: 'call_session_sample_consultation',
    appointmentId: COMPLETED_ID,
    webinarId: null,
    orgId: ORG_ID,
    format: 'consultation',
    providerMeetingId: 'sample_meeting_consultation',
    status: 'ended',
    startsAt: '2026-10-14T14:00:00.000Z',
    endsAt: '2026-10-14T14:50:00.000Z',
    startedAt: '2026-10-14T13:56:00.000Z',
    endedAt: '2026-10-14T14:49:00.000Z',
    participants: [
      {
        id: 'call_participant_sample_expert',
        userId: EXPERT_USER_ID,
        role: 'expert',
        firstJoinedAt: '2026-10-14T13:56:00.000Z',
        lastLeftAt: '2026-10-14T14:49:00.000Z',
        reconnectCount: 0,
      },
      {
        id: 'call_participant_sample_employee',
        userId: EMPLOYEE_USER_ID,
        role: 'employee',
        firstJoinedAt: '2026-10-14T13:58:00.000Z',
        lastLeftAt: '2026-10-14T14:48:00.000Z',
        reconnectCount: 1,
      },
    ],
    outcome: {
      id: 'call_outcome_sample_consultation',
      status: 'completed',
      recordedByUserId: EXPERT_USER_ID,
      connectionMetrics: { rtt: 42, jitter: 6, packetLoss: 0.004, outgoingBitrate: 900_000 },
    },
    feedback: [
      {
        id: 'call_feedback_sample_consultation',
        userId: EMPLOYEE_USER_ID,
        score: 4,
        comment: 'Sample feedback comment (fixture)',
      },
    ],
    sample: true,
  },
  {
    id: 'call_session_sample_webinar',
    appointmentId: null,
    webinarId: 'webinar_sample_ended',
    orgId: ORG_ID,
    format: 'webinar',
    providerMeetingId: 'sample_meeting_webinar',
    status: 'ended',
    startsAt: '2026-10-15T15:00:00.000Z',
    endsAt: '2026-10-15T16:00:00.000Z',
    startedAt: '2026-10-15T14:32:00.000Z',
    endedAt: '2026-10-15T15:58:00.000Z',
    participants: [
      {
        id: 'call_participant_sample_presenter',
        userId: EXPERT_USER_ID,
        role: 'presenter',
        firstJoinedAt: '2026-10-15T14:35:00.000Z',
        lastLeftAt: '2026-10-15T15:58:00.000Z',
        reconnectCount: 0,
      },
      {
        id: 'call_participant_sample_moderator',
        userId: 'user_nikola',
        role: 'moderator',
        firstJoinedAt: '2026-10-15T14:32:00.000Z',
        lastLeftAt: '2026-10-15T15:58:00.000Z',
        reconnectCount: 0,
      },
      {
        id: 'call_participant_sample_attendee_jovan',
        userId: EMPLOYEE_USER_ID,
        role: 'attendee',
        firstJoinedAt: '2026-10-15T14:52:00.000Z',
        lastLeftAt: '2026-10-15T15:58:00.000Z',
        reconnectCount: 0,
      },
      {
        id: 'call_participant_sample_attendee_ana',
        userId: 'user_ana',
        role: 'attendee',
        firstJoinedAt: '2026-10-15T15:03:00.000Z',
        lastLeftAt: '2026-10-15T15:51:00.000Z',
        reconnectCount: 0,
      },
    ],
    outcome: null,
    feedback: [],
    sample: true,
  },
];
