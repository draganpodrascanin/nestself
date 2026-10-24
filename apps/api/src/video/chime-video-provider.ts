/**
 * Amazon Chime SDK adapter (guidelines section 3).
 *
 * Only the `chime-sdk-meetings` and `chime-sdk-media-pipelines` namespaces are
 * used, never the legacy `@aws-sdk/client-chime` (CW-R-07). Both clients and
 * the media region are pinned to eu-central-1 (D-CW-06, CW-R-06).
 *
 * Error mapping (CW-R-09): `ServiceUnavailableException` becomes 503
 * `video_provider_unavailable`; `ThrottlingException` and
 * `LimitExceededException` become 429 `video_provider_unavailable`;
 * `NotFoundException` becomes 409 `appointment_not_joinable`, except where the
 * method is idempotent (remove, end, stop) or reports absence (describe); any
 * other SDK error becomes 502 `video_provider_unavailable`. The provider's
 * message never reaches the client or the log; only the exception name does.
 *
 * Logging (guidelines 16.1): one line per SDK call with the operation, the
 * session, participant or meeting id and the latency. Responses are never
 * logged: they carry join tokens (CW-R-69).
 */
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { performance } from 'node:perf_hooks';
import {
  ChimeSDKMeetingsClient,
  CreateAttendeeCommand,
  CreateMeetingWithAttendeesCommand,
  DeleteAttendeeCommand,
  DeleteMeetingCommand,
  GetMeetingCommand,
  UpdateAttendeeCapabilitiesCommand,
  type Attendee,
  type Meeting,
  type Tag,
} from '@aws-sdk/client-chime-sdk-meetings';
import {
  ChimeSDKMediaPipelinesClient,
  CreateMediaCapturePipelineCommand,
  DeleteMediaCapturePipelineCommand,
} from '@aws-sdk/client-chime-sdk-media-pipelines';
import {
  MEETING_FEATURES,
  VIDEO_MEDIA_REGION,
  VideoProvider,
  assertCapabilitiesAllowed,
  assertCapacityWithinLimit,
  resolveCapabilities,
  sessionNotJoinable,
  tenantIdsFor,
  videoProviderUnavailable,
  type CreateParticipantInput,
  type CreateSessionInput,
  type DescribeSessionInput,
  type EndSessionInput,
  type ParticipantCapabilities,
  type ProviderMeeting,
  type ProviderParticipant,
  type ProviderRecording,
  type ProviderSession,
  type ProviderSessionInfo,
  type RemoveParticipantInput,
  type StartRecordingInput,
  type StopRecordingInput,
  type UpdateCapabilitiesInput,
} from './video-provider.js';

export interface ChimeVideoProviderOptions {
  /** `CHIME_EVENTS_QUEUE_ARN`: every meeting notifies this queue (D-CW-12). */
  eventsQueueArn: string;
  /** `RECORDINGS_BUCKET`: webinar captures land under `raw/{sessionId}/` (D-CW-18). */
  recordingsBucket: string;
  /** Deployment stage for the `stage` tag (D-CW-11). */
  stage: string;
}

interface CallContext {
  sessionId?: string;
  participantId?: string;
  providerMeetingId?: string;
  pipelineId?: string;
}

/** Returned by {@link ChimeVideoProvider.send} when the SDK reports `NotFoundException`. */
const NOT_FOUND = Symbol('NOT_FOUND');

/** Prefix the recordings bucket expires after 30 days (infra video stack, D-CW-18). */
const RAW_SEGMENTS_PREFIX = 'raw';

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}

function describeContext(context: CallContext): string {
  const parts = [
    context.sessionId && `session ${context.sessionId}`,
    context.participantId && `participant ${context.participantId}`,
    context.providerMeetingId && `meeting ${context.providerMeetingId}`,
    context.pipelineId && `pipeline ${context.pipelineId}`,
  ].filter(Boolean);
  return parts.length > 0 ? ` (${parts.join(', ')})` : '';
}

function toProviderMeeting(meeting: Meeting | undefined): ProviderMeeting | null {
  const placement = meeting?.MediaPlacement;
  if (
    !meeting?.MeetingId ||
    !meeting.MediaRegion ||
    !placement?.AudioHostUrl ||
    !placement.AudioFallbackUrl ||
    !placement.SignalingUrl
  ) {
    return null;
  }
  return {
    MeetingId: meeting.MeetingId,
    MeetingArn: meeting.MeetingArn,
    ExternalMeetingId: meeting.ExternalMeetingId,
    MediaRegion: meeting.MediaRegion,
    MediaPlacement: {
      ...placement,
      AudioHostUrl: placement.AudioHostUrl,
      AudioFallbackUrl: placement.AudioFallbackUrl,
      SignalingUrl: placement.SignalingUrl,
    },
    MeetingFeatures: meeting.MeetingFeatures,
    TenantIds: meeting.TenantIds,
  };
}

