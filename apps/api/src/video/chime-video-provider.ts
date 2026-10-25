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
  CreateMeetingCommand,
  CreateMeetingWithAttendeesCommand,
  DeleteAttendeeCommand,
  DeleteMeetingCommand,
  GetMeetingCommand,
  UpdateAttendeeCapabilitiesCommand,
  type Attendee,
  type CreateMeetingRequest,
  type Meeting,
  type Tag,
} from '@aws-sdk/client-chime-sdk-meetings';
import {
  ChimeSDKMediaPipelinesClient,
  CreateMediaCapturePipelineCommand,
  CreateMediaConcatenationPipelineCommand,
  DeleteMediaCapturePipelineCommand,
  GetMediaPipelineCommand,
  type ArtifactsConcatenationConfiguration,
} from '@aws-sdk/client-chime-sdk-media-pipelines';
import {
  CONCATENATED_VIDEO_FOLDER,
  HOST_ROLES,
  MEETING_FEATURES,
  VIDEO_MEDIA_REGION,
  VideoProvider,
  assertCapabilitiesAllowed,
  assertCapacityWithinLimit,
  assertPresenterStreams,
  assertRecordingPrefix,
  floorCapabilities,
  pickReplica,
  replicaCapacities,
  replicaExternalMeetingId,
  resolveCapabilities,
  resolveTargetMeeting,
  sessionNotJoinable,
  tenantIdsFor,
  videoProviderUnavailable,
  type CreateParticipantInput,
  type CreateSessionInput,
  type DemoteFromPrimaryInput,
  type DescribeConcatenationInput,
  type DescribeSessionInput,
  type EndSessionInput,
  type ParticipantCapabilities,
  type ProviderMeeting,
  type ProviderConcatenation,
  type ProviderConcatenationState,
  type ProviderParticipant,
  type ProviderRecording,
  type ProviderReplica,
  type ProviderReplicaInfo,
  type ProviderSession,
  type ProviderSessionInfo,
  type PromoteToPrimaryInput,
  type RemoveParticipantInput,
  type StartConcatenationInput,
  type StartRecordingInput,
  type StopRecordingInput,
  type UpdateCapabilitiesInput,
} from './video-provider.js';

