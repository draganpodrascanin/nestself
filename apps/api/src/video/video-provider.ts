/**
 * Video provider contract (NS-CALLS-01): the abstract `VideoProvider`, its
 * input and output shapes, the in-process event shape, and the pure rules both
 * adapters share (capabilities per role, meeting features per format, the
 * capacity limit and the error envelopes).
 *
 * `ChimeVideoProvider` is selected by `VIDEO_PROVIDER=chime`; the default
 * `none` selects `FakeVideoProvider` (D-CW-05).
 *
 * @see docs/tasks/calls-webinars/06-implementation-guidelines.md sections 2 and 3
 * @see D-CW-05, D-CW-06, D-CW-10, D-CW-11, D-CW-12, D-CW-35
 */
import { HttpStatus } from '@nestjs/common';
import type {
  AttendeeCapabilities,
  MediaCapabilities,
  MeetingFeaturesConfiguration,
} from '@aws-sdk/client-chime-sdk-meetings';
import {
  WEBINAR_SINGLE_MEETING_CAPACITY,
  WORKSHOP_CAPACITY,
  type CallErrorCode,
  type CallFormat,
  type CallParticipantRole,
} from '@nestself/contracts';
import { ApiHttpException } from '../common/api-error.js';

/** Injection token of the selected {@link VideoProvider}. */
export const VIDEO_PROVIDER = Symbol('VIDEO_PROVIDER');

/**
 * Control, media and media-pipeline region. Hard-coded: the adapter never uses
 * nearest-region selection, and the env schema refuses any other `CHIME_REGION`
 * (D-CW-06, CW-R-06).
 */
export const VIDEO_MEDIA_REGION = 'eu-central-1';
export type VideoMediaRegion = typeof VIDEO_MEDIA_REGION;

// ---------------------------------------------------------------------------
// Capabilities (D-CW-10, D-CW-15, D-CW-35)
// ---------------------------------------------------------------------------

/**
 * Chime `AttendeeCapabilities` with every channel set: the SDK type allows
 * `undefined` per channel, which a request built here never sends.
 */
export type ParticipantCapabilities = {
  [Channel in keyof AttendeeCapabilities]-?: NonNullable<AttendeeCapabilities[Channel]>;
};

/**
 * Capabilities for a participant role, per the D-CW-10 table. A webinar
 * attendee is receive-only; an attendee given the floor sends audio only and
 * its video and content stay `Receive` (D-CW-35). `floor` has no effect on the
 * other roles, which already send audio.
 */
export function capabilitiesForRole(
  role: CallParticipantRole,
  options: { floor?: boolean } = {},
): ParticipantCapabilities {
  switch (role) {
    case 'expert':
    case 'presenter':
    case 'moderator':
    case 'facilitator':
      return { Audio: 'SendReceive', Video: 'SendReceive', Content: 'SendReceive' };
    case 'employee':
    case 'participant':
      return { Audio: 'SendReceive', Video: 'SendReceive', Content: 'Receive' };
    case 'attendee':
      return {
        Audio: options.floor ? 'SendReceive' : 'Receive',
        Video: 'Receive',
        Content: 'Receive',
      };
  }
}

/** Thrown when code asks the provider for capabilities a role may never have. */
export class VideoCapabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VideoCapabilityError';
  }
}

function sends(capability: MediaCapabilities): boolean {
  return capability === 'SendReceive' || capability === 'Send';
}

/**
 * Attendees never send video or content, in any milestone (D-CW-35, CW-R-108,
 * global constraint 14). Both adapters call this before any provider request.
 */
export function assertCapabilitiesAllowed(
  role: CallParticipantRole,
  capabilities: ParticipantCapabilities,
): void {
  if (role !== 'attendee') return;
  if (sends(capabilities.Video)) {
    throw new VideoCapabilityError('A webinar attendee can never send video (D-CW-35)');
  }
  if (sends(capabilities.Content)) {
    throw new VideoCapabilityError('A webinar attendee can never send content (D-CW-35)');
  }
}

// ---------------------------------------------------------------------------
// Meeting features (D-CW-10)
// ---------------------------------------------------------------------------

/**
 * Chime `MeetingFeaturesConfiguration` as this epic uses it. Video is typed as
 * `HD` only: `FHD` would cap the meeting at 25 attendees (CW-R-08, CORE-06).
 */
export interface MeetingFeatures {
  readonly Audio: { readonly EchoReduction: 'AVAILABLE' };
  readonly Video: { readonly MaxResolution: 'HD' };
  readonly Content: { readonly MaxResolution: 'FHD' };
  readonly Attendee: { readonly MaxCount: number };
}

/** Meeting features per format (D-CW-10, guidelines section 3). */
export const MEETING_FEATURES: Readonly<Record<CallFormat, MeetingFeatures>> = {
  consultation: {
    Audio: { EchoReduction: 'AVAILABLE' },
    Video: { MaxResolution: 'HD' },
    Content: { MaxResolution: 'FHD' },
    Attendee: { MaxCount: 4 },
  },
  webinar: {
    Audio: { EchoReduction: 'AVAILABLE' },
    Video: { MaxResolution: 'HD' },
    Content: { MaxResolution: 'FHD' },
    Attendee: { MaxCount: WEBINAR_SINGLE_MEETING_CAPACITY },
  },
  workshop: {
    Audio: { EchoReduction: 'AVAILABLE' },
    Video: { MaxResolution: 'HD' },
    Content: { MaxResolution: 'FHD' },
    Attendee: { MaxCount: 30 },
  },
};

