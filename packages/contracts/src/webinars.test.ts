import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { ACTIONS } from './actions.ts';
import { CALL_ERROR_CODES, CALL_ROOM_EVENT_NAMES, WEBINAR_SINGLE_MEETING_CAPACITY } from './calls.ts';
import { locales } from './locale.ts';
import { PERMISSION_TEMPLATES } from './templates.ts';
import {
  CHIME_CAPABILITY_BY_MEDIA_CAPABILITY,
  ROOM_EVENT_PAYLOAD_SCHEMAS,
  WEBINAR_EVENT_NAMES,
  WEBINAR_EVENT_PAYLOAD_SCHEMAS,
  WEBINAR_MESSAGE_TEXT_MAX_LENGTH,
  WEBINAR_MODERATION_ROOM_EVENT_NAMES,
  WEBINAR_PARTICIPANT_EVENT_NAMES,
  WEBINAR_POLL_OPTIONS_MAX,
  WEBINAR_POLL_OPTIONS_MIN,
  WEBINAR_ROOM_EVENT_NAMES,
  WEBINAR_STATUSES,
  WEBINAR_STATUS_TRANSITIONS,
  WebinarAttendanceResponseSchema,
  WebinarAudiencePolicySchema,
  WebinarCreateRequestSchema,
  WebinarFloorResponseSchema,
  WebinarHandRaiseResponseSchema,
  WebinarJoinResponseSchema,
  WebinarListQuerySchema,
  WebinarListResponseSchema,
  WebinarLocalizedTextSchema,
  WebinarMessageAnswerRequestSchema,
  WebinarMessageCreateRequestSchema,
  WebinarMessageListResponseSchema,
  WebinarMessageSchema,
  WebinarModerationMessageSchema,
  WebinarPollCreateRequestSchema,
  WebinarPollResultsSchema,
  WebinarPollSchema,
  WebinarPollVoteRequestSchema,
  WebinarRecordingPayloadSchema,
  WebinarRecordingStatusResponseSchema,
  WebinarRegistrationResponseSchema,
  WebinarResponseSchema,
  WebinarSchema,
  WebinarStatusSchema,
  WebinarUpdateRequestSchema,
  canTransitionWebinar,
  webinarModerationRoomName,
  webinarRoomName,
  type WebinarStatus,
} from './webinars.ts';
import * as entry from './index.ts';

function issuePaths(result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) {
  return (result.error?.issues ?? []).map((i) => i.path.join('.'));
}

const title = { en: 'Planning a balanced working week', 'sr-Latn': 'Planiranje uravnotežene radne nedelje' };

const createBody = {
  title,
  presenterUserIds: ['user_milica'],
  moderatorUserId: 'user_nikola',
  startsAt: '2026-11-25T16:00:00.000Z',
  endsAt: '2026-11-25T17:00:00.000Z',
  timeZone: 'Europe/Belgrade',
  audiencePolicy: { type: 'all_eligible' },
  capacity: 120,
};

describe('webinar status (decision record section 7)', () => {
  it('has the canonical lower-case values', () => {
    expect(WEBINAR_STATUSES).toEqual(['draft', 'published', 'live', 'ended', 'canceled']);
    expect(WebinarStatusSchema.safeParse('DRAFT').success).toBe(false);
  });

  it('allows draft -> published|canceled, published -> live|canceled, live -> ended only', () => {
    const allowed: [WebinarStatus, WebinarStatus][] = [
      ['draft', 'published'],
      ['draft', 'canceled'],
      ['published', 'live'],
      ['published', 'canceled'],
      ['live', 'ended'],
    ];
    for (const from of WEBINAR_STATUSES) {
      for (const to of WEBINAR_STATUSES) {
        const expected = allowed.some(([f, t]) => f === from && t === to);
        expect(canTransitionWebinar(from, to), `${from} -> ${to}`).toBe(expected);
      }
    }
    expect(WEBINAR_STATUS_TRANSITIONS.ended).toEqual([]);
    expect(WEBINAR_STATUS_TRANSITIONS.canceled).toEqual([]);
  });
});

