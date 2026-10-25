/**
 * In-process video provider for local development and every test that is not
 * the nightly real-provider smoke test (`VIDEO_PROVIDER=none`, D-CW-05).
 *
 * Deterministic stubs: the meeting id is `fake-meeting-{sessionId}`, the
 * attendee id `fake-attendee-{participantId}` and the join token
 * `fake-token-{participantId}`, with `-r{n}` appended in replica `n`.
 * Meetings live in memory, so `describeSession` returns what `createSession`
 * created until `endSession` removes it.
 *
 * Lifecycle events go out through an in-process `EventEmitter` with the same
 * names and fields the Chime SQS consumer hands to the event handler
 * (D-CW-12, guidelines 9.1, CW-R-41). Delivery is deferred to the next turn of
 * the event loop, so a call returns before any listener runs, as with a queue.
 *
 * No method touches the network (CW-R-05). The same capability, capacity and
 * not-found rules as `ChimeVideoProvider` apply, so a test against the fake
 * sees the errors the real adapter raises.
 *
 * Media replication (D-CW-14) is mirrored too: a webinar above one meeting
 * gets replicas `fake-meeting-{sessionId}-r{n}` with `ExternalMeetingId`
 * `{sessionId}-r{n}`, attendees are routed by `target`, and ending the
 * primary ends its replicas first, as Chime's `DeleteMeeting` does.
 */
import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter } from 'node:events';
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
  type CreateParticipantInput,
  type CreateSessionInput,
  type DemoteFromPrimaryInput,
  type DescribeConcatenationInput,
  type DescribeSessionInput,
  type EndSessionInput,
  type ParticipantCapabilities,
  type ProviderAttendee,
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
  type SessionParticipantInput,
  type RemoveParticipantInput,
  type StartConcatenationInput,
  type StartRecordingInput,
  type StopRecordingInput,
  type UpdateCapabilitiesInput,
  type VideoProviderEvent,
  type VideoProviderEventListener,
  type VideoProviderEventType,
} from './video-provider.js';

export interface FakeVideoProviderOptions {
  /** Clock for event timestamps; injected by tests. */
  now?: () => Date;
}

interface FakeMeeting {
  /** The `call_sessions.id`, shared by the primary and its replicas. */
  sessionId: string;
  meeting: ProviderMeeting;
  /** Keyed by participant id (the `ExternalUserId`). */
  attendees: Map<string, ProviderAttendee>;
  /** Set on a replica: the primary it replicates. */
  primaryMeetingId: string | null;
  /** On a primary: its replicas in index order. */
  replicas: Array<{ replicaIndex: number; providerMeetingId: string; capacity: number }>;
}

const EVENT = 'video-provider-event';
const FAKE_HOST = 'fake-chime.invalid';
/** The bucket name in the fake's `s3://` locations. */
const FAKE_BUCKET = 'fake-recordings';

function toParticipant(state: FakeMeeting, attendee: ProviderAttendee): ProviderParticipant {
  return {
    providerMeetingId: state.meeting.MeetingId,
    providerAttendeeId: attendee.AttendeeId,
    attendee: structuredClone(attendee),
  };
}

@Injectable()
export class FakeVideoProvider extends VideoProvider {
  private readonly logger = new Logger(FakeVideoProvider.name);
  private readonly emitter = new EventEmitter();
  private readonly meetings = new Map<string, FakeMeeting>();
  private readonly pipelines = new Set<string>();
  /** Concatenation pipelines and whether each failed. */
  private readonly concatenations = new Map<string, boolean>();
  private failNext = false;
  private readonly now: () => Date;

  constructor(options: FakeVideoProviderOptions = {}) {
    super();
    this.now = options.now ?? (() => new Date());
  }

  /**
   * Subscribes to provider events. A failing listener is logged and never
   * breaks the provider or the other listeners. Returns the unsubscribe call.
   */
  onEvent(listener: VideoProviderEventListener): () => void {
    const deliver = (event: VideoProviderEvent): void => {
      try {
        void Promise.resolve(listener(event)).catch((error: unknown) => this.listenerFailed(event, error));
      } catch (error) {
        this.listenerFailed(event, error);
      }
    };
    this.emitter.on(EVENT, deliver);
    return () => {
      this.emitter.off(EVENT, deliver);
    };
  }

