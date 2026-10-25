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
  WEBINAR_MAX_REPLICAS,
  WEBINAR_REPLICATED_CAPACITY,
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

/**
 * A replica meeting of a webinar with media replication (D-CW-14, WEB-07):
 * its attendees receive only the primary's presenters and never see each
 * other. `meeting` never carries the primary's id.
 */
export interface ProviderReplicaInfo {
  /** 1-based; the `-r{n}` suffix of the replica's `ExternalMeetingId`. */
  replicaIndex: number;
  providerMeetingId: string;
  meeting: ProviderMeeting;
}

export interface ProviderReplica extends ProviderReplicaInfo {
  /** Attendee seats planned for this replica. */
  capacity: number;
}

/** What `describeSession` reports: the meeting a rejoining client connects to. */
export interface ProviderSessionInfo {
  /** The primary meeting: hosts, and attendees given the floor from a replica. */
  providerMeetingId: string;
  meeting: ProviderMeeting;
  /** Replicas still known to the provider, of those asked about; empty for a single meeting. */
  replicas: ProviderReplicaInfo[];
}

/** What `createSession` returns: the meetings and the first participant's attendee (D-CW-07). */
export interface ProviderSession extends ProviderSessionInfo {
  participant: ProviderParticipant;
  /** Replicas in index order; empty unless a webinar exceeds a single meeting. */
  replicas: ProviderReplica[];
}

export interface ProviderParticipant {
  /** The meeting this attendee belongs to: the primary or one replica. */
  providerMeetingId: string;
  providerAttendeeId: string;
  attendee: ProviderAttendee;
}

export interface ProviderRecording {
  /** Media capture pipeline id (`webinar_recordings.provider_pipeline_id`). */
  pipelineId: string;
  /** Its ARN, the source of the concatenation pipeline (`webinar_recordings.provider_pipeline_arn`, WEB-29). */
  pipelineArn: string;
  /** Key prefix of the raw segments (`webinar_recordings.raw_segments_prefix`), the input's `s3Prefix`. */
  rawSegmentsPrefix: string;
}

/** A started media concatenation pipeline (WEB-29). */
export interface ProviderConcatenation {
  /** `webinar_recordings.concatenation_pipeline_id`. */
  pipelineId: string;
}

/** Where a concatenation stands: running, finished with its MP4, or failed. */
export type ProviderConcatenationStatus = 'in_progress' | 'completed' | 'failed';