describe('WebinarAudiencePolicySchema (D-CW-17)', () => {
  it('accepts all_eligible, organisations and organisational units of one organisation', () => {
    expect(WebinarAudiencePolicySchema.parse({ type: 'all_eligible' })).toEqual({ type: 'all_eligible' });
    expect(WebinarAudiencePolicySchema.parse({ type: 'organization', orgIds: ['org_a', 'org_b'] }).type).toBe(
      'organization',
    );
    expect(
      WebinarAudiencePolicySchema.parse({ type: 'org_unit', orgId: 'org_a', orgUnitIds: ['ou_1'] }).type,
    ).toBe('org_unit');
  });

  it('refuses empty or duplicate id lists, foreign fields and unknown types', () => {
    expect(WebinarAudiencePolicySchema.safeParse({ type: 'organization', orgIds: [] }).success).toBe(false);
    expect(WebinarAudiencePolicySchema.safeParse({ type: 'organization', orgIds: ['org_a', 'org_a'] }).success).toBe(
      false,
    );
    expect(WebinarAudiencePolicySchema.safeParse({ type: 'org_unit', orgId: 'org_a', orgUnitIds: [] }).success).toBe(
      false,
    );
    expect(WebinarAudiencePolicySchema.safeParse({ type: 'org_unit', orgUnitIds: ['ou_1'] }).success).toBe(false);
    expect(WebinarAudiencePolicySchema.safeParse({ type: 'all_eligible', orgIds: ['org_a'] }).success).toBe(false);
    expect(WebinarAudiencePolicySchema.safeParse({ type: 'everyone' }).success).toBe(false);
  });
});

describe('WebinarLocalizedTextSchema', () => {
  it('is keyed by the four locales and needs at least one', () => {
    expect(Object.keys(WebinarLocalizedTextSchema.shape).sort()).toEqual([...locales].sort());
    expect(WebinarLocalizedTextSchema.parse({ hu: 'Szünetek' })).toEqual({ hu: 'Szünetek' });
    expect(WebinarLocalizedTextSchema.safeParse({}).success).toBe(false);
    expect(WebinarLocalizedTextSchema.safeParse({ de: 'Pausen' }).success).toBe(false);
    expect(WebinarLocalizedTextSchema.safeParse({ en: '   ' }).success).toBe(false);
  });
});

describe('WebinarCreateRequestSchema (WBN-30)', () => {
  it('accepts a full occurrence and defaults nothing it was given', () => {
    const parsed = WebinarCreateRequestSchema.parse(createBody);
    expect(parsed.capacity).toBe(120);
    expect(parsed.presenterUserIds).toEqual(['user_milica']);
  });

  it('defaults capacity to the single-meeting limit and allows a draft without hosts', () => {
    const { capacity: _c, presenterUserIds: _p, moderatorUserId: _m, ...draft } = createBody;
    const parsed = WebinarCreateRequestSchema.parse(draft);
    expect(parsed.capacity).toBe(WEBINAR_SINGLE_MEETING_CAPACITY);
    expect(parsed.presenterUserIds).toEqual([]);
    expect(parsed.moderatorUserId).toBeNull();
  });

  it('refines capacity at 250 with the capacity_above_limit code until M3 (D-CW-36)', () => {
    expect(WebinarCreateRequestSchema.safeParse({ ...createBody, capacity: 250 }).success).toBe(true);
    const over = WebinarCreateRequestSchema.safeParse({ ...createBody, capacity: 251 });
    expect(over.success).toBe(false);
    expect(over.error?.issues).toHaveLength(1);
    expect(over.error?.issues[0]?.path).toEqual(['capacity']);
    expect(over.error?.issues[0]?.message).toBe('capacity_above_limit');
    expect(CALL_ERROR_CODES).toContain(over.error?.issues[0]?.message);
    for (const capacity of [0, -1, 1.5]) {
      expect(WebinarCreateRequestSchema.safeParse({ ...createBody, capacity }).success, String(capacity)).toBe(false);
    }
  });

  it('has no recording switch: every webinar is recorded (D-CW-34)', () => {
    for (const field of ['recordingPolicy', 'recordingEnabled', 'record']) {
      const result = WebinarCreateRequestSchema.safeParse({ ...createBody, [field]: false });
      expect(result.success, field).toBe(false);
    }
  });

  it('refuses an end before the start, a fixed offset time zone and duplicate presenters', () => {
    expect(issuePaths(WebinarCreateRequestSchema.safeParse({ ...createBody, endsAt: createBody.startsAt }))).toEqual([
      'endsAt',
    ]);
    expect(WebinarCreateRequestSchema.safeParse({ ...createBody, timeZone: '+01:00' }).success).toBe(false);
    expect(
      issuePaths(WebinarCreateRequestSchema.safeParse({ ...createBody, presenterUserIds: ['user_a', 'user_a'] })),
    ).toEqual(['presenterUserIds']);
  });

  it('refuses a status: an occurrence is always created as a draft (WBN-30)', () => {
    expect(WebinarCreateRequestSchema.safeParse({ ...createBody, status: 'published' }).success).toBe(false);
  });
});