  /**
   * Emits an event no provider call caused, so handler tests can drive
   * `AttendeeDropped`, `AttendeeLeft` or `MeetingEnded` (for example Chime's
   * own end of an empty meeting, CORE-16). Attendee events leave the attendee
   * in the meeting, as Chime does until `DeleteAttendee`; `MeetingEnded`
   * forgets the meeting (a primary takes its replicas along, silently), so
   * `describeSession` then returns null. Works for any meeting id, replicas
   * included. Delivery is deferred like every other event. Returns the event.
   */
  simulateEvent(
    eventType: VideoProviderEventType,
    providerMeetingId: string,
    providerAttendeeId?: string,
  ): VideoProviderEvent {
    const state = this.meetings.get(providerMeetingId);
    if (!state) throw new Error(`simulateEvent: unknown meeting ${providerMeetingId}`);

    if (!eventType.startsWith('Attendee')) {
      if (providerAttendeeId) {
        throw new Error(`simulateEvent: ${eventType} is a meeting event and takes no attendee`);
      }
      if (eventType === 'MeetingEnded') {
        for (const replica of state.replicas) this.meetings.delete(replica.providerMeetingId);
        this.meetings.delete(providerMeetingId);
        if (!state.primaryMeetingId) this.pipelines.delete(this.pipelineId(state.sessionId));
      }
      return this.emit(eventType, state, null);
    }

    if (!providerAttendeeId) throw new Error(`simulateEvent: ${eventType} needs an attendee id`);
    const attendee = this.findAttendee(providerMeetingId, providerAttendeeId);
    if (!attendee) throw new Error(`simulateEvent: unknown attendee ${providerAttendeeId}`);
    return this.emit(eventType, state, attendee);
  }

  /** Forgets every meeting and recording; listeners stay subscribed. */
  reset(): void {
    this.meetings.clear();
    this.pipelines.clear();
    this.concatenations.clear();
    this.failNext = false;
  }

  /** Whether a capture pipeline is running (tests). */
  isRecording(pipelineId: string): boolean {
    return this.pipelines.has(pipelineId);
  }

  /** The next concatenation started reports `failed` (tests of the finalize retry). */
  failNextConcatenation(): void {
    this.failNext = true;
  }

  async createSession(input: CreateSessionInput): Promise<ProviderSession> {
    assertCapacityWithinLimit(input.format, input.capacity);
    const capabilities = resolveCapabilities(input.participant);
    const tenantIds = tenantIdsFor(input);
    const primaryId = `fake-meeting-${input.sessionId}`;

    // A repeated ClientRequestToken returns the existing meetings (D-CW-07).
    let primary = this.meetings.get(primaryId);
    if (!primary) {
      primary = this.startMeeting(input, primaryId, input.sessionId, tenantIds, null);
      for (const [i, capacity] of replicaCapacities(input.format, input.capacity).entries()) {
        const replicaIndex = i + 1;
        const replicaId = `${primaryId}-r${replicaIndex}`;
        this.startMeeting(input, replicaId, replicaExternalMeetingId(input.sessionId, replicaIndex), tenantIds, primaryId);
        primary.replicas.push({ replicaIndex, providerMeetingId: replicaId, capacity });
      }
    }

    const home = this.homeFor(primary, input.participant);
    const participant = this.addAttendee(home, input.participant.participantId, capabilities);
    return {
      providerMeetingId: primaryId,
      meeting: structuredClone(primary.meeting),
      participant,
      replicas: this.replicasOf(primary),
    };
  }

  async createParticipant(input: CreateParticipantInput): Promise<ProviderParticipant> {
    const capabilities = resolveCapabilities(input);
    const state = this.meetings.get(resolveTargetMeeting(input));
    if (!state) throw sessionNotJoinable();
    return this.addAttendee(state, input.participantId, capabilities);
  }

  async updateParticipantCapabilities(input: UpdateCapabilitiesInput): Promise<void> {
    assertCapabilitiesAllowed(input.role, input.capabilities);
    const attendee = this.findAttendee(input.providerMeetingId, input.providerAttendeeId);
    if (!attendee) throw sessionNotJoinable();
    attendee.Capabilities = { ...input.capabilities };
  }

  async removeParticipant(input: RemoveParticipantInput): Promise<void> {
    const state = this.meetings.get(input.providerMeetingId);
    const attendee = this.findAttendee(input.providerMeetingId, input.providerAttendeeId);
    if (!state || !attendee) return;
    state.attendees.delete(attendee.ExternalUserId);
    this.emit('AttendeeLeft', state, attendee);
  }

