/**
 * Video provider adapter tests (T-CW-0.2): the role-to-capability mapping,
 * the Chime adapter's request shapes and error mapping (aws-sdk-client-mock,
 * OPS-31, CW-R-81), the fake provider's stubs and events, and the module's
 * provider selection.
 */
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { mockClient } from 'aws-sdk-client-mock';
import {
  BadRequestException,
  ChimeSDKMeetingsClient,
  CreateAttendeeCommand,
  CreateMeetingCommand,
  CreateMeetingWithAttendeesCommand,
  DeleteAttendeeCommand,
  DeleteMeetingCommand,
  GetMeetingCommand,
  LimitExceededException,
  NotFoundException,
  ServiceUnavailableException,
  ThrottlingException,
  UpdateAttendeeCapabilitiesCommand,
  type Meeting,
} from '@aws-sdk/client-chime-sdk-meetings';
import {
  ChimeSDKMediaPipelinesClient,
  CreateMediaCapturePipelineCommand,
  CreateMediaConcatenationPipelineCommand,
  DeleteMediaCapturePipelineCommand,
  GetMediaPipelineCommand,
  NotFoundException as PipelineNotFoundException,
  ServiceUnavailableException as PipelineServiceUnavailableException,
} from '@aws-sdk/client-chime-sdk-media-pipelines';
import {
  CALL_FORMATS,
  CALL_PARTICIPANT_ROLES,
  WEBINAR_MAX_REPLICAS,
  WEBINAR_REPLICATED_CAPACITY,
  WEBINAR_SINGLE_MEETING_CAPACITY,
  WORKSHOP_CAPACITY,
} from '@nestself/contracts';
import { ApiHttpException } from '../common/api-error.js';
import {
  CHIME_TENANT_ID_PATTERN,
  MEETING_FEATURES,
  VIDEO_MEDIA_REGION,
  VideoCapabilityError,
  VideoRoutingError,
  assertCapabilitiesAllowed,
  capabilitiesForRole,
  encodeTenantId,
  parseReplicaExternalMeetingId,
  pickReplica,
  replicaCapacities,
  replicaExternalMeetingId,
  type CreateSessionInput,
  type VideoProviderEvent,
} from './video-provider.js';
import { ChimeVideoProvider } from './chime-video-provider.js';
import { FakeVideoProvider } from './fake-video-provider.js';
import { createVideoProvider } from './video.module.js';

const SESSION_ID = '0b7f9a52-3c1e-4e0f-9a51-2f6d1c8e4b10';
const PARTICIPANT_ID = '5d2c8e17-9b4a-4f3e-8c21-7a6b5d4c3e21';
const SECOND_PARTICIPANT_ID = 'a3e1c5d7-2b4f-4a6c-9e8d-1f3b5a7c9e02';
const ORG_ID = 'c8d2e4f6-1a3b-4c5d-8e7f-9a1b2c3d4e5f';
const WEBINAR_ID = 'e1f2a3b4-c5d6-4e7f-8a9b-0c1d2e3f4a5b';
/** Fails Chime's TenantIds pattern raw: four identical characters in a row. */
const REPEATING_ID = 'aaaa0000-1111-4222-8333-444455556666';
const QUEUE_ARN = 'arn:aws:sqs:eu-central-1:111122223333:nestself-dev-chime-events';
const BUCKET = 'nestself-dev-recordings-111122223333';
const JOIN_TOKEN = 'join-token-secret-value';

const consultationInput: CreateSessionInput = {
  sessionId: SESSION_ID,
  format: 'consultation',
  capacity: 2,
  orgId: ORG_ID,
  webinarId: null,
  participant: { participantId: PARTICIPANT_ID, role: 'expert' },
};

const webinarInput: CreateSessionInput = {
  sessionId: SESSION_ID,
  format: 'webinar',
  capacity: WEBINAR_SINGLE_MEETING_CAPACITY,
  orgId: null,
  webinarId: WEBINAR_ID,
  participant: { participantId: PARTICIPANT_ID, role: 'presenter' },
};

const workshopInput: CreateSessionInput = {
  sessionId: SESSION_ID,
  format: 'workshop',
  capacity: WORKSHOP_CAPACITY,
  orgId: ORG_ID,
  webinarId: null,
  participant: { participantId: PARTICIPANT_ID, role: 'facilitator' },
};

const MEETING: Meeting = {
  MeetingId: 'meeting-1',
  MeetingArn: 'arn:aws:chime:eu-central-1:111122223333:meeting/meeting-1',
  ExternalMeetingId: SESSION_ID,
  MediaRegion: 'eu-central-1',
  MediaPlacement: {
    AudioHostUrl: 'audio.example.test:3478',
    AudioFallbackUrl: 'wss://audio.example.test:443/calls/meeting-1',
    SignalingUrl: 'wss://signal.example.test/control/meeting-1',
    TurnControlUrl: 'https://turn.example.test/v2/turn_sessions',
    EventIngestionUrl: 'https://data.example.test/v1/client-events',
  },
  MeetingFeatures: MEETING_FEATURES.consultation,
  TenantIds: [ORG_ID],
};

function attendee(externalUserId: string, attendeeId = 'attendee-1') {
  return {
    AttendeeId: attendeeId,
    ExternalUserId: externalUserId,
    JoinToken: JOIN_TOKEN,
    Capabilities: { Audio: 'SendReceive', Video: 'SendReceive', Content: 'SendReceive' },
  } as const;
}

/** A ConfigService stand-in over the parsed env values. */
function config(values: Record<string, string | undefined>) {
  return { get: <T = string>(key: string): T | undefined => values[key] as T | undefined };
}

const CHIME_CONFIG = {
  VIDEO_PROVIDER: 'chime',
  CHIME_REGION: 'eu-central-1',
  CHIME_EVENTS_QUEUE_ARN: QUEUE_ARN,
  RECORDINGS_BUCKET: BUCKET,
  STAGE: 'dev',
};

