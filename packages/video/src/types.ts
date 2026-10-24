/**
 * Public shapes of the call client: the controller's state snapshot and the
 * interface the React hooks and components depend on. Both the real
 * `CallSessionController` and the fake one used by stories and tests
 * implement `CallSessionControllerApi`.
 */
import type {
  CallFormat,
  CallJoinResponse,
  CallParticipantRole,
  CallQualityMetrics,
  ClientEventRequest,
} from '@nestself/contracts';
import type { ConnectionQuality } from './quality-thresholds';

/** Join state machine (guidelines 11.1, 11.7). */
export type CallSessionStatus = 'idle' | 'checking' | 'joining' | 'connected' | 'reconnecting' | 'failed' | 'left';

/** Why the session is `failed`. */
export type CallFailureReason = 'join_failed' | 'connection_failed' | 'reconnect_timeout';

/** Why the session is `left`: this person left, the expert ended it, the API removed the attendee, or another tab took over. */
export type CallEndReason = 'left' | 'ended' | 'removed' | 'joined_elsewhere';

/** Browser permission for a capture device as the checks observed it. */
export type MediaPermission = 'unknown' | 'granted' | 'denied' | 'error';

export type DeviceCheckResult = 'pending' | 'passed' | 'denied' | 'failed' | 'skipped';
export type NetworkCheckResult = 'pending' | ConnectionQuality | 'offline';
export type SpeakerTestState = 'idle' | 'playing' | 'heard' | 'not_heard' | 'failed';

/** Quick signals from the control bar; sending them is wired by the app (T-CW-1.5). */
export type CallSignal = 'cannot_hear' | 'cannot_see';

export type DeviceKind = 'camera' | 'microphone' | 'speaker';

/** A device as the UI lists it. Labels stay in the UI and never reach telemetry. */
export interface DeviceOption {
  deviceId: string;
  label: string;
}

export interface SessionState {
  status: CallSessionStatus;
  failure: CallFailureReason | null;
  endReason: CallEndReason | null;
  role: CallParticipantRole;
  format: CallFormat;
  /** Scheduled window from the join response, for the session timer. */
  startsAt: string | null;
  endsAt: string | null;
  /** Epoch milliseconds when the current reconnection started. */
  reconnectStartedAt: number | null;
}

export interface ReadinessState {
  status: 'idle' | 'running' | 'done';
  camera: DeviceCheckResult;
  microphone: DeviceCheckResult;
  network: NetworkCheckResult;
  speaker: SpeakerTestState;
}

export interface BlurState {
  /** `null` until the browser was asked (on demand, CW-R-99). */
  supported: boolean | null;
  enabled: boolean;
  loading: boolean;
}

export interface DevicesState {
  cameras: readonly DeviceOption[];
  microphones: readonly DeviceOption[];
  /** Empty where the browser cannot choose an output (Firefox, Safari). */
  speakers: readonly DeviceOption[];
  selected: Readonly<Record<DeviceKind, string | null>>;
  permissions: Readonly<{ camera: MediaPermission; microphone: MediaPermission }>;
  /** The "join with camera off" choice, remembered per device (D-CW-21). */
  cameraOff: boolean;
  blur: BlurState;
  /** False for webinar attendees, who never send video (D-CW-35). */
  canSendVideo: boolean;
  /** False for webinar attendees, who have no microphone until given the floor. */
  canSendAudio: boolean;
}

export interface MediaState {
  muted: boolean;
  cameraOn: boolean;
  sharingScreen: boolean;
}

export interface QualityState {
  level: ConnectionQuality;
  /** Last 30-second aggregate, or null before the first one. */
  metrics: CallQualityMetrics | null;
  /** Degraded mode step one: outgoing video lowered to 360p. */
  lowResolution: boolean;
  /** Degraded mode step two: outgoing video paused, audio continues. */
  videoPaused: boolean;
}

export interface RemoteTile {
  tileId: number;
  attendeeId: string | null;
  paused: boolean;
}

export interface TilesState {
  localTileId: number | null;
  contentTileId: number | null;
  remote: readonly RemoteTile[];
}

/**
 * Immutable snapshot. Each slice keeps its identity until it changes, so
 * hooks can select a slice with `useSyncExternalStore`.
 */
export interface CallSessionSnapshot {
  session: SessionState;
  readiness: ReadinessState;
  devices: DevicesState;
  media: MediaState;
  quality: QualityState;
  tiles: TilesState;
}

/** What hooks and components need from a controller. */
export interface CallSessionControllerApi {
  getSnapshot(): CallSessionSnapshot;
  subscribe(listener: () => void): () => void;

  /** Camera, microphone and network checks (D-CW-21); runs before the join endpoint is called. */
  checkReadiness(): Promise<void>;
  /** Plays a tone through the selected speaker; resolve it with `confirmSpeaker`. */
  testSpeaker(): Promise<void>;
  confirmSpeaker(heard: boolean): void;

  refreshDevices(): Promise<void>;
  selectDevice(kind: DeviceKind, deviceId: string): Promise<void>;
  /** The pre-join "join with camera off" choice; persisted. */
  setCameraOff(off: boolean): Promise<void>;
  /** Background blur, loaded on demand; persisted. */
  setBlur(enabled: boolean): Promise<void>;
  bindPreview(element: HTMLVideoElement | null): void;
  /** Microphone input level from 0 to 1 for the pre-join meter. */
  getMicrophoneLevel(): number;

  join(response: CallJoinResponse): Promise<void>;
  leave(): Promise<void>;

  setMuted(muted: boolean): void;
  /**
   * Audio capability change (a webinar attendee given or losing the floor).
   * Never enables video. Optional so existing implementations stay valid.
   */
  setAudioCapability?(enabled: boolean): Promise<void>;
  setCameraOn(on: boolean): Promise<void>;
  setScreenShare(on: boolean): Promise<void>;
  bindVideoTile(tileId: number, element: HTMLVideoElement): void;
  unbindVideoTile(tileId: number): void;
  bindAudio(element: HTMLAudioElement | null): void;

  /** Client events of D-CW-13 recorded so far: connection metadata only. */
  getClientEvents(): readonly ClientEventRequest[];
  /** Returns the recorded client events and clears the buffer, for posting. */
  drainClientEvents(): ClientEventRequest[];

  destroy(): Promise<void>;
}