  async promoteToPrimary(input: PromoteToPrimaryInput): Promise<ProviderParticipant> {
    const primary = this.meetings.get(input.providerMeetingId);
    if (!primary) throw sessionNotJoinable();
    return this.addAttendee(primary, input.participantId, floorCapabilities());
  }

  async demoteFromPrimary(input: DemoteFromPrimaryInput): Promise<void> {
    await this.removeParticipant({
      providerMeetingId: input.providerMeetingId,
      providerAttendeeId: input.providerAttendeeId,
    });
  }

  /** Replicas first (those named and those the primary has), then the primary. */
  async endSession(input: EndSessionInput): Promise<void> {
    const known = this.meetings.get(input.providerMeetingId)?.replicas.map((r) => r.providerMeetingId) ?? [];
    for (const replicaId of new Set([...(input.replicaMeetingIds ?? []), ...known])) {
      this.endMeeting(replicaId);
    }
    this.endMeeting(input.providerMeetingId);
  }

  async describeSession(input: DescribeSessionInput): Promise<ProviderSessionInfo | null> {
    const state = this.meetings.get(input.providerMeetingId);
    if (!state) return null;
    const replicas = (input.replicaMeetingIds ?? []).flatMap((replicaId, i): ProviderReplicaInfo[] => {
      const replica = this.meetings.get(replicaId);
      return replica
        ? [{ replicaIndex: i + 1, providerMeetingId: replicaId, meeting: structuredClone(replica.meeting) }]
        : [];
    });
    return { providerMeetingId: input.providerMeetingId, meeting: structuredClone(state.meeting), replicas };
  }

  async startRecording(input: StartRecordingInput): Promise<ProviderRecording> {
    assertRecordingPrefix(input.s3Prefix);
    assertPresenterStreams(input.presenterAttendeeIds);
    if (!this.meetings.has(input.providerMeetingId)) throw sessionNotJoinable();
    const pipelineId = this.pipelineId(input.sessionId);
    this.pipelines.add(pipelineId);
    return {
      pipelineId,
      pipelineArn: `arn:aws:chime:${VIDEO_MEDIA_REGION}:000000000000:media-pipeline/${pipelineId}`,
      rawSegmentsPrefix: input.s3Prefix,
    };
  }

  async stopRecording(input: StopRecordingInput): Promise<void> {
    this.pipelines.delete(input.pipelineId);
  }

  /** Completes at once (or fails, after {@link failNextConcatenation}); one pipeline per session and attempt. */
  async startConcatenation(input: StartConcatenationInput): Promise<ProviderConcatenation> {
    assertRecordingPrefix(input.s3Prefix);
    const pipelineId = `fake-concat-${input.sessionId}-${input.attempt}`;
    if (!this.concatenations.has(pipelineId)) {
      this.concatenations.set(pipelineId, this.failNext);
      this.failNext = false;
    }
    return { pipelineId };
  }

  async describeConcatenation(input: DescribeConcatenationInput): Promise<ProviderConcatenationState> {
    const failed = this.concatenations.get(input.pipelineId);
    if (failed === undefined || failed) return { status: 'failed', concatenatedKey: null, location: null };
    const concatenatedKey = `${input.s3Prefix}${CONCATENATED_VIDEO_FOLDER}`;
    return { status: 'completed', concatenatedKey, location: `s3://${FAKE_BUCKET}/${concatenatedKey}` };
  }

  // -- Helpers --------------------------------------------------------------

  private pipelineId(sessionId: string): string {
    return `fake-pipeline-${sessionId}`;
  }

  private startMeeting(
    input: CreateSessionInput,
    meetingId: string,
    externalMeetingId: string,
    tenantIds: string[],
    primaryMeetingId: string | null,
  ): FakeMeeting {
    const state: FakeMeeting = {
      sessionId: input.sessionId,
      meeting: {
        MeetingId: meetingId,
        MeetingArn: `arn:aws:chime:${VIDEO_MEDIA_REGION}:000000000000:meeting/${meetingId}`,
        ExternalMeetingId: externalMeetingId,
        MediaRegion: VIDEO_MEDIA_REGION,
        MediaPlacement: {
          AudioHostUrl: `audio.${FAKE_HOST}:3478`,
          AudioFallbackUrl: `wss://audio.${FAKE_HOST}:443/calls/${meetingId}`,
          SignalingUrl: `wss://signal.${FAKE_HOST}/control/${meetingId}`,
          TurnControlUrl: `https://turn.${FAKE_HOST}/v2/turn_sessions`,
          EventIngestionUrl: `https://data.${FAKE_HOST}/v1/client-events`,
        },
        MeetingFeatures: structuredClone(MEETING_FEATURES[input.format]),
        TenantIds: tenantIds,
      },
      attendees: new Map(),
      primaryMeetingId,
      replicas: [],
    };
    this.meetings.set(meetingId, state);
    this.emit('MeetingStarted', state, null);
    return state;
  }

