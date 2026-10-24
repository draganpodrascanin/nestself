/**
 * In-process video provider for local development and every test that is not
 * the nightly real-provider smoke test (`VIDEO_PROVIDER=none`, D-CW-05).
 *
 * Deterministic stubs: the meeting id is `fake-meeting-{sessionId}`, the
 * attendee id `fake-attendee-{participantId}` and the join token
 * `fake-token-{participantId}`. Meetings live in memory, so `describeSession`
 * returns what `createSession` created until `endSession` removes it.
 *
 * Lifecycle events go out through an in-process `EventEmitter` with the same
 * names and fields the Chime SQS consumer hands to the event handler
 * (D-CW-12, guidelines 9.1, CW-R-41). Delivery is deferred to the next turn of
 * the event loop, so a call returns before any listener runs, as with a queue.
 *
 * No method touches the network (CW-R-05). The same capability, capacity and
 * not-found rules as `ChimeVideoProvider` apply, so a test against the fake
 * sees the errors the real adapter raises.
 */
import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import {
  MEETING_FEATURES,
  VIDEO_MEDIA_REGION,
  VideoProvider,
  assertCapabilitiesAllowed,
  assertCapacityWithinLimit,
  resolveCapabilities,
  sessionNotJoinable,
  tenantIdsFor,
  type CreateParticipantInput,
  type CreateSessionInput,
  type DescribeSessionInput,
  type EndSessionInput,
  type ParticipantCapabilities,
  type ProviderAttendee,
  type ProviderMeeting,
  type ProviderParticipant,
  type ProviderRecording,
  type ProviderSession,
  type ProviderSessionInfo,
  type RemoveParticipantInput,
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
  sessionId: string;
  meeting: ProviderMeeting;
  /** Keyed by participant id (the `ExternalUserId`). */
  attendees: Map<string, ProviderAttendee>;
}

const EVENT = 'video-provider-event';
const FAKE_HOST = 'fake-chime.invalid';

function toParticipant(attendee: ProviderAttendee): ProviderParticipant {
  return { providerAttendeeId: attendee.AttendeeId, attendee: structuredClone(attendee) };
}

@Injectable()
export class FakeVideoProvider extends VideoProvider {
  private readonly logger = new Logger(FakeVideoProvider.name);
  private readonly emitter = new EventEmitter();
  private readonly meetings = new Map<string, FakeMeeting>();
  private readonly pipelines = new Set<string>();
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

  /** Forgets every meeting and recording; listeners stay subscribed. */
  reset(): void {
    this.meetings.clear();
    this.pipelines.clear();
  }

  async createSession(input: CreateSessionInput): Promise<ProviderSession> {
    assertCapacityWithinLimit(input.format, input.capacity);
    const capabilities = resolveCapabilities(input.participant);
    const tenantIds = tenantIdsFor(input);
    const meetingId = `fake-meeting-${input.sessionId}`;

    // A repeated ClientRequestToken returns the existing meeting (D-CW-07).
    let state = this.meetings.get(meetingId);
    if (!state) {
      state = {
        sessionId: input.sessionId,
        meeting: {
          MeetingId: meetingId,
          MeetingArn: `arn:aws:chime:${VIDEO_MEDIA_REGION}:000000000000:meeting/${meetingId}`,
          ExternalMeetingId: input.sessionId,
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
      };
      this.meetings.set(meetingId, state);
      this.emit('MeetingStarted', state, null);
    }

    const participant = this.addAttendee(state, input.participant.participantId, capabilities);
    return { providerMeetingId: meetingId, meeting: structuredClone(state.meeting), participant };
  }

  async createParticipant(input: CreateParticipantInput): Promise<ProviderParticipant> {
    const capabilities = resolveCapabilities(input);
    const state = this.meetings.get(input.providerMeetingId);
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

  async endSession(input: EndSessionInput): Promise<void> {
    const state = this.meetings.get(input.providerMeetingId);
    if (!state) return;
    this.meetings.delete(input.providerMeetingId);
    this.pipelines.delete(this.pipelineId(state.sessionId));
    for (const attendee of state.attendees.values()) {
      this.emit('AttendeeLeft', state, attendee);
    }
    this.emit('MeetingEnded', state, null);
  }

  async describeSession(input: DescribeSessionInput): Promise<ProviderSessionInfo | null> {
    const state = this.meetings.get(input.providerMeetingId);
    return state ? { providerMeetingId: input.providerMeetingId, meeting: structuredClone(state.meeting) } : null;
  }

  async startRecording(input: StartRecordingInput): Promise<ProviderRecording> {
    if (!this.meetings.has(input.providerMeetingId)) throw sessionNotJoinable();
    const pipelineId = this.pipelineId(input.sessionId);
    this.pipelines.add(pipelineId);
    return { pipelineId, rawSegmentsPrefix: `raw/${input.sessionId}/` };
  }

  async stopRecording(input: StopRecordingInput): Promise<void> {
    this.pipelines.delete(input.pipelineId);
  }

  // -- Helpers --------------------------------------------------------------

  private pipelineId(sessionId: string): string {
    return `fake-pipeline-${sessionId}`;
  }

  private addAttendee(
    state: FakeMeeting,
    participantId: string,
    capabilities: ParticipantCapabilities,
  ): ProviderParticipant {
    const existing = state.attendees.get(participantId);
    if (existing) return toParticipant(existing);

    const attendee: ProviderAttendee = {
      AttendeeId: `fake-attendee-${participantId}`,
      ExternalUserId: participantId,
      JoinToken: `fake-token-${participantId}`,
      Capabilities: { ...capabilities },
    };
    state.attendees.set(participantId, attendee);
    this.emit('AttendeeJoined', state, attendee);
    return toParticipant(attendee);
  }

  private findAttendee(providerMeetingId: string, providerAttendeeId: string): ProviderAttendee | undefined {
    const state = this.meetings.get(providerMeetingId);
    if (!state) return undefined;
    for (const attendee of state.attendees.values()) {
      if (attendee.AttendeeId === providerAttendeeId) return attendee;
    }
    return undefined;
  }

  private emit(eventType: VideoProviderEventType, state: FakeMeeting, attendee: ProviderAttendee | null): void {
    const event: VideoProviderEvent = {
      eventType,
      providerMeetingId: state.meeting.MeetingId,
      providerAttendeeId: attendee?.AttendeeId ?? null,
      occurredAt: this.now(),
      externalMeetingId: state.sessionId,
      externalUserId: attendee?.ExternalUserId ?? null,
    };
    setImmediate(() => this.emitter.emit(EVENT, event));
  }

  private listenerFailed(event: VideoProviderEvent, error: unknown): void {
    const name = error instanceof Error ? error.name : 'UnknownError';
    this.logger.error(`Video event listener failed on ${event.eventType} with ${name}`);
  }
}
