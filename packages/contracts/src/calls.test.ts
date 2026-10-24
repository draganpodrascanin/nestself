import { describe, expect, it } from 'vitest';
import { AUTH_ERROR_CODES } from './auth.ts';
import {
  API_ERROR_CODES,
  ApiErrorCodeSchema,
  CALL_ERROR_CODES,
  CALL_FEEDBACK_COMMENT_MAX_LENGTH,
  CALL_FORMATS,
  CALL_JOIN_WINDOW_AFTER_MINUTES,
  CALL_JOIN_WINDOW_BEFORE_MINUTES,
  CALL_OUTCOME_STATUSES,
  CALL_PARTICIPANT_ROLES,
  CALL_ROOM_CLOSE_AFTER_MINUTES,
  CALL_SESSION_STATUSES,
  CALL_TICKET_TTL_SECONDS,
  CLIENT_EVENT_NAMES,
  CallFeedbackRequestSchema,
  CallFormatSchema,
  CallJoinResponseSchema,
  CallOutcomeRequestSchema,
  CallOutcomeStatusSchema,
  CallParticipantRoleSchema,
  CallSessionStatusSchema,
  ClientEventRequestSchema,
  DIAGNOSTICS_PARTICIPANT_FIELDS,
  DIAGNOSTICS_RESPONSE_FIELDS,
  DiagnosticsResponseSchema,
  RECORDING_STATUSES,
  REMINDER_OFFSETS_MINUTES,
  RecordingStatusSchema,
  VIDEO_PROVIDERS,
  WEBINAR_HOST_JOIN_BEFORE_MINUTES,
  WEBINAR_MESSAGE_KINDS,
  WEBINAR_MESSAGE_STATUSES,
  WEBINAR_SINGLE_MEETING_CAPACITY,
  WORKSHOP_CAPACITY,
  WebinarMessageKindSchema,
  WebinarMessageStatusSchema,
} from './calls.ts';
import * as entry from './index.ts';

function issuePaths(result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) {
  return (result.error?.issues ?? []).map((i) => i.path.join('.'));
}

describe('call constants (decision record section 7)', () => {
  it('have the canonical values', () => {
    expect(CALL_JOIN_WINDOW_BEFORE_MINUTES).toBe(15);
    expect(CALL_JOIN_WINDOW_AFTER_MINUTES).toBe(10);
    expect(CALL_ROOM_CLOSE_AFTER_MINUTES).toBe(15);
    expect(WEBINAR_HOST_JOIN_BEFORE_MINUTES).toBe(30);
    expect(WEBINAR_SINGLE_MEETING_CAPACITY).toBe(250);
    expect(WORKSHOP_CAPACITY).toBe(25);
    expect(REMINDER_OFFSETS_MINUTES).toEqual([1440, 60]);
    expect(CALL_TICKET_TTL_SECONDS).toBe(30);
  });
});

describe('call enums', () => {
  const cases = [
    ['call_session_status', CALL_SESSION_STATUSES, CallSessionStatusSchema, ['pending', 'creating', 'active', 'ended', 'failed']],
    [
      'call_participant_role',
      CALL_PARTICIPANT_ROLES,
      CallParticipantRoleSchema,
      ['expert', 'employee', 'presenter', 'moderator', 'attendee', 'facilitator', 'participant'],
    ],
    ['call_format', CALL_FORMATS, CallFormatSchema, ['consultation', 'webinar', 'workshop']],
    [
      'call_outcome_status',
      CALL_OUTCOME_STATUSES,
      CallOutcomeStatusSchema,
      ['completed', 'no_show_employee', 'no_show_expert', 'technical_failure', 'canceled'],
    ],
    [
      'recording_status',
      RECORDING_STATUSES,
      RecordingStatusSchema,
      ['scheduled', 'recording', 'processing', 'ready', 'handed_off', 'failed'],
    ],
    ['webinar_message_kind', WEBINAR_MESSAGE_KINDS, WebinarMessageKindSchema, ['host', 'attendee', 'question']],
    [
      'webinar_message_status',
      WEBINAR_MESSAGE_STATUSES,
      WebinarMessageStatusSchema,
      ['pending', 'published', 'answered', 'dismissed'],
    ],
  ] as const;

  for (const [name, values, schema, expected] of cases) {
    it(`${name} has the canonical values and rejects others`, () => {
      expect(values).toEqual(expected);
      for (const v of values) expect(schema.safeParse(v).success, v).toBe(true);
      expect(schema.safeParse(values[0].toUpperCase()).success).toBe(false);
      expect(schema.safeParse('unknown').success).toBe(false);
    });
  }

  it('video providers match the VIDEO_PROVIDER env values', () => {
    expect(VIDEO_PROVIDERS).toEqual(['none', 'chime']);
  });
});