function toProviderParticipant(
  attendee: Attendee | undefined,
  requested: ParticipantCapabilities,
): ProviderParticipant | null {
  if (!attendee?.AttendeeId || !attendee.ExternalUserId || !attendee.JoinToken) return null;
  const capabilities = attendee.Capabilities;
  return {
    providerAttendeeId: attendee.AttendeeId,
    attendee: {
      AttendeeId: attendee.AttendeeId,
      ExternalUserId: attendee.ExternalUserId,
      JoinToken: attendee.JoinToken,
      Capabilities:
        capabilities?.Audio && capabilities.Video && capabilities.Content
          ? { Audio: capabilities.Audio, Video: capabilities.Video, Content: capabilities.Content }
          : requested,
    },
  };
}

/**
 * The media capture source ARN is `arn:<partition>:chime::<account>:meeting:<id>`,
 * which differs from the `MeetingArn` Chime returns; partition and account
 * come from the latter.
 */
function captureArns(
  meeting: ProviderMeeting,
  bucket: string,
  prefix: string,
): { sourceArn: string; sinkArn: string } | null {
  const [arn, partition, service, , account] = meeting.MeetingArn?.split(':') ?? [];
  if (arn !== 'arn' || !partition || service !== 'chime' || !account) return null;
  return {
    sourceArn: `arn:${partition}:chime::${account}:meeting:${meeting.MeetingId}`,
    sinkArn: `arn:${partition}:s3:::${bucket}/${prefix}`,
  };
}

@Injectable()
export class ChimeVideoProvider extends VideoProvider {
  readonly meetingsClient: ChimeSDKMeetingsClient;
  readonly pipelinesClient: ChimeSDKMediaPipelinesClient;
  private readonly logger = new Logger(ChimeVideoProvider.name);

  constructor(private readonly options: ChimeVideoProviderOptions) {
    super();
    this.meetingsClient = new ChimeSDKMeetingsClient({ region: VIDEO_MEDIA_REGION });
    this.pipelinesClient = new ChimeSDKMediaPipelinesClient({ region: VIDEO_MEDIA_REGION });
  }

  async createSession(input: CreateSessionInput): Promise<ProviderSession> {
    assertCapacityWithinLimit(input.format, input.capacity);
    const capabilities = resolveCapabilities(input.participant);
    const tenantIds = tenantIdsFor(input);
    const context = { sessionId: input.sessionId, participantId: input.participant.participantId };

    const response = await this.send('CreateMeetingWithAttendees', context, () =>
      this.meetingsClient.send(
        new CreateMeetingWithAttendeesCommand({
          ClientRequestToken: input.sessionId,
          ExternalMeetingId: input.sessionId,
          MediaRegion: VIDEO_MEDIA_REGION,
          MeetingFeatures: MEETING_FEATURES[input.format],
          NotificationsConfiguration: { SqsQueueArn: this.options.eventsQueueArn },
          TenantIds: tenantIds,
          Tags: this.tags(input),
          Attendees: [{ ExternalUserId: input.participant.participantId, Capabilities: capabilities }],
        }),
      ),
    );
    if (response === NOT_FOUND) throw sessionNotJoinable();

    const meeting = toProviderMeeting(response.Meeting);
    const participant = toProviderParticipant(
      response.Attendees?.find((a) => a.ExternalUserId === input.participant.participantId),
      capabilities,
    );
    if (!meeting || !participant) {
      const codes = (response.Errors ?? []).map((e) => e.ErrorCode ?? 'unknown').join(', ');
      throw this.incomplete('CreateMeetingWithAttendees', context, codes);
    }
    return { providerMeetingId: meeting.MeetingId, meeting, participant };
  }

  async createParticipant(input: CreateParticipantInput): Promise<ProviderParticipant> {
    const capabilities = resolveCapabilities(input);
    const context = { participantId: input.participantId, providerMeetingId: input.providerMeetingId };

    const response = await this.send('CreateAttendee', context, () =>
      this.meetingsClient.send(
        new CreateAttendeeCommand({
          MeetingId: input.providerMeetingId,
          ExternalUserId: input.participantId,
          Capabilities: capabilities,
        }),
      ),
    );
    if (response === NOT_FOUND) throw sessionNotJoinable();

    const participant = toProviderParticipant(response.Attendee, capabilities);
    if (!participant) throw this.incomplete('CreateAttendee', context);
    return participant;
  }

  async updateParticipantCapabilities(input: UpdateCapabilitiesInput): Promise<void> {
    assertCapabilitiesAllowed(input.role, input.capabilities);
    const response = await this.send(
      'UpdateAttendeeCapabilities',
      { providerMeetingId: input.providerMeetingId },
      () =>
        this.meetingsClient.send(
          new UpdateAttendeeCapabilitiesCommand({
            MeetingId: input.providerMeetingId,
            AttendeeId: input.providerAttendeeId,
            Capabilities: input.capabilities,
          }),
        ),
    );
    if (response === NOT_FOUND) throw sessionNotJoinable();
  }

  async removeParticipant(input: RemoveParticipantInput): Promise<void> {
    await this.send('DeleteAttendee', { providerMeetingId: input.providerMeetingId }, () =>
      this.meetingsClient.send(
        new DeleteAttendeeCommand({ MeetingId: input.providerMeetingId, AttendeeId: input.providerAttendeeId }),
      ),
    );
  }