describe('WebinarUpdateRequestSchema', () => {
  it('accepts a partial update without filling in create defaults', () => {
    expect(WebinarUpdateRequestSchema.parse({ capacity: 200 })).toEqual({ capacity: 200 });
    expect(WebinarUpdateRequestSchema.parse({ moderatorUserId: null })).toEqual({ moderatorUserId: null });
  });

  it('refuses an empty body, a capacity above 250, a status and a reversed schedule', () => {
    expect(WebinarUpdateRequestSchema.safeParse({}).success).toBe(false);
    const over = WebinarUpdateRequestSchema.safeParse({ capacity: 300 });
    expect(over.error?.issues[0]?.message).toBe('capacity_above_limit');
    expect(WebinarUpdateRequestSchema.safeParse({ status: 'live' }).success).toBe(false);
    expect(
      issuePaths(
        WebinarUpdateRequestSchema.safeParse({
          startsAt: '2026-11-25T17:00:00.000Z',
          endsAt: '2026-11-25T16:00:00.000Z',
        }),
      ),
    ).toEqual(['endsAt']);
  });
});

describe('WebinarListQuerySchema', () => {
  it('coerces the limit, accepts the filters and refuses a reversed range', () => {
    const parsed = WebinarListQuerySchema.parse({ limit: '20', status: 'published', orgId: 'org_a' });
    expect(parsed.limit).toBe(20);
    expect(WebinarListQuerySchema.parse({}).limit).toBe(50);
    expect(WebinarListQuerySchema.safeParse({ limit: '1000' }).success).toBe(false);
    expect(
      issuePaths(WebinarListQuerySchema.safeParse({ from: '2026-11-02T00:00:00.000Z', to: '2026-11-01T00:00:00.000Z' })),
    ).toEqual(['to']);
  });
});

const fixtureLikeWebinar = {
  id: 'webinar_sample_upcoming',
  orgId: null,
  title: { en: 'Planning', 'sr-Latn': 'Planiranje', 'sr-Cyrl': 'Планирање', hu: 'Tervezés' },
  description: { en: 'Practical ways.', 'sr-Latn': 'Praktični načini.', 'sr-Cyrl': 'Практични начини.', hu: 'Módszerek.' },
  audiencePolicy: { type: 'all_eligible' },
  capacity: 250,
  startsAt: '2026-11-25T16:00:00.000Z',
  endsAt: '2026-11-25T17:00:00.000Z',
  timeZone: 'Europe/Belgrade',
  status: 'published',
  chatPolicy: 'moderated',
  createdByUserId: 'user_nikola',
  hosts: [
    { userId: 'user_milica', role: 'presenter', displayName: 'Milica' },
    { userId: 'user_nikola', role: 'moderator', displayName: 'Nikola' },
  ],
  sample: true,
};

describe('WebinarSchema (operations view)', () => {
  it('accepts the sample fixture field names (audience policy as the contract object)', () => {
    const parsed = WebinarSchema.parse(fixtureLikeWebinar);
    expect(parsed.hosts).toHaveLength(2);
    expect('sample' in parsed).toBe(false);
  });

  it('refuses an attendee as a host', () => {
    const hosts = [{ userId: 'user_x', role: 'attendee', displayName: 'X' }];
    expect(WebinarSchema.safeParse({ ...fixtureLikeWebinar, hosts }).success).toBe(false);
  });
});

const employeeWebinar = {
  id: 'webinar_1',
  title,
  description: null,
  startsAt: '2026-11-25T16:00:00.000Z',
  endsAt: '2026-11-25T17:00:00.000Z',
  timeZone: 'Europe/Belgrade',
  status: 'published',
  capacity: 250,
  capacityRemaining: 12,
  presenters: [{ displayName: 'Milica' }],
  registered: false,
};

describe('WebinarResponseSchema (employee view, WBN-01)', () => {
  it('carries title per locale, presenter name, schedule and capacity remaining', () => {
    expect(WebinarResponseSchema.parse(employeeWebinar)).toEqual(employeeWebinar);
    expect(WebinarListResponseSchema.parse({ items: [employeeWebinar], nextCursor: null }).items).toHaveLength(1);
  });

  it('never carries the audience policy, the org id, host user ids or a roster', () => {
    for (const extra of [
      { audiencePolicy: { type: 'all_eligible' } },
      { orgId: 'org_a' },
      { createdByUserId: 'user_x' },
      { attendees: [] },
      { presenters: [{ displayName: 'Milica', userId: 'user_milica' }] },
    ]) {
      expect(WebinarResponseSchema.safeParse({ ...employeeWebinar, ...extra }).success, JSON.stringify(extra)).toBe(
        false,
      );
    }
  });

  it('refuses more capacity remaining than capacity', () => {
    expect(issuePaths(WebinarResponseSchema.safeParse({ ...employeeWebinar, capacityRemaining: 251 }))).toEqual([
      'capacityRemaining',
    ]);
  });
});