describe('CALL_ERROR_CODES (CW-R-27)', () => {
  it('contains every canonical error code', () => {
    expect(CALL_ERROR_CODES).toEqual([
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
    ]);
  });

  it('has no duplicates and no overlap with AUTH_ERROR_CODES', () => {
    expect(new Set(CALL_ERROR_CODES).size).toBe(CALL_ERROR_CODES.length);
    const auth = new Set<string>(AUTH_ERROR_CODES);
    for (const code of CALL_ERROR_CODES) expect(auth.has(code), code).toBe(false);
  });

  it('is merged with AUTH_ERROR_CODES into API_ERROR_CODES', () => {
    expect(API_ERROR_CODES).toEqual([...AUTH_ERROR_CODES, ...CALL_ERROR_CODES]);
    expect(new Set(API_ERROR_CODES).size).toBe(API_ERROR_CODES.length);
    expect(ApiErrorCodeSchema.safeParse('join_window_closed').success).toBe(true);
    expect(ApiErrorCodeSchema.safeParse('step_up_required').success).toBe(true);
    expect(ApiErrorCodeSchema.safeParse('not_a_code').success).toBe(false);
  });
});

describe('CallJoinResponseSchema', () => {
  const valid = {
    sessionId: 'sess_1',
    participantId: 'part_1',
    role: 'employee',
    format: 'consultation',
    startsAt: '2026-11-03T09:00:00.000Z',
    endsAt: '2026-11-03T09:50:00.000Z',
    meeting: {
      MeetingId: 'meeting-1',
      MediaRegion: 'eu-central-1',
      MediaPlacement: {
        AudioHostUrl: 'audio.example:3478',
        AudioFallbackUrl: 'wss://audio.example:443/calls/meeting-1',
        SignalingUrl: 'wss://signal.example/control/meeting-1',
        TurnControlUrl: 'https://turn.example/v2/turn_sessions',
      },
    },
    attendee: {
      AttendeeId: 'attendee-1',
      ExternalUserId: 'part_1',
      JoinToken: 'fake-join-token-part_1',
    },
  };

  it('accepts a valid join response', () => {
    expect(CallJoinResponseSchema.parse(valid)).toEqual(valid);
  });

  it('rejects missing session, credential and media fields', () => {
    for (const field of ['sessionId', 'participantId', 'role', 'format', 'startsAt', 'endsAt', 'meeting', 'attendee']) {
      const input: Record<string, unknown> = { ...valid };
      delete input[field];
      expect(issuePaths(CallJoinResponseSchema.safeParse(input)), field).toEqual([field]);
    }
    const noToken = { ...valid, attendee: { AttendeeId: 'attendee-1', ExternalUserId: 'part_1' } };
    expect(issuePaths(CallJoinResponseSchema.safeParse(noToken))).toEqual(['attendee.JoinToken']);
    const noSignal = {
      ...valid,
      meeting: { ...valid.meeting, MediaPlacement: { ...valid.meeting.MediaPlacement, SignalingUrl: undefined } },
    };
    expect(issuePaths(CallJoinResponseSchema.safeParse(noSignal))).toEqual(['meeting.MediaPlacement.SignalingUrl']);
  });

  it('drops the provider event ingestion URL (D-CW-13)', () => {
    const withIngestion = {
      ...valid,
      meeting: {
        ...valid.meeting,
        MediaPlacement: { ...valid.meeting.MediaPlacement, EventIngestionUrl: 'https://data.example/client-events' },
      },
    };
    const parsed = CallJoinResponseSchema.parse(withIngestion);
    expect(parsed.meeting.MediaPlacement).not.toHaveProperty('EventIngestionUrl');
  });
});

