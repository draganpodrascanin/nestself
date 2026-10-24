/**
 * `CallSessionController`: the framework-agnostic core of the call client
 * (D-CW-20, guidelines 11.1). It owns the Chime SDK `MeetingSession`, device
 * enumeration, selection and persistence, the pre-join readiness checks
 * (OPS-30), join, reconnection (CORE-17), capability-aware media, the
 * 30-second quality aggregate and degraded mode (UX-12, UX-38), and the
 * client-event log of D-CW-13.
 *
 * The SDK is imported on demand, so importing `@nestself/video` for a
 * follow-up card or the crisis block does not pull `amazon-chime-sdk-js`
 * into that bundle (CW-R-98).
 *
 * Privacy: the browser never uses Chime's event ingestion (CW-R-48); every
 * session gets a `NoOpEventReporter` and the ingestion URL is cleared. Client
 * events carry connection metadata only: no device labels, names or ids.
 */
import { ClientEventRequestSchema } from '@nestself/contracts';
import type {
  CallFormat,
  CallJoinResponse,
  CallParticipantRole,
  CallQualityMetrics,
  ClientEventName,
  ClientEventRequest,
} from '@nestself/contracts';
import type * as ChimeSdkModule from 'amazon-chime-sdk-js';
import type {
  AudioVideoFacade,
  AudioVideoObserver,
  ClientMetricReport,
  ContentShareObserver,
  DefaultDeviceController,
  DefaultMeetingSession,
  DefaultVideoTransformDevice,
  DeviceChangeObserver,
  Logger,
  MeetingReadinessChecker,
  MeetingSessionStatus,
  RemovableAnalyserNode,
  VideoTileState,
} from 'amazon-chime-sdk-js';
import { currentUserAgent, detectBrowser, detectOs } from './environment';
import { VIDEO_STORAGE_KEYS, createLocalPreferenceStore, readDevicePreferences } from './preferences';
import type { PreferenceStore } from './preferences';
import {
  DEFAULT_VIDEO_QUALITY,
  DEGRADED_VIDEO_QUALITY,
  POOR_INTERVALS_BEFORE_VIDEO_PAUSE,
  QUALITY_AGGREGATION_INTERVAL_MS,
  QUALITY_RECOVERY_MS,
  RECONNECT_TIMEOUT_MS,
  aggregateMetrics,
  classifyQuality,
} from './quality-thresholds';
import type {
  CallSessionControllerApi,
  CallSessionSnapshot,
  CallSessionStatus,
  DeviceCheckResult,
  DeviceKind,
  DeviceOption,
  DevicesState,
  MediaPermission,
  NetworkCheckResult,
  QualityState,
  ReadinessState,
  TilesState,
} from './types';

type ChimeSdk = typeof ChimeSdkModule;

let sdkPromise: Promise<ChimeSdk> | null = null;

/**
 * `amazon-chime-sdk-js` 3.32.0 evaluates `'document' in global` when its
 * module loads (`cspmonitor/CSPMonitor.js`). Browsers have no `global`, and
 * the apps' bundlers do not define one, so every session constructor threw
 * a ReferenceError (DEF-1). Alias it to `globalThis` first; Node and jsdom
 * already have one, which is left alone.
 */
function ensureGlobalAlias(): void {
  if (typeof globalThis === 'undefined') return;
  const scope = globalThis as { global?: typeof globalThis };
  if (typeof scope.global === 'undefined') scope.global = globalThis;
}

/** Loads `amazon-chime-sdk-js` once, on first use. */
export function loadChimeSdk(): Promise<ChimeSdk> {
  ensureGlobalAlias();
  sdkPromise ??= import('amazon-chime-sdk-js');
  return sdkPromise;
}

export interface CallSessionControllerOptions {
  /** The participant's role; the join response's role replaces it on join. */
  role: CallParticipantRole;
  format?: CallFormat;
  /** Defaults to `localStorage` with try/catch wrappers. */
  store?: PreferenceStore;
  /**
   * Round-trip probe for the pre-join network check, in milliseconds. The
   * app passes one that times a request to the NestSelf API; the default
   * times a `HEAD` request to the page's own origin.
   */
  probeNetwork?: () => Promise<number>;
  /** Called with every recorded client event, for posting (T-CW-1.5). */
  onClientEvent?: (event: ClientEventRequest) => void;
  /** Overrides `navigator.userAgent` for the coarse browser and OS names. */
  userAgent?: string;
}

const ACTIVE_STATUSES: ReadonlySet<CallSessionStatus> = new Set(['joining', 'connected', 'reconnecting']);
const DENIED_ERROR_NAMES = new Set(['NotAllowedError', 'PermissionDeniedError', 'SecurityError']);
const SCREEN_SHARE_ROLES: ReadonlySet<CallParticipantRole> = new Set(['expert', 'presenter', 'moderator', 'facilitator']);
const PREJOIN_ATTENDEE_ID = 'nestself-prejoin';
const MAX_BUFFERED_EVENTS = 500;
const MAX_BUFFERED_SAMPLES = 120;
const DEVICE_STORAGE_KEY: Record<DeviceKind, (typeof VIDEO_STORAGE_KEYS)[DeviceKind]> = {
  camera: VIDEO_STORAGE_KEYS.camera,
  microphone: VIDEO_STORAGE_KEYS.microphone,
  speaker: VIDEO_STORAGE_KEYS.speaker,
};

const INITIAL_QUALITY: QualityState = { level: 'good', metrics: null, lowResolution: false, videoPaused: false };
const EMPTY_TILES: TilesState = { localTileId: null, contentTileId: null, remote: [] };

function canSendVideo(role: CallParticipantRole): boolean {
  return role !== 'attendee';
}

