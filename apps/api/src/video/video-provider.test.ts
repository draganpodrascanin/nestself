/**
 * Video provider adapter tests (T-CW-0.2): the role-to-capability mapping,
 * the Chime adapter's request shapes and error mapping (aws-sdk-client-mock,
 * OPS-31, CW-R-81), the fake provider's stubs and events, and the module's
 * provider selection.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { mockClient } from 'aws-sdk-client-mock';
import {
  BadRequestException,
  ChimeSDKMeetingsClient,
  CreateAttendeeCommand,
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
  DeleteMediaCapturePipelineCommand,
  NotFoundException as PipelineNotFoundException,
  ServiceUnavailableException as PipelineServiceUnavailableException,
} from '@aws-sdk/client-chime-sdk-media-pipelines';
import { CALL_FORMATS, CALL_PARTICIPANT_ROLES } from '@nestself/contracts';
import { ApiHttpException } from '../common/api-error.js';
import {
  MEETING_FEATURES,
  VIDEO_MEDIA_REGION,
  VideoCapabilityError,
  assertCapabilitiesAllowed,
  capabilitiesForRole,
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
  capacity: 250,
  orgId: null,
  webinarId: WEBINAR_ID,
  participant: { participantId: PARTICIPANT_ID, role: 'presenter' },
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
    expect(MEETING_FEATURES.webinar.Attendee.MaxCount).toBe(250);
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
      expect(request.TenantIds).toEqual([ORG_ID]);
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

    it('uses the webinar id as tenant id for webinars and omits the orgId tag when there is none', async () => {
      meetings.on(CreateMeetingWithAttendeesCommand).resolves({
        Meeting: { ...MEETING, TenantIds: [WEBINAR_ID] },
        Attendees: [attendee(PARTICIPANT_ID)],
      });

      await provider.createSession(webinarInput);

      const request = meetings.commandCalls(CreateMeetingWithAttendeesCommand)[0]!.args[0].input;
      expect(request.TenantIds).toEqual([WEBINAR_ID]);
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

    it('rejects a capacity above the single-meeting limit with capacity_above_limit', async () => {
      await expectApiError(
        provider.createSession({ ...webinarInput, capacity: 251 }),
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

    it('fails with 502 when Chime reports an error for the attendee', async () => {
      meetings.on(CreateMeetingWithAttendeesCommand).resolves({
        Meeting: MEETING,
        Attendees: [],
        Errors: [{ ExternalUserId: PARTICIPANT_ID, ErrorCode: 'BadRequest', ErrorMessage: 'nope' }],
      });

      await expectApiError(provider.createSession(consultationInput), 502, 'video_provider_unavailable');
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
    it('captures presenter-only composited HD video into the raw prefix (D-CW-18)', async () => {
      meetings.on(GetMeetingCommand).resolves({ Meeting: MEETING });
      pipelines.on(CreateMediaCapturePipelineCommand).resolves({
        MediaCapturePipeline: { MediaPipelineId: 'pipeline-1' },
      });

      const recording = await provider.startRecording({
        sessionId: SESSION_ID,
        providerMeetingId: 'meeting-1',
        presenterAttendeeIds: ['attendee-1', 'attendee-3'],
      });

      const request = pipelines.commandCalls(CreateMediaCapturePipelineCommand)[0]!.args[0].input;
      expect(request).toEqual({
        SourceType: 'ChimeSdkMeeting',
        SourceArn: 'arn:aws:chime::111122223333:meeting:meeting-1',
        SinkType: 'S3Bucket',
        SinkArn: `arn:aws:s3:::${BUCKET}/raw/${SESSION_ID}`,
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
      expect(recording).toEqual({ pipelineId: 'pipeline-1', rawSegmentsPrefix: `raw/${SESSION_ID}/` });
    });

    it('maps NotFoundException on the meeting to appointment_not_joinable', async () => {
      meetings.on(GetMeetingCommand).rejects(new NotFoundException({ message: 'gone', $metadata: {} }));

      await expectApiError(
        provider.startRecording({ sessionId: SESSION_ID, providerMeetingId: 'meeting-1', presenterAttendeeIds: ['attendee-1'] }),
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
        provider.startRecording({ sessionId: SESSION_ID, providerMeetingId: 'meeting-1', presenterAttendeeIds: ['attendee-1'] }),
        503,
        'video_provider_unavailable',
      );
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
    expect(session.meeting.TenantIds).toEqual([ORG_ID]);
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
    await expectApiError(fake.createSession({ ...webinarInput, capacity: 251 }), 400, 'capacity_above_limit');
  });

  it('starts and stops a stub recording', async () => {
    const session = await fake.createSession(webinarInput);

    const recording = await fake.startRecording({
      sessionId: SESSION_ID,
      providerMeetingId: session.providerMeetingId,
      presenterAttendeeIds: [session.participant.providerAttendeeId],
    });

    expect(recording).toEqual({ pipelineId: `fake-pipeline-${SESSION_ID}`, rawSegmentsPrefix: `raw/${SESSION_ID}/` });
    await expect(fake.stopRecording({ pipelineId: recording.pipelineId })).resolves.toBeUndefined();
    await expect(fake.stopRecording({ pipelineId: recording.pipelineId })).resolves.toBeUndefined();
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
  function config(values: Record<string, string | undefined>) {
    return { get: <T = string>(key: string): T | undefined => values[key] as T | undefined };
  }

  it('selects the fake when VIDEO_PROVIDER is absent', () => {
    expect(createVideoProvider(config({}))).toBeInstanceOf(FakeVideoProvider);
  });

  it('selects the fake for VIDEO_PROVIDER=none', () => {
    expect(createVideoProvider(config({ VIDEO_PROVIDER: 'none' }))).toBeInstanceOf(FakeVideoProvider);
  });

  it('selects the Chime adapter for VIDEO_PROVIDER=chime', () => {
    const provider = createVideoProvider(
      config({
        VIDEO_PROVIDER: 'chime',
        CHIME_REGION: 'eu-central-1',
        CHIME_EVENTS_QUEUE_ARN: QUEUE_ARN,
        RECORDINGS_BUCKET: BUCKET,
      }),
    );
    expect(provider).toBeInstanceOf(ChimeVideoProvider);
  });
});