describe('CallOutcomeRequestSchema (CW-R-21)', () => {
  it('accepts every outcome status', () => {
    for (const status of CALL_OUTCOME_STATUSES) {
      expect(CallOutcomeRequestSchema.parse({ status })).toEqual({ status });
    }
  });

  it('rejects a missing or unknown status', () => {
    expect(issuePaths(CallOutcomeRequestSchema.safeParse({}))).toEqual(['status']);
    expect(issuePaths(CallOutcomeRequestSchema.safeParse({ status: 'partial' }))).toEqual(['status']);
  });

  it('rejects free text alongside the status', () => {
    expect(CallOutcomeRequestSchema.safeParse({ status: 'completed', notes: 'went well' }).success).toBe(false);
  });
});

describe('CallFeedbackRequestSchema (CW-R-22)', () => {
  it('accepts a score from 1 to 5 with an optional comment', () => {
    for (const score of [1, 2, 3, 4, 5]) {
      expect(CallFeedbackRequestSchema.parse({ score })).toEqual({ score });
    }
    expect(CallFeedbackRequestSchema.parse({ score: 4, comment: '  Helpful.  ' })).toEqual({
      score: 4,
      comment: 'Helpful.',
    });
    expect(CallFeedbackRequestSchema.parse({ score: 4, comment: null })).toEqual({ score: 4, comment: null });
  });

  it('rejects a missing, fractional or out-of-range score', () => {
    for (const score of [undefined, 0, 6, 3.5]) {
      expect(issuePaths(CallFeedbackRequestSchema.safeParse({ score })), String(score)).toEqual(['score']);
    }
  });

  it('caps the comment at 2000 characters', () => {
    expect(CALL_FEEDBACK_COMMENT_MAX_LENGTH).toBe(2000);
    const long = 'a'.repeat(CALL_FEEDBACK_COMMENT_MAX_LENGTH + 1);
    expect(issuePaths(CallFeedbackRequestSchema.safeParse({ score: 3, comment: long }))).toEqual(['comment']);
  });
});

describe('ClientEventRequestSchema (D-CW-13)', () => {
  it('names the Chime client events and the 30-second stats aggregate', () => {
    expect(CLIENT_EVENT_NAMES).toEqual([
      'meetingStartSucceeded',
      'meetingStartFailed',
      'meetingFailed',
      'meetingReconnected',
      'audioInputFailed',
      'videoInputFailed',
      'signalingDropped',
      'connectionStats',
    ]);
  });

  it('accepts a start event and a stats aggregate', () => {
    const start = { eventName: 'meetingStartSucceeded', durationMs: 2300, browser: 'Chrome 130', os: 'macOS 15' };
    expect(ClientEventRequestSchema.parse(start)).toEqual(start);
    const stats = {
      eventName: 'connectionStats',
      metrics: { rtt: 42, jitter: 3.5, packetLoss: 0.01, outgoingBitrate: 1_200_000 },
    };
    expect(ClientEventRequestSchema.parse(stats)).toEqual(stats);
    const deviceFailure = { eventName: 'audioInputFailed', deviceError: 'NotAllowedError' };
    expect(ClientEventRequestSchema.parse(deviceFailure)).toEqual(deviceFailure);
  });

  it('rejects a missing or unknown event name', () => {
    expect(issuePaths(ClientEventRequestSchema.safeParse({}))).toEqual(['eventName']);
    expect(issuePaths(ClientEventRequestSchema.safeParse({ eventName: 'chatMessage' }))).toEqual(['eventName']);
  });

  it('rejects device labels, names and content (only error names are allowed)', () => {
    expect(
      ClientEventRequestSchema.safeParse({ eventName: 'audioInputFailed', deviceLabel: 'MacBook Pro Microphone' }).success,
    ).toBe(false);
    expect(
      issuePaths(
        ClientEventRequestSchema.safeParse({ eventName: 'audioInputFailed', deviceError: 'Could not start MacBook Pro Microphone' }),
      ),
    ).toEqual(['deviceError']);
    expect(
      ClientEventRequestSchema.safeParse({ eventName: 'connectionStats', metrics: { rtt: 40, speaker: 'Ana' } }).success,
    ).toBe(false);
  });

  it('rejects negative metrics and a packet-loss fraction above 1', () => {
    expect(issuePaths(ClientEventRequestSchema.safeParse({ eventName: 'connectionStats', metrics: { rtt: -1 } }))).toEqual([
      'metrics.rtt',
    ]);
    expect(
      issuePaths(ClientEventRequestSchema.safeParse({ eventName: 'connectionStats', metrics: { packetLoss: 1.5 } })),
    ).toEqual(['metrics.packetLoss']);
    expect(issuePaths(ClientEventRequestSchema.safeParse({ eventName: 'meetingStartSucceeded', durationMs: -5 }))).toEqual([
      'durationMs',
    ]);
  });
});