export interface ProviderConcatenationState {
  status: ProviderConcatenationStatus;
  /**
   * Once completed: the key of the composited MP4, or (Chime) the key prefix
   * that holds it, since Chime names the object (SPIKE-CW-04 records the name).
   */
  concatenatedKey: string | null;
  /** Once completed: `s3://{bucket}/{concatenatedKey}`, for the CMS handoff (D-CW-03). */
  location: string | null;
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

/** Where a participant joins: the primary meeting or one replica (by 1-based index). */
export type ParticipantTarget = 'primary' | { replicaIndex: number };

/** Replica meeting ids in index order (`ProviderSession.replicas`), kept by the caller. */
interface ReplicaMeetingIds {
  /** Omitted for a single meeting. Chime cannot list a primary's replicas, so the caller keeps them. */
  replicaMeetingIds?: string[];
}

export interface CreateParticipantInput extends SessionParticipantInput, ReplicaMeetingIds {
  /** The session's primary meeting. */
  providerMeetingId: string;
  /**
   * Defaults to the primary. Hosts always join the primary. The floor for a
   * replica attendee goes through {@link VideoProvider.promoteToPrimary}.
   */
  target?: ParticipantTarget;
}

/** The floor for a replica attendee (WEB-09, SPIKE-CW-06): primary credentials to promote into. */
export interface PromoteToPrimaryInput {
  sessionId: string;
  /** The primary meeting: Chime cannot find a meeting by session id. */
  providerMeetingId: string;
  /** The `call_participants.id`, the primary attendee's `ExternalUserId` (D-CW-11). */
  participantId: string;
}

export interface DemoteFromPrimaryInput extends PromoteToPrimaryInput {
  /** The primary attendee `promoteToPrimary` returned: Chime cannot find it by `ExternalUserId`. */
  providerAttendeeId: string;
}

/**
 * For a single-meeting webinar's floor and other in-meeting changes. A replica
 * attendee cannot be given audio this way; see `promoteToPrimary`.
 */
export interface UpdateCapabilitiesInput {
  /** The meeting the attendee belongs to (`ProviderParticipant.providerMeetingId`), replica included. */
  providerMeetingId: string;
  providerAttendeeId: string;
  role: CallParticipantRole;
  capabilities: ParticipantCapabilities;
}

export interface RemoveParticipantInput {
  /** The meeting the attendee belongs to (`ProviderParticipant.providerMeetingId`), replica included. */
  providerMeetingId: string;
  providerAttendeeId: string;
}

export interface EndSessionInput extends ReplicaMeetingIds {
  providerMeetingId: string;
}

export interface DescribeSessionInput extends ReplicaMeetingIds {
  providerMeetingId: string;
}

export interface StartRecordingInput {
  sessionId: string;
  providerMeetingId: string;
  /** Only these attendees' video is captured (D-CW-18); at least one. */
  presenterAttendeeIds: string[];
  /**
   * Key prefix of the capture segments in the recordings bucket, ending in
   * `/`: `recordings/{webinarId}/raw/` (T-CW-2.5 step 7, {@link recordingRawPrefix}).
   */
  s3Prefix: string;
}

export interface StopRecordingInput {
  pipelineId: string;
}

export interface StartConcatenationInput {
  /** For the log line and the idempotency token. */
  sessionId: string;
  /** The capture pipeline's ARN, created within 30 days (WEB-29). */
  capturePipelineArn: string;
  /** Destination key prefix, ending in `/`: `recordings/{webinarId}/final/` ({@link recordingFinalPrefix}). */
  s3Prefix: string;
  /** 1-based attempt: the idempotency token is per attempt, so a retry after a failed concatenation starts anew. */
  attempt: number;
}

export interface DescribeConcatenationInput {
  pipelineId: string;
  /** The destination prefix it was started with. */
  s3Prefix: string;
}

// ---------------------------------------------------------------------------
// Recordings bucket layout (T-CW-2.5 step 7, D-CW-18)
// ---------------------------------------------------------------------------

/** `recordings/{webinarId}/raw/`: the capture pipeline's 5-second segments. */
export function recordingRawPrefix(webinarId: string): string {
  return `recordings/${webinarId}/raw/`;
}

/** `recordings/{webinarId}/final/`: the concatenated MP4. */
export function recordingFinalPrefix(webinarId: string): string {
  return `recordings/${webinarId}/final/`;
}

/**
 * The folder a concatenation pipeline writes the composited video (with the
 * audio muxed in) under its destination prefix.
 */
export const CONCATENATED_VIDEO_FOLDER = 'composited-video/';

/** `SelectedVideoStreams` takes at most 25 attendee ids (WEB-24, WEB-25). */
export const MAX_SELECTED_VIDEO_STREAMS = 25;

/** A relative S3 key prefix that names a folder: no leading `/`, no `..`, ends in `/`. */
const RECORDING_PREFIX_PATTERN = /^(?!\/)(?!.*\.\.)[A-Za-z0-9!_.*'()/-]+\/$/;

/** Both adapters refuse a recording prefix that is not a relative folder, before any provider call. */
export function assertRecordingPrefix(prefix: string): void {
  if (!RECORDING_PREFIX_PATTERN.test(prefix)) {
    throw new Error('A recording prefix is a relative folder key ending in "/" (recordings/{webinarId}/raw/)');
  }
}

/** A capture records presenters only, 1 to 25 of them (D-CW-18, WEB-25). */
export function assertPresenterStreams(presenterAttendeeIds: readonly string[]): void {
  if (presenterAttendeeIds.length === 0 || presenterAttendeeIds.length > MAX_SELECTED_VIDEO_STREAMS) {
    throw new Error(`A webinar capture selects 1 to ${MAX_SELECTED_VIDEO_STREAMS} presenter video streams (D-CW-18)`);
  }
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
 * Largest audience per format: the contract constants for webinars (with
 * media replication, D-CW-14) and workshops (CW-R-26). Consultations have no
 * contract constant and are bounded by the meeting itself (D-CW-10).
 */
const CAPACITY_LIMITS: Readonly<Record<CallFormat, number>> = {
  consultation: MEETING_FEATURES.consultation.Attendee.MaxCount,
  webinar: WEBINAR_REPLICATED_CAPACITY,
  workshop: WORKSHOP_CAPACITY,
};

export function assertCapacityWithinLimit(format: CallFormat, capacity: number): void {
  const limit = CAPACITY_LIMITS[format];
  if (capacity <= limit) return;
  throw callError(
    HttpStatus.BAD_REQUEST,
    'capacity_above_limit',
    format === 'webinar'
      ? `A webinar holds at most ${limit} attendees; a larger audience needs the Amazon IVS live connector, documented but not built (D-CW-14)`
      : `A ${format} session holds at most ${limit} participants`,
    { limit },
  );
}

// ---------------------------------------------------------------------------
// Media replication (D-CW-14, D-CW-36, WEB-07 to WEB-09)
// ---------------------------------------------------------------------------

/** Webinar hosts: they always join the primary meeting (WBN-35). */
export const HOST_ROLES: ReadonlySet<CallParticipantRole> = new Set(['presenter', 'moderator']);

/** Thrown when code routes a participant to a meeting it may not join. */
export class VideoRoutingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VideoRoutingError';
  }
}

/**
 * Attendee seats per replica: none up to a single meeting, then
 * `ceil(capacity / 250)` replicas sharing the audience evenly. `capacity`
 * counts registrations only; hosts sit in the primary outside it, so no seats
 * are reserved for them. At most `WEBINAR_MAX_REPLICAS` once
 * {@link assertCapacityWithinLimit} has passed.
 */
export function replicaCapacities(format: CallFormat, capacity: number): number[] {
  if (format !== 'webinar' || capacity <= WEBINAR_SINGLE_MEETING_CAPACITY) return [];
  const count = Math.min(Math.ceil(capacity / WEBINAR_SINGLE_MEETING_CAPACITY), WEBINAR_MAX_REPLICAS);
  const base = Math.floor(capacity / count);
  return Array.from({ length: count }, (_, i) => base + (i < capacity % count ? 1 : 0));
}

/** A replica's `ExternalMeetingId` (and `ClientRequestToken`): the session id plus `-r{n}`. */
export function replicaExternalMeetingId(sessionId: string, replicaIndex: number): string {
  return `${sessionId}-r${replicaIndex}`;
}

/** Maps a replica's `ExternalMeetingId` back to its session, for the event handler. */
export function parseReplicaExternalMeetingId(
  externalMeetingId: string,
): { sessionId: string; replicaIndex: number } | null {
  const match = /^(.+)-r([1-9]\d*)$/.exec(externalMeetingId);
  return match ? { sessionId: match[1]!, replicaIndex: Number(match[2]) } : null;
}

/**
 * The replica a joining attendee goes to: the least-loaded one with a free
 * seat, ties broken by the lowest index. `counts` maps a replica index to its
 * current attendees (absent means none). Null when every replica is full.
 */
export function pickReplica<T extends { replicaIndex: number; capacity?: number }>(
  replicas: readonly T[],
  counts: Readonly<Record<number, number>>,
): T | null {
  let best: T | null = null;
  let bestCount = Number.POSITIVE_INFINITY;
  for (const replica of [...replicas].sort((a, b) => a.replicaIndex - b.replicaIndex)) {
    const count = counts[replica.replicaIndex] ?? 0;
    if (count >= (replica.capacity ?? WEBINAR_SINGLE_MEETING_CAPACITY)) continue;
    if (count < bestCount) {
      best = replica;
      bestCount = count;
    }
  }
  return best;
}

/**
 * The meeting a participant joins. Hosts never join a replica, and a replica
 * must be one of the caller's `replicaMeetingIds`.
 */
export function resolveTargetMeeting(input: CreateParticipantInput): string {
  const target = input.target ?? 'primary';
  if (target === 'primary') return input.providerMeetingId;
  if (HOST_ROLES.has(input.role)) {
    throw new VideoRoutingError('Webinar hosts always join the primary meeting (WBN-35)');
  }
  const replicaMeetingId = input.replicaMeetingIds?.[target.replicaIndex - 1];
  if (!replicaMeetingId) throw new VideoRoutingError(`No replica ${target.replicaIndex} for this session`);
  return replicaMeetingId;
}

/**
 * What an attendee given the floor may do: audio only, video and content stay
 * `Receive` (D-CW-35). Re-checked by the attendee guard on every use.
 */
export function floorCapabilities(): ParticipantCapabilities {
  const capabilities = capabilitiesForRole('attendee', { floor: true });
  assertCapabilitiesAllowed('attendee', capabilities);
  return capabilities;
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
  /**
   * Creates the meeting with its first attendee (`CreateMeetingWithAttendees`).
   * A webinar above a single meeting also gets replicas (`PrimaryMeetingId`);
   * a first-arriving attendee then joins replica 1, never the primary.
   */
  abstract createSession(input: CreateSessionInput): Promise<ProviderSession>;
  /** Adds an attendee to the primary or a replica (`CreateAttendee`). */
  abstract createParticipant(input: CreateParticipantInput): Promise<ProviderParticipant>;
  abstract updateParticipantCapabilities(input: UpdateCapabilitiesInput): Promise<void>;
  /** Idempotent: an attendee that is already gone counts as removed. */
  abstract removeParticipant(input: RemoveParticipantInput): Promise<void>;
  /**
   * Gives a replica attendee the floor: an attendee for the same participant on
   * the primary, with {@link floorCapabilities} only (never video, D-CW-35).
   * The client promotes into it with `promoteToPrimaryMeeting`; Chime has no
   * server-side promote and no audio for a replica attendee (SPIKE-CW-06).
   */
  abstract promoteToPrimary(input: PromoteToPrimaryInput): Promise<ProviderParticipant>;
  /** Takes the floor back by deleting the primary attendee; the client demotes. Idempotent. */
  abstract demoteFromPrimary(input: DemoteFromPrimaryInput): Promise<void>;
  /**
   * Idempotent: ending an ended meeting is a no-op (CW-R-16). Replicas end
   * first, then the primary; deleting the primary also deletes its replicas.
   */
  abstract endSession(input: EndSessionInput): Promise<void>;
  abstract startRecording(input: StartRecordingInput): Promise<ProviderRecording>;
  /** Idempotent: a pipeline that is already gone counts as stopped. */
  abstract stopRecording(input: StopRecordingInput): Promise<void>;
  /**
   * One MP4 from a stopped capture (`CreateMediaConcatenationPipeline`,
   * WEB-29): composited video with the audio, nothing else. Chime waits for the
   * capture to finish before it starts. Idempotent per capture pipeline.
   */
  abstract startConcatenation(input: StartConcatenationInput): Promise<ProviderConcatenation>;
  /** The concatenation's state (`GetMediaPipeline`); a pipeline the provider no longer knows is `failed`. */
  abstract describeConcatenation(input: DescribeConcatenationInput): Promise<ProviderConcatenationState>;
  /** Null when the provider no longer knows the meeting. */
  abstract describeSession(input: DescribeSessionInput): Promise<ProviderSessionInfo | null>;
}