function canSendAudio(role: CallParticipantRole): boolean {
  return role !== 'attendee';
}

/** The browser's error name (`NotAllowedError`), never its message. */
function errorName(error: unknown): string | undefined {
  const candidate = error as { name?: unknown; cause?: { name?: unknown } } | null;
  const name = typeof candidate?.cause?.name === 'string' ? candidate.cause.name : candidate?.name;
  return typeof name === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name) ? name : undefined;
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** The SDK reports packet loss in percent (0 to 100); the contracts carry a fraction (0 to 1). */
function percentToFraction(percent: number | undefined): number | undefined {
  return percent === undefined ? undefined : Math.min(1, Math.max(0, percent / 100));
}

function compact(metrics: CallQualityMetrics): CallQualityMetrics {
  return Object.fromEntries(Object.entries(metrics).filter(([, value]) => value !== undefined)) as CallQualityMetrics;
}

async function defaultNetworkProbe(): Promise<number> {
  const started = performance.now();
  await fetch(`${window.location.origin}/`, { method: 'HEAD', cache: 'no-store' });
  return performance.now() - started;
}

type Patch = { [K in keyof CallSessionSnapshot]?: Partial<CallSessionSnapshot[K]> };

export class CallSessionController implements CallSessionControllerApi {
  private readonly options: CallSessionControllerOptions;
  private readonly store: PreferenceStore;
  private readonly browser: string;
  private readonly os: string;
  private readonly listeners = new Set<() => void>();
  private snapshot: CallSessionSnapshot;

  private sdk: ChimeSdk | null = null;
  private logger: Logger | null = null;
  private deviceController: DefaultDeviceController | null = null;
  private previewSession: DefaultMeetingSession | null = null;
  private session: DefaultMeetingSession | null = null;
  private checker: MeetingReadinessChecker | null = null;
  private transformDevice: DefaultVideoTransformDevice | null = null;
  private analyser: RemovableAnalyserNode | null = null;
  private previewElement: HTMLVideoElement | null = null;
  private audioElement: HTMLAudioElement | null = null;
  private videoInputActive = false;
  private audioInputActive = false;
  private attendeeId: string | null = null;
  private videoAtStart = false;
  private hasStarted = false;
  private joinStartedAt = 0;
  private speakerAnswer: ((heard: boolean) => void) | null = null;
  private speakerHeard: boolean | null = null;
  /** An answer given while the tone was still starting. */
  private earlySpeakerAnswer: boolean | null = null;

  /** Per-second samples: `metrics` for the badge and the API, `outgoing` for degraded mode. */
  private samples: Array<{ metrics: CallQualityMetrics; outgoing: CallQualityMetrics }> = [];
  private poorIntervals = 0;
  private recoveringSince: number | null = null;
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private events: ClientEventRequest[] = [];

  constructor(options: CallSessionControllerOptions) {
    this.options = options;
    this.store = options.store ?? createLocalPreferenceStore();
    const userAgent = options.userAgent ?? currentUserAgent();
    this.browser = detectBrowser(userAgent);
    this.os = detectOs(userAgent);
    const prefs = readDevicePreferences(this.store);
    const role = options.role;
    this.snapshot = {
      session: {
        status: 'idle',
        failure: null,
        endReason: null,
        role,
        format: options.format ?? 'consultation',
        startsAt: null,
        endsAt: null,
        reconnectStartedAt: null,
      },
      readiness: { status: 'idle', camera: 'pending', microphone: 'pending', network: 'pending', speaker: 'idle' },
      devices: {
        cameras: [],
        microphones: [],
        speakers: [],
        selected: { camera: prefs.camera, microphone: prefs.microphone, speaker: prefs.speaker },
        permissions: { camera: 'unknown', microphone: 'unknown' },
        cameraOff: canSendVideo(role) ? prefs.cameraOff : true,
        blur: { supported: null, enabled: false, loading: false },
        canSendVideo: canSendVideo(role),
        canSendAudio: canSendAudio(role),
      },
      media: { muted: !canSendAudio(role), cameraOn: false, sharingScreen: false },
      quality: INITIAL_QUALITY,
      tiles: EMPTY_TILES,
    };
  }

  /* ---------------------------------------------------------------------- */
  /* Store                                                                   */
  /* ---------------------------------------------------------------------- */

  getSnapshot = (): CallSessionSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private update(patch: Patch): void {
    const next = { ...this.snapshot } as Record<keyof CallSessionSnapshot, unknown>;
    for (const key of Object.keys(patch) as Array<keyof CallSessionSnapshot>) {
      next[key] = { ...this.snapshot[key], ...patch[key] };
    }
    this.snapshot = next as unknown as CallSessionSnapshot;
    for (const listener of [...this.listeners]) listener();
  }

  private get role(): CallParticipantRole {
    return this.snapshot.session.role;
  }

  private get devices(): DevicesState {
    return this.snapshot.devices;
  }

  private get isActive(): boolean {
    return ACTIVE_STATUSES.has(this.snapshot.session.status);
  }

  /** The joined session's facade, or the pre-join one. Device calls go to the shared device controller either way. */
  private get av(): AudioVideoFacade | null {
    return (this.session ?? this.previewSession)?.audioVideo ?? null;
  }

  /* ---------------------------------------------------------------------- */
  /* SDK setup                                                               */
  /* ---------------------------------------------------------------------- */

  private async ensureSdk(): Promise<ChimeSdk> {
    if (!this.sdk) {
      this.sdk = await loadChimeSdk();
      this.logger = new this.sdk.ConsoleLogger('NestSelfVideo', this.sdk.LogLevel.WARN);
    }
    return this.sdk;
  }

