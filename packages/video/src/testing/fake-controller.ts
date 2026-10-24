/**
 * An in-memory `CallSessionControllerApi` for stories, unit tests and the
 * apps' sample mode. It never loads the Chime SDK and never joins a meeting;
 * the `simulate` helpers script the states a real meeting would produce.
 * Video tiles and the self-view are filled with an abstract animated
 * pattern drawn on the theme tokens where the browser supports
 * `canvas.captureStream` (not in jsdom).
 */
import type { CallFormat, CallJoinResponse, CallParticipantRole, CallQualityMetrics, ClientEventRequest } from '@nestself/contracts';
import { VIDEO_STORAGE_KEYS, createMemoryPreferenceStore, readDevicePreferences } from '../preferences';
import type { PreferenceStore } from '../preferences';
import type { ConnectionQuality } from '../quality-thresholds';
import type {
  CallSessionControllerApi,
  CallSessionSnapshot,
  CallSessionStatus,
  DeviceKind,
  DeviceOption,
  ReadinessState,
} from '../types';

export interface FakeCallSessionControllerOptions {
  role?: CallParticipantRole;
  format?: CallFormat;
  store?: PreferenceStore;
  /** Result of `checkReadiness`. Defaults to everything passing on a good network. */
  readiness?: Partial<Pick<ReadinessState, 'camera' | 'microphone' | 'network'>>;
  /** Background blur support. Defaults to supported. */
  blurSupported?: boolean;
  /** Delay of asynchronous steps in milliseconds (0 in tests). */
  delayMs?: number;
  cameras?: DeviceOption[];
  microphones?: DeviceOption[];
  speakers?: DeviceOption[];
}

const SAMPLE_CAMERAS: DeviceOption[] = [
  { deviceId: 'sample-camera-1', label: 'Built-in camera (sample)' },
  { deviceId: 'sample-camera-2', label: 'USB camera (sample)' },
];
const SAMPLE_MICROPHONES: DeviceOption[] = [
  { deviceId: 'sample-mic-1', label: 'Built-in microphone (sample)' },
  { deviceId: 'sample-mic-2', label: 'Headset microphone (sample)' },
];
const SAMPLE_SPEAKERS: DeviceOption[] = [{ deviceId: 'sample-speaker-1', label: 'Built-in speakers (sample)' }];

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type Patch = { [K in keyof CallSessionSnapshot]?: Partial<CallSessionSnapshot[K]> };

export class FakeCallSessionController implements CallSessionControllerApi {
  private snapshot: CallSessionSnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly options: FakeCallSessionControllerOptions;
  private readonly store: PreferenceStore;
  private readonly streams = new Map<HTMLVideoElement, () => void>();
  private events: ClientEventRequest[] = [];
  private nextTileId = 10;