describe('WebinarRegistrationResponseSchema (WBN-02, WBN-03)', () => {
  it('states the registration consistently', () => {
    const registered = { webinarId: 'webinar_1', registered: true, registeredAt: '2026-11-01T10:00:00.000Z' };
    expect(WebinarRegistrationResponseSchema.parse(registered)).toEqual(registered);
    expect(WebinarRegistrationResponseSchema.parse({ webinarId: 'webinar_1', registered: false, registeredAt: null }))
      .toBeTruthy();
    expect(
      WebinarRegistrationResponseSchema.safeParse({ webinarId: 'webinar_1', registered: true, registeredAt: null })
        .success,
    ).toBe(false);
    expect(WebinarRegistrationResponseSchema.safeParse({ ...registered, userId: 'user_1' }).success).toBe(false);
  });
});

const chime = {
  meeting: {
    MeetingId: 'meeting-1',
    MediaRegion: 'eu-central-1',
    MediaPlacement: {
      AudioHostUrl: 'audio.example:3478',
      AudioFallbackUrl: 'wss://audio.example:443/calls/meeting-1',
      SignalingUrl: 'wss://signal.example/control/meeting-1',
    },
  },
  attendee: { AttendeeId: 'attendee-1', ExternalUserId: 'part_1', JoinToken: 'fake-join-token' },
};

const attendeeJoin = {
  webinarId: 'webinar_1',
  sessionId: 'sess_1',
  participantId: 'part_1',
  format: 'webinar',
  role: 'attendee',
  startsAt: '2026-11-25T16:00:00.000Z',
  endsAt: '2026-11-25T17:00:00.000Z',
  capabilities: { audio: 'receive', video: 'receive', content: 'receive' },
  ...chime,
};

describe('WebinarJoinResponseSchema (WBN-07, D-CW-35)', () => {
  it('accepts a receive-only attendee and a sending presenter', () => {
    expect(WebinarJoinResponseSchema.parse(attendeeJoin).role).toBe('attendee');
    const presenter = {
      ...attendeeJoin,
      role: 'presenter',
      capabilities: { audio: 'send_receive', video: 'send_receive', content: 'send_receive' },
    };
    expect(WebinarJoinResponseSchema.parse(presenter).role).toBe('presenter');
  });

  it('cannot express any send capability for an attendee', () => {
    for (const channel of ['audio', 'video', 'content'] as const) {
      for (const value of ['send_receive', 'send', 'none']) {
        const input = { ...attendeeJoin, capabilities: { ...attendeeJoin.capabilities, [channel]: value } };
        expect(WebinarJoinResponseSchema.safeParse(input).success, `${channel}=${value}`).toBe(false);
      }
    }
  });

  it('refuses an attendee whose Chime capabilities would send', () => {
    const input = {
      ...attendeeJoin,
      attendee: {
        ...chime.attendee,
        Capabilities: { Audio: 'Receive', Video: 'SendReceive', Content: 'Receive' },
      },
    };
    expect(WebinarJoinResponseSchema.safeParse(input).success).toBe(false);
    const receiveOnly = {
      ...attendeeJoin,
      attendee: { ...chime.attendee, Capabilities: { Audio: 'Receive', Video: 'Receive', Content: 'Receive' } },
    };
    expect(WebinarJoinResponseSchema.safeParse(receiveOnly).success).toBe(true);
  });

  it('refuses consultation roles and formats', () => {
    expect(WebinarJoinResponseSchema.safeParse({ ...attendeeJoin, role: 'employee' }).success).toBe(false);
    expect(WebinarJoinResponseSchema.safeParse({ ...attendeeJoin, format: 'consultation' }).success).toBe(false);
  });

  it('maps the contract capability spellings to Chime', () => {
    expect(CHIME_CAPABILITY_BY_MEDIA_CAPABILITY).toEqual({
      send_receive: 'SendReceive',
      send: 'Send',
      receive: 'Receive',
      none: 'None',
    });
  });
});