  private ensureDeviceController(sdk: ChimeSdk): DefaultDeviceController {
    if (!this.deviceController) {
      this.deviceController = new sdk.DefaultDeviceController(this.logger!, { enableWebAudio: false });
      this.deviceController.addDeviceChangeObserver(this.deviceChangeObserver);
    }
    return this.deviceController;
  }

  /**
   * A session that is never started: it lends its device facade to the
   * readiness checker and the preview before the join endpoint is called
   * (CW-R-55a). The SDK reads the attendee id on construction, so it gets
   * placeholder credentials.
   */
  private async ensurePreviewSession(): Promise<DefaultMeetingSession> {
    const sdk = await this.ensureSdk();
    if (!this.previewSession) {
      const configuration = new sdk.MeetingSessionConfiguration();
      const credentials = new sdk.MeetingSessionCredentials();
      credentials.attendeeId = PREJOIN_ATTENDEE_ID;
      credentials.externalUserId = PREJOIN_ATTENDEE_ID;
      credentials.joinToken = '';
      configuration.credentials = credentials;
      const eventController = new sdk.DefaultEventController(configuration, this.logger!, new sdk.NoOpEventReporter());
      this.previewSession = new sdk.DefaultMeetingSession(configuration, this.logger!, this.ensureDeviceController(sdk), eventController);
    }
    return this.previewSession;
  }

  private readonly deviceChangeObserver: DeviceChangeObserver = {
    audioInputsChanged: () => void this.refreshDevices().catch(() => undefined),
    videoInputsChanged: () => void this.refreshDevices().catch(() => undefined),
    audioOutputsChanged: () => void this.refreshDevices().catch(() => undefined),
  };

  /* ---------------------------------------------------------------------- */
  /* Devices                                                                 */
  /* ---------------------------------------------------------------------- */

  async refreshDevices(): Promise<void> {
    const av = this.av ?? (await this.ensurePreviewSession()).audioVideo;
    const [cameras, microphones, speakers] = await Promise.all([
      this.devices.canSendVideo ? av.listVideoInputDevices() : Promise.resolve([]),
      this.devices.canSendAudio ? av.listAudioInputDevices() : Promise.resolve([]),
      av.listAudioOutputDevices().catch(() => []),
    ]);
    const options = (list: MediaDeviceInfo[]): DeviceOption[] =>
      list.filter((device) => device.deviceId).map((device) => ({ deviceId: device.deviceId, label: device.label }));
    const lists: Record<DeviceKind, DeviceOption[]> = {
      camera: options(cameras),
      microphone: options(microphones),
      speaker: options(speakers),
    };
    const pick = (kind: DeviceKind): string | null => {
      const preferred = this.store.get(DEVICE_STORAGE_KEY[kind]) ?? this.devices.selected[kind];
      const list = lists[kind];
      return list.some((device) => device.deviceId === preferred) ? preferred : (list[0]?.deviceId ?? null);
    };
    this.update({
      devices: {
        cameras: lists.camera,
        microphones: lists.microphone,
        speakers: lists.speaker,
        selected: { camera: pick('camera'), microphone: pick('microphone'), speaker: pick('speaker') },
      },
    });
  }

  async selectDevice(kind: DeviceKind, deviceId: string): Promise<void> {
    if (kind === 'camera' && !this.devices.canSendVideo) return;
    if (kind === 'microphone' && !this.devices.canSendAudio) return;
    this.store.set(DEVICE_STORAGE_KEY[kind], deviceId);
    this.update({ devices: { selected: { ...this.devices.selected, [kind]: deviceId } } });
    const av = this.av;
    if (!av) return;
    try {
      if (kind === 'camera') {
        if (this.transformDevice) this.transformDevice = this.transformDevice.chooseNewInnerDevice(deviceId);
        if (this.videoInputActive) {
          await av.startVideoInput(this.videoInput());
          this.attachPreview();
        }
      } else if (kind === 'microphone') {
        if (this.audioInputActive) {
          await av.startAudioInput(deviceId);
          if (!this.session) this.refreshAnalyser(av);
        }
      } else {
        await av.chooseAudioOutput(deviceId);
      }
    } catch (error) {
      if (kind !== 'speaker') this.onDeviceError(kind, error);
    }
  }

  async setCameraOff(off: boolean): Promise<void> {
    if (!this.devices.canSendVideo) return;
    this.store.set(VIDEO_STORAGE_KEYS.cameraOff, String(off));
    this.update({ devices: { cameraOff: off } });
    if (this.isActive) return;
    if (off) {
      await this.stopVideoInput();
    } else if (this.snapshot.readiness.status === 'done' && this.devices.permissions.camera !== 'denied') {
      await this.startVideoInputSafely();
      this.attachPreview();
    }
  }

  async setBlur(enabled: boolean): Promise<void> {
    if (!this.devices.canSendVideo) return;
    this.store.set(VIDEO_STORAGE_KEYS.blur, String(enabled));
    await this.applyBlur(enabled);
  }

  private async applyBlur(enabled: boolean): Promise<void> {
    if (!enabled) {
      const previous = this.transformDevice;
      this.transformDevice = null;
      this.update({ devices: { blur: { ...this.devices.blur, enabled: false, loading: false } } });
      if (this.videoInputActive) await this.restartVideoInput();
      await previous?.stop().catch(() => undefined);
      return;
    }
    this.update({ devices: { blur: { ...this.devices.blur, loading: true } } });
    try {
      const sdk = await this.ensureSdk();
      const supported = await sdk.BackgroundBlurVideoFrameProcessor.isSupported();
      const processor = supported ? await sdk.BackgroundBlurVideoFrameProcessor.create() : undefined;
      if (!processor) {
        this.update({ devices: { blur: { supported: false, enabled: false, loading: false } } });
        return;
      }
      this.transformDevice = new sdk.DefaultVideoTransformDevice(this.logger!, this.devices.selected.camera ?? {}, [processor]);
      this.update({ devices: { blur: { supported: true, enabled: true, loading: false } } });
      if (this.videoInputActive) await this.restartVideoInput();
    } catch {
      // The WASM module is blocked (CSP) or failed to load: blur is unavailable, the call is not (CW-R-55b).
      this.update({ devices: { blur: { supported: false, enabled: false, loading: false } } });
    }
  }