  constructor(options: FakeCallSessionControllerOptions = {}) {
    this.options = options;
    this.store = options.store ?? createMemoryPreferenceStore();
    const role = options.role ?? 'employee';
    const prefs = readDevicePreferences(this.store);
    const video = role !== 'attendee';
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
        cameraOff: video ? prefs.cameraOff : true,
        blur: { supported: null, enabled: false, loading: false },
        canSendVideo: video,
        canSendAudio: video,
      },
      media: { muted: !video, cameraOn: false, sharingScreen: false },
      quality: { level: 'good', metrics: null, lowResolution: false, videoPaused: false },
      tiles: { localTileId: null, contentTileId: null, remote: [] },
    };
  }

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

  private pause(): Promise<void> {
    return wait(this.options.delayMs ?? 0);
  }

  async checkReadiness(): Promise<void> {
    const { canSendAudio, canSendVideo } = this.snapshot.devices;
    this.update({
      session: { status: 'checking' },
      readiness: { status: 'running', camera: canSendVideo ? 'pending' : 'skipped', microphone: canSendAudio ? 'pending' : 'skipped', network: 'pending' },
    });
    await this.pause();
    await this.refreshDevices();
    const camera = canSendVideo ? (this.options.readiness?.camera ?? 'passed') : 'skipped';
    const microphone = canSendAudio ? (this.options.readiness?.microphone ?? 'passed') : 'skipped';
    const permission = (result: string) => (result === 'passed' ? 'granted' : result === 'denied' ? 'denied' : result === 'skipped' ? 'unknown' : 'error');
    this.update({
      session: { status: 'idle' },
      readiness: { status: 'done', camera, microphone, network: this.options.readiness?.network ?? 'good' },
      devices: { permissions: { camera: permission(camera), microphone: permission(microphone) } },
    });
  }

  async testSpeaker(): Promise<void> {
    this.update({ readiness: { speaker: 'playing' } });
  }

  confirmSpeaker(heard: boolean): void {
    this.update({ readiness: { speaker: heard ? 'heard' : 'not_heard' } });
  }

  async refreshDevices(): Promise<void> {
    const { canSendVideo, canSendAudio } = this.snapshot.devices;
    const cameras = canSendVideo ? (this.options.cameras ?? SAMPLE_CAMERAS) : [];
    const microphones = canSendAudio ? (this.options.microphones ?? SAMPLE_MICROPHONES) : [];
    const speakers = this.options.speakers ?? SAMPLE_SPEAKERS;
    const pick = (list: DeviceOption[], key: (typeof VIDEO_STORAGE_KEYS)[DeviceKind]) => {
      const stored = this.store.get(key);
      return list.some((device) => device.deviceId === stored) ? stored : (list[0]?.deviceId ?? null);
    };
    this.update({
      devices: {
        cameras,
        microphones,
        speakers,
        selected: {
          camera: pick(cameras, VIDEO_STORAGE_KEYS.camera),
          microphone: pick(microphones, VIDEO_STORAGE_KEYS.microphone),
          speaker: pick(speakers, VIDEO_STORAGE_KEYS.speaker),
        },
      },
    });
  }

  async selectDevice(kind: DeviceKind, deviceId: string): Promise<void> {
    this.store.set(VIDEO_STORAGE_KEYS[kind], deviceId);
    this.update({ devices: { selected: { ...this.snapshot.devices.selected, [kind]: deviceId } } });
  }

  async setCameraOff(off: boolean): Promise<void> {
    if (!this.snapshot.devices.canSendVideo) return;
    this.store.set(VIDEO_STORAGE_KEYS.cameraOff, String(off));
    this.update({ devices: { cameraOff: off } });
  }

  async setBlur(enabled: boolean): Promise<void> {
    if (!this.snapshot.devices.canSendVideo) return;
    this.store.set(VIDEO_STORAGE_KEYS.blur, String(enabled));
    if (!enabled) {
      this.update({ devices: { blur: { ...this.snapshot.devices.blur, enabled: false } } });
      return;
    }
    this.update({ devices: { blur: { ...this.snapshot.devices.blur, loading: true } } });
    await this.pause();
    const supported = this.options.blurSupported ?? true;
    this.update({ devices: { blur: { supported, enabled: supported, loading: false } } });
  }

  bindPreview(element: HTMLVideoElement | null): void {
    if (element) this.attachPattern(element, 0);
  }

  getMicrophoneLevel(): number {
    if (this.snapshot.media.muted && this.snapshot.session.status === 'connected') return 0;
    return 0.35 + 0.3 * Math.abs(Math.sin(Date.now() / 260));
  }

  async join(response?: CallJoinResponse): Promise<void> {
    const role = response?.role ?? this.snapshot.session.role;
    const video = role !== 'attendee';
    this.update({
      session: {
        status: 'joining',
        failure: null,
        endReason: null,
        role,
        startsAt: response?.startsAt ?? this.snapshot.session.startsAt,
        endsAt: response?.endsAt ?? this.snapshot.session.endsAt,
      },
    });
    await this.pause();
    const cameraOn = video && !this.snapshot.devices.cameraOff;
    this.update({
      session: { status: 'connected' },
      media: { muted: !video, cameraOn, sharingScreen: false },
      tiles: { localTileId: cameraOn ? 1 : null, contentTileId: null, remote: [] },
    });
    this.record('meetingStartSucceeded');
  }

  async leave(): Promise<void> {
    this.update({
      session: { status: 'left', endReason: 'left', reconnectStartedAt: null },
      media: { cameraOn: false, sharingScreen: false },
      tiles: { localTileId: null, contentTileId: null, remote: [] },
    });
  }

  setMuted(muted: boolean): void {
    if (!this.snapshot.devices.canSendAudio) return;
    this.update({ media: { muted } });
  }

  async setAudioCapability(enabled: boolean): Promise<void> {
    this.update({ devices: { canSendAudio: enabled }, media: { muted: true } });
  }

  async setCameraOn(on: boolean): Promise<void> {
    if (!this.snapshot.devices.canSendVideo) return;
    this.update({
      media: { cameraOn: on },
      tiles: { localTileId: on ? 1 : null },
      quality: { videoPaused: false },
    });
  }

  async setScreenShare(on: boolean): Promise<void> {
    const role = this.snapshot.session.role;
    if (!['expert', 'presenter', 'moderator', 'facilitator'].includes(role)) return;
    this.update({ media: { sharingScreen: on } });
  }

  bindVideoTile(tileId: number, element: HTMLVideoElement): void {
    this.attachPattern(element, tileId);
  }

  unbindVideoTile(): void {
    // Patterns stop when their element leaves the document.
  }

  bindAudio(): void {
    // No remote audio in a fake meeting.
  }

  getClientEvents(): readonly ClientEventRequest[] {
    return [...this.events];
  }

  drainClientEvents(): ClientEventRequest[] {
    return this.events.splice(0);
  }

  async destroy(): Promise<void> {
    for (const stop of this.streams.values()) stop();
    this.streams.clear();
  }

  private record(eventName: ClientEventRequest['eventName'], metrics?: CallQualityMetrics): void {
    this.events.push({ eventName, ...(metrics ? { metrics } : {}), browser: 'other', os: 'other' });
  }

  /** Scripted states for stories and tests. */
  readonly simulate = {
    status: (status: CallSessionStatus, extra: Partial<CallSessionSnapshot['session']> = {}) =>
      this.update({ session: { status, ...extra } }),
    connected: (window?: { startsAt: string; endsAt: string }) => {
      const video = this.snapshot.devices.canSendVideo && !this.snapshot.devices.cameraOff;
      this.update({
        session: { status: 'connected', ...(window ?? {}) },
        media: { muted: !this.snapshot.devices.canSendAudio, cameraOn: video },
        tiles: { localTileId: video ? 1 : null },
      });
    },
    remoteJoined: (attendeeId = 'sample-attendee') => {
      const tileId = this.nextTileId++;
      this.update({ tiles: { remote: [...this.snapshot.tiles.remote, { tileId, attendeeId, paused: false }] } });
      return tileId;
    },
    remoteLeft: () => this.update({ tiles: { remote: [] } }),
    contentShared: (shared: boolean) => this.update({ tiles: { contentTileId: shared ? this.nextTileId++ : null } }),
    quality: (level: ConnectionQuality, extra: { videoPaused?: boolean; lowResolution?: boolean } = {}) =>
      this.update({ quality: { level, ...extra } }),
    reconnecting: () => this.update({ session: { status: 'reconnecting', reconnectStartedAt: Date.now() } }),
    reconnectFailed: () => this.update({ session: { status: 'failed', failure: 'reconnect_timeout', reconnectStartedAt: null } }),
    ended: () => this.update({ session: { status: 'left', endReason: 'ended' } }),
  };

  /** Draws a slow abstract gradient on the theme tokens into the video element. */
  private attachPattern(element: HTMLVideoElement, seed: number): void {
    if (typeof document === 'undefined') return;
    this.streams.get(element)?.();
    const canvas = document.createElement('canvas');
    if (typeof canvas.captureStream !== 'function') return;
    canvas.width = 640;
    canvas.height = 360;
    const context = canvas.getContext('2d');
    if (!context) return;
    const styles = getComputedStyle(document.documentElement);
    const colour = (name: string) => styles.getPropertyValue(name).trim() || 'gray';
    const [a, b] = seed === 0 ? [colour('--color-accent-soft'), colour('--color-primary')] : [colour('--color-primary'), colour('--color-accent')];
    let frame = 0;
    const draw = () => {
      const t = frame++ / 90;
      const gradient = context.createLinearGradient(0, 0, canvas.width * (1 + Math.sin(t) * 0.5), canvas.height);
      gradient.addColorStop(0, a);
      gradient.addColorStop(1, b);
      context.fillStyle = gradient;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.globalAlpha = 0.25;
      context.fillStyle = colour('--color-surface');
      context.beginPath();
      context.arc(canvas.width / 2 + Math.cos(t) * 60, canvas.height / 2, 70, 0, Math.PI * 2);
      context.fill();
      context.globalAlpha = 1;
    };
    draw();
    const timer = setInterval(() => {
      if (!element.isConnected) {
        clearInterval(timer);
        return;
      }
      draw();
    }, 1000 / 15);
    element.srcObject = canvas.captureStream(15);
    element.muted = true;
    void element.play?.().catch(() => undefined);
    this.streams.set(element, () => clearInterval(timer));
  }
}