describe('WebinarFloorResponseSchema (D-CW-15, D-CW-35, CW-R-108)', () => {
  it('gives the floor as audio only', () => {
    const given = {
      participantId: 'part_1',
      hasFloor: true,
      capabilities: { audio: 'send_receive', video: 'receive', content: 'receive' },
    };
    expect(WebinarFloorResponseSchema.parse(given)).toEqual(given);
    const taken = { ...given, hasFloor: false, capabilities: { ...given.capabilities, audio: 'receive' } };
    expect(WebinarFloorResponseSchema.parse(taken)).toEqual(taken);
  });

  it("cannot express video: 'send_receive' or any content send for an attendee", () => {
    const base = { participantId: 'part_1', hasFloor: true };
    expect(
      WebinarFloorResponseSchema.safeParse({
        ...base,
        capabilities: { audio: 'send_receive', video: 'send_receive', content: 'receive' },
      }).success,
    ).toBe(false);
    expect(
      WebinarFloorResponseSchema.safeParse({
        ...base,
        capabilities: { audio: 'send_receive', video: 'receive', content: 'send_receive' },
      }).success,
    ).toBe(false);
  });

  it('keeps hasFloor and the audio capability consistent', () => {
    const input = {
      participantId: 'part_1',
      hasFloor: false,
      capabilities: { audio: 'send_receive', video: 'receive', content: 'receive' },
    };
    expect(WebinarFloorResponseSchema.safeParse(input).success).toBe(false);
  });
});

describe('WebinarMessageCreateRequestSchema (CW-R-110, WBN-09, WBN-37)', () => {
  it('lets attendees write messages and questions, anonymous by default', () => {
    expect(WebinarMessageCreateRequestSchema.parse({ text: ' Hello ', kind: 'attendee' })).toEqual({
      text: 'Hello',
      kind: 'attendee',
      showFirstName: false,
    });
    expect(WebinarMessageCreateRequestSchema.parse({ text: 'Why?', kind: 'question', showFirstName: true }))
      .toMatchObject({ showFirstName: true });
  });

  it('lets hosts post without a first-name flag', () => {
    expect(WebinarMessageCreateRequestSchema.parse({ text: 'Welcome', kind: 'host' })).toEqual({
      text: 'Welcome',
      kind: 'host',
    });
    expect(WebinarMessageCreateRequestSchema.safeParse({ text: 'Welcome', kind: 'host', showFirstName: true }).success)
      .toBe(false);
  });

  it('bounds the text and refuses author fields', () => {
    expect(WebinarMessageCreateRequestSchema.safeParse({ text: '', kind: 'attendee' }).success).toBe(false);
    expect(
      WebinarMessageCreateRequestSchema.safeParse({
        text: 'x'.repeat(WEBINAR_MESSAGE_TEXT_MAX_LENGTH + 1),
        kind: 'attendee',
      }).success,
    ).toBe(false);
    for (const field of ['userId', 'authorFirstName', 'status']) {
      expect(
        WebinarMessageCreateRequestSchema.safeParse({ text: 'Hi', kind: 'attendee', [field]: 'x' }).success,
        field,
      ).toBe(false);
    }
  });
});

const publishedMessage = {
  id: 'msg_1',
  webinarId: 'webinar_1',
  kind: 'attendee',
  status: 'published',
  text: 'Thank you, the sound and the slides are clear.',
  authorFirstName: 'Jovan',
  answerText: null,
  publishedAt: '2026-10-15T15:06:00.000Z',
  createdAt: '2026-10-15T15:05:00.000Z',
};

describe('WebinarMessageSchema (attendee view, D-CW-15)', () => {
  it('accepts a published message with an optional first name', () => {
    expect(WebinarMessageSchema.parse(publishedMessage)).toEqual(publishedMessage);
    expect(WebinarMessageSchema.parse({ ...publishedMessage, authorFirstName: null }).authorFirstName).toBeNull();
  });

  it('rejects email, user id, participant id and the registration name', () => {
    for (const field of ['email', 'userId', 'authorParticipantId', 'authorName', 'showFirstName', 'sessionId']) {
      expect(WebinarMessageSchema.safeParse({ ...publishedMessage, [field]: 'x' }).success, field).toBe(false);
    }
  });

  it('carries an answer exactly when the status is answered', () => {
    const answered = { ...publishedMessage, kind: 'question', status: 'answered', answerText: 'A few minutes.' };
    expect(WebinarMessageSchema.parse(answered).answerText).toBe('A few minutes.');
    expect(WebinarMessageSchema.safeParse({ ...answered, answerText: null }).success).toBe(false);
    expect(WebinarMessageSchema.safeParse({ ...publishedMessage, answerText: 'Early' }).success).toBe(false);
  });

  it('lists only published and answered messages to attendees (CW-R-104)', () => {
    expect(WebinarMessageListResponseSchema.parse({ items: [publishedMessage], nextCursor: null }).items).toHaveLength(1);
    for (const status of ['pending', 'dismissed']) {
      const item = { ...publishedMessage, status, publishedAt: null };
      expect(WebinarMessageListResponseSchema.safeParse({ items: [item], nextCursor: null }).success, status).toBe(
        false,
      );
    }
  });
});