  bindPreview(element: HTMLVideoElement | null): void {
    const previous = this.previewElement;
    this.previewElement = element;
    if (previous && previous !== element) {
      try {
        this.av?.stopVideoPreviewForVideoInput(previous);
      } catch {
        // The preview element was already released.
      }
    }
    this.attachPreview();
  }

  private attachPreview(): void {
    if (!this.previewElement || !this.videoInputActive) return;
    try {
      this.av?.startVideoPreviewForVideoInput(this.previewElement);
    } catch {
      // The preview is cosmetic; the device state already reflects failures.
    }
  }

  getMicrophoneLevel(): number {
    const analyser = this.analyser;
    if (!analyser) return 0;
    const data = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (const value of data) {
      const centred = (value - 128) / 128;
      sum += centred * centred;
    }
    // Speech sits around 0.05 to 0.2 RMS; scale it so normal speech fills most of the meter.
    return Math.min(1, Math.sqrt(sum / data.length) * 4);
  }

  private refreshAnalyser(av: AudioVideoFacade): void {
    this.analyser?.removeOriginalInputs?.();
    this.analyser = av.createAnalyserNodeForAudioInput();
  }

  private videoInput(): string | MediaTrackConstraints | DefaultVideoTransformDevice {
    return this.transformDevice ?? this.devices.selected.camera ?? {};
  }

  private audioInput(): string | MediaTrackConstraints {
    return this.devices.selected.microphone ?? {};
  }

  private onDeviceError(kind: 'camera' | 'microphone', error: unknown): void {
    const name = errorName(error);
    const permission: MediaPermission = name && DENIED_ERROR_NAMES.has(name) ? 'denied' : 'error';
    this.update({ devices: { permissions: { ...this.devices.permissions, [kind]: permission } } });
    this.emit(kind === 'camera' ? 'videoInputFailed' : 'audioInputFailed', name ? { deviceError: name } : {});
  }

  private async startVideoInputSafely(): Promise<void> {
    const av = this.av;
    if (!av || !this.devices.canSendVideo) return;
    try {
      await av.startVideoInput(this.videoInput());
      this.videoInputActive = true;
      if (this.devices.permissions.camera !== 'granted') {
        this.update({ devices: { permissions: { ...this.devices.permissions, camera: 'granted' } } });
      }
    } catch (error) {
      this.videoInputActive = false;
      this.onDeviceError('camera', error);
    }
  }

  private async restartVideoInput(): Promise<void> {
    await this.startVideoInputSafely();
    this.attachPreview();
  }

  private async stopVideoInput(): Promise<void> {
    const av = this.av;
    if (this.previewElement) {
      try {
        av?.stopVideoPreviewForVideoInput(this.previewElement);
      } catch {
        // Already stopped.
      }
    }
    if (this.videoInputActive) await av?.stopVideoInput().catch(() => undefined);
    this.videoInputActive = false;
  }

  private async startAudioInputSafely(): Promise<void> {
    const av = this.av;
    if (!av || !this.devices.canSendAudio) return;
    try {
      await av.startAudioInput(this.audioInput());
      this.audioInputActive = true;
      if (this.devices.permissions.microphone !== 'granted') {
        this.update({ devices: { permissions: { ...this.devices.permissions, microphone: 'granted' } } });
      }
    } catch (error) {
      this.audioInputActive = false;
      this.onDeviceError('microphone', error);
    }
  }

  private async stopInputs(av: AudioVideoFacade | null): Promise<void> {
    this.analyser?.removeOriginalInputs?.();
    this.analyser = null;
    if (this.previewElement) {
      try {
        av?.stopVideoPreviewForVideoInput(this.previewElement);
      } catch {
        // Already stopped.
      }
    }
    await av?.stopVideoInput().catch(() => undefined);
    await av?.stopAudioInput().catch(() => undefined);
    this.videoInputActive = false;
    this.audioInputActive = false;
  }

  /* ---------------------------------------------------------------------- */
  /* Readiness (D-CW-21, OPS-30)                                             */
  /* ---------------------------------------------------------------------- */

  async checkReadiness(): Promise<void> {
    const { status } = this.snapshot.session;
    if (status === 'checking' || this.isActive) return;
    const { canSendAudio: audio, canSendVideo: video } = this.devices;
    this.update({
      session: { status: 'checking' },
      readiness: { status: 'running', camera: video ? 'pending' : 'skipped', microphone: audio ? 'pending' : 'skipped', network: 'pending' },
    });
    try {
      const sdk = await this.ensureSdk();
      const preview = await this.ensurePreviewSession();
      await this.stopInputs(preview.audioVideo);
      const checker = (this.checker ??= new sdk.DefaultMeetingReadinessChecker(this.logger!, preview));
      await this.refreshDevices();

      if (audio) {
        const feedback = await checker.checkAudioInput(this.audioInput());
        this.recordCheck('microphone', feedback === sdk.CheckAudioInputFeedback.Succeeded ? 'passed' : feedback === sdk.CheckAudioInputFeedback.PermissionDenied ? 'denied' : 'failed');
      }
      if (video) {
        const feedback = await checker.checkVideoInput(this.devices.selected.camera ?? {});
        this.recordCheck('camera', feedback === sdk.CheckVideoInputFeedback.Succeeded ? 'passed' : feedback === sdk.CheckVideoInputFeedback.PermissionDenied ? 'denied' : 'failed');
      }
      // Labels appear once a permission was granted.
      await this.refreshDevices();
      const network = await this.checkNetwork();
      this.update({ readiness: { status: 'done', network }, session: { status: 'idle' } });
      await this.startPreviewMedia();
    } catch {
      // The SDK could not load (offline, CSP): every pending check fails visibly.
      const failed = (result: DeviceCheckResult): DeviceCheckResult => (result === 'pending' ? 'failed' : result);
      const readiness: ReadinessState = this.snapshot.readiness;
      this.update({
        readiness: {
          status: 'done',
          camera: failed(readiness.camera),
          microphone: failed(readiness.microphone),
          network: readiness.network === 'pending' ? 'offline' : readiness.network,
        },
        session: { status: 'idle' },
      });
    }
  }