  private replicasOf(primary: FakeMeeting): ProviderReplica[] {
    return primary.replicas.flatMap(({ replicaIndex, providerMeetingId, capacity }) => {
      const replica = this.meetings.get(providerMeetingId);
      return replica ? [{ replicaIndex, providerMeetingId, meeting: structuredClone(replica.meeting), capacity }] : [];
    });
  }

  /**
   * The meeting a first joiner lands in: where the participant already is, the
   * primary for hosts and single meetings, otherwise the least-loaded replica.
   */
  private homeFor(primary: FakeMeeting, participant: SessionParticipantInput): FakeMeeting {
    const meetings = [primary, ...primary.replicas.map((r) => this.meetings.get(r.providerMeetingId))];
    const existing = meetings.find((state) => state?.attendees.has(participant.participantId));
    if (existing) return existing;
    if (primary.replicas.length === 0 || HOST_ROLES.has(participant.role)) return primary;

    const counts = Object.fromEntries(
      primary.replicas.map((r) => [r.replicaIndex, this.meetings.get(r.providerMeetingId)?.attendees.size ?? 0]),
    );
    const picked = pickReplica(primary.replicas, counts);
    const replica = picked && this.meetings.get(picked.providerMeetingId);
    if (!replica) throw sessionNotJoinable();
    return replica;
  }

  private endMeeting(providerMeetingId: string): void {
    const state = this.meetings.get(providerMeetingId);
    if (!state) return;
    this.meetings.delete(providerMeetingId);
    if (!state.primaryMeetingId) this.pipelines.delete(this.pipelineId(state.sessionId));
    for (const attendee of state.attendees.values()) {
      this.emit('AttendeeLeft', state, attendee);
    }
    this.emit('MeetingEnded', state, null);
  }

  private addAttendee(
    state: FakeMeeting,
    participantId: string,
    capabilities: ParticipantCapabilities,
  ): ProviderParticipant {
    const existing = state.attendees.get(participantId);
    if (existing) return toParticipant(state, existing);

    // A replica seat carries the replica's `-r{n}`, so it never shares an id
    // with the same participant's promotion on the primary.
    const suffix = state.primaryMeetingId ? state.meeting.MeetingId.slice(state.primaryMeetingId.length) : '';
    const attendee: ProviderAttendee = {
      AttendeeId: `fake-attendee-${participantId}${suffix}`,
      ExternalUserId: participantId,
      JoinToken: `fake-token-${participantId}${suffix}`,
      Capabilities: { ...capabilities },
    };
    state.attendees.set(participantId, attendee);
    this.emit('AttendeeJoined', state, attendee);
    return toParticipant(state, attendee);
  }

  private findAttendee(providerMeetingId: string, providerAttendeeId: string): ProviderAttendee | undefined {
    const state = this.meetings.get(providerMeetingId);
    if (!state) return undefined;
    for (const attendee of state.attendees.values()) {
      if (attendee.AttendeeId === providerAttendeeId) return attendee;
    }
    return undefined;
  }

  private emit(
    eventType: VideoProviderEventType,
    state: FakeMeeting,
    attendee: ProviderAttendee | null,
  ): VideoProviderEvent {
    const event: VideoProviderEvent = {
      eventType,
      providerMeetingId: state.meeting.MeetingId,
      providerAttendeeId: attendee?.AttendeeId ?? null,
      occurredAt: this.now(),
      // A replica reports its own `{sessionId}-r{n}`, as Chime does.
      externalMeetingId: state.meeting.ExternalMeetingId ?? state.sessionId,
      externalUserId: attendee?.ExternalUserId ?? null,
    };
    setImmediate(() => this.emitter.emit(EVENT, event));
    return event;
  }

  private listenerFailed(event: VideoProviderEvent, error: unknown): void {
    const name = error instanceof Error ? error.name : 'UnknownError';
    this.logger.error(`Video event listener failed on ${event.eventType} with ${name}`);
  }
}