  async endSession(input: EndSessionInput): Promise<void> {
    await this.send('DeleteMeeting', { providerMeetingId: input.providerMeetingId }, () =>
      this.meetingsClient.send(new DeleteMeetingCommand({ MeetingId: input.providerMeetingId })),
    );
  }

  async describeSession(input: DescribeSessionInput): Promise<ProviderSessionInfo | null> {
    const meeting = await this.getMeeting(input.providerMeetingId, {});
    return meeting ? { providerMeetingId: meeting.MeetingId, meeting } : null;
  }

  async startRecording(input: StartRecordingInput): Promise<ProviderRecording> {
    const context = { sessionId: input.sessionId, providerMeetingId: input.providerMeetingId };
    const meeting = await this.getMeeting(input.providerMeetingId, context);
    if (!meeting) throw sessionNotJoinable();

    const prefix = `${RAW_SEGMENTS_PREFIX}/${input.sessionId}`;
    const arns = captureArns(meeting, this.options.recordingsBucket, prefix);
    if (!arns) throw this.incomplete('GetMeeting', context, 'MeetingArn');

    const response = await this.send('CreateMediaCapturePipeline', context, () =>
      this.pipelinesClient.send(
        new CreateMediaCapturePipelineCommand({
          SourceType: 'ChimeSdkMeeting',
          SourceArn: arns.sourceArn,
          SinkType: 'S3Bucket',
          SinkArn: arns.sinkArn,
          ChimeSdkMeetingConfiguration: {
            // Presenters only, composited, audio muxed in; no per-attendee or
            // content artifacts (D-CW-18, WEB-23 to WEB-26).
            SourceConfiguration: { SelectedVideoStreams: { AttendeeIds: input.presenterAttendeeIds } },
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
        }),
      ),
    );
    if (response === NOT_FOUND) throw sessionNotJoinable();

    const pipelineId = response.MediaCapturePipeline?.MediaPipelineId;
    if (!pipelineId) throw this.incomplete('CreateMediaCapturePipeline', context);
    return { pipelineId, rawSegmentsPrefix: `${prefix}/` };
  }

  async stopRecording(input: StopRecordingInput): Promise<void> {
    await this.send('DeleteMediaCapturePipeline', { pipelineId: input.pipelineId }, () =>
      this.pipelinesClient.send(new DeleteMediaCapturePipelineCommand({ MediaPipelineId: input.pipelineId })),
    );
  }

  // -- Helpers --------------------------------------------------------------

  /** Tags: `stage`, `format` and `orgId` only, never personal data (CW-R-04). */
  private tags(input: CreateSessionInput): Tag[] {
    const tags: Tag[] = [
      { Key: 'stage', Value: this.options.stage },
      { Key: 'format', Value: input.format },
    ];
    if (input.orgId) tags.push({ Key: 'orgId', Value: input.orgId });
    return tags;
  }

  private async getMeeting(providerMeetingId: string, context: CallContext): Promise<ProviderMeeting | null> {
    const response = await this.send('GetMeeting', { ...context, providerMeetingId }, () =>
      this.meetingsClient.send(new GetMeetingCommand({ MeetingId: providerMeetingId })),
    );
    if (response === NOT_FOUND) return null;
    const meeting = toProviderMeeting(response.Meeting);
    if (!meeting) throw this.incomplete('GetMeeting', { ...context, providerMeetingId });
    return meeting;
  }

  /**
   * Sends one SDK request, logs it and maps its failure. `NotFoundException`
   * is returned as {@link NOT_FOUND} so each method decides what absence means.
   */
  private async send<T>(
    operation: string,
    context: CallContext,
    request: () => Promise<T>,
  ): Promise<T | typeof NOT_FOUND> {
    const startedAt = performance.now();
    const elapsed = () => Math.round(performance.now() - startedAt);
    try {
      const response = await request();
      this.logger.log(`Chime ${operation} succeeded in ${elapsed()} ms${describeContext(context)}`);
      return response;
    } catch (error) {
      const name = errorName(error);
      if (name === 'NotFoundException') {
        this.logger.log(`Chime ${operation} found nothing in ${elapsed()} ms${describeContext(context)}`);
        return NOT_FOUND;
      }
      this.logger.error(`Chime ${operation} failed with ${name} after ${elapsed()} ms${describeContext(context)}`);
      switch (name) {
        case 'ServiceUnavailableException':
          throw videoProviderUnavailable(HttpStatus.SERVICE_UNAVAILABLE);
        case 'ThrottlingException':
        case 'LimitExceededException':
          throw videoProviderUnavailable(HttpStatus.TOO_MANY_REQUESTS);
        default:
          throw videoProviderUnavailable(HttpStatus.BAD_GATEWAY);
      }
    }
  }

  private incomplete(operation: string, context: CallContext, detail?: string) {
    this.logger.error(
      `Chime ${operation} returned an incomplete response${detail ? ` (${detail})` : ''}${describeContext(context)}`,
    );
    return videoProviderUnavailable(HttpStatus.BAD_GATEWAY);
  }
}