  private recordCheck(kind: 'camera' | 'microphone', result: 'passed' | 'denied' | 'failed'): void {
    const permission: MediaPermission = result === 'passed' ? 'granted' : result === 'denied' ? 'denied' : 'error';
    this.update({
      readiness: { [kind]: result },
      devices: { permissions: { ...this.devices.permissions, [kind]: permission } },
    });
    if (result !== 'passed') {
      this.emit(kind === 'camera' ? 'videoInputFailed' : 'audioInputFailed', result === 'denied' ? { deviceError: 'NotAllowedError' } : {});
    }
  }

  private async checkNetwork(): Promise<NetworkCheckResult> {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
    try {
      const rtt = await (this.options.probeNetwork ?? defaultNetworkProbe)();
      return classifyQuality({ rtt });
    } catch {
      return 'offline';
    }
  }

  private async startPreviewMedia(): Promise<void> {
    const av = this.av;
    if (!av || this.isActive) return;
    if (this.devices.canSendAudio && this.devices.permissions.microphone === 'granted') {
      await this.startAudioInputSafely();
      if (this.audioInputActive) this.refreshAnalyser(av);
    }
    if (this.devices.canSendVideo && this.devices.permissions.camera === 'granted' && !this.devices.cameraOff) {
      if (readDevicePreferences(this.store).blur && !this.transformDevice) await this.applyBlur(true);
      await this.startVideoInputSafely();
      this.attachPreview();
    }
  }

  async testSpeaker(): Promise<void> {
    this.speakerHeard = null;
    this.earlySpeakerAnswer = null;
    this.update({ readiness: { speaker: 'playing' } });
    try {
      const sdk = await this.ensureSdk();
      const preview = await this.ensurePreviewSession();
      const checker = (this.checker ??= new sdk.DefaultMeetingReadinessChecker(this.logger!, preview));
      const feedback = await checker.checkAudioOutput(this.devices.selected.speaker ?? 'default', () => {
        return new Promise<boolean>((resolve) => {
          this.speakerAnswer = (heard) => {
            this.speakerHeard = heard;
            resolve(heard);
          };
          if (this.earlySpeakerAnswer !== null) this.speakerAnswer(this.earlySpeakerAnswer);
        });
      });
      const speaker =
        feedback === sdk.CheckAudioOutputFeedback.Succeeded ? 'heard' : this.speakerHeard === false ? 'not_heard' : 'failed';
      this.update({ readiness: { speaker } });
    } catch {
      // The SDK did not load or the tone could not play: the screen says so instead of waiting forever.
      this.update({ readiness: { speaker: 'failed' } });
    } finally {
      this.speakerAnswer = null;
    }
  }

  confirmSpeaker(heard: boolean): void {
    if (this.speakerAnswer) this.speakerAnswer(heard);
    else if (this.snapshot.readiness.speaker === 'playing') this.earlySpeakerAnswer = heard;
  }

  /* ---------------------------------------------------------------------- */
  /* Join, leave, reconnect                                                  */
  /* ---------------------------------------------------------------------- */

  async join(response: CallJoinResponse): Promise<void> {
    if (this.isActive || this.snapshot.session.status === 'checking') return;
    const role = response.role;
    this.attendeeId = response.attendee.AttendeeId;
    this.hasStarted = false;
    this.joinStartedAt = Date.now();
    this.samples = [];
    this.poorIntervals = 0;
    this.recoveringSince = null;
    this.update({
      session: {
        status: 'joining',
        failure: null,
        endReason: null,
        role,
        format: response.format,
        startsAt: response.startsAt,
        endsAt: response.endsAt,
        reconnectStartedAt: null,
      },
      devices: {
        canSendVideo: canSendVideo(role),
        canSendAudio: canSendAudio(role),
        cameraOff: canSendVideo(role) ? this.devices.cameraOff : true,
      },
      media: { muted: !canSendAudio(role), cameraOn: false, sharingScreen: false },
      quality: INITIAL_QUALITY,
      tiles: EMPTY_TILES,
    });
    try {
      const sdk = await this.ensureSdk();
      // Release the pre-join preview: the session takes over the same devices.
      this.analyser?.removeOriginalInputs?.();
      this.analyser = null;
      if (this.previewElement && this.previewSession) {
        try {
          this.previewSession.audioVideo.stopVideoPreviewForVideoInput(this.previewElement);
        } catch {
          // Already stopped.
        }
      }

      const configuration = new sdk.MeetingSessionConfiguration({ Meeting: response.meeting }, { Attendee: response.attendee });
      if (configuration.urls) configuration.urls.eventIngestionURL = null;
      configuration.reconnectTimeoutMs = RECONNECT_TIMEOUT_MS;
      const eventController = new sdk.DefaultEventController(configuration, this.logger!, new sdk.NoOpEventReporter());
      this.session = new sdk.DefaultMeetingSession(configuration, this.logger!, this.ensureDeviceController(sdk), eventController);
      const av = this.session.audioVideo;
      av.addObserver(this.observer);
      av.addContentShareObserver(this.contentShareObserver);
      av.realtimeSubscribeToMuteAndUnmuteLocalAudio(this.onMuteChanged);

      if (this.devices.canSendAudio && this.devices.permissions.microphone !== 'denied') await this.startAudioInputSafely();
      this.videoAtStart = this.devices.canSendVideo && !this.devices.cameraOff && this.devices.permissions.camera !== 'denied';
      if (this.videoAtStart) {
        if (readDevicePreferences(this.store).blur && !this.transformDevice) await this.applyBlur(true);
        await this.startVideoInputSafely();
      }
      if (this.audioElement) await av.bindAudioElement(this.audioElement).catch(() => undefined);
      if (this.devices.selected.speaker) await av.chooseAudioOutput(this.devices.selected.speaker).catch(() => undefined);
      av.start();
    } catch (error) {
      this.update({ session: { status: 'failed', failure: 'join_failed' } });
      this.emit('meetingStartFailed', { durationMs: this.since(this.joinStartedAt) });
      await this.teardownSession();
      void error;
    }
  }