export interface ChimeVideoProviderOptions {
  /** `CHIME_EVENTS_QUEUE_ARN`: every meeting notifies this queue (D-CW-12). */
  eventsQueueArn: string;
  /**
   * `RECORDINGS_BUCKET`: webinar captures land under the caller's prefix,
   * `recordings/{webinarId}/raw/`, and the concatenated MP4 under
   * `recordings/{webinarId}/final/` (D-CW-18, T-CW-2.5).
   */
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

/**
 * What a webinar concatenation keeps: the composited video with the audio
 * muxed in (`AudioWithCompositedVideo` at capture); nothing per attendee, no
 * content, data channel, transcript or event artifacts (D-CW-18, WEB-29).
 */
const CONCATENATION_ARTIFACTS: ArtifactsConcatenationConfiguration = {
  Audio: { State: 'Enabled' },
  Video: { State: 'Disabled' },
  Content: { State: 'Disabled' },
  DataChannel: { State: 'Disabled' },
  TranscriptionMessages: { State: 'Disabled' },
  MeetingEvents: { State: 'Disabled' },
  CompositedVideo: { State: 'Enabled' },
};

/** `ClientRequestToken`: 2 to 64 characters of `[-_a-zA-Z0-9]`. */
const CLIENT_REQUEST_TOKEN_PATTERN = /^[-_a-zA-Z0-9]{2,64}$/;

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

/**
 * Copies the fields a client needs. `PrimaryMeetingId` is left out on purpose:
 * replica attendees never learn the primary's id (D-CW-15, WEB-07).
 */
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
  providerMeetingId: string,
  attendee: Attendee | undefined,
  requested: ParticipantCapabilities,
): ProviderParticipant | null {
  if (!attendee?.AttendeeId || !attendee.ExternalUserId || !attendee.JoinToken) return null;
  const capabilities = attendee.Capabilities;
  return {
    providerMeetingId,
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

  /**
   * A webinar above one meeting (D-CW-14): the primary first, then its
   * replicas with `PrimaryMeetingId`. Hosts and every single-meeting first
   * joiner are created with the primary; a first-arriving attendee of a
   * replicated webinar joins replica 1 instead. If a replica fails, the primary
   * is deleted, which deletes the replicas already created.
   */
  async createSession(input: CreateSessionInput): Promise<ProviderSession> {
    assertCapacityWithinLimit(input.format, input.capacity);
    const capabilities = resolveCapabilities(input.participant);
    const tenantIds = tenantIdsFor(input);
    const plan = replicaCapacities(input.format, input.capacity);
    const context = { sessionId: input.sessionId, participantId: input.participant.participantId };

    if (plan.length === 0 || HOST_ROLES.has(input.participant.role)) {
      const primary = await this.createPrimaryWithAttendee(input, tenantIds, capabilities, context);
      if (plan.length === 0) return { ...primary, replicas: [] };
      const replicas = await this.createReplicasOrDiscard(input, tenantIds, primary.providerMeetingId, plan, context);
      return { ...primary, replicas };
    }

    const meeting = await this.createMeeting(
      this.meetingRequest(input, tenantIds, input.sessionId),
      'CreateMeeting',
      context,
    );
    try {
      const replicas = await this.createReplicas(input, tenantIds, meeting.MeetingId, plan, context);
      const first = pickReplica(replicas, {});
      if (!first) throw this.incomplete('CreateMeeting', context, 'no replica');
      const participant = await this.addAttendee(first.providerMeetingId, input.participant, capabilities);
      return { providerMeetingId: meeting.MeetingId, meeting, participant, replicas };
    } catch (error) {
      await this.discardMeeting(meeting.MeetingId, context);
      throw error;
    }
  }

  async createParticipant(input: CreateParticipantInput): Promise<ProviderParticipant> {
    const capabilities = resolveCapabilities(input);
    return this.addAttendee(resolveTargetMeeting(input), input, capabilities);
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

  async promoteToPrimary(input: PromoteToPrimaryInput): Promise<ProviderParticipant> {
    const capabilities = floorCapabilities();
    const promoted = await this.addAttendee(input.providerMeetingId, input, capabilities);
    // Whatever Chime echoes back, the client is told audio only (D-CW-35).
    return { ...promoted, attendee: { ...promoted.attendee, Capabilities: capabilities } };
  }

  async demoteFromPrimary(input: DemoteFromPrimaryInput): Promise<void> {
    await this.send('DeleteAttendee', { sessionId: input.sessionId, participantId: input.participantId, providerMeetingId: input.providerMeetingId }, () =>
      this.meetingsClient.send(
        new DeleteAttendeeCommand({ MeetingId: input.providerMeetingId, AttendeeId: input.providerAttendeeId }),
      ),
    );
  }

  /**
   * Replicas first, then the primary. A replica that cannot be deleted is
   * left to the primary's `DeleteMeeting`, which deletes every attached
   * replica; only the primary's failure reaches the caller.
   */
  async endSession(input: EndSessionInput): Promise<void> {
    for (const replicaMeetingId of input.replicaMeetingIds ?? []) {
      try {
        await this.deleteMeeting(replicaMeetingId);
      } catch {
        // Logged by send(); the primary's delete below takes the replica along.
      }
    }
    await this.deleteMeeting(input.providerMeetingId);
  }

  async describeSession(input: DescribeSessionInput): Promise<ProviderSessionInfo | null> {
    const meeting = await this.getMeeting(input.providerMeetingId, {});
    if (!meeting) return null;
    const replicas = await Promise.all(
      (input.replicaMeetingIds ?? []).map(async (replicaMeetingId, i): Promise<ProviderReplicaInfo | null> => {
        const replica = await this.getMeeting(replicaMeetingId, {});
        return replica ? { replicaIndex: i + 1, providerMeetingId: replica.MeetingId, meeting: replica } : null;
      }),
    );
    return {
      providerMeetingId: meeting.MeetingId,
      meeting,
      replicas: replicas.filter((replica): replica is ProviderReplicaInfo => replica !== null),
    };
  }

  async startRecording(input: StartRecordingInput): Promise<ProviderRecording> {
    assertRecordingPrefix(input.s3Prefix);
    assertPresenterStreams(input.presenterAttendeeIds);
    const context = { sessionId: input.sessionId, providerMeetingId: input.providerMeetingId };
    const meeting = await this.getMeeting(input.providerMeetingId, context);
    if (!meeting) throw sessionNotJoinable();

    // The sink names the folder without its trailing slash; the pipeline adds `audio/`, `composited-video/` and so on.
    const arns = captureArns(meeting, this.options.recordingsBucket, input.s3Prefix.slice(0, -1));
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
    const pipelineArn = response.MediaCapturePipeline?.MediaPipelineArn;
    if (!pipelineId || !pipelineArn) throw this.incomplete('CreateMediaCapturePipeline', context);
    return { pipelineId, pipelineArn, rawSegmentsPrefix: input.s3Prefix };
  }

  async stopRecording(input: StopRecordingInput): Promise<void> {
    await this.send('DeleteMediaCapturePipeline', { pipelineId: input.pipelineId }, () =>
      this.pipelinesClient.send(new DeleteMediaCapturePipelineCommand({ MediaPipelineId: input.pipelineId })),
    );
  }

  async startConcatenation(input: StartConcatenationInput): Promise<ProviderConcatenation> {
    assertRecordingPrefix(input.s3Prefix);
    const context = { sessionId: input.sessionId };
    const token = `${input.sessionId}-c${input.attempt}`;
    const response = await this.send('CreateMediaConcatenationPipeline', context, () =>
      this.pipelinesClient.send(
        new CreateMediaConcatenationPipelineCommand({
          ...(CLIENT_REQUEST_TOKEN_PATTERN.test(token) ? { ClientRequestToken: token } : {}),
          Sources: [
            {
              Type: 'MediaCapturePipeline',
              MediaCapturePipelineSourceConfiguration: {
                MediaPipelineArn: input.capturePipelineArn,
                ChimeSdkMeetingConfiguration: { ArtifactsConfiguration: CONCATENATION_ARTIFACTS },
              },
            },
          ],
          Sinks: [
            {
              Type: 'S3Bucket',
              S3BucketSinkConfiguration: {
                Destination: `arn:aws:s3:::${this.options.recordingsBucket}/${input.s3Prefix.slice(0, -1)}`,
              },
            },
          ],
        }),
      ),
    );
    // The capture pipeline is gone (older than 30 days, WEB-29): nothing left to concatenate.
    if (response === NOT_FOUND) throw this.incomplete('CreateMediaConcatenationPipeline', context, 'source not found');
    const pipelineId = response.MediaConcatenationPipeline?.MediaPipelineId;
    if (!pipelineId) throw this.incomplete('CreateMediaConcatenationPipeline', context);
    return { pipelineId };
  }

  /**
   * `GetMediaPipeline`: `Stopped` is a finished concatenation, `Failed` a
   * failed one, anything else still running. Chime names the MP4 itself, so
   * the key is the `composited-video/` folder under the destination, which
   * holds that one object (SPIKE-CW-04 records the object name).
   */
  async describeConcatenation(input: DescribeConcatenationInput): Promise<ProviderConcatenationState> {
    const response = await this.send('GetMediaPipeline', { pipelineId: input.pipelineId }, () =>
      this.pipelinesClient.send(new GetMediaPipelineCommand({ MediaPipelineId: input.pipelineId })),
    );
    const status = response === NOT_FOUND ? 'Failed' : response.MediaPipeline?.MediaConcatenationPipeline?.Status;
    if (status === 'Failed') return { status: 'failed', concatenatedKey: null, location: null };
    if (status !== 'Stopped') return { status: 'in_progress', concatenatedKey: null, location: null };
    const concatenatedKey = `${input.s3Prefix}${CONCATENATED_VIDEO_FOLDER}`;
    return { status: 'completed', concatenatedKey, location: `s3://${this.options.recordingsBucket}/${concatenatedKey}` };
  }

  // -- Helpers --------------------------------------------------------------

  /** What every meeting of a session shares; replicas differ only in id and `PrimaryMeetingId`. */
  private meetingRequest(
    input: CreateSessionInput,
    tenantIds: string[],
    externalMeetingId: string,
  ): CreateMeetingRequest {
    return {
      ClientRequestToken: externalMeetingId,
      ExternalMeetingId: externalMeetingId,
      MediaRegion: VIDEO_MEDIA_REGION,
      MeetingFeatures: MEETING_FEATURES[input.format],
      NotificationsConfiguration: { SqsQueueArn: this.options.eventsQueueArn },
      TenantIds: tenantIds,
      Tags: this.tags(input),
    };
  }

  /** The primary with its first attendee in one call (D-CW-07). */
  private async createPrimaryWithAttendee(
    input: CreateSessionInput,
    tenantIds: string[],
    capabilities: ParticipantCapabilities,
    context: CallContext,
  ): Promise<Omit<ProviderSession, 'replicas'>> {
    const response = await this.send('CreateMeetingWithAttendees', context, () =>
      this.meetingsClient.send(
        new CreateMeetingWithAttendeesCommand({
          ...this.meetingRequest(input, tenantIds, input.sessionId),
          Attendees: [{ ExternalUserId: input.participant.participantId, Capabilities: capabilities }],
        }),
      ),
    );
    if (response === NOT_FOUND) throw sessionNotJoinable();

    const meeting = toProviderMeeting(response.Meeting);
    const participant =
      meeting &&
      toProviderParticipant(
        meeting.MeetingId,
        response.Attendees?.find((a) => a.ExternalUserId === input.participant.participantId),
        capabilities,
      );
    if (!meeting || !participant) {
      const codes = (response.Errors ?? []).map((e) => e.ErrorCode ?? 'unknown').join(', ');
      const error = this.incomplete('CreateMeetingWithAttendees', context, codes);
      await this.discardMeeting(response.Meeting?.MeetingId, context);
      throw error;
    }
    return { providerMeetingId: meeting.MeetingId, meeting, participant };
  }

  /** A meeting without attendees: the primary of a replicated webinar, or one replica. */
  private async createMeeting(
    request: CreateMeetingRequest,
    operation: string,
    context: CallContext,
  ): Promise<ProviderMeeting> {
    const response = await this.send(operation, context, () =>
      this.meetingsClient.send(new CreateMeetingCommand(request)),
    );
    if (response === NOT_FOUND) throw sessionNotJoinable();
    const meeting = toProviderMeeting(response.Meeting);
    if (!meeting) {
      const error = this.incomplete(operation, context);
      await this.discardMeeting(response.Meeting?.MeetingId, context);
      throw error;
    }
    return meeting;
  }

  /** Replicas in index order, created together; the first failure is rethrown once all settle. */
  private async createReplicas(
    input: CreateSessionInput,
    tenantIds: string[],
    primaryMeetingId: string,
    plan: number[],
    context: CallContext,
  ): Promise<ProviderReplica[]> {
    const settled = await Promise.allSettled(
      plan.map(async (capacity, i): Promise<ProviderReplica> => {
        const replicaIndex = i + 1;
        const meeting = await this.createMeeting(
          {
            ...this.meetingRequest(input, tenantIds, replicaExternalMeetingId(input.sessionId, replicaIndex)),
            PrimaryMeetingId: primaryMeetingId,
          },
          'CreateMeeting (replica)',
          context,
        );
        return { replicaIndex, providerMeetingId: meeting.MeetingId, meeting, capacity };
      }),
    );
    const failed = settled.find((result) => result.status === 'rejected');
    if (failed) throw failed.reason;
    return settled.map((result) => (result as PromiseFulfilledResult<ProviderReplica>).value);
  }

  private async createReplicasOrDiscard(
    input: CreateSessionInput,
    tenantIds: string[],
    primaryMeetingId: string,
    plan: number[],
    context: CallContext,
  ): Promise<ProviderReplica[]> {
    try {
      return await this.createReplicas(input, tenantIds, primaryMeetingId, plan, context);
    } catch (error) {
      await this.discardMeeting(primaryMeetingId, context);
      throw error;
    }
  }

  /** `CreateAttendee` in one meeting, primary or replica. */
  private async addAttendee(
    providerMeetingId: string,
    participant: { participantId: string },
    capabilities: ParticipantCapabilities,
  ): Promise<ProviderParticipant> {
    const context = { participantId: participant.participantId, providerMeetingId };
    const response = await this.send('CreateAttendee', context, () =>
      this.meetingsClient.send(
        new CreateAttendeeCommand({
          MeetingId: providerMeetingId,
          ExternalUserId: participant.participantId,
          Capabilities: capabilities,
        }),
      ),
    );
    if (response === NOT_FOUND) throw sessionNotJoinable();

    const created = toProviderParticipant(providerMeetingId, response.Attendee, capabilities);
    if (!created) throw this.incomplete('CreateAttendee', context);
    return created;
  }

  /** `DeleteMeeting`; a meeting that is already gone counts as deleted (CW-R-16). */
  private async deleteMeeting(providerMeetingId: string): Promise<void> {
    await this.send('DeleteMeeting', { providerMeetingId }, () =>
      this.meetingsClient.send(new DeleteMeetingCommand({ MeetingId: providerMeetingId })),
    );
  }

  /** Tags: `stage`, `format` and `orgId` only, never personal data (CW-R-04). */
  private tags(input: CreateSessionInput): Tag[] {
    const tags: Tag[] = [
      { Key: 'stage', Value: this.options.stage },
      { Key: 'format', Value: input.format },
    ];
    if (input.orgId) tags.push({ Key: 'orgId', Value: input.orgId });
    return tags;
  }

  /**
   * Deletes a meeting created without a usable attendee, so it does not sit
   * idle until Chime ends it. Best effort: `send` already logs a failure, and
   * the caller's 502 must not be replaced by the cleanup's error.
   */
  private async discardMeeting(meetingId: string | undefined, context: CallContext): Promise<void> {
    if (!meetingId) return;
    try {
      await this.send('DeleteMeeting', { ...context, providerMeetingId: meetingId }, () =>
        this.meetingsClient.send(new DeleteMeetingCommand({ MeetingId: meetingId })),
      );
    } catch {
      // Logged by send(); the meeting still auto-ends after 5 empty minutes (CORE-16).
    }
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