describe('WebinarModerationMessageSchema (moderator view, WBN-23)', () => {
  it('adds the registration name, the participant id and the first-name choice', () => {
    const pending = {
      ...publishedMessage,
      status: 'pending',
      publishedAt: null,
      authorFirstName: null,
      authorParticipantId: 'part_7',
      authorName: 'Ana Petrović',
      showFirstName: false,
    };
    expect(WebinarModerationMessageSchema.parse(pending)).toEqual(pending);
    expect(WebinarModerationMessageSchema.safeParse({ ...pending, email: 'ana@example.test' }).success).toBe(false);
  });

  it('bounds the answer text', () => {
    expect(WebinarMessageAnswerRequestSchema.parse({ answerText: ' Yes ' })).toEqual({ answerText: 'Yes' });
    expect(WebinarMessageAnswerRequestSchema.safeParse({ answerText: 'x'.repeat(2001) }).success).toBe(false);
  });
});

describe('WebinarHandRaiseResponseSchema', () => {
  it('keeps raised and raisedAt consistent', () => {
    expect(WebinarHandRaiseResponseSchema.parse({ raised: true, raisedAt: '2026-11-25T16:10:00.000Z' }).raised).toBe(
      true,
    );
    expect(WebinarHandRaiseResponseSchema.parse({ raised: false, raisedAt: null }).raised).toBe(false);
    expect(WebinarHandRaiseResponseSchema.safeParse({ raised: true, raisedAt: null }).success).toBe(false);
  });
});

describe('polls (WBN-11, D-CW-16, CW-R-24)', () => {
  it('creates a poll with a question and 2 to 6 distinct options', () => {
    const options = ['A short walk', 'Stretching at the desk'];
    expect(WebinarPollCreateRequestSchema.parse({ question: 'Which break?', options }).options).toEqual(options);
    expect(WEBINAR_POLL_OPTIONS_MIN).toBe(2);
    expect(WEBINAR_POLL_OPTIONS_MAX).toBe(6);
    expect(WebinarPollCreateRequestSchema.safeParse({ question: 'Q', options: ['Only'] }).success).toBe(false);
    const seven = Array.from({ length: 7 }, (_, i) => `Option ${i}`);
    expect(WebinarPollCreateRequestSchema.safeParse({ question: 'Q', options: seven }).success).toBe(false);
    expect(WebinarPollCreateRequestSchema.safeParse({ question: 'Q', options: ['Same', 'Same'] }).success).toBe(false);
    expect(WebinarPollCreateRequestSchema.safeParse({ question: '', options }).success).toBe(false);
  });

  it('accepts the poll definition the opened event carries', () => {
    const poll = {
      id: 'poll_1',
      webinarId: 'webinar_1',
      question: 'Which break would you like to try this week?',
      options: [
        { id: 'opt_1', label: 'A short walk', position: 0 },
        { id: 'opt_2', label: 'Stretching at the desk', position: 1 },
      ],
      openedAt: '2026-10-15T15:35:00.000Z',
      closedAt: null,
    };
    expect(WebinarPollSchema.parse(poll)).toEqual(poll);
  });

  it('votes with the option id only: no voter field fits', () => {
    expect(WebinarPollVoteRequestSchema.parse({ optionId: 'opt_1' })).toEqual({ optionId: 'opt_1' });
    for (const field of ['userId', 'participantId', 'voterId', 'registrationId']) {
      expect(WebinarPollVoteRequestSchema.safeParse({ optionId: 'opt_1', [field]: 'x' }).success, field).toBe(false);
    }
  });

  it('reports aggregate counts only, summing to the total', () => {
    const results = {
      pollId: 'poll_1',
      totalVotes: 2,
      results: [
        { optionId: 'opt_1', count: 1 },
        { optionId: 'opt_2', count: 1 },
      ],
    };
    expect(WebinarPollResultsSchema.parse(results)).toEqual(results);
    expect(WebinarPollResultsSchema.safeParse({ ...results, totalVotes: 3 }).success).toBe(false);
    const withVoters = { ...results, results: [{ optionId: 'opt_1', count: 2, voters: ['user_1'] }] };
    expect(WebinarPollResultsSchema.safeParse(withVoters).success).toBe(false);
  });
});