  async leave(): Promise<void> {
    if (this.isActive) {
      this.update({ session: { status: 'left', endReason: 'left', reconnectStartedAt: null } });
      await this.teardownSession();
    } else {
      await this.stopInputs(this.av);
    }
  }

  private readonly observer: AudioVideoObserver = {
    audioVideoDidStartConnecting: (reconnecting: boolean) => {
      if (reconnecting) this.onReconnecting();
    },
    audioVideoDidStart: () => this.onStarted(),
    audioVideoDidStop: (status: MeetingSessionStatus) => this.onStopped(status),
    videoTileDidUpdate: (tile: VideoTileState) => this.onTileUpdated(tile),
    videoTileWasRemoved: (tileId: number) => this.onTileRemoved(tileId),
    metricsDidReceive: (report: ClientMetricReport) => this.onMetrics(report),
  };

  private readonly contentShareObserver: ContentShareObserver = {
    contentShareDidStart: () => this.update({ media: { sharingScreen: true } }),
    contentShareDidStop: () => this.update({ media: { sharingScreen: false } }),
  };

  private readonly onMuteChanged = (muted: boolean): void => {
    if (muted !== this.snapshot.media.muted) this.update({ media: { muted } });
  };

  private onStarted(): void {
    const { status, reconnectStartedAt } = this.snapshot.session;
    const av = this.session?.audioVideo;
    if (!av) return;
    this.clearReconnectTimer();
    if (status === 'joining') {
      this.hasStarted = true;
      this.emit('meetingStartSucceeded', { durationMs: this.since(this.joinStartedAt) });
      this.update({ session: { status: 'connected', reconnectStartedAt: null } });
      if (this.videoAtStart && this.videoInputActive) {
        av.startLocalVideoTile();
        this.update({ media: { cameraOn: true } });
      }
      this.statsTimer ??= setInterval(() => this.onStatsInterval(), QUALITY_AGGREGATION_INTERVAL_MS);
    } else if (status === 'reconnecting') {
      this.emit('meetingReconnected', { durationMs: this.since(reconnectStartedAt ?? Date.now()) });
      this.update({ session: { status: 'connected', reconnectStartedAt: null } });
    }
  }