describe('DiagnosticsResponseSchema (D-CW-28, CW-R-86)', () => {
  const participant = {
    role: 'employee',
    joinedAt: '2026-11-03T09:01:00.000Z',
    leftAt: '2026-11-03T09:49:00.000Z',
    reconnectCount: 1,
    qualityMetrics: { rtt: 40, jitter: 2, packetLoss: 0.002, outgoingBitrate: 900_000 },
    errorCodes: ['signalingDropped'],
    browser: 'Firefox 132',
    os: 'Windows 11',
  };
  const valid = {
    sessionId: 'sess_1',
    appointmentId: 'appt_1',
    webinarId: null,
    startedAt: '2026-11-03T09:00:30.000Z',
    endedAt: '2026-11-03T09:50:00.000Z',
    status: 'ended',
    provider: 'chime',
    providerMeetingId: 'meeting-1',
    participants: [participant],
  };

  it('allowlists exactly the 4.7.5 fields', () => {
    expect(DIAGNOSTICS_RESPONSE_FIELDS).toEqual([
      'sessionId',
      'appointmentId',
      'webinarId',
      'startedAt',
      'endedAt',
      'status',
      'provider',
      'providerMeetingId',
      'participants',
    ]);
    expect(DIAGNOSTICS_PARTICIPANT_FIELDS).toEqual([
      'role',
      'joinedAt',
      'leftAt',
      'reconnectCount',
      'qualityMetrics',
      'errorCodes',
      'browser',
      'os',
    ]);
    expect(Object.keys(DiagnosticsResponseSchema.shape)).toEqual([...DIAGNOSTICS_RESPONSE_FIELDS]);
  });

  it('accepts a valid diagnostics payload, including a session that never started', () => {
    expect(DiagnosticsResponseSchema.parse(valid)).toEqual(valid);
    const pending = {
      ...valid,
      startedAt: null,
      endedAt: null,
      status: 'pending',
      providerMeetingId: null,
      participants: [
        { ...participant, joinedAt: null, leftAt: null, reconnectCount: 0, qualityMetrics: null, errorCodes: [], browser: null, os: null },
      ],
    };
    expect(DiagnosticsResponseSchema.parse(pending)).toEqual(pending);
  });

  it('rejects each missing field', () => {
    for (const field of DIAGNOSTICS_RESPONSE_FIELDS) {
      const input: Record<string, unknown> = { ...valid };
      delete input[field];
      expect(issuePaths(DiagnosticsResponseSchema.safeParse(input)), field).toEqual([field]);
    }
    for (const field of DIAGNOSTICS_PARTICIPANT_FIELDS) {
      const p: Record<string, unknown> = { ...participant };
      delete p[field];
      expect(issuePaths(DiagnosticsResponseSchema.safeParse({ ...valid, participants: [p] })), field).toEqual([
        `participants.0.${field}`,
      ]);
    }
  });

  it('rejects any field outside the allowlist, at both levels', () => {
    for (const extra of ['serviceCategory', 'employeeUserId', 'notes', 'joinToken']) {
      expect(DiagnosticsResponseSchema.safeParse({ ...valid, [extra]: 'x' }).success, extra).toBe(false);
    }
    for (const extra of ['userId', 'displayName', 'email', 'deviceLabel']) {
      expect(
        DiagnosticsResponseSchema.safeParse({ ...valid, participants: [{ ...participant, [extra]: 'x' }] }).success,
        extra,
      ).toBe(false);
    }
  });
});

describe('package entry', () => {
  it('re-exports the appointment and call contracts', () => {
    expect(entry.CALL_ERROR_CODES).toBe(CALL_ERROR_CODES);
    expect(entry.API_ERROR_CODES).toBe(API_ERROR_CODES);
    expect(entry.DiagnosticsResponseSchema).toBe(DiagnosticsResponseSchema);
    expect(entry.CALL_JOIN_WINDOW_BEFORE_MINUTES).toBe(15);
    expect(entry.AppointmentSchema).toBeDefined();
    expect(entry.FollowUpSuggestTimesRequestSchema).toBeDefined();
    expect(entry.APPOINTMENT_STATUS_TRANSITIONS).toBeDefined();
  });
});