// ---------------------------------------------------------------------------
// Provider objects handed to the browser client
// ---------------------------------------------------------------------------

/** Chime `MediaPlacement`, kept whole. The join contract drops `EventIngestionUrl` (CW-R-48). */
export interface ProviderMediaPlacement {
  AudioHostUrl: string;
  AudioFallbackUrl: string;
  SignalingUrl: string;
  TurnControlUrl?: string;
  ScreenDataUrl?: string;
  ScreenViewingUrl?: string;
  ScreenSharingUrl?: string;
  EventIngestionUrl?: string;
}

/** Chime `Meeting`, as the browser's `MeetingSessionConfiguration` needs it. */
export interface ProviderMeeting {
  MeetingId: string;
  MeetingArn?: string;
  /** The `call_sessions.id`. */
  ExternalMeetingId?: string;
  MediaRegion: string;
  MediaPlacement: ProviderMediaPlacement;
  MeetingFeatures?: MeetingFeaturesConfiguration;
  TenantIds?: string[];
}

/**
 * Chime `Attendee`. `JoinToken` is a credential: never written to PostgreSQL,
 * logged, or put in audit details (D-CW-08, CW-R-69).
 */
export interface ProviderAttendee {
  AttendeeId: string;
  /** The `call_participants.id`, never a user id, name or email (CW-R-03). */
  ExternalUserId: string;
  JoinToken: string;
  Capabilities: ParticipantCapabilities;
}

/** What `describeSession` reports: the meeting a rejoining client connects to. */
export interface ProviderSessionInfo {
  providerMeetingId: string;
  meeting: ProviderMeeting;
}

/** What `createSession` returns: the meeting and the first participant's attendee (D-CW-07). */
export interface ProviderSession extends ProviderSessionInfo {
  participant: ProviderParticipant;
}

export interface ProviderParticipant {
  providerAttendeeId: string;
  attendee: ProviderAttendee;
}