  private onReconnecting(): void {
    if (this.snapshot.session.status !== 'connected') return;
    this.update({ session: { status: 'reconnecting', reconnectStartedAt: Date.now() } });
    this.emit('signalingDropped', {});
    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => void this.onReconnectTimeout(), RECONNECT_TIMEOUT_MS);
  }

  private async onReconnectTimeout(): Promise<void> {
    this.reconnectTimer = null;
    if (this.snapshot.session.status !== 'reconnecting') return;
    this.update({ session: { status: 'failed', failure: 'reconnect_timeout', reconnectStartedAt: null } });
    this.emit('meetingFailed', {});
    await this.teardownSession();
  }

  private onStopped(status: MeetingSessionStatus): void {
    const current = this.snapshot.session.status;
    if (!ACTIVE_STATUSES.has(current) || !this.sdk) return;
    const codes = this.sdk.MeetingSessionStatusCode;
    const code = status.statusCode();
    if (code === codes.MeetingEnded) {
      this.update({ session: { status: 'left', endReason: 'ended', reconnectStartedAt: null } });
    } else if (code === codes.AudioAttendeeRemoved) {
      this.update({ session: { status: 'left', endReason: 'removed', reconnectStartedAt: null } });
    } else if (code === codes.AudioJoinedFromAnotherDevice) {
      this.update({ session: { status: 'left', endReason: 'joined_elsewhere', reconnectStartedAt: null } });
    } else if (status.isFailure()) {
      const failure = this.hasStarted ? 'connection_failed' : 'join_failed';
      this.update({ session: { status: 'failed', failure, reconnectStartedAt: null } });
      if (this.hasStarted) this.emit('meetingFailed', {});
      else this.emit('meetingStartFailed', { durationMs: this.since(this.joinStartedAt) });
    } else {
      this.update({ session: { status: 'left', endReason: 'left', reconnectStartedAt: null } });
    }
    void this.teardownSession();
  }

  private async teardownSession(): Promise<void> {
    this.clearReconnectTimer();
    if (this.statsTimer) clearInterval(this.statsTimer);
    this.statsTimer = null;
    const session = this.session;
    this.session = null;
    if (session) {
      const av = session.audioVideo;
      av.removeObserver(this.observer);
      av.removeContentShareObserver(this.contentShareObserver);
      av.realtimeUnsubscribeToMuteAndUnmuteLocalAudio(this.onMuteChanged);
      try {
        if (this.snapshot.media.sharingScreen) av.stopContentShare();
        av.stopLocalVideoTile();
        av.stop();
      } catch {
        // The SDK already stopped this session.
      }
      await this.stopInputs(av);
      await session.destroy().catch(() => undefined);
    }
    this.update({
      media: { cameraOn: false, sharingScreen: false, muted: !this.devices.canSendAudio },
      quality: INITIAL_QUALITY,
      tiles: EMPTY_TILES,
    });
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  /* ---------------------------------------------------------------------- */
  /* In-call media                                                           */
  /* ---------------------------------------------------------------------- */

  setMuted(muted: boolean): void {
    const av = this.session?.audioVideo;
    if (!av || !this.devices.canSendAudio) return;
    if (muted) av.realtimeMuteLocalAudio();
    else av.realtimeUnmuteLocalAudio();
    this.update({ media: { muted } });
  }

  /**
   * Turns the microphone path on or off for a participant whose capability
   * changed: a webinar attendee given the floor, then the floor taken back
   * (D-CW-15, T-CW-2.3). Audio only: video is never touched, so an attendee
   * can never send video (D-CW-35). The microphone starts muted; the
   * attendee unmutes to speak.
   */
  async setAudioCapability(enabled: boolean): Promise<void> {
    if (enabled === this.devices.canSendAudio) return;
    const av = this.session?.audioVideo;
    if (enabled) {
      this.update({ devices: { canSendAudio: true }, media: { muted: true } });
      if (!av || !this.isActive) return;
      av.realtimeMuteLocalAudio();
      await this.startAudioInputSafely();
      return;
    }
    av?.realtimeMuteLocalAudio();
    if (this.audioInputActive) await av?.stopAudioInput().catch(() => undefined);
    this.audioInputActive = false;
    this.update({ devices: { canSendAudio: false }, media: { muted: true } });
  }

  async setCameraOn(on: boolean): Promise<void> {
    if (!this.devices.canSendVideo) return;
    const av = this.session?.audioVideo;
    if (!av || !this.isActive) {
      await this.setCameraOff(!on);
      return;
    }
    if (on) {
      await this.startVideoInputSafely();
      if (!this.videoInputActive) return;
      av.startLocalVideoTile();
      this.poorIntervals = 0;
      this.update({ media: { cameraOn: true }, quality: { videoPaused: false } });
    } else {
      av.stopLocalVideoTile();
      await av.stopVideoInput().catch(() => undefined);
      this.videoInputActive = false;
      this.update({ media: { cameraOn: false }, quality: { videoPaused: false, lowResolution: false } });
    }
  }

  async setScreenShare(on: boolean): Promise<void> {
    const av = this.session?.audioVideo;
    if (!av || !SCREEN_SHARE_ROLES.has(this.role)) return;
    if (on) {
      try {
        await av.startContentShareFromScreenCapture();
      } catch {
        // The person closed the screen picker.
      }
    } else {
      av.stopContentShare();
    }
  }

  bindVideoTile(tileId: number, element: HTMLVideoElement): void {
    this.session?.audioVideo.bindVideoElement(tileId, element);
  }

  unbindVideoTile(tileId: number): void {
    try {
      this.session?.audioVideo.unbindVideoElement(tileId);
    } catch {
      // The tile was already removed.
    }
  }

  bindAudio(element: HTMLAudioElement | null): void {
    this.audioElement = element;
    const av = this.session?.audioVideo;
    if (!av) return;
    if (element) void av.bindAudioElement(element).catch(() => undefined);
    else av.unbindAudioElement();
  }

  private onTileUpdated(tile: VideoTileState): void {
    const tileId = tile.tileId;
    if (tileId === null || tileId === undefined) return;
    const tiles = this.snapshot.tiles;
    if (tile.localTile) {
      if (tiles.localTileId !== tileId) this.update({ tiles: { localTileId: tileId } });
      return;
    }
    if (tile.isContent) {
      // The expert's own share comes back as `<attendeeId>#content`; it is not shown to them.
      const own = !!this.attendeeId && tile.boundAttendeeId?.startsWith(`${this.attendeeId}#`);
      if (!own && tiles.contentTileId !== tileId) this.update({ tiles: { contentTileId: tileId } });
      return;
    }
    const entry = { tileId, attendeeId: tile.boundAttendeeId ?? null, paused: !!tile.paused };
    const existing = tiles.remote.find((remote) => remote.tileId === tileId);
    if (existing && existing.attendeeId === entry.attendeeId && existing.paused === entry.paused) return;
    const remote = existing ? tiles.remote.map((r) => (r.tileId === tileId ? entry : r)) : [...tiles.remote, entry];
    this.update({ tiles: { remote } });
  }

  private onTileRemoved(tileId: number): void {
    const tiles = this.snapshot.tiles;
    this.update({
      tiles: {
        localTileId: tiles.localTileId === tileId ? null : tiles.localTileId,
        contentTileId: tiles.contentTileId === tileId ? null : tiles.contentTileId,
        remote: tiles.remote.filter((remote) => remote.tileId !== tileId),
      },
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Quality and degraded mode (guidelines 11.6)                             */
  /* ---------------------------------------------------------------------- */

  private get sendingVideo(): boolean {
    return this.snapshot.media.cameraOn && !this.snapshot.quality.videoPaused;
  }

  private onMetrics(report: ClientMetricReport): void {
    const observed = report.getObservableMetrics() as Record<string, unknown>;
    // Both loss metrics are percentages in SDK 3.x: received (downstream) and sent (upstream) audio.
    const downstreamLoss = percentToFraction(finite(observed.audioPacketsReceivedFractionLoss));
    const upstreamLoss = percentToFraction(finite(observed.audioPacketLossPercent));
    const rtt = finite(observed.currentRoundTripTimeMs) ?? finite(observed.audioUpstreamRoundTripTimeMs);
    // Without outgoing video the bandwidth estimate stays low by design; it only counts while video is sent.
    const outgoingBitrate = this.sendingVideo ? finite(observed.availableOutgoingBitrate) : undefined;
    const losses = [downstreamLoss, upstreamLoss].filter((value): value is number => value !== undefined);
    const sample = {
      // The badge and the API get the worse direction.
      metrics: compact({
        rtt,
        jitter: finite(observed.audioUpstreamJitterMs) ?? finite(observed.audioDownstreamJitterMs),
        packetLoss: losses.length ? Math.max(...losses) : undefined,
        outgoingBitrate,
      }),
      // Pausing outgoing video only helps the upstream path, so degraded mode reads upstream loss where the SDK has it.
      outgoing: compact({
        rtt,
        jitter: finite(observed.audioUpstreamJitterMs),
        packetLoss: upstreamLoss ?? downstreamLoss,
        outgoingBitrate,
      }),
    };
    this.samples.push(sample);
    if (this.samples.length > MAX_BUFFERED_SAMPLES) this.samples.shift();
    if (this.snapshot.quality.videoPaused) this.checkRecovery(sample.outgoing, classifyQuality(sample.metrics));
  }

  private onStatsInterval(): void {
    if (this.snapshot.session.status !== 'connected') return;
    const samples = this.samples.splice(0);
    if (!samples.length) return;
    const metrics = aggregateMetrics(samples.map((sample) => sample.metrics));
    const level = classifyQuality(metrics);
    const outgoingLevel = classifyQuality(aggregateMetrics(samples.map((sample) => sample.outgoing)));
    this.emit('connectionStats', { metrics });
    this.update({ quality: { level, metrics } });
    void this.applyDegradedMode(outgoingLevel);
  }

  private async applyDegradedMode(level: QualityState['level']): Promise<void> {
    const av = this.session?.audioVideo;
    if (!av) return;
    const quality = this.snapshot.quality;
    if (level !== 'poor') {
      this.poorIntervals = 0;
      if (quality.lowResolution && !quality.videoPaused) {
        await this.setOutgoingQuality(DEFAULT_VIDEO_QUALITY);
        this.update({ quality: { lowResolution: false } });
      }
      return;
    }
    this.poorIntervals += 1;
    if (!this.sendingVideo) return;
    if (!quality.lowResolution) {
      await this.setOutgoingQuality(DEGRADED_VIDEO_QUALITY);
      this.update({ quality: { lowResolution: true } });
    }
    if (this.poorIntervals >= POOR_INTERVALS_BEFORE_VIDEO_PAUSE) {
      av.stopLocalVideoTile();
      this.recoveringSince = null;
      this.update({ quality: { videoPaused: true } });
    }
  }

  private checkRecovery(outgoing: CallQualityMetrics, overall: QualityState['level']): void {
    const level = classifyQuality(outgoing);
    if (level === 'poor') {
      this.recoveringSince = null;
      return;
    }
    const now = Date.now();
    this.recoveringSince ??= now;
    if (now - this.recoveringSince < QUALITY_RECOVERY_MS) return;
    const av = this.session?.audioVideo;
    if (!av) return;
    this.recoveringSince = null;
    this.poorIntervals = 0;
    void this.setOutgoingQuality(DEFAULT_VIDEO_QUALITY);
    av.startLocalVideoTile();
    this.update({ quality: { videoPaused: false, lowResolution: false, level: overall } });
  }

  private async setOutgoingQuality(quality: { width: number; height: number; frameRate: number }): Promise<void> {
    const av = this.session?.audioVideo;
    if (!av) return;
    av.chooseVideoInputQuality(quality.width, quality.height, quality.frameRate);
    // A new constraint applies when the input restarts.
    if (this.videoInputActive) await av.startVideoInput(this.videoInput()).catch(() => undefined);
  }

  /* ---------------------------------------------------------------------- */
  /* Client events (D-CW-13)                                                 */
  /* ---------------------------------------------------------------------- */

  private since(start: number): number {
    return Math.max(0, Math.round(Date.now() - start));
  }

  private emit(eventName: ClientEventName, extra: Omit<ClientEventRequest, 'eventName' | 'browser' | 'os'>): void {
    const parsed = ClientEventRequestSchema.safeParse({ eventName, ...extra, browser: this.browser, os: this.os });
    if (!parsed.success) return;
    this.events.push(parsed.data);
    if (this.events.length > MAX_BUFFERED_EVENTS) this.events.shift();
    this.options.onClientEvent?.(parsed.data);
  }

  getClientEvents(): readonly ClientEventRequest[] {
    return [...this.events];
  }

  drainClientEvents(): ClientEventRequest[] {
    return this.events.splice(0);
  }

  /**
   * Leaves, releases the camera and microphone and drops every SDK object.
   * The controller stays usable: a later call re-creates what it needs, so a
   * React StrictMode effect replay (destroy, then use again) is harmless.
   */
  async destroy(): Promise<void> {
    await this.leave();
    await this.stopInputs(this.av);
    this.deviceController?.removeDeviceChangeObserver(this.deviceChangeObserver);
    this.deviceController = null;
    this.checker = null;
    await this.transformDevice?.stop().catch(() => undefined);
    this.transformDevice = null;
    await this.previewSession?.destroy().catch(() => undefined);
    this.previewSession = null;
    this.update({
      readiness: { status: 'idle', camera: 'pending', microphone: 'pending', network: 'pending', speaker: 'idle' },
      devices: { blur: { ...this.devices.blur, enabled: false, loading: false } },
    });
  }
}