describe('WebinarAttendanceResponseSchema (WBN-33, D-CW-17, D-CW-30)', () => {
  const attendance = {
    webinarId: 'webinar_1',
    registeredCount: 40,
    joinedCount: 31,
    peakConcurrent: 28,
    registrants: [
      {
        registrationId: 'reg_1',
        joinedAt: '2026-11-25T16:01:00.000Z',
        leftAt: '2026-11-25T16:58:00.000Z',
        attendedMinutes: 57,
        completionPercent: 95,
      },
    ],
  };

  it('accepts counts and nameless per-registrant rows', () => {
    expect(WebinarAttendanceResponseSchema.parse(attendance)).toEqual(attendance);
  });

  it('never carries a name, an email or a user id', () => {
    for (const field of ['name', 'displayName', 'email', 'userId']) {
      const registrants = [{ ...attendance.registrants[0], [field]: 'x' }];
      expect(WebinarAttendanceResponseSchema.safeParse({ ...attendance, registrants }).success, field).toBe(false);
      expect(WebinarAttendanceResponseSchema.safeParse({ ...attendance, [field]: 'x' }).success, field).toBe(false);
    }
  });

  it('keeps the counts ordered: peak <= joined <= registered', () => {
    expect(WebinarAttendanceResponseSchema.safeParse({ ...attendance, joinedCount: 41 }).success).toBe(false);
    expect(WebinarAttendanceResponseSchema.safeParse({ ...attendance, peakConcurrent: 32 }).success).toBe(false);
  });
});

describe('WebinarRecordingStatusResponseSchema', () => {
  it('uses the canonical recording statuses', () => {
    const value = { webinarId: 'webinar_1', status: 'processing', startedAt: '2026-11-25T16:00:00.000Z', stoppedAt: '2026-11-25T16:40:00.000Z' };
    expect(WebinarRecordingStatusResponseSchema.parse(value)).toEqual(value);
    expect(WebinarRecordingStatusResponseSchema.safeParse({ ...value, status: 'stopped' }).success).toBe(false);
  });
});