export interface ProviderRecording {
  /** Media capture pipeline id (`webinar_recordings.provider_pipeline_id`). */
  pipelineId: string;
  /** Key prefix of the raw segments (`webinar_recordings.raw_segments_prefix`). */
  rawSegmentsPrefix: string;
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface SessionParticipantInput {
  /** The `call_participants.id`, sent as `ExternalUserId` (D-CW-11). */
  participantId: string;
  role: CallParticipantRole;
  /** Defaults to {@link capabilitiesForRole}(role). */
  capabilities?: ParticipantCapabilities;
}

export interface CreateSessionInput {
  /** The `call_sessions.id`: `ClientRequestToken` and `ExternalMeetingId` (D-CW-07). */
  sessionId: string;
  /** Selects the meeting features of {@link MEETING_FEATURES}. */
  format: CallFormat;
  /** Planned audience; above the format's `Attendee.MaxCount` it is refused until M3 (D-CW-36). */
  capacity: number;
  /** Organisation: `orgId` tag, and the tenant id of consultations and workshops (D-CW-11). */
  orgId: string | null;
  /** Webinar: the tenant id of webinars (D-CW-11). */
  webinarId: string | null;
  /** The first joiner, created with the meeting (D-CW-07). */
  participant: SessionParticipantInput;
}

export interface CreateParticipantInput extends SessionParticipantInput {
  providerMeetingId: string;
}

export interface UpdateCapabilitiesInput {
  providerMeetingId: string;
  providerAttendeeId: string;
  role: CallParticipantRole;
  capabilities: ParticipantCapabilities;
}

export interface RemoveParticipantInput {
  providerMeetingId: string;
  providerAttendeeId: string;
}

export interface EndSessionInput {
  providerMeetingId: string;
}

export interface DescribeSessionInput {
  providerMeetingId: string;
}

export interface StartRecordingInput {
  sessionId: string;
  providerMeetingId: string;
  /** Only these attendees' video is captured (D-CW-18). */
  presenterAttendeeIds: string[];
}

export interface StopRecordingInput {
  pipelineId: string;
}

// ---------------------------------------------------------------------------
// Provider events (D-CW-12, guidelines section 9.1)
// ---------------------------------------------------------------------------

/**
 * Chime meeting event names the event handler consumes. The SQS consumer maps
 * `chime:<Name>` messages to these; `FakeVideoProvider` emits them in process.
 */
export const VIDEO_PROVIDER_EVENT_TYPES = [
  'MeetingStarted',
  'AttendeeJoined',
  'AttendeeLeft',
  'AttendeeDropped',
  'MeetingEnded',
] as const;
export type VideoProviderEventType = (typeof VIDEO_PROVIDER_EVENT_TYPES)[number];

/** One provider event; its first four fields are the `call_events` dedup key. */
export interface VideoProviderEvent {
  eventType: VideoProviderEventType;
  providerMeetingId: string;
  /** Null for meeting-level events. */
  providerAttendeeId: string | null;
  occurredAt: Date;
  /** The `call_sessions.id`. */
  externalMeetingId: string;
  /** The `call_participants.id`; null for meeting-level events. */
  externalUserId: string | null;
}

export type VideoProviderEventListener = (event: VideoProviderEvent) => void | Promise<void>;

// ---------------------------------------------------------------------------
// Shared rules
// ---------------------------------------------------------------------------

/**
 * Chime's `TenantIds` item pattern: 2 to 256 characters from a small set, and
 * never four identical characters in a row. About 1 in 250 random UUIDs breaks
 * the second rule, so ids are encoded before they are sent.
 */
export const CHIME_TENANT_ID_PATTERN = /^(?!.*?(.)\1{3})[-_!@#$a-zA-Z0-9]{2,256}$/;

/**
 * Encodes an id for `TenantIds` by putting `_` after every third character,
 * so no run of identical characters can reach four (a UUID becomes 47
 * characters). Only `TenantIds` is encoded; `ExternalMeetingId`,
 * `ExternalUserId` and `ClientRequestToken` take the raw ids.
 */
export function encodeTenantId(id: string): string {
  const encoded = id.replace(/(.{3})(?=.)/g, '$1_');
  if (!CHIME_TENANT_ID_PATTERN.test(encoded)) {
    throw new Error('The id cannot be encoded as a Chime TenantIds value');
  }
  return encoded;
}

/** Tenant id per D-CW-11: the organisation, or the webinar for webinars, encoded. */
export function tenantIdsFor(input: CreateSessionInput): string[] {
  const tenantId = input.format === 'webinar' ? input.webinarId : input.orgId;
  if (!tenantId) {
    throw new Error(
      input.format === 'webinar'
        ? 'A webinar session needs a webinarId (D-CW-11)'
        : `A ${input.format} session needs an orgId (D-CW-11)`,
    );
  }
  return [encodeTenantId(tenantId)];
}

function callError(
  status: number,
  code: CallErrorCode,
  message: string,
  details?: Record<string, unknown>,
): ApiHttpException {
  return new ApiHttpException({ status, code, message, details });
}

/** 503 by default; 429 when the provider throttles; 502 for an unexpected provider failure. */
export function videoProviderUnavailable(
  status: number = HttpStatus.SERVICE_UNAVAILABLE,
): ApiHttpException {
  return callError(status, 'video_provider_unavailable', 'The video provider is unavailable');
}

/** The provider no longer knows the meeting (deleted or ended). */
export function sessionNotJoinable(): ApiHttpException {
  return callError(HttpStatus.CONFLICT, 'appointment_not_joinable', 'The call session is no longer available');
}

/**
 * Largest audience per format: the contract constants for webinars (until the
 * M3 replication, D-CW-36) and workshops (CW-R-26). Consultations have no
 * contract constant and are bounded by the meeting itself (D-CW-10).
 */
const CAPACITY_LIMITS: Readonly<Record<CallFormat, number>> = {
  consultation: MEETING_FEATURES.consultation.Attendee.MaxCount,
  webinar: WEBINAR_SINGLE_MEETING_CAPACITY,
  workshop: WORKSHOP_CAPACITY,
};

export function assertCapacityWithinLimit(format: CallFormat, capacity: number): void {
  const limit = CAPACITY_LIMITS[format];
  if (capacity > limit) {
    throw callError(
      HttpStatus.BAD_REQUEST,
      'capacity_above_limit',
      `A ${format} session holds at most ${limit} participants`,
      { limit },
    );
  }
}

/** Capabilities to request for a participant, after the attendee guard. */
export function resolveCapabilities(input: SessionParticipantInput): ParticipantCapabilities {
  const capabilities = input.capabilities ?? capabilitiesForRole(input.role);
  assertCapabilitiesAllowed(input.role, capabilities);
  return capabilities;
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

export abstract class VideoProvider {
  /** Creates the meeting with its first attendee (`CreateMeetingWithAttendees`). */
  abstract createSession(input: CreateSessionInput): Promise<ProviderSession>;
  /** Adds an attendee to an existing meeting (`CreateAttendee`). */
  abstract createParticipant(input: CreateParticipantInput): Promise<ProviderParticipant>;
  abstract updateParticipantCapabilities(input: UpdateCapabilitiesInput): Promise<void>;
  /** Idempotent: an attendee that is already gone counts as removed. */
  abstract removeParticipant(input: RemoveParticipantInput): Promise<void>;
  /** Idempotent: ending an ended meeting is a no-op (CW-R-16). */
  abstract endSession(input: EndSessionInput): Promise<void>;
  abstract startRecording(input: StartRecordingInput): Promise<ProviderRecording>;
  /** Idempotent: a pipeline that is already gone counts as stopped. */
  abstract stopRecording(input: StopRecordingInput): Promise<void>;
  /** Null when the provider no longer knows the meeting. */
  abstract describeSession(input: DescribeSessionInput): Promise<ProviderSessionInfo | null>;
}