/** Waits until the fake provider's queued events have been delivered. */
function flushEvents(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

async function expectApiError(
  promise: Promise<unknown>,
  status: number,
  code: string,
): Promise<ApiHttpException> {
  const error = await promise.then(
    () => {
      throw new Error('expected the call to reject');
    },
    (err: unknown) => err,
  );
  expect(error).toBeInstanceOf(ApiHttpException);
  const apiError = error as ApiHttpException;
  expect(apiError.getStatus()).toBe(status);
  expect(apiError.code).toBe(code);
  return apiError;
}

// ---------------------------------------------------------------------------
// Capabilities (D-CW-10, D-CW-15, D-CW-35)
// ---------------------------------------------------------------------------

describe('capabilitiesForRole', () => {
  it.each([
    ['expert', { Audio: 'SendReceive', Video: 'SendReceive', Content: 'SendReceive' }],
    ['employee', { Audio: 'SendReceive', Video: 'SendReceive', Content: 'Receive' }],
    ['presenter', { Audio: 'SendReceive', Video: 'SendReceive', Content: 'SendReceive' }],
    ['moderator', { Audio: 'SendReceive', Video: 'SendReceive', Content: 'SendReceive' }],
    ['attendee', { Audio: 'Receive', Video: 'Receive', Content: 'Receive' }],
    ['facilitator', { Audio: 'SendReceive', Video: 'SendReceive', Content: 'SendReceive' }],
    ['participant', { Audio: 'SendReceive', Video: 'SendReceive', Content: 'Receive' }],
  ] as const)('maps %s to its D-CW-10 capabilities', (role, expected) => {
    expect(capabilitiesForRole(role)).toEqual(expected);
  });

  it('gives an attendee with the floor audio only; video and content stay Receive', () => {
    expect(capabilitiesForRole('attendee', { floor: true })).toEqual({
      Audio: 'SendReceive',
      Video: 'Receive',
      Content: 'Receive',
    });
  });

  it('never lets an attendee send video, with or without the floor (constraint 14)', () => {
    for (const floor of [false, true]) {
      const capabilities = capabilitiesForRole('attendee', { floor });
      expect(capabilities.Video).toBe('Receive');
      expect(capabilities.Video).not.toBe('SendReceive');
    }
  });

  it('returns capabilities the attendee guard accepts for every role', () => {
    for (const role of CALL_PARTICIPANT_ROLES) {
      for (const floor of [false, true]) {
        expect(() => assertCapabilitiesAllowed(role, capabilitiesForRole(role, { floor }))).not.toThrow();
      }
    }
  });
});

describe('assertCapabilitiesAllowed', () => {
  it.each(['SendReceive', 'Send'] as const)('rejects attendee video %s (CW-R-108)', (video) => {
    expect(() =>
      assertCapabilitiesAllowed('attendee', { Audio: 'SendReceive', Video: video, Content: 'Receive' }),
    ).toThrow(VideoCapabilityError);
  });

  it.each(['SendReceive', 'Send'] as const)('rejects attendee content %s', (content) => {
    expect(() =>
      assertCapabilitiesAllowed('attendee', { Audio: 'Receive', Video: 'Receive', Content: content }),
    ).toThrow(VideoCapabilityError);
  });

  it('accepts video send for a presenter', () => {
    expect(() => assertCapabilitiesAllowed('presenter', capabilitiesForRole('presenter'))).not.toThrow();
  });
});

describe('encodeTenantId (Chime TenantIds pattern)', () => {
  it('makes an id with four identical characters in a row acceptable to Chime', () => {
    expect(REPEATING_ID).not.toMatch(CHIME_TENANT_ID_PATTERN);
    const encoded = encodeTenantId(REPEATING_ID);
    expect(encoded).toMatch(CHIME_TENANT_ID_PATTERN);
    expect(encoded).toHaveLength(47);
  });

  it('encodes every UUID to 47 characters that match the pattern', () => {
    for (let i = 0; i < 2000; i += 1) {
      const encoded = encodeTenantId(randomUUID());
      expect(encoded).toHaveLength(47);
      expect(encoded).toMatch(CHIME_TENANT_ID_PATTERN);
    }
  });

  it('refuses an id the encoding cannot make valid', () => {
    expect(() => encodeTenantId('org id')).toThrow(/TenantIds/);
    expect(() => encodeTenantId('a')).toThrow(/TenantIds/);
  });
});

describe('media replication rules (D-CW-14, T-CW-3.2)', () => {
  it('reaches 1,000 attendees with the default quota of four replicas', () => {
    expect(WEBINAR_MAX_REPLICAS).toBe(4);
    expect(WEBINAR_REPLICATED_CAPACITY).toBe(WEBINAR_SINGLE_MEETING_CAPACITY * WEBINAR_MAX_REPLICAS);
  });

  it.each([
    ['webinar', WEBINAR_SINGLE_MEETING_CAPACITY, []],
    ['webinar', WEBINAR_SINGLE_MEETING_CAPACITY + 1, [126, 125]],
    ['webinar', 500, [250, 250]],
    ['webinar', 501, [167, 167, 167]],
    ['webinar', WEBINAR_REPLICATED_CAPACITY, [250, 250, 250, 250]],
    ['consultation', 2, []],
    ['workshop', WORKSHOP_CAPACITY, []],
  ] as const)('plans %s capacity %i as replicas %j', (format, capacity, expected) => {
    expect(replicaCapacities(format, capacity)).toEqual(expected);
  });

  it('never plans more replicas than the quota or seats above the single-meeting limit', () => {
    for (let capacity = 1; capacity <= WEBINAR_REPLICATED_CAPACITY; capacity += 1) {
      const plan = replicaCapacities('webinar', capacity);
      expect(plan.length).toBeLessThanOrEqual(WEBINAR_MAX_REPLICAS);
      if (plan.length > 0) {
        expect(plan.reduce((sum, seats) => sum + seats, 0)).toBe(capacity);
        expect(Math.max(...plan)).toBeLessThanOrEqual(WEBINAR_SINGLE_MEETING_CAPACITY);
      }
    }
  });

  it('suffixes and parses the replica ExternalMeetingId', () => {
    expect(replicaExternalMeetingId(SESSION_ID, 3)).toBe(`${SESSION_ID}-r3`);
    expect(parseReplicaExternalMeetingId(`${SESSION_ID}-r3`)).toEqual({ sessionId: SESSION_ID, replicaIndex: 3 });
    expect(parseReplicaExternalMeetingId(SESSION_ID)).toBeNull();
  });

  describe('pickReplica', () => {
    const replicas = [
      { replicaIndex: 1, capacity: 250 },
      { replicaIndex: 2, capacity: 250 },
      { replicaIndex: 3, capacity: 250 },
    ];

    it('picks the least-loaded replica', () => {
      expect(pickReplica(replicas, { 1: 10, 2: 4, 3: 7 })?.replicaIndex).toBe(2);
    });

    it('breaks ties by the lowest index and counts a missing replica as empty', () => {
      expect(pickReplica(replicas, { 1: 5, 2: 3, 3: 3 })?.replicaIndex).toBe(2);
      expect(pickReplica(replicas, { 1: 5 })?.replicaIndex).toBe(2);
      expect(pickReplica(replicas, {})?.replicaIndex).toBe(1);
    });

    it('balances attendees across replicas as they join', () => {
      const counts: Record<number, number> = {};
      for (let i = 0; i < 300; i += 1) {
        const picked = pickReplica(replicas, counts)!;
        counts[picked.replicaIndex] = (counts[picked.replicaIndex] ?? 0) + 1;
      }
      expect(counts).toEqual({ 1: 100, 2: 100, 3: 100 });
    });

    it('skips a full replica and returns null when every replica is full', () => {
      expect(pickReplica(replicas, { 1: 250, 2: 250, 3: 249 })?.replicaIndex).toBe(3);
      expect(pickReplica(replicas, { 1: 250, 2: 250, 3: 250 })).toBeNull();
      expect(pickReplica([{ replicaIndex: 1 }], { 1: WEBINAR_SINGLE_MEETING_CAPACITY })).toBeNull();
    });
  });
});

describe('MEETING_FEATURES', () => {
  it('never requests FHD video, so no meeting is capped at 25 attendees (CW-R-08)', () => {
    for (const format of CALL_FORMATS) {
      expect(MEETING_FEATURES[format].Video.MaxResolution).toBe('HD');
      expect(MEETING_FEATURES[format].Audio.EchoReduction).toBe('AVAILABLE');
      expect(MEETING_FEATURES[format].Content.MaxResolution).toBe('FHD');
    }
  });

  it('sizes each format per D-CW-10', () => {
    expect(MEETING_FEATURES.consultation.Attendee.MaxCount).toBe(4);
    expect(MEETING_FEATURES.webinar.Attendee.MaxCount).toBe(WEBINAR_SINGLE_MEETING_CAPACITY);
    expect(MEETING_FEATURES.workshop.Attendee.MaxCount).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// ChimeVideoProvider (aws-sdk-client-mock)
// ---------------------------------------------------------------------------

describe('ChimeVideoProvider', () => {
  const meetings = mockClient(ChimeSDKMeetingsClient);
  const pipelines = mockClient(ChimeSDKMediaPipelinesClient);
  let provider: ChimeVideoProvider;
  let logged: string[];

  beforeEach(() => {
    meetings.reset();
    pipelines.reset();
    logged = [];
    for (const level of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
      vi.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
        logged.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '));
      });
    }
    provider = new ChimeVideoProvider({ eventsQueueArn: QUEUE_ARN, recordingsBucket: BUCKET, stage: 'dev' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('configures both SDK clients for eu-central-1 (CW-R-06)', async () => {
    expect(VIDEO_MEDIA_REGION).toBe('eu-central-1');
    expect(await provider.meetingsClient.config.region()).toBe('eu-central-1');
    expect(await provider.pipelinesClient.config.region()).toBe('eu-central-1');
  });

  describe('createSession', () => {
    it('calls CreateMeetingWithAttendees with the Frankfurt media region and the session identity', async () => {
      meetings.on(CreateMeetingWithAttendeesCommand).resolves({
        Meeting: MEETING,
        Attendees: [attendee(PARTICIPANT_ID)],
      });

      await provider.createSession(consultationInput);

      const calls = meetings.commandCalls(CreateMeetingWithAttendeesCommand);
      expect(calls).toHaveLength(1);
      const request = calls[0]!.args[0].input;
      expect(request.MediaRegion).toBe('eu-central-1');
      expect(request.ClientRequestToken).toBe(SESSION_ID);
      expect(request.ExternalMeetingId).toBe(SESSION_ID);
      expect(request.MeetingFeatures).toEqual(MEETING_FEATURES.consultation);
      expect(request.NotificationsConfiguration).toEqual({ SqsQueueArn: QUEUE_ARN });
      expect(request.TenantIds).toEqual([encodeTenantId(ORG_ID)]);
      expect(request.Attendees).toEqual([
        {
          ExternalUserId: PARTICIPANT_ID,
          Capabilities: { Audio: 'SendReceive', Video: 'SendReceive', Content: 'SendReceive' },
        },
      ]);
    });

    it('tags the meeting with stage, format and orgId only (CW-R-04)', async () => {
      meetings.on(CreateMeetingWithAttendeesCommand).resolves({
        Meeting: MEETING,
        Attendees: [attendee(PARTICIPANT_ID)],
      });

      await provider.createSession(consultationInput);

      const request = meetings.commandCalls(CreateMeetingWithAttendeesCommand)[0]!.args[0].input;
      expect(request.Tags).toEqual([
        { Key: 'stage', Value: 'dev' },
        { Key: 'format', Value: 'consultation' },
        { Key: 'orgId', Value: ORG_ID },
      ]);
    });

    it('tags the stage the module reads from the parsed env', async () => {
      meetings.on(CreateMeetingWithAttendeesCommand).resolves({
        Meeting: MEETING,
        Attendees: [attendee(PARTICIPANT_ID)],
      });
      const staged = createVideoProvider(config({ ...CHIME_CONFIG, STAGE: 'staging' }));

      await staged.createSession(consultationInput);

      const request = meetings.commandCalls(CreateMeetingWithAttendeesCommand)[0]!.args[0].input;
      expect(request.Tags).toContainEqual({ Key: 'stage', Value: 'staging' });
    });

    it('uses the webinar id as tenant id for webinars and omits the orgId tag when there is none', async () => {
      meetings.on(CreateMeetingWithAttendeesCommand).resolves({
        Meeting: { ...MEETING, TenantIds: [WEBINAR_ID] },
        Attendees: [attendee(PARTICIPANT_ID)],
      });

      await provider.createSession(webinarInput);

      const request = meetings.commandCalls(CreateMeetingWithAttendeesCommand)[0]!.args[0].input;
      expect(request.TenantIds).toEqual([encodeTenantId(WEBINAR_ID)]);
      expect(request.MeetingFeatures).toEqual(MEETING_FEATURES.webinar);
      expect(request.Tags).toEqual([
        { Key: 'stage', Value: 'dev' },
        { Key: 'format', Value: 'webinar' },
      ]);
    });

    it('returns the raw meeting and attendee for the browser client', async () => {
      meetings.on(CreateMeetingWithAttendeesCommand).resolves({
        Meeting: MEETING,
        Attendees: [attendee(PARTICIPANT_ID)],
      });

      const session = await provider.createSession(consultationInput);

      expect(session.providerMeetingId).toBe('meeting-1');
      expect(session.meeting.MeetingId).toBe('meeting-1');
      expect(session.meeting.MediaRegion).toBe('eu-central-1');
      expect(session.meeting.MediaPlacement).toEqual(MEETING.MediaPlacement);
      expect(session.meeting.MediaPlacement.EventIngestionUrl).toBe('https://data.example.test/v1/client-events');
      expect(session.participant.providerAttendeeId).toBe('attendee-1');
      expect(session.participant.attendee).toEqual(attendee(PARTICIPANT_ID));
    });

    it('rejects an attendee with video send before calling Chime', async () => {
      await expect(
        provider.createSession({
          ...webinarInput,
          participant: {
            participantId: PARTICIPANT_ID,
            role: 'attendee',
            capabilities: { Audio: 'Receive', Video: 'SendReceive', Content: 'Receive' },
          },
        }),
      ).rejects.toThrow(VideoCapabilityError);
      expect(meetings.commandCalls(CreateMeetingWithAttendeesCommand)).toHaveLength(0);
    });

    it('rejects a webinar above the replicated limit with capacity_above_limit', async () => {
      await expectApiError(
        provider.createSession({ ...webinarInput, capacity: WEBINAR_REPLICATED_CAPACITY + 1 }),
        400,
        'capacity_above_limit',
      );
      expect(meetings.commandCalls(CreateMeetingWithAttendeesCommand)).toHaveLength(0);
    });

    it('rejects a workshop above WORKSHOP_CAPACITY even though the meeting holds more', async () => {
      expect(MEETING_FEATURES.workshop.Attendee.MaxCount).toBeGreaterThan(WORKSHOP_CAPACITY);
      await expectApiError(
        provider.createSession({ ...workshopInput, capacity: WORKSHOP_CAPACITY + 1 }),
        400,
        'capacity_above_limit',
      );
      expect(meetings.commandCalls(CreateMeetingWithAttendeesCommand)).toHaveLength(0);
    });

    it.each([
      ['ServiceUnavailableException', () => new ServiceUnavailableException({ message: 'down', $metadata: {} }), 503],
      ['ThrottlingException', () => new ThrottlingException({ message: 'slow down', $metadata: {} }), 429],
      ['LimitExceededException', () => new LimitExceededException({ message: 'limit', $metadata: {} }), 429],
    ] as const)('maps %s to video_provider_unavailable', async (_name, makeError, status) => {
      meetings.on(CreateMeetingWithAttendeesCommand).rejects(makeError());
      await expectApiError(provider.createSession(consultationInput), status, 'video_provider_unavailable');
    });

    it('maps any other SDK error to a 502 without the provider message (CW-R-09)', async () => {
      meetings
        .on(CreateMeetingWithAttendeesCommand)
        .rejects(new BadRequestException({ message: 'internal provider detail', $metadata: {} }));

      const error = await expectApiError(
        provider.createSession(consultationInput),
        502,
        'video_provider_unavailable',
      );
      expect(error.message).not.toContain('internal provider detail');
      expect(logged.join('\n')).not.toContain('internal provider detail');
    });

    it('deletes the new meeting and fails with 502 when Chime reports an error for the attendee', async () => {
      meetings.on(CreateMeetingWithAttendeesCommand).resolves({
        Meeting: MEETING,
        Attendees: [],
        Errors: [{ ExternalUserId: PARTICIPANT_ID, ErrorCode: 'BadRequest', ErrorMessage: 'nope' }],
      });
      meetings.on(DeleteMeetingCommand).resolves({});

      await expectApiError(provider.createSession(consultationInput), 502, 'video_provider_unavailable');

      const deletes = meetings.commandCalls(DeleteMeetingCommand);
      expect(deletes).toHaveLength(1);
      expect(deletes[0]!.args[0].input).toEqual({ MeetingId: 'meeting-1' });
      expect(logged.join('\n')).not.toContain('nope');
    });

    it('still fails with 502 when deleting the half-created meeting fails too', async () => {
      meetings.on(CreateMeetingWithAttendeesCommand).resolves({
        Meeting: MEETING,
        Attendees: [],
        Errors: [{ ExternalUserId: PARTICIPANT_ID, ErrorCode: 'BadRequest', ErrorMessage: 'nope' }],
      });
      meetings.on(DeleteMeetingCommand).rejects(new ServiceUnavailableException({ message: 'down', $metadata: {} }));

      await expectApiError(provider.createSession(consultationInput), 502, 'video_provider_unavailable');
      expect(meetings.commandCalls(DeleteMeetingCommand)).toHaveLength(1);
    });

    it('sends the session and participant ids raw; only tenant ids are encoded', async () => {
      meetings.on(CreateMeetingWithAttendeesCommand).resolves({
        Meeting: MEETING,
        Attendees: [attendee(PARTICIPANT_ID)],
      });

      await provider.createSession({ ...consultationInput, orgId: REPEATING_ID });

      const request = meetings.commandCalls(CreateMeetingWithAttendeesCommand)[0]!.args[0].input;
      expect(request.ClientRequestToken).toBe(SESSION_ID);
      expect(request.ExternalMeetingId).toBe(SESSION_ID);
      expect(request.Attendees?.[0]?.ExternalUserId).toBe(PARTICIPANT_ID);
      expect(request.TenantIds).toEqual([encodeTenantId(REPEATING_ID)]);
      expect(request.TenantIds?.[0]).toMatch(CHIME_TENANT_ID_PATTERN);
      expect(request.Tags).toContainEqual({ Key: 'orgId', Value: REPEATING_ID });
    });

    it('never logs the join token (CW-R-69)', async () => {
      meetings.on(CreateMeetingWithAttendeesCommand).resolves({
        Meeting: MEETING,
        Attendees: [attendee(PARTICIPANT_ID)],
      });

      await provider.createSession(consultationInput);

      expect(logged.length).toBeGreaterThan(0);
      expect(logged.join('\n')).not.toContain(JOIN_TOKEN);
    });
  });

  describe('createParticipant', () => {
    it('calls CreateAttendee with the participant id as ExternalUserId (CW-R-71)', async () => {
      meetings.on(CreateAttendeeCommand).resolves({ Attendee: attendee(SECOND_PARTICIPANT_ID, 'attendee-2') });

      const participant = await provider.createParticipant({
        providerMeetingId: 'meeting-1',
        participantId: SECOND_PARTICIPANT_ID,
        role: 'employee',
      });

      const request = meetings.commandCalls(CreateAttendeeCommand)[0]!.args[0].input;
      expect(request).toEqual({
        MeetingId: 'meeting-1',
        ExternalUserId: SECOND_PARTICIPANT_ID,
        Capabilities: { Audio: 'SendReceive', Video: 'SendReceive', Content: 'Receive' },
      });
      expect(participant.providerAttendeeId).toBe('attendee-2');
      expect(participant.attendee.JoinToken).toBe(JOIN_TOKEN);
    });

    it('gives a webinar attendee receive-only capabilities (CW-R-75)', async () => {
      meetings.on(CreateAttendeeCommand).resolves({ Attendee: attendee(SECOND_PARTICIPANT_ID, 'attendee-2') });

      await provider.createParticipant({
        providerMeetingId: 'meeting-1',
        participantId: SECOND_PARTICIPANT_ID,
        role: 'attendee',
      });

      const request = meetings.commandCalls(CreateAttendeeCommand)[0]!.args[0].input;
      expect(request.Capabilities).toEqual({ Audio: 'Receive', Video: 'Receive', Content: 'Receive' });
    });

    it('maps NotFoundException (meeting deleted) to appointment_not_joinable', async () => {
      meetings.on(CreateAttendeeCommand).rejects(new NotFoundException({ message: 'gone', $metadata: {} }));

      await expectApiError(
        provider.createParticipant({ providerMeetingId: 'meeting-1', participantId: SECOND_PARTICIPANT_ID, role: 'employee' }),
        409,
        'appointment_not_joinable',
      );
    });

    it('maps ServiceUnavailableException to video_provider_unavailable', async () => {
      meetings.on(CreateAttendeeCommand).rejects(new ServiceUnavailableException({ message: 'down', $metadata: {} }));

      await expectApiError(
        provider.createParticipant({ providerMeetingId: 'meeting-1', participantId: SECOND_PARTICIPANT_ID, role: 'employee' }),
        503,
        'video_provider_unavailable',
      );
    });
  });

  describe('updateParticipantCapabilities', () => {
    it('calls UpdateAttendeeCapabilities with the floor capabilities', async () => {
      meetings.on(UpdateAttendeeCapabilitiesCommand).resolves({});

      await provider.updateParticipantCapabilities({
        providerMeetingId: 'meeting-1',
        providerAttendeeId: 'attendee-2',
        role: 'attendee',
        capabilities: capabilitiesForRole('attendee', { floor: true }),
      });

      const request = meetings.commandCalls(UpdateAttendeeCapabilitiesCommand)[0]!.args[0].input;
      expect(request).toEqual({
        MeetingId: 'meeting-1',
        AttendeeId: 'attendee-2',
        Capabilities: { Audio: 'SendReceive', Video: 'Receive', Content: 'Receive' },
      });
    });

    it('rejects attendee video SendReceive without calling Chime (CW-R-108)', async () => {
      await expect(
        provider.updateParticipantCapabilities({
          providerMeetingId: 'meeting-1',
          providerAttendeeId: 'attendee-2',
          role: 'attendee',
          capabilities: { Audio: 'SendReceive', Video: 'SendReceive', Content: 'Receive' },
        }),
      ).rejects.toThrow(VideoCapabilityError);
      expect(meetings.commandCalls(UpdateAttendeeCapabilitiesCommand)).toHaveLength(0);
    });

    it('maps NotFoundException to appointment_not_joinable', async () => {
      meetings
        .on(UpdateAttendeeCapabilitiesCommand)
        .rejects(new NotFoundException({ message: 'gone', $metadata: {} }));

      await expectApiError(
        provider.updateParticipantCapabilities({
          providerMeetingId: 'meeting-1',
          providerAttendeeId: 'attendee-2',
          role: 'presenter',
          capabilities: capabilitiesForRole('presenter'),
        }),
        409,
        'appointment_not_joinable',
      );
    });
  });

  describe('removeParticipant', () => {
    it('calls DeleteAttendee', async () => {
      meetings.on(DeleteAttendeeCommand).resolves({});

      await provider.removeParticipant({ providerMeetingId: 'meeting-1', providerAttendeeId: 'attendee-2' });

      expect(meetings.commandCalls(DeleteAttendeeCommand)[0]!.args[0].input).toEqual({
        MeetingId: 'meeting-1',
        AttendeeId: 'attendee-2',
      });
    });

    it('treats an attendee that is already gone as removed', async () => {
      meetings.on(DeleteAttendeeCommand).rejects(new NotFoundException({ message: 'gone', $metadata: {} }));

      await expect(
        provider.removeParticipant({ providerMeetingId: 'meeting-1', providerAttendeeId: 'attendee-2' }),
      ).resolves.toBeUndefined();
    });

    it('maps ServiceUnavailableException to video_provider_unavailable', async () => {
      meetings.on(DeleteAttendeeCommand).rejects(new ServiceUnavailableException({ message: 'down', $metadata: {} }));

      await expectApiError(
        provider.removeParticipant({ providerMeetingId: 'meeting-1', providerAttendeeId: 'attendee-2' }),
        503,
        'video_provider_unavailable',
      );
    });
  });

  describe('endSession', () => {
    it('calls DeleteMeeting', async () => {
      meetings.on(DeleteMeetingCommand).resolves({});

      await provider.endSession({ providerMeetingId: 'meeting-1' });

      expect(meetings.commandCalls(DeleteMeetingCommand)[0]!.args[0].input).toEqual({ MeetingId: 'meeting-1' });
    });

    it('is a no-op for a meeting that already ended (CW-R-16)', async () => {
      meetings.on(DeleteMeetingCommand).rejects(new NotFoundException({ message: 'gone', $metadata: {} }));

      await expect(provider.endSession({ providerMeetingId: 'meeting-1' })).resolves.toBeUndefined();
    });

    it('maps ThrottlingException to video_provider_unavailable', async () => {
      meetings.on(DeleteMeetingCommand).rejects(new ThrottlingException({ message: 'slow', $metadata: {} }));

      await expectApiError(provider.endSession({ providerMeetingId: 'meeting-1' }), 429, 'video_provider_unavailable');
    });
  });

  describe('describeSession', () => {
    it('calls GetMeeting and returns the meeting', async () => {
      meetings.on(GetMeetingCommand).resolves({ Meeting: MEETING });

      const info = await provider.describeSession({ providerMeetingId: 'meeting-1' });

      expect(meetings.commandCalls(GetMeetingCommand)[0]!.args[0].input).toEqual({ MeetingId: 'meeting-1' });
      expect(info?.providerMeetingId).toBe('meeting-1');
      expect(info?.meeting.MediaPlacement.SignalingUrl).toBe(MEETING.MediaPlacement!.SignalingUrl);
    });

    it('returns null when the meeting no longer exists', async () => {
      meetings.on(GetMeetingCommand).rejects(new NotFoundException({ message: 'gone', $metadata: {} }));

      await expect(provider.describeSession({ providerMeetingId: 'meeting-1' })).resolves.toBeNull();
    });

    it('maps ServiceUnavailableException to video_provider_unavailable', async () => {
      meetings.on(GetMeetingCommand).rejects(new ServiceUnavailableException({ message: 'down', $metadata: {} }));

      await expectApiError(
        provider.describeSession({ providerMeetingId: 'meeting-1' }),
        503,
        'video_provider_unavailable',
      );
    });
  });

  describe('startRecording', () => {
    const RAW_PREFIX = `recordings/${WEBINAR_ID}/raw/`;
    const PIPELINE_ARN = 'arn:aws:chime:eu-central-1:111122223333:media-pipeline/pipeline-1';

    it('captures presenter-only composited HD video into recordings/{webinarId}/raw/ (D-CW-18, T-CW-2.5)', async () => {
      meetings.on(GetMeetingCommand).resolves({ Meeting: MEETING });
      pipelines.on(CreateMediaCapturePipelineCommand).resolves({
        MediaCapturePipeline: { MediaPipelineId: 'pipeline-1', MediaPipelineArn: PIPELINE_ARN },
      });

      const recording = await provider.startRecording({
        sessionId: SESSION_ID,
        providerMeetingId: 'meeting-1',
        presenterAttendeeIds: ['attendee-1', 'attendee-3'],
        s3Prefix: RAW_PREFIX,
      });

      const request = pipelines.commandCalls(CreateMediaCapturePipelineCommand)[0]!.args[0].input;
      expect(request).toEqual({
        SourceType: 'ChimeSdkMeeting',
        SourceArn: 'arn:aws:chime::111122223333:meeting:meeting-1',
        SinkType: 'S3Bucket',
        SinkArn: `arn:aws:s3:::${BUCKET}/recordings/${WEBINAR_ID}/raw`,
        ChimeSdkMeetingConfiguration: {
          SourceConfiguration: { SelectedVideoStreams: { AttendeeIds: ['attendee-1', 'attendee-3'] } },
          ArtifactsConfiguration: {
            Audio: { MuxType: 'AudioWithCompositedVideo' },
            Video: { State: 'Disabled' },
            Content: { State: 'Disabled' },
            CompositedVideo: {
              Layout: 'GridView',
              Resolution: 'HD',
              GridViewConfiguration: { ContentShareLayout: 'PresenterOnly' },
            },
          },
        },
      });
      expect(recording).toEqual({ pipelineId: 'pipeline-1', pipelineArn: PIPELINE_ARN, rawSegmentsPrefix: RAW_PREFIX });
    });

    it('refuses a prefix that is empty, absolute or not a folder, and an empty presenter list, before any SDK call', async () => {
      const base = { sessionId: SESSION_ID, providerMeetingId: 'meeting-1', presenterAttendeeIds: ['attendee-1'] };
      for (const s3Prefix of ['', '/recordings/w/raw/', 'recordings/w/raw', 'recordings/../raw/']) {
        await expect(provider.startRecording({ ...base, s3Prefix })).rejects.toThrow(/prefix/);
      }
      await expect(provider.startRecording({ ...base, presenterAttendeeIds: [], s3Prefix: RAW_PREFIX })).rejects.toThrow(
        /presenter/,
      );
      expect(meetings.commandCalls(GetMeetingCommand)).toHaveLength(0);
      expect(pipelines.commandCalls(CreateMediaCapturePipelineCommand)).toHaveLength(0);
    });

    it('answers 502 when the capture response has no pipeline ARN (the concatenation source)', async () => {
      meetings.on(GetMeetingCommand).resolves({ Meeting: MEETING });
      pipelines.on(CreateMediaCapturePipelineCommand).resolves({ MediaCapturePipeline: { MediaPipelineId: 'pipeline-1' } });
      await expectApiError(
        provider.startRecording({ sessionId: SESSION_ID, providerMeetingId: 'meeting-1', presenterAttendeeIds: ['a'], s3Prefix: RAW_PREFIX }),
        502,
        'video_provider_unavailable',
      );
    });

    it('maps NotFoundException on the meeting to appointment_not_joinable', async () => {
      meetings.on(GetMeetingCommand).rejects(new NotFoundException({ message: 'gone', $metadata: {} }));

      await expectApiError(
        provider.startRecording({
          sessionId: SESSION_ID,
          providerMeetingId: 'meeting-1',
          presenterAttendeeIds: ['attendee-1'],
          s3Prefix: RAW_PREFIX,
        }),
        409,
        'appointment_not_joinable',
      );
      expect(pipelines.commandCalls(CreateMediaCapturePipelineCommand)).toHaveLength(0);
    });

    it('maps a pipeline ServiceUnavailableException to video_provider_unavailable', async () => {
      meetings.on(GetMeetingCommand).resolves({ Meeting: MEETING });
      pipelines
        .on(CreateMediaCapturePipelineCommand)
        .rejects(new PipelineServiceUnavailableException({ message: 'down', $metadata: {} }));

      await expectApiError(
        provider.startRecording({
          sessionId: SESSION_ID,
          providerMeetingId: 'meeting-1',
          presenterAttendeeIds: ['attendee-1'],
          s3Prefix: RAW_PREFIX,
        }),
        503,
        'video_provider_unavailable',
      );
    });
  });

  describe('startConcatenation and describeConcatenation (WEB-29, T-CW-2.5)', () => {
    const CAPTURE_ARN = 'arn:aws:chime:eu-central-1:111122223333:media-pipeline/pipeline-1';
    const FINAL_PREFIX = `recordings/${WEBINAR_ID}/final/`;

    it('concatenates the capture into one composited MP4 with the audio under recordings/{webinarId}/final/', async () => {
      pipelines.on(CreateMediaConcatenationPipelineCommand).resolves({
        MediaConcatenationPipeline: { MediaPipelineId: 'concat-1', Status: 'Initializing' },
      });

      const started = await provider.startConcatenation({
        sessionId: SESSION_ID,
        capturePipelineArn: CAPTURE_ARN,
        s3Prefix: FINAL_PREFIX,
        attempt: 2,
      });

      expect(started).toEqual({ pipelineId: 'concat-1' });
      expect(pipelines.commandCalls(CreateMediaConcatenationPipelineCommand)[0]!.args[0].input).toEqual({
        // One token per attempt: a retry after a failed concatenation starts a new pipeline.
        ClientRequestToken: `${SESSION_ID}-c2`,
        Sources: [
          {
            Type: 'MediaCapturePipeline',
            MediaCapturePipelineSourceConfiguration: {
              MediaPipelineArn: CAPTURE_ARN,
              ChimeSdkMeetingConfiguration: {
                ArtifactsConfiguration: {
                  Audio: { State: 'Enabled' },
                  Video: { State: 'Disabled' },
                  Content: { State: 'Disabled' },
                  DataChannel: { State: 'Disabled' },
                  TranscriptionMessages: { State: 'Disabled' },
                  MeetingEvents: { State: 'Disabled' },
                  CompositedVideo: { State: 'Enabled' },
                },
              },
            },
          },
        ],
        Sinks: [
          { Type: 'S3Bucket', S3BucketSinkConfiguration: { Destination: `arn:aws:s3:::${BUCKET}/recordings/${WEBINAR_ID}/final` } },
        ],
      });
    });

    it('maps a concatenation ServiceUnavailableException to video_provider_unavailable', async () => {
      pipelines
        .on(CreateMediaConcatenationPipelineCommand)
        .rejects(new PipelineServiceUnavailableException({ message: 'down', $metadata: {} }));
      await expectApiError(
        provider.startConcatenation({ sessionId: SESSION_ID, capturePipelineArn: CAPTURE_ARN, s3Prefix: FINAL_PREFIX, attempt: 1 }),
        503,
        'video_provider_unavailable',
      );
    });

    it.each([
      ['Initializing', 'in_progress'],
      ['InProgress', 'in_progress'],
      ['NotStarted', 'in_progress'],
      ['Stopping', 'in_progress'],
      ['Failed', 'failed'],
    ] as const)('reports %s as %s without a key', async (status, expected) => {
      pipelines.on(GetMediaPipelineCommand).resolves({
        MediaPipeline: { MediaConcatenationPipeline: { MediaPipelineId: 'concat-1', Status: status } },
      });
      expect(await provider.describeConcatenation({ pipelineId: 'concat-1', s3Prefix: FINAL_PREFIX })).toEqual({
        status: expected,
        concatenatedKey: null,
        location: null,
      });
      expect(pipelines.commandCalls(GetMediaPipelineCommand)[0]!.args[0].input).toEqual({ MediaPipelineId: 'concat-1' });
    });

    it('reports Stopped as completed, with the composited-video key prefix and its s3 location', async () => {
      pipelines.on(GetMediaPipelineCommand).resolves({
        MediaPipeline: { MediaConcatenationPipeline: { MediaPipelineId: 'concat-1', Status: 'Stopped' } },
      });
      expect(await provider.describeConcatenation({ pipelineId: 'concat-1', s3Prefix: FINAL_PREFIX })).toEqual({
        status: 'completed',
        concatenatedKey: `${FINAL_PREFIX}composited-video/`,
        location: `s3://${BUCKET}/${FINAL_PREFIX}composited-video/`,
      });
    });

    it('reports a pipeline the provider no longer knows as failed', async () => {
      pipelines.on(GetMediaPipelineCommand).rejects(new PipelineNotFoundException({ message: 'gone', $metadata: {} }));
      expect(await provider.describeConcatenation({ pipelineId: 'concat-1', s3Prefix: FINAL_PREFIX })).toMatchObject({
        status: 'failed',
      });
    });
  });

  describe('stopRecording', () => {
    it('calls DeleteMediaCapturePipeline', async () => {
      pipelines.on(DeleteMediaCapturePipelineCommand).resolves({});

      await provider.stopRecording({ pipelineId: 'pipeline-1' });

      expect(pipelines.commandCalls(DeleteMediaCapturePipelineCommand)[0]!.args[0].input).toEqual({
        MediaPipelineId: 'pipeline-1',
      });
    });

    it('treats a pipeline that is already gone as stopped', async () => {
      pipelines
        .on(DeleteMediaCapturePipelineCommand)
        .rejects(new PipelineNotFoundException({ message: 'gone', $metadata: {} }));

      await expect(provider.stopRecording({ pipelineId: 'pipeline-1' })).resolves.toBeUndefined();
    });

    it('maps ServiceUnavailableException to video_provider_unavailable', async () => {
      pipelines
        .on(DeleteMediaCapturePipelineCommand)
        .rejects(new PipelineServiceUnavailableException({ message: 'down', $metadata: {} }));

      await expectApiError(provider.stopRecording({ pipelineId: 'pipeline-1' }), 503, 'video_provider_unavailable');
    });
  });
  describe('media replication (T-CW-3.2)', () => {
    const HOST_ID = PARTICIPANT_ID;
    const replicatedInput: CreateSessionInput = { ...webinarInput, capacity: 500 };
    const PRIMARY: Meeting = { ...MEETING, TenantIds: [encodeTenantId(WEBINAR_ID)] };

    function replicaMeeting(externalMeetingId: string | undefined): Meeting {
      const index = parseReplicaExternalMeetingId(externalMeetingId ?? '')?.replicaIndex ?? 0;
      return {
        MeetingId: `replica-${index}`,
        MeetingArn: `arn:aws:chime:eu-central-1:111122223333:meeting/replica-${index}`,
        ExternalMeetingId: externalMeetingId,
        MediaRegion: 'eu-central-1',
        // Chime reports the primary on a replica; attendees must never receive it.
        PrimaryMeetingId: 'meeting-1',
        MediaPlacement: {
          AudioHostUrl: 'audio.example.test:3478',
          AudioFallbackUrl: `wss://audio.example.test:443/calls/replica-${index}`,
          SignalingUrl: `wss://signal.example.test/control/replica-${index}`,
        },
      };
    }

    beforeEach(() => {
      meetings.on(CreateMeetingWithAttendeesCommand).resolves({ Meeting: PRIMARY, Attendees: [attendee(HOST_ID)] });
      meetings.on(CreateMeetingCommand).callsFake((input: { ExternalMeetingId?: string; PrimaryMeetingId?: string }) => ({
        Meeting: input.PrimaryMeetingId ? replicaMeeting(input.ExternalMeetingId) : PRIMARY,
      }));
    });

    it('creates one primary and two replicas with PrimaryMeetingId for capacity 500', async () => {
      const session = await provider.createSession(replicatedInput);

      expect(meetings.commandCalls(CreateMeetingWithAttendeesCommand)).toHaveLength(1);
      const replicaRequests = meetings.commandCalls(CreateMeetingCommand).map((call) => call.args[0].input);
      expect(replicaRequests).toHaveLength(2);
      replicaRequests.forEach((request, i) => {
        const suffix = `${SESSION_ID}-r${i + 1}`;
        expect(request).toEqual({
          PrimaryMeetingId: 'meeting-1',
          ClientRequestToken: suffix,
          ExternalMeetingId: suffix,
          MediaRegion: 'eu-central-1',
          MeetingFeatures: MEETING_FEATURES.webinar,
          NotificationsConfiguration: { SqsQueueArn: QUEUE_ARN },
          TenantIds: [encodeTenantId(WEBINAR_ID)],
          Tags: [
            { Key: 'stage', Value: 'dev' },
            { Key: 'format', Value: 'webinar' },
          ],
        });
      });

      expect(session.providerMeetingId).toBe('meeting-1');
      expect(session.participant.providerMeetingId).toBe('meeting-1');
      expect(session.replicas.map(({ replicaIndex, providerMeetingId, capacity }) => ({ replicaIndex, providerMeetingId, capacity }))).toEqual([
        { replicaIndex: 1, providerMeetingId: 'replica-1', capacity: 250 },
        { replicaIndex: 2, providerMeetingId: 'replica-2', capacity: 250 },
      ]);
    });

    it('never hands a replica meeting out with the primary id', async () => {
      const session = await provider.createSession(replicatedInput);

      for (const replica of session.replicas) {
        expect(replica.meeting).not.toHaveProperty('PrimaryMeetingId');
        expect(JSON.stringify(replica.meeting)).not.toContain('meeting-1');
      }
    });

    it('creates no replica for capacity 250', async () => {
      const session = await provider.createSession({ ...webinarInput, capacity: WEBINAR_SINGLE_MEETING_CAPACITY });

      expect(meetings.commandCalls(CreateMeetingCommand)).toHaveLength(0);
      expect(session.replicas).toEqual([]);
    });

    it('creates four replicas for 1,000 and refuses 1,001, naming the documented IVS path', async () => {
      const full = await provider.createSession({ ...webinarInput, capacity: WEBINAR_REPLICATED_CAPACITY });
      expect(full.replicas).toHaveLength(WEBINAR_MAX_REPLICAS);

      meetings.resetHistory();
      const error = await expectApiError(
        provider.createSession({ ...webinarInput, capacity: WEBINAR_REPLICATED_CAPACITY + 1 }),
        400,
        'capacity_above_limit',
      );
      expect(error.message).toMatch(/IVS/);
      expect(error.details).toEqual({ limit: WEBINAR_REPLICATED_CAPACITY });
      expect(meetings.calls()).toHaveLength(0);
    });

    it('puts an attendee who arrives first into the first replica, never the primary', async () => {
      meetings.on(CreateAttendeeCommand).resolves({ Attendee: attendee(SECOND_PARTICIPANT_ID, 'attendee-2') });

      const session = await provider.createSession({
        ...replicatedInput,
        participant: { participantId: SECOND_PARTICIPANT_ID, role: 'attendee' },
      });

      expect(meetings.commandCalls(CreateMeetingWithAttendeesCommand)).toHaveLength(0);
      const created = meetings.commandCalls(CreateMeetingCommand).map((call) => call.args[0].input);
      expect(created[0]).not.toHaveProperty('PrimaryMeetingId');
      expect(created.slice(1).map((request) => request.PrimaryMeetingId)).toEqual(['meeting-1', 'meeting-1']);
      expect(meetings.commandCalls(CreateAttendeeCommand)[0]!.args[0].input).toEqual({
        MeetingId: 'replica-1',
        ExternalUserId: SECOND_PARTICIPANT_ID,
        Capabilities: { Audio: 'Receive', Video: 'Receive', Content: 'Receive' },
      });
      expect(session.participant.providerMeetingId).toBe('replica-1');
    });

    it('deletes the primary, and with it the replicas, when a replica cannot be created', async () => {
      meetings
        .on(CreateMeetingCommand)
        .rejects(new ServiceUnavailableException({ message: 'down', $metadata: {} }));
      meetings.on(DeleteMeetingCommand).resolves({});

      await expectApiError(provider.createSession(replicatedInput), 503, 'video_provider_unavailable');

      expect(meetings.commandCalls(DeleteMeetingCommand).map((call) => call.args[0].input)).toEqual([
        { MeetingId: 'meeting-1' },
      ]);
    });

    it('routes a participant to the replica named by target', async () => {
      meetings.on(CreateAttendeeCommand).resolves({ Attendee: attendee(SECOND_PARTICIPANT_ID, 'attendee-2') });

      const participant = await provider.createParticipant({
        providerMeetingId: 'meeting-1',
        replicaMeetingIds: ['replica-1', 'replica-2'],
        target: { replicaIndex: 2 },
        participantId: SECOND_PARTICIPANT_ID,
        role: 'attendee',
      });

      expect(meetings.commandCalls(CreateAttendeeCommand)[0]!.args[0].input.MeetingId).toBe('replica-2');
      expect(participant.providerMeetingId).toBe('replica-2');
    });

    it('keeps hosts on the primary and refuses an unknown replica', async () => {
      for (const role of ['presenter', 'moderator'] as const) {
        await expect(
          provider.createParticipant({
            providerMeetingId: 'meeting-1',
            replicaMeetingIds: ['replica-1'],
            target: { replicaIndex: 1 },
            participantId: SECOND_PARTICIPANT_ID,
            role,
          }),
        ).rejects.toThrow(VideoRoutingError);
      }
      await expect(
        provider.createParticipant({
          providerMeetingId: 'meeting-1',
          replicaMeetingIds: ['replica-1'],
          target: { replicaIndex: 2 },
          participantId: SECOND_PARTICIPANT_ID,
          role: 'attendee',
        }),
      ).rejects.toThrow(VideoRoutingError);
      expect(meetings.commandCalls(CreateAttendeeCommand)).toHaveLength(0);
    });

    it('never lets a replica attendee or a promoted attendee send video (D-CW-35)', async () => {
      meetings.on(CreateAttendeeCommand).resolves({ Attendee: attendee(SECOND_PARTICIPANT_ID, 'attendee-2') });
      meetings.on(UpdateAttendeeCapabilitiesCommand).resolves({});
      const replicaVideo = { Audio: 'Receive', Video: 'SendReceive', Content: 'Receive' } as const;
      const promotedVideo = { Audio: 'SendReceive', Video: 'SendReceive', Content: 'Receive' } as const;

      await expect(
        provider.createParticipant({
          providerMeetingId: 'meeting-1',
          replicaMeetingIds: ['replica-1'],
          target: { replicaIndex: 1 },
          participantId: SECOND_PARTICIPANT_ID,
          role: 'attendee',
          capabilities: replicaVideo,
        }),
      ).rejects.toThrow(VideoCapabilityError);
      await expect(
        provider.createParticipant({
          providerMeetingId: 'meeting-1',
          target: 'primary',
          participantId: SECOND_PARTICIPANT_ID,
          role: 'attendee',
          capabilities: promotedVideo,
        }),
      ).rejects.toThrow(VideoCapabilityError);
      await expect(
        provider.updateParticipantCapabilities({
          providerMeetingId: 'replica-1',
          providerAttendeeId: 'attendee-2',
          role: 'attendee',
          capabilities: promotedVideo,
        }),
      ).rejects.toThrow(VideoCapabilityError);
      expect(meetings.commandCalls(CreateAttendeeCommand)).toHaveLength(0);
      expect(meetings.commandCalls(UpdateAttendeeCapabilitiesCommand)).toHaveLength(0);

      // The floor from a replica: primary credentials, audio only (WEB-09).
      await provider.createParticipant({
        providerMeetingId: 'meeting-1',
        target: 'primary',
        participantId: SECOND_PARTICIPANT_ID,
        role: 'attendee',
        capabilities: capabilitiesForRole('attendee', { floor: true }),
      });
      expect(meetings.commandCalls(CreateAttendeeCommand)[0]!.args[0].input).toEqual({
        MeetingId: 'meeting-1',
        ExternalUserId: SECOND_PARTICIPANT_ID,
        Capabilities: { Audio: 'SendReceive', Video: 'Receive', Content: 'Receive' },
      });

    });

    describe('the floor from a replica (WEB-09, SPIKE-CW-06)', () => {
      const promotion = { sessionId: SESSION_ID, providerMeetingId: 'meeting-1', participantId: SECOND_PARTICIPANT_ID };

      it('promoteToPrimary creates an audio-only attendee on the primary and returns its credentials', async () => {
        meetings.on(CreateAttendeeCommand).resolves({
          Attendee: { ...attendee(SECOND_PARTICIPANT_ID, 'primary-attendee-2'), Capabilities: undefined },
        });

        const promoted = await provider.promoteToPrimary(promotion);

        expect(meetings.commandCalls(CreateAttendeeCommand)[0]!.args[0].input).toEqual({
          MeetingId: 'meeting-1',
          ExternalUserId: SECOND_PARTICIPANT_ID,
          Capabilities: { Audio: 'SendReceive', Video: 'Receive', Content: 'Receive' },
        });
        expect(promoted.providerMeetingId).toBe('meeting-1');
        expect(promoted.providerAttendeeId).toBe('primary-attendee-2');
        expect(promoted.attendee.JoinToken).toBe(JOIN_TOKEN);
        // D-CW-35: the floor is audio only, never video, whatever the caller does.
        expect(promoted.attendee.Capabilities.Video).toBe('Receive');
        expect(promoted.attendee.Capabilities.Content).toBe('Receive');
        expect(logged.join('\n')).not.toContain(JOIN_TOKEN);
      });

      it('never lets a promotion carry video, even if the provider reports it', async () => {
        meetings.on(CreateAttendeeCommand).resolves({ Attendee: attendee(SECOND_PARTICIPANT_ID, 'primary-attendee-2') });

        const promoted = await provider.promoteToPrimary(promotion);

        expect(promoted.attendee.Capabilities).toEqual({ Audio: 'SendReceive', Video: 'Receive', Content: 'Receive' });
      });

      it('maps a primary that is gone to appointment_not_joinable', async () => {
        meetings.on(CreateAttendeeCommand).rejects(new NotFoundException({ message: 'gone', $metadata: {} }));

        await expectApiError(provider.promoteToPrimary(promotion), 409, 'appointment_not_joinable');
      });

      it('demoteFromPrimary deletes the primary attendee and tolerates one already gone', async () => {
        meetings
          .on(DeleteAttendeeCommand)
          .resolvesOnce({})
          .rejectsOnce(new NotFoundException({ message: 'gone', $metadata: {} }));
        const demotion = { ...promotion, providerAttendeeId: 'primary-attendee-2' };

        await provider.demoteFromPrimary(demotion);
        await expect(provider.demoteFromPrimary(demotion)).resolves.toBeUndefined();

        expect(meetings.commandCalls(DeleteAttendeeCommand).map((call) => call.args[0].input)).toEqual([
          { MeetingId: 'meeting-1', AttendeeId: 'primary-attendee-2' },
          { MeetingId: 'meeting-1', AttendeeId: 'primary-attendee-2' },
        ]);
      });
    });

    it('ends the replicas first, then the primary', async () => {
      meetings.on(DeleteMeetingCommand).resolves({});

      await provider.endSession({ providerMeetingId: 'meeting-1', replicaMeetingIds: ['replica-1', 'replica-2'] });

      expect(meetings.commandCalls(DeleteMeetingCommand).map((call) => call.args[0].input.MeetingId)).toEqual([
        'replica-1',
        'replica-2',
        'meeting-1',
      ]);
    });

    it('still deletes the primary, which takes its replicas along, when a replica delete fails', async () => {
      meetings
        .on(DeleteMeetingCommand, { MeetingId: 'replica-1' })
        .rejects(new ServiceUnavailableException({ message: 'down', $metadata: {} }))
        .on(DeleteMeetingCommand, { MeetingId: 'replica-2' })
        .rejects(new NotFoundException({ message: 'gone', $metadata: {} }))
        .on(DeleteMeetingCommand, { MeetingId: 'meeting-1' })
        .resolves({});

      await expect(
        provider.endSession({ providerMeetingId: 'meeting-1', replicaMeetingIds: ['replica-1', 'replica-2'] }),
      ).resolves.toBeUndefined();
      expect(meetings.commandCalls(DeleteMeetingCommand).at(-1)!.args[0].input.MeetingId).toBe('meeting-1');
    });

    it('describes the primary and the replicas that still exist', async () => {
      meetings
        .on(GetMeetingCommand, { MeetingId: 'meeting-1' })
        .resolves({ Meeting: PRIMARY })
        .on(GetMeetingCommand, { MeetingId: 'replica-1' })
        .resolves({ Meeting: replicaMeeting(`${SESSION_ID}-r1`) })
        .on(GetMeetingCommand, { MeetingId: 'replica-2' })
        .rejects(new NotFoundException({ message: 'gone', $metadata: {} }));

      const info = await provider.describeSession({
        providerMeetingId: 'meeting-1',
        replicaMeetingIds: ['replica-1', 'replica-2'],
      });

      expect(info?.providerMeetingId).toBe('meeting-1');
      expect(info?.replicas.map(({ replicaIndex, providerMeetingId }) => ({ replicaIndex, providerMeetingId }))).toEqual([
        { replicaIndex: 1, providerMeetingId: 'replica-1' },
      ]);
      expect(info?.replicas[0]?.meeting).not.toHaveProperty('PrimaryMeetingId');
    });
  });
});

// ---------------------------------------------------------------------------
// FakeVideoProvider (D-CW-05, D-CW-12)
// ---------------------------------------------------------------------------

describe('FakeVideoProvider', () => {
  const NOW = new Date('2026-10-24T09:00:00.000Z');
  let fake: FakeVideoProvider;
  let events: VideoProviderEvent[];

  beforeEach(() => {
    fake = new FakeVideoProvider({ now: () => NOW });
    // Bound to this test's array: earlier tests' fakes may still deliver.
    const received: VideoProviderEvent[] = [];
    events = received;
    fake.onEvent((event) => {
      received.push(event);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a stub with stable fields', async () => {
    const session = await fake.createSession(consultationInput);

    expect(session.providerMeetingId).toBe(`fake-meeting-${SESSION_ID}`);
    expect(session.meeting.MeetingId).toBe(`fake-meeting-${SESSION_ID}`);
    expect(session.meeting.ExternalMeetingId).toBe(SESSION_ID);
    expect(session.meeting.MediaRegion).toBe('eu-central-1');
    expect(session.meeting.MeetingFeatures).toEqual(MEETING_FEATURES.consultation);
    expect(session.meeting.TenantIds).toEqual([encodeTenantId(ORG_ID)]);
    expect(session.participant.attendee).toEqual({
      AttendeeId: `fake-attendee-${PARTICIPANT_ID}`,
      ExternalUserId: PARTICIPANT_ID,
      JoinToken: `fake-token-${PARTICIPANT_ID}`,
      Capabilities: { Audio: 'SendReceive', Video: 'SendReceive', Content: 'SendReceive' },
    });
    expect(session.participant.providerAttendeeId).toBe(`fake-attendee-${PARTICIPANT_ID}`);
  });

  it('is deterministic: a fresh fake returns the same stub for the same input', async () => {
    const first = await fake.createSession(consultationInput);
    const second = await new FakeVideoProvider({ now: () => NOW }).createSession(consultationInput);
    expect(second).toEqual(first);
  });

  it('returns the existing meeting when the session is created twice', async () => {
    const first = await fake.createSession(consultationInput);
    const again = await fake.createSession(consultationInput);
    expect(again).toEqual(first);
  });

  it('describes what createSession created and forgets it after endSession', async () => {
    const session = await fake.createSession(consultationInput);

    await expect(fake.describeSession({ providerMeetingId: session.providerMeetingId })).resolves.toEqual({
      providerMeetingId: session.providerMeetingId,
      meeting: session.meeting,
      replicas: [],
    });

    await fake.endSession({ providerMeetingId: session.providerMeetingId });

    await expect(fake.describeSession({ providerMeetingId: session.providerMeetingId })).resolves.toBeNull();
    await expect(fake.endSession({ providerMeetingId: session.providerMeetingId })).resolves.toBeUndefined();
  });

  it('emits the Chime lifecycle events after each call returns', async () => {
    const session = await fake.createSession(consultationInput);
    expect(events).toHaveLength(0);
    await flushEvents();

    const second = await fake.createParticipant({
      providerMeetingId: session.providerMeetingId,
      participantId: SECOND_PARTICIPANT_ID,
      role: 'employee',
    });
    await fake.removeParticipant({
      providerMeetingId: session.providerMeetingId,
      providerAttendeeId: second.providerAttendeeId,
    });
    await fake.endSession({ providerMeetingId: session.providerMeetingId });
    await flushEvents();

    const meetingId = session.providerMeetingId;
    expect(events).toEqual([
      { eventType: 'MeetingStarted', providerMeetingId: meetingId, providerAttendeeId: null, externalMeetingId: SESSION_ID, externalUserId: null, occurredAt: NOW },
      { eventType: 'AttendeeJoined', providerMeetingId: meetingId, providerAttendeeId: `fake-attendee-${PARTICIPANT_ID}`, externalMeetingId: SESSION_ID, externalUserId: PARTICIPANT_ID, occurredAt: NOW },
      { eventType: 'AttendeeJoined', providerMeetingId: meetingId, providerAttendeeId: `fake-attendee-${SECOND_PARTICIPANT_ID}`, externalMeetingId: SESSION_ID, externalUserId: SECOND_PARTICIPANT_ID, occurredAt: NOW },
      { eventType: 'AttendeeLeft', providerMeetingId: meetingId, providerAttendeeId: `fake-attendee-${SECOND_PARTICIPANT_ID}`, externalMeetingId: SESSION_ID, externalUserId: SECOND_PARTICIPANT_ID, occurredAt: NOW },
      { eventType: 'AttendeeLeft', providerMeetingId: meetingId, providerAttendeeId: `fake-attendee-${PARTICIPANT_ID}`, externalMeetingId: SESSION_ID, externalUserId: PARTICIPANT_ID, occurredAt: NOW },
      { eventType: 'MeetingEnded', providerMeetingId: meetingId, providerAttendeeId: null, externalMeetingId: SESSION_ID, externalUserId: null, occurredAt: NOW },
    ]);
  });

  it('keeps working when a listener fails', async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    fake.onEvent(() => {
      throw new Error('handler down');
    });
    fake.onEvent(async () => {
      throw new Error('async handler down');
    });

    await fake.createSession(consultationInput);
    await flushEvents();
    await flushEvents();

    expect(events.map((event) => event.eventType)).toEqual(['MeetingStarted', 'AttendeeJoined']);
  });

  it('stops delivering to a listener after it unsubscribes', async () => {
    const received: VideoProviderEvent[] = [];
    const unsubscribe = fake.onEvent((event) => {
      received.push(event);
    });
    unsubscribe();

    await fake.createSession(consultationInput);
    await flushEvents();

    expect(received).toHaveLength(0);
    expect(events).toHaveLength(2);
  });

  it('maps a participant for an unknown meeting to appointment_not_joinable', async () => {
    await expectApiError(
      fake.createParticipant({ providerMeetingId: 'fake-meeting-unknown', participantId: PARTICIPANT_ID, role: 'employee' }),
      409,
      'appointment_not_joinable',
    );
  });

  it('applies the same attendee guard as the Chime adapter (CW-R-108)', async () => {
    const session = await fake.createSession(webinarInput);
    const attendeeParticipant = await fake.createParticipant({
      providerMeetingId: session.providerMeetingId,
      participantId: SECOND_PARTICIPANT_ID,
      role: 'attendee',
    });
    expect(attendeeParticipant.attendee.Capabilities).toEqual({ Audio: 'Receive', Video: 'Receive', Content: 'Receive' });

    await expect(
      fake.updateParticipantCapabilities({
        providerMeetingId: session.providerMeetingId,
        providerAttendeeId: attendeeParticipant.providerAttendeeId,
        role: 'attendee',
        capabilities: { Audio: 'SendReceive', Video: 'SendReceive', Content: 'Receive' },
      }),
    ).rejects.toThrow(VideoCapabilityError);

    await fake.updateParticipantCapabilities({
      providerMeetingId: session.providerMeetingId,
      providerAttendeeId: attendeeParticipant.providerAttendeeId,
      role: 'attendee',
      capabilities: capabilitiesForRole('attendee', { floor: true }),
    });
    const again = await fake.createParticipant({
      providerMeetingId: session.providerMeetingId,
      participantId: SECOND_PARTICIPANT_ID,
      role: 'attendee',
    });
    expect(again.attendee.Capabilities).toEqual({ Audio: 'SendReceive', Video: 'Receive', Content: 'Receive' });
  });

  it('applies the same capacity limit as the Chime adapter', async () => {
    await expectApiError(fake.createSession({ ...webinarInput, capacity: WEBINAR_REPLICATED_CAPACITY + 1 }), 400, 'capacity_above_limit');
    await expectApiError(fake.createSession({ ...workshopInput, capacity: WORKSHOP_CAPACITY + 1 }), 400, 'capacity_above_limit');
  });

  it('starts and stops a stub recording under the given prefix', async () => {
    const session = await fake.createSession(webinarInput);

    const recording = await fake.startRecording({
      sessionId: SESSION_ID,
      providerMeetingId: session.providerMeetingId,
      presenterAttendeeIds: [session.participant.providerAttendeeId],
      s3Prefix: `recordings/${WEBINAR_ID}/raw/`,
    });

    expect(recording).toEqual({
      pipelineId: `fake-pipeline-${SESSION_ID}`,
      pipelineArn: `arn:aws:chime:eu-central-1:000000000000:media-pipeline/fake-pipeline-${SESSION_ID}`,
      rawSegmentsPrefix: `recordings/${WEBINAR_ID}/raw/`,
    });
    expect(fake.isRecording(recording.pipelineId)).toBe(true);
    await expect(fake.stopRecording({ pipelineId: recording.pipelineId })).resolves.toBeUndefined();
    expect(fake.isRecording(recording.pipelineId)).toBe(false);
    await expect(fake.stopRecording({ pipelineId: recording.pipelineId })).resolves.toBeUndefined();
  });

  it('refuses a recording without a presenter or with a bad prefix, as the Chime adapter does', async () => {
    const session = await fake.createSession(webinarInput);
    const base = { sessionId: SESSION_ID, providerMeetingId: session.providerMeetingId };
    await expect(fake.startRecording({ ...base, presenterAttendeeIds: [], s3Prefix: 'recordings/w/raw/' })).rejects.toThrow(
      /presenter/,
    );
    await expect(fake.startRecording({ ...base, presenterAttendeeIds: ['a'], s3Prefix: 'raw' })).rejects.toThrow(/prefix/);
  });

  it('completes a stub concatenation at once, unless told to fail it', async () => {
    const finalPrefix = `recordings/${WEBINAR_ID}/final/`;
    const capturePipelineArn = 'arn:aws:chime:eu-central-1:000000000000:media-pipeline/fake-pipeline-x';
    const started = await fake.startConcatenation({ sessionId: SESSION_ID, capturePipelineArn, s3Prefix: finalPrefix, attempt: 1 });
    expect(started).toEqual({ pipelineId: `fake-concat-${SESSION_ID}-1` });
    expect(await fake.describeConcatenation({ pipelineId: started.pipelineId, s3Prefix: finalPrefix })).toEqual({
      status: 'completed',
      concatenatedKey: `${finalPrefix}composited-video/`,
      location: `s3://fake-recordings/${finalPrefix}composited-video/`,
    });

    fake.failNextConcatenation();
    const failing = await fake.startConcatenation({ sessionId: SESSION_ID, capturePipelineArn, s3Prefix: finalPrefix, attempt: 2 });
    expect(await fake.describeConcatenation({ pipelineId: failing.pipelineId, s3Prefix: finalPrefix })).toEqual({
      status: 'failed',
      concatenatedKey: null,
      location: null,
    });
    expect(await fake.describeConcatenation({ pipelineId: 'unknown', s3Prefix: finalPrefix })).toMatchObject({ status: 'failed' });
  });

  describe('media replication (T-CW-3.2)', () => {
    const replicatedInput: CreateSessionInput = { ...webinarInput, capacity: 500 };
    const primaryId = `fake-meeting-${SESSION_ID}`;
    const replicaIds = [`${primaryId}-r1`, `${primaryId}-r2`];

    it('stubs one primary and two replicas for capacity 500', async () => {
      const session = await fake.createSession(replicatedInput);
      await flushEvents();

      expect(session.providerMeetingId).toBe(primaryId);
      expect(session.participant.providerMeetingId).toBe(primaryId);
      expect(session.replicas.map(({ replicaIndex, providerMeetingId, capacity }) => ({ replicaIndex, providerMeetingId, capacity }))).toEqual([
        { replicaIndex: 1, providerMeetingId: replicaIds[0], capacity: 250 },
        { replicaIndex: 2, providerMeetingId: replicaIds[1], capacity: 250 },
      ]);
      expect(session.replicas.map((replica) => replica.meeting.ExternalMeetingId)).toEqual([
        `${SESSION_ID}-r1`,
        `${SESSION_ID}-r2`,
      ]);
      expect(session.replicas[0]?.meeting).not.toHaveProperty('PrimaryMeetingId');
      expect(events.filter((event) => event.eventType === 'MeetingStarted').map((event) => event.providerMeetingId)).toEqual([
        primaryId,
        ...replicaIds,
      ]);
    });

    it('creates no replica for capacity 250 and refuses 1,001', async () => {
      const single = await fake.createSession({ ...webinarInput, capacity: WEBINAR_SINGLE_MEETING_CAPACITY });
      expect(single.replicas).toEqual([]);
      fake.reset();
      await expectApiError(
        fake.createSession({ ...webinarInput, capacity: WEBINAR_REPLICATED_CAPACITY + 1 }),
        400,
        'capacity_above_limit',
      );
    });

    it('routes attendees by target and reports their events from the replica', async () => {
      await fake.createSession(replicatedInput);
      await flushEvents();
      events.length = 0;

      const participant = await fake.createParticipant({
        providerMeetingId: primaryId,
        replicaMeetingIds: replicaIds,
        target: { replicaIndex: 2 },
        participantId: SECOND_PARTICIPANT_ID,
        role: 'attendee',
      });
      await flushEvents();

      expect(participant.providerMeetingId).toBe(replicaIds[1]);
      expect(participant.attendee.Capabilities).toEqual({ Audio: 'Receive', Video: 'Receive', Content: 'Receive' });
      expect(events).toEqual([
        {
          eventType: 'AttendeeJoined',
          providerMeetingId: replicaIds[1],
          providerAttendeeId: participant.providerAttendeeId,
          externalMeetingId: `${SESSION_ID}-r2`,
          externalUserId: SECOND_PARTICIPANT_ID,
          occurredAt: NOW,
        },
      ]);
    });

    it('puts a first-arriving attendee into the first replica', async () => {
      const session = await fake.createSession({
        ...replicatedInput,
        participant: { participantId: SECOND_PARTICIPANT_ID, role: 'attendee' },
      });
      expect(session.participant.providerMeetingId).toBe(replicaIds[0]);
    });

    it('applies the host and D-CW-35 rules to replicas', async () => {
      await fake.createSession(replicatedInput);
      await expect(
        fake.createParticipant({
          providerMeetingId: primaryId,
          replicaMeetingIds: replicaIds,
          target: { replicaIndex: 1 },
          participantId: SECOND_PARTICIPANT_ID,
          role: 'moderator',
        }),
      ).rejects.toThrow(VideoRoutingError);
      await expect(
        fake.createParticipant({
          providerMeetingId: primaryId,
          replicaMeetingIds: replicaIds,
          target: { replicaIndex: 1 },
          participantId: SECOND_PARTICIPANT_ID,
          role: 'attendee',
          capabilities: { Audio: 'Receive', Video: 'SendReceive', Content: 'Receive' },
        }),
      ).rejects.toThrow(VideoCapabilityError);
    });

    it('ends the replicas first, then the primary, and forgets them all', async () => {
      await fake.createSession(replicatedInput);
      await flushEvents();
      events.length = 0;

      await fake.endSession({ providerMeetingId: primaryId });
      await flushEvents();

      expect(events.filter((event) => event.eventType === 'MeetingEnded').map((event) => event.providerMeetingId)).toEqual([
        ...replicaIds,
        primaryId,
      ]);
      await expect(fake.describeSession({ providerMeetingId: primaryId, replicaMeetingIds: replicaIds })).resolves.toBeNull();
      await expect(fake.describeSession({ providerMeetingId: replicaIds[0]! })).resolves.toBeNull();
    });

    it('describes the replicas it is asked about', async () => {
      const session = await fake.createSession(replicatedInput);

      const info = await fake.describeSession({ providerMeetingId: primaryId, replicaMeetingIds: replicaIds });

      expect(info?.replicas).toEqual(
        session.replicas.map(({ replicaIndex, providerMeetingId, meeting }) => ({ replicaIndex, providerMeetingId, meeting })),
      );
      expect((await fake.describeSession({ providerMeetingId: primaryId }))?.replicas).toEqual([]);
    });

    it('promotes a replica attendee onto the primary with audio only and demotes them again', async () => {
      await fake.createSession(replicatedInput);
      const inReplica = await fake.createParticipant({
        providerMeetingId: primaryId,
        replicaMeetingIds: replicaIds,
        target: { replicaIndex: 1 },
        participantId: SECOND_PARTICIPANT_ID,
        role: 'attendee',
      });
      await flushEvents();
      events.length = 0;

      const promoted = await fake.promoteToPrimary({
        sessionId: SESSION_ID,
        providerMeetingId: primaryId,
        participantId: SECOND_PARTICIPANT_ID,
      });
      expect(promoted.providerMeetingId).toBe(primaryId);
      expect(promoted.providerAttendeeId).not.toBe(inReplica.providerAttendeeId);
      expect(promoted.attendee.JoinToken).toBe(`fake-token-${SECOND_PARTICIPANT_ID}`);
      expect(promoted.attendee.Capabilities).toEqual({ Audio: 'SendReceive', Video: 'Receive', Content: 'Receive' });

      await fake.demoteFromPrimary({
        sessionId: SESSION_ID,
        providerMeetingId: primaryId,
        participantId: SECOND_PARTICIPANT_ID,
        providerAttendeeId: promoted.providerAttendeeId,
      });
      await flushEvents();

      expect(events.map((event) => [event.eventType, event.providerMeetingId, event.externalUserId])).toEqual([
        ['AttendeeJoined', primaryId, SECOND_PARTICIPANT_ID],
        ['AttendeeLeft', primaryId, SECOND_PARTICIPANT_ID],
      ]);
      // The replica seat stays: the client demotes back into it.
      const again = await fake.createParticipant({
        providerMeetingId: primaryId,
        replicaMeetingIds: replicaIds,
        target: { replicaIndex: 1 },
        participantId: SECOND_PARTICIPANT_ID,
        role: 'attendee',
      });
      expect(again).toEqual(inReplica);
    });

    it('refuses a promotion into a meeting it does not know', async () => {
      await expectApiError(
        fake.promoteToPrimary({ sessionId: SESSION_ID, providerMeetingId: 'fake-meeting-unknown', participantId: PARTICIPANT_ID }),
        409,
        'appointment_not_joinable',
      );
    });

    it('simulates events per meeting id, replicas included', async () => {
      await fake.createSession(replicatedInput);
      const participant = await fake.createParticipant({
        providerMeetingId: primaryId,
        replicaMeetingIds: replicaIds,
        target: { replicaIndex: 1 },
        participantId: SECOND_PARTICIPANT_ID,
        role: 'attendee',
      });
      await flushEvents();
      events.length = 0;

      fake.simulateEvent('AttendeeDropped', replicaIds[0]!, participant.providerAttendeeId);
      fake.simulateEvent('MeetingEnded', replicaIds[1]!);
      await flushEvents();

      expect(events.map((event) => [event.eventType, event.providerMeetingId, event.externalMeetingId])).toEqual([
        ['AttendeeDropped', replicaIds[0], `${SESSION_ID}-r1`],
        ['MeetingEnded', replicaIds[1], `${SESSION_ID}-r2`],
      ]);
      await expect(fake.describeSession({ providerMeetingId: replicaIds[1]! })).resolves.toBeNull();
      await expect(fake.describeSession({ providerMeetingId: primaryId })).resolves.not.toBeNull();
    });
  });

  describe('simulateEvent', () => {
    it('emits an attendee event the provider did not cause, leaving the attendee in place', async () => {
      const session = await fake.createSession(consultationInput);
      await flushEvents();
      events.length = 0;

      const event = fake.simulateEvent('AttendeeDropped', session.providerMeetingId, session.participant.providerAttendeeId);
      expect(events).toHaveLength(0);
      await flushEvents();

      const expected: VideoProviderEvent = {
        eventType: 'AttendeeDropped',
        providerMeetingId: session.providerMeetingId,
        providerAttendeeId: session.participant.providerAttendeeId,
        externalMeetingId: SESSION_ID,
        externalUserId: PARTICIPANT_ID,
        occurredAt: NOW,
      };
      expect(event).toEqual(expected);
      expect(events).toEqual([expected]);
      const again = await fake.createParticipant({
        providerMeetingId: session.providerMeetingId,
        participantId: PARTICIPANT_ID,
        role: 'expert',
      });
      expect(again).toEqual(session.participant);
    });

    it('drives AttendeeLeft without removing the attendee', async () => {
      const session = await fake.createSession(consultationInput);
      await flushEvents();
      events.length = 0;

      fake.simulateEvent('AttendeeLeft', session.providerMeetingId, session.participant.providerAttendeeId);
      await flushEvents();

      expect(events.map((event) => [event.eventType, event.externalUserId])).toEqual([['AttendeeLeft', PARTICIPANT_ID]]);
    });

    it('ends the meeting on MeetingEnded, as when Chime ends an empty meeting', async () => {
      const session = await fake.createSession(consultationInput);
      await flushEvents();
      events.length = 0;

      fake.simulateEvent('MeetingEnded', session.providerMeetingId);
      await flushEvents();

      expect(events).toEqual([
        {
          eventType: 'MeetingEnded',
          providerMeetingId: session.providerMeetingId,
          providerAttendeeId: null,
          externalMeetingId: SESSION_ID,
          externalUserId: null,
          occurredAt: NOW,
        },
      ]);
      await expect(fake.describeSession({ providerMeetingId: session.providerMeetingId })).resolves.toBeNull();
    });

    it('refuses an unknown meeting or attendee, and attendee events without an attendee', async () => {
      const session = await fake.createSession(consultationInput);

      expect(() => fake.simulateEvent('MeetingEnded', 'fake-meeting-unknown')).toThrow(/unknown meeting/);
      expect(() => fake.simulateEvent('AttendeeDropped', session.providerMeetingId, 'fake-attendee-unknown')).toThrow(
        /unknown attendee/,
      );
      expect(() => fake.simulateEvent('AttendeeLeft', session.providerMeetingId)).toThrow(/needs an attendee/);
      expect(() =>
        fake.simulateEvent('MeetingEnded', session.providerMeetingId, session.participant.providerAttendeeId),
      ).toThrow(/meeting event/);
    });
  });

  it('forgets every session on reset()', async () => {
    const session = await fake.createSession(consultationInput);
    fake.reset();
    await expect(fake.describeSession({ providerMeetingId: session.providerMeetingId })).resolves.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// VideoModule provider selection (D-CW-05)
// ---------------------------------------------------------------------------

describe('createVideoProvider', () => {
  it('selects the fake when VIDEO_PROVIDER is absent', () => {
    expect(createVideoProvider(config({}))).toBeInstanceOf(FakeVideoProvider);
  });

  it('selects the fake for VIDEO_PROVIDER=none', () => {
    expect(createVideoProvider(config({ VIDEO_PROVIDER: 'none' }))).toBeInstanceOf(FakeVideoProvider);
  });

  it('selects the Chime adapter for VIDEO_PROVIDER=chime', () => {
    expect(createVideoProvider(config(CHIME_CONFIG))).toBeInstanceOf(ChimeVideoProvider);
  });

  it.each(['CHIME_EVENTS_QUEUE_ARN', 'RECORDINGS_BUCKET', 'STAGE'] as const)(
    'refuses to start the Chime adapter without %s',
    (key) => {
      expect(() => createVideoProvider(config({ ...CHIME_CONFIG, [key]: undefined }))).toThrow(
        `${key} is required when VIDEO_PROVIDER=chime`,
      );
    },
  );
});