describe('webinar rooms and events (decision record section 7)', () => {
  it('names the rooms', () => {
    expect(webinarRoomName('webinar_1')).toBe('webinar:webinar_1');
    expect(webinarModerationRoomName('webinar_1')).toBe('webinar:webinar_1:moderation');
  });

  it('lists the canonical events per room', () => {
    expect(WEBINAR_ROOM_EVENT_NAMES).toEqual([
      'webinar.state',
      'webinar.message.published',
      'webinar.message.answered',
      'webinar.poll.opened',
      'webinar.poll.closed',
      'webinar.poll.results',
      'webinar.recording',
      'webinar.ended',
    ]);
    expect(WEBINAR_PARTICIPANT_EVENT_NAMES).toEqual(['webinar.floor.given', 'webinar.floor.taken']);
    expect(WEBINAR_MODERATION_ROOM_EVENT_NAMES).toEqual([
      'webinar.message.submitted',
      'webinar.hand.raised',
      'webinar.hand.lowered',
      'webinar.attendance.count',
    ]);
    expect(Object.keys(WEBINAR_EVENT_PAYLOAD_SCHEMAS).sort()).toEqual([...WEBINAR_EVENT_NAMES].sort());
  });

  it('merges with the call room events without a clash', () => {
    const callNames: readonly string[] = CALL_ROOM_EVENT_NAMES;
    expect(WEBINAR_EVENT_NAMES.filter((name) => callNames.includes(name))).toEqual([]);
    expect(Object.keys(ROOM_EVENT_PAYLOAD_SCHEMAS)).toHaveLength(CALL_ROOM_EVENT_NAMES.length + WEBINAR_EVENT_NAMES.length);
  });

  it('keeps names and identities out of every payload attendees receive', () => {
    const forbidden = [
      'userId',
      'email',
      'name',
      'displayName',
      'authorName',
      'participantName',
      'authorParticipantId',
      'showFirstName',
    ];
    for (const event of [...WEBINAR_ROOM_EVENT_NAMES, ...WEBINAR_PARTICIPANT_EVENT_NAMES]) {
      const schema = WEBINAR_EVENT_PAYLOAD_SCHEMAS[event] as z.ZodObject;
      const keys = Object.keys(schema.shape);
      expect(keys.filter((key) => forbidden.includes(key)), event).toEqual([]);
    }
  });

  it('sends published and answered messages only on the public room', () => {
    const published = WEBINAR_EVENT_PAYLOAD_SCHEMAS['webinar.message.published'];
    expect(published.safeParse(publishedMessage).success).toBe(true);
    expect(published.safeParse({ ...publishedMessage, status: 'pending', publishedAt: null }).success).toBe(false);
    const answered = WEBINAR_EVENT_PAYLOAD_SCHEMAS['webinar.message.answered'];
    expect(answered.safeParse({ ...publishedMessage, status: 'answered', answerText: 'Yes.' }).success).toBe(true);
    expect(answered.safeParse(publishedMessage).success).toBe(false);
  });

  it('gives the floor as audio only on the participant event', () => {
    const given = WEBINAR_EVENT_PAYLOAD_SCHEMAS['webinar.floor.given'];
    const payload = { participantId: 'part_1', capabilities: { audio: 'send_receive', video: 'receive', content: 'receive' } };
    expect(given.safeParse(payload).success).toBe(true);
    expect(
      given.safeParse({ ...payload, capabilities: { ...payload.capabilities, video: 'send_receive' } }).success,
    ).toBe(false);
    const taken = WEBINAR_EVENT_PAYLOAD_SCHEMAS['webinar.floor.taken'];
    expect(taken.safeParse(payload).success).toBe(false);
    expect(taken.safeParse({ ...payload, capabilities: { ...payload.capabilities, audio: 'receive' } }).success).toBe(
      true,
    );
  });

  it('shows the moderator the registration name on a raised hand (WBN-10)', () => {
    const raised = WEBINAR_EVENT_PAYLOAD_SCHEMAS['webinar.hand.raised'];
    const payload = { participantId: 'part_1', participantName: 'Ana Petrović', raisedAt: '2026-11-25T16:10:00.000Z' };
    expect(raised.parse(payload)).toEqual(payload);
  });

  it('carries the state, the recording indicator and the attendance count', () => {
    expect(WEBINAR_EVENT_PAYLOAD_SCHEMAS['webinar.state'].parse({ webinarId: 'w', status: 'live' }).status).toBe('live');
    expect(WebinarRecordingPayloadSchema.parse({ webinarId: 'w', status: 'started' }).status).toBe('started');
    expect(WebinarRecordingPayloadSchema.safeParse({ webinarId: 'w', status: 'recording' }).success).toBe(false);
    expect(WEBINAR_EVENT_PAYLOAD_SCHEMAS['webinar.attendance.count'].parse({ webinarId: 'w', count: 3 }).count).toBe(3);
    expect(WEBINAR_EVENT_PAYLOAD_SCHEMAS['webinar.attendance.count'].safeParse({ webinarId: 'w', count: -1 }).success)
      .toBe(false);
  });
});

describe('webinar actions and templates (T-CW-2.2 step 2)', () => {
  it('has event.manage and event.moderate in the catalogue', () => {
    expect(ACTIONS['event.manage']).toBe('event.manage');
    expect(ACTIONS['event.moderate']).toBe('event.moderate');
  });

  it('grants them per the canonical template table', () => {
    const actionsOf = (key: string) => PERMISSION_TEMPLATES.find((t) => t.key === key)?.actions ?? [];
    expect(actionsOf('platform_owner')).toEqual(expect.arrayContaining(['event.manage', 'event.moderate']));
    expect(actionsOf('client_operations')).toEqual(expect.arrayContaining(['event.manage', 'event.moderate']));
    expect(actionsOf('content_publisher')).toContain('event.manage');
    expect(actionsOf('content_publisher')).not.toContain('event.moderate');
    expect(actionsOf('service_coordinator')).toContain('event.moderate');
    expect(actionsOf('service_coordinator')).not.toContain('event.manage');
    expect(actionsOf('expert')).toContain('event.present');
    expect(actionsOf('employee')).toContain('event.register');
  });
});

describe('package entry', () => {
  it('re-exports the webinar contracts', () => {
    expect(entry.WebinarCreateRequestSchema).toBe(WebinarCreateRequestSchema);
    expect(entry.WebinarJoinResponseSchema).toBe(WebinarJoinResponseSchema);
    expect(entry.canTransitionWebinar).toBe(canTransitionWebinar);
    expect(entry.WEBINAR_EVENT_PAYLOAD_SCHEMAS).toBe(WEBINAR_EVENT_PAYLOAD_SCHEMAS);
  });
});
