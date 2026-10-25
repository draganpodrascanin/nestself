import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CallJoinResponse } from '@nestself/contracts';
import { ClientEventRequestSchema } from '@nestself/contracts';
import { CallSessionController, loadChimeSdk } from './controller';
import { VIDEO_STORAGE_KEYS, createMemoryPreferenceStore } from './preferences';
import type { PreferenceStore } from './preferences';

/* ------------------------------------------------------------------------ */
/* amazon-chime-sdk-js mock                                                  */
/* ------------------------------------------------------------------------ */

const h = vi.hoisted(() => {
  type Observer = Record<string, ((...args: unknown[]) => void) | undefined>;

  const state = {
    promotionFails: false,
    sessions: [] as Array<{ configuration: Record<string, unknown>; eventController: { reporter: unknown }; audioVideo: ReturnType<typeof createAudioVideo>; destroy: () => Promise<void> }>,
    eventControllers: [] as Array<{ reporter: unknown }>,
    audioInputFeedback: 0,
    videoInputFeedback: 0,
    blurSupported: true,
    speakerError: false,
    /** `typeof globalThis.global` when the SDK module evaluated (DEF-1). */
    globalAtEvaluation: 'not evaluated' as string,
    transformDevices: [] as Array<{ device: unknown; stop: () => Promise<void> }>,
    cameras: [
      { deviceId: 'cam-1', label: 'Built-in camera', kind: 'videoinput', groupId: 'g1' },
      { deviceId: 'cam-2', label: 'USB camera', kind: 'videoinput', groupId: 'g2' },
    ],
    microphones: [
      { deviceId: 'mic-1', label: 'Built-in microphone', kind: 'audioinput', groupId: 'g1' },
      { deviceId: 'mic-2', label: 'Headset microphone', kind: 'audioinput', groupId: 'g3' },
    ],
    speakers: [{ deviceId: 'spk-1', label: 'Built-in speakers', kind: 'audiooutput', groupId: 'g1' }],
  };

  function createAudioVideo() {
    const observers = new Set<Observer>();
    const contentObservers = new Set<Observer>();
    return {
      observers,
      contentObservers,
      emit(name: string, ...args: unknown[]) {
        for (const o of observers) o[name]?.(...args);
      },
      emitContent(name: string) {
        for (const o of contentObservers) o[name]?.();
      },
      addObserver: vi.fn((o: Observer) => void observers.add(o)),
      removeObserver: vi.fn((o: Observer) => void observers.delete(o)),
      addContentShareObserver: vi.fn((o: Observer) => void contentObservers.add(o)),
      removeContentShareObserver: vi.fn((o: Observer) => void contentObservers.delete(o)),
      addDeviceChangeObserver: vi.fn(),
      removeDeviceChangeObserver: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      listVideoInputDevices: vi.fn(async () => state.cameras),
      listAudioInputDevices: vi.fn(async () => state.microphones),
      listAudioOutputDevices: vi.fn(async () => state.speakers),
      startAudioInput: vi.fn(async () => undefined),
      stopAudioInput: vi.fn(async () => undefined),
      startVideoInput: vi.fn(async () => undefined),
      stopVideoInput: vi.fn(async () => undefined),
      chooseAudioOutput: vi.fn(async () => undefined),
      chooseVideoInputQuality: vi.fn(),
      startVideoPreviewForVideoInput: vi.fn(),
      stopVideoPreviewForVideoInput: vi.fn(),
      createAnalyserNodeForAudioInput: vi.fn(() => null),
      startLocalVideoTile: vi.fn(() => 1),
      stopLocalVideoTile: vi.fn(),
      hasStartedLocalVideoTile: vi.fn(() => false),
      bindVideoElement: vi.fn(),
      unbindVideoElement: vi.fn(),
      bindAudioElement: vi.fn(async () => undefined),
      unbindAudioElement: vi.fn(),
      realtimeMuteLocalAudio: vi.fn(),
      realtimeUnmuteLocalAudio: vi.fn(() => true),
      realtimeSubscribeToMuteAndUnmuteLocalAudio: vi.fn(),
      realtimeUnsubscribeToMuteAndUnmuteLocalAudio: vi.fn(),
      startContentShareFromScreenCapture: vi.fn(async () => ({})),
      stopContentShare: vi.fn(),
      promoteToPrimaryMeeting: vi.fn(async (_credentials: unknown) => ({ isFailure: () => state.promotionFails })),
      demoteFromPrimaryMeeting: vi.fn(),
    };
  }

  return { state, createAudioVideo };
});

vi.mock('amazon-chime-sdk-js', () => {
  // The real 3.32.0 module reads `global` at evaluation (cspmonitor/CSPMonitor.js).
  h.state.globalAtEvaluation = typeof (globalThis as { global?: unknown }).global;
  class ConsoleLogger {}
  class DefaultDeviceController {
    addDeviceChangeObserver = vi.fn();
    removeDeviceChangeObserver = vi.fn();
  }
  class NoOpEventReporter {}
  class MeetingSessionCredentials {
    attendeeId: string | null = null;
    externalUserId: string | null = null;
    joinToken: string | null = null;
  }
  class DefaultEventController {
    reporter: unknown;
    constructor(_configuration: unknown, _logger: unknown, reporter?: unknown) {
      this.reporter = reporter;
      h.state.eventControllers.push(this);
    }
  }
  class MeetingSessionConfiguration {
    meeting: unknown;
    attendee: unknown;
    urls: { eventIngestionURL: string | null } | null;
    reconnectTimeoutMs = 120_000;
    constructor(meeting?: unknown, attendee?: unknown) {
      this.meeting = meeting;
      this.attendee = attendee;
      // Simulate a response that still carried an ingestion URL.
      this.urls = meeting ? { eventIngestionURL: 'https://ingest.example.invalid' } : null;
    }
  }
  class DefaultMeetingSession {
    configuration: unknown;
    eventController: unknown;
    audioVideo = h.createAudioVideo();
    destroy = vi.fn(async () => undefined);
    constructor(configuration: unknown, _logger: unknown, _deviceController: unknown, eventController: unknown) {
      this.configuration = configuration;
      this.eventController = eventController;
      h.state.sessions.push(this as never);
    }
  }
  class DefaultMeetingReadinessChecker {
    checkAudioInput = vi.fn(async () => h.state.audioInputFeedback);
    checkVideoInput = vi.fn(async () => h.state.videoInputFeedback);
    checkAudioOutput = vi.fn(async (_device: unknown, verify: () => Promise<boolean>) => {
      if (h.state.speakerError) throw new Error('The audio context could not start');
      return (await verify()) ? 0 : 1;
    });
  }
  class DefaultVideoTransformDevice {
    device: unknown;
    stop = vi.fn(async () => undefined);
    constructor(_logger: unknown, device: unknown) {
      this.device = device;
      h.state.transformDevices.push(this);
    }
    chooseNewInnerDevice(device: unknown) {
      return new DefaultVideoTransformDevice(null, device);
    }
  }
  const BackgroundBlurVideoFrameProcessor = {
    isSupported: vi.fn(async () => h.state.blurSupported),
    create: vi.fn(async () => ({ destroy: vi.fn() })),
  };
  return {
    ConsoleLogger,
    LogLevel: { WARN: 2 },
    DefaultDeviceController,
    NoOpEventReporter,
    MeetingSessionCredentials,
    DefaultEventController,
    MeetingSessionConfiguration,
    DefaultMeetingSession,
    DefaultMeetingReadinessChecker,
    DefaultVideoTransformDevice,
    BackgroundBlurVideoFrameProcessor,
    MeetingSessionStatusCode: { OK: 0, Left: 1, AudioJoinedFromAnotherDevice: 2, MeetingEnded: 5, SignalingChannelClosedUnexpectedly: 14, AudioAttendeeRemoved: 22 },
    CheckAudioInputFeedback: { Succeeded: 0, Failed: 1, PermissionDenied: 2 },
    CheckVideoInputFeedback: { Succeeded: 0, Failed: 1, PermissionDenied: 2 },
    CheckAudioOutputFeedback: { Succeeded: 0, Failed: 1 },
  };
});

/* ------------------------------------------------------------------------ */
/* Fixtures                                                                  */
/* ------------------------------------------------------------------------ */

const JOIN: CallJoinResponse = {
  sessionId: 'session-1',
  participantId: 'participant-1',
  role: 'employee',
  format: 'consultation',
  startsAt: '2030-01-10T09:00:00.000Z',
  endsAt: '2030-01-10T09:45:00.000Z',
  meeting: {
    MeetingId: 'meeting-1',
    MediaRegion: 'eu-central-1',
    MediaPlacement: {
      AudioHostUrl: 'audio.example.invalid:3478',
      AudioFallbackUrl: 'wss://audio.example.invalid',
      SignalingUrl: 'wss://signal.example.invalid',
    },
  },
  attendee: { AttendeeId: 'attendee-1', ExternalUserId: 'participant-1', JoinToken: 'token-1' },
};

function status(code: number) {
  return { statusCode: () => code, isFailure: () => code > 2 && code !== 5 && code !== 22 };
}

function metrics(values: Record<string, number>) {
  return { getObservableMetrics: () => values };
}

let store: PreferenceStore;

function create(role: CallJoinResponse['role'] = 'employee', extra: Partial<ConstructorParameters<typeof CallSessionController>[0]> = {}) {
  return new CallSessionController({ role, store, probeNetwork: async () => 40, ...extra });
}

async function joined(controller = create(), response: CallJoinResponse = JOIN) {
  await controller.join(response);
  const session = h.state.sessions.at(-1)!;
  session.audioVideo.emit('audioVideoDidStart');
  return { controller, session, av: session.audioVideo };
}

beforeEach(() => {
  h.state.sessions.length = 0;
  h.state.eventControllers.length = 0;
  h.state.transformDevices.length = 0;
  h.state.audioInputFeedback = 0;
  h.state.videoInputFeedback = 0;
  h.state.blurSupported = true;
  h.state.speakerError = false;
  store = createMemoryPreferenceStore();
});

afterEach(() => {
  vi.useRealTimers();
});

/* ------------------------------------------------------------------------ */
/* Tests                                                                     */
/* ------------------------------------------------------------------------ */

// Runs first: the mocked SDK module evaluates on the first load in this file.
describe('loadChimeSdk (DEF-1)', () => {
  it('defines global before the SDK module evaluates, as browsers have none', async () => {
    const scope = globalThis as { global?: typeof globalThis };
    const original = scope.global;
    delete scope.global;
    try {
      expect(typeof scope.global).toBe('undefined');
      const sdk = await loadChimeSdk();
      expect(h.state.globalAtEvaluation).toBe('object');
      expect(scope.global).toBe(globalThis);
      expect(sdk.NoOpEventReporter).toBeDefined();
    } finally {
      scope.global = original ?? globalThis;
    }
  });

  it('leaves an existing global alone', async () => {
    const scope = globalThis as { global?: unknown };
    const original = scope.global;
    const marker = { marker: true };
    scope.global = marker;
    try {
      await loadChimeSdk();
      expect(scope.global).toBe(marker);
    } finally {
      scope.global = original;
    }
  });
});

describe('CallSessionController: join', () => {
  it('builds the session from the join response with a NoOpEventReporter and no ingestion URL (CW-R-48)', async () => {
    const controller = create();
    expect(controller.getSnapshot().session.status).toBe('idle');
    const joining = controller.join(JOIN);
    expect(controller.getSnapshot().session.status).toBe('joining');
    await joining;
    const session = h.state.sessions.at(-1)!;
    const configuration = session.configuration as { meeting: unknown; attendee: unknown; urls: { eventIngestionURL: string | null }; reconnectTimeoutMs: number };
    expect(configuration.meeting).toEqual({ Meeting: JOIN.meeting });
    expect(configuration.attendee).toEqual({ Attendee: JOIN.attendee });
    expect(configuration.urls.eventIngestionURL).toBeNull();
    expect(configuration.reconnectTimeoutMs).toBe(120_000);
    expect(h.state.eventControllers.at(-1)!.reporter).toBeDefined();
    expect(h.state.eventControllers.at(-1)!.reporter?.constructor.name).toBe('NoOpEventReporter');
    expect(session.audioVideo.start).toHaveBeenCalled();
    expect(session.audioVideo.startAudioInput).toHaveBeenCalled();
    expect(session.audioVideo.startVideoInput).toHaveBeenCalled();

    session.audioVideo.emit('audioVideoDidStart');
    const snapshot = controller.getSnapshot();
    expect(snapshot.session).toMatchObject({ status: 'connected', startsAt: JOIN.startsAt, endsAt: JOIN.endsAt, role: 'employee' });
    expect(session.audioVideo.startLocalVideoTile).toHaveBeenCalled();
    expect(snapshot.media.cameraOn).toBe(true);
    expect(controller.getClientEvents().map((e) => e.eventName)).toEqual(['meetingStartSucceeded']);
  });

  it('fails the join when the meeting stops before it started', async () => {
    const controller = create();
    await controller.join(JOIN);
    h.state.sessions.at(-1)!.audioVideo.emit('audioVideoDidStop', status(14));
    expect(controller.getSnapshot().session).toMatchObject({ status: 'failed', failure: 'join_failed' });
    expect(controller.getClientEvents().map((e) => e.eventName)).toEqual(['meetingStartFailed']);
  });

  it('ends as left with reason ended when the expert ends the meeting', async () => {
    const { controller, av } = await joined();
    av.emit('audioVideoDidStop', status(5));
    expect(controller.getSnapshot().session).toMatchObject({ status: 'left', endReason: 'ended' });
  });

  it('leaves: stops media and ignores the SDK stop that follows', async () => {
    const { controller, av } = await joined();
    await controller.leave();
    expect(av.stop).toHaveBeenCalled();
    expect(av.stopVideoInput).toHaveBeenCalled();
    av.emit('audioVideoDidStop', status(1));
    expect(controller.getSnapshot().session).toMatchObject({ status: 'left', endReason: 'left' });
    expect(controller.getSnapshot().media.cameraOn).toBe(false);
  });

  it('joins with the camera off when the person chose it', async () => {
    store.set(VIDEO_STORAGE_KEYS.cameraOff, 'true');
    const { controller, av } = await joined();
    expect(av.startVideoInput).not.toHaveBeenCalled();
    expect(av.startLocalVideoTile).not.toHaveBeenCalled();
    expect(controller.getSnapshot().media.cameraOn).toBe(false);
  });
});

describe('CallSessionController: reconnection (CORE-17)', () => {
  it('goes reconnecting and back to connected, recording the reconnect', async () => {
    const { controller, av } = await joined();
    av.emit('audioVideoDidStartConnecting', true);
    expect(controller.getSnapshot().session.status).toBe('reconnecting');
    av.emit('audioVideoDidStart');
    expect(controller.getSnapshot().session.status).toBe('connected');
    expect(controller.getClientEvents().map((e) => e.eventName)).toEqual([
      'meetingStartSucceeded',
      'signalingDropped',
      'meetingReconnected',
    ]);
  });

  it('fails after the 2-minute reconnect deadline and stops the session', async () => {
    vi.useFakeTimers();
    const { controller, av } = await joined();
    av.emit('audioVideoDidStartConnecting', true);
    await vi.advanceTimersByTimeAsync(119_000);
    expect(controller.getSnapshot().session.status).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(controller.getSnapshot().session).toMatchObject({ status: 'failed', failure: 'reconnect_timeout' });
    expect(av.stop).toHaveBeenCalled();
    expect(controller.getClientEvents().at(-1)!.eventName).toBe('meetingFailed');
  });

  it('can rejoin after a failure', async () => {
    const { controller, av } = await joined();
    av.emit('audioVideoDidStop', status(14));
    expect(controller.getSnapshot().session).toMatchObject({ status: 'failed', failure: 'connection_failed' });
    await controller.join(JOIN);
    h.state.sessions.at(-1)!.audioVideo.emit('audioVideoDidStart');
    expect(controller.getSnapshot().session.status).toBe('connected');
  });
});

describe('CallSessionController: readiness and devices (D-CW-21, CALL-03, CALL-04)', () => {
  it('runs idle -> checking -> idle and records the results', async () => {
    const controller = create();
    const seen: string[] = [];
    controller.subscribe(() => seen.push(controller.getSnapshot().session.status));
    await controller.checkReadiness();
    expect(seen).toContain('checking');
    const snapshot = controller.getSnapshot();
    expect(snapshot.session.status).toBe('idle');
    expect(snapshot.readiness).toMatchObject({ status: 'done', camera: 'passed', microphone: 'passed', network: 'good' });
    expect(snapshot.devices.permissions).toEqual({ camera: 'granted', microphone: 'granted' });
    expect(snapshot.devices.cameras.map((d) => d.deviceId)).toEqual(['cam-1', 'cam-2']);
  });

  it('records a denied microphone', async () => {
    h.state.audioInputFeedback = 2;
    const controller = create();
    await controller.checkReadiness();
    expect(controller.getSnapshot().readiness.microphone).toBe('denied');
    expect(controller.getSnapshot().devices.permissions.microphone).toBe('denied');
    expect(controller.getClientEvents()).toEqual([expect.objectContaining({ eventName: 'audioInputFailed', deviceError: 'NotAllowedError' })]);
  });

  it('classifies the network probe and reports offline when it fails', async () => {
    const slow = create('employee', { probeNetwork: async () => 400 });
    await slow.checkReadiness();
    expect(slow.getSnapshot().readiness.network).toBe('poor');
    const offline = create('employee', { probeNetwork: async () => Promise.reject(new TypeError('Failed to fetch')) });
    await offline.checkReadiness();
    expect(offline.getSnapshot().readiness.network).toBe('offline');
  });

  it('persists device choices under nestself.video.* and restores them', async () => {
    const controller = create();
    await controller.checkReadiness();
    await controller.selectDevice('camera', 'cam-2');
    await controller.selectDevice('microphone', 'mic-2');
    await controller.selectDevice('speaker', 'spk-1');
    await controller.setCameraOff(true);
    expect(store.get(VIDEO_STORAGE_KEYS.camera)).toBe('cam-2');
    expect(store.get(VIDEO_STORAGE_KEYS.microphone)).toBe('mic-2');
    expect(store.get(VIDEO_STORAGE_KEYS.speaker)).toBe('spk-1');
    expect(store.get(VIDEO_STORAGE_KEYS.cameraOff)).toBe('true');

    const next = create();
    await next.refreshDevices();
    expect(next.getSnapshot().devices.selected).toEqual({ camera: 'cam-2', microphone: 'mic-2', speaker: 'spk-1' });
    expect(next.getSnapshot().devices.cameraOff).toBe(true);
  });

  it('falls back to the first device when the stored one is gone', async () => {
    store.set(VIDEO_STORAGE_KEYS.camera, 'unplugged');
    const controller = create();
    await controller.refreshDevices();
    expect(controller.getSnapshot().devices.selected.camera).toBe('cam-1');
  });

  it('plays the speaker tone and waits for the answer', async () => {
    const controller = create();
    await controller.checkReadiness();
    const test = controller.testSpeaker();
    await vi.waitFor(() => expect(controller.getSnapshot().readiness.speaker).toBe('playing'));
    controller.confirmSpeaker(false);
    await test;
    expect(controller.getSnapshot().readiness.speaker).toBe('not_heard');
  });

  it('marks the speaker test failed when the tone cannot play', async () => {
    h.state.speakerError = true;
    const controller = create();
    await controller.checkReadiness();
    await controller.testSpeaker();
    expect(controller.getSnapshot().readiness.speaker).toBe('failed');
  });

  it('stays usable after destroy (a StrictMode effect replay destroys, then uses it again)', async () => {
    const controller = create();
    await controller.checkReadiness();
    await controller.destroy();
    expect(controller.getSnapshot().readiness.status).toBe('idle');
    const seen = vi.fn();
    controller.subscribe(seen);
    await controller.checkReadiness();
    expect(controller.getSnapshot().readiness).toMatchObject({ status: 'done', camera: 'passed', microphone: 'passed' });
    expect(seen).toHaveBeenCalled();
  });

  it('enables blur on demand, persists it and joins with the blur device', async () => {
    const controller = create();
    await controller.checkReadiness();
    await controller.setBlur(true);
    expect(controller.getSnapshot().devices.blur).toEqual({ supported: true, enabled: true, loading: false });
    expect(store.get(VIDEO_STORAGE_KEYS.blur)).toBe('true');
    await controller.join(JOIN);
    const av = h.state.sessions.at(-1)!.audioVideo;
    expect(av.startVideoInput).toHaveBeenCalledWith(h.state.transformDevices.at(-1));
  });

  it('turns blur into a disabled option where the browser cannot run it', async () => {
    h.state.blurSupported = false;
    const controller = create();
    await controller.setBlur(true);
    expect(controller.getSnapshot().devices.blur).toEqual({ supported: false, enabled: false, loading: false });
  });
});

describe('CallSessionController: webinar attendees never send video (D-CW-35)', () => {
  it('skips the camera check, never starts video and ignores camera requests', async () => {
    const controller = create('attendee');
    await controller.checkReadiness();
    expect(controller.getSnapshot().readiness).toMatchObject({ camera: 'skipped', microphone: 'skipped' });
    expect(controller.getSnapshot().devices).toMatchObject({ canSendVideo: false, canSendAudio: false });
    await controller.join({ ...JOIN, role: 'attendee', format: 'webinar' });
    const av = h.state.sessions.at(-1)!.audioVideo;
    av.emit('audioVideoDidStart');
    await controller.setCameraOn(true);
    expect(av.startVideoInput).not.toHaveBeenCalled();
    expect(av.startLocalVideoTile).not.toHaveBeenCalled();
    expect(controller.getSnapshot().media.cameraOn).toBe(false);
  });
});

describe('CallSessionController: audio capability for an attendee given the floor (D-CW-15)', () => {
  it('turns the microphone on muted and off again, and never enables video', async () => {
    const controller = create('attendee');
    const { av } = await joined(controller, { ...JOIN, role: 'attendee', format: 'webinar' });
    expect(controller.getSnapshot().devices.canSendAudio).toBe(false);

    await controller.setAudioCapability(true);
    expect(controller.getSnapshot().devices).toMatchObject({ canSendAudio: true, canSendVideo: false });
    expect(controller.getSnapshot().media).toMatchObject({ muted: true, cameraOn: false });
    expect(av.startAudioInput).toHaveBeenCalledOnce();
    controller.setMuted(false);
    expect(av.realtimeUnmuteLocalAudio).toHaveBeenCalled();
    await controller.setCameraOn(true);

    await controller.setAudioCapability(false);
    expect(controller.getSnapshot().devices).toMatchObject({ canSendAudio: false, canSendVideo: false });
    expect(controller.getSnapshot().media.muted).toBe(true);
    expect(av.stopAudioInput).toHaveBeenCalled();
    expect(av.startVideoInput).not.toHaveBeenCalled();
    expect(av.startLocalVideoTile).not.toHaveBeenCalled();
  });
});

describe('CallSessionController: a replica attendee promoted onto the primary meeting (T-CW-3.2)', () => {
  const PRIMARY = { AttendeeId: 'primary-attendee-1', ExternalUserId: 'participant-1', JoinToken: 'secret-join-token' };

  it('promotes with the primary credentials, audio only and muted, and demotes back to receive-only', async () => {
    const logs = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => undefined));
    const controller = create('attendee');
    const { av } = await joined(controller, { ...JOIN, role: 'attendee', format: 'webinar' });

    await controller.promoteToPrimaryMeeting(PRIMARY);
    expect(av.promoteToPrimaryMeeting).toHaveBeenCalledOnce();
    expect(av.promoteToPrimaryMeeting.mock.calls[0]![0]).toMatchObject({ attendeeId: 'primary-attendee-1', externalUserId: 'participant-1', joinToken: 'secret-join-token' });
    expect(controller.getSnapshot().devices).toMatchObject({ canSendAudio: true, canSendVideo: false });
    expect(controller.getSnapshot().media).toMatchObject({ muted: true, cameraOn: false });
    expect(av.startAudioInput).toHaveBeenCalledOnce();
    controller.setMuted(false);
    expect(av.realtimeUnmuteLocalAudio).toHaveBeenCalled();

    await controller.demoteFromPrimaryMeeting();
    expect(av.demoteFromPrimaryMeeting).toHaveBeenCalledOnce();
    expect(av.stopAudioInput).toHaveBeenCalled();
    expect(controller.getSnapshot().devices.canSendAudio).toBe(false);
    expect(controller.getSnapshot().media.muted).toBe(true);
    expect(av.startVideoInput).not.toHaveBeenCalled();
    expect(av.startLocalVideoTile).not.toHaveBeenCalled();
    // The join token lives in the call only: never in the state, never logged.
    expect(JSON.stringify(controller.getSnapshot())).not.toContain('secret-join-token');
    for (const spy of logs) expect(JSON.stringify(spy.mock.calls)).not.toContain('secret-join-token');
  });

  it('reverts to receive-only and rejects when the promotion fails', async () => {
    const controller = create('attendee');
    const { av } = await joined(controller, { ...JOIN, role: 'attendee', format: 'webinar' });
    h.state.promotionFails = true;
    await expect(controller.promoteToPrimaryMeeting(PRIMARY)).rejects.toThrow(/Promotion/);
    h.state.promotionFails = false;
    expect(controller.getSnapshot().devices.canSendAudio).toBe(false);
    expect(controller.getSnapshot().media.muted).toBe(true);
    expect(av.demoteFromPrimaryMeeting).not.toHaveBeenCalled();
  });

  it('goes back to receive-only when the SDK demotes on its own (disconnection, DeleteAttendee)', async () => {
    const controller = create('attendee');
    const { av } = await joined(controller, { ...JOIN, role: 'attendee', format: 'webinar' });
    await controller.promoteToPrimaryMeeting(PRIMARY);
    controller.setMuted(false);
    av.emit('audioVideoWasDemotedFromPrimaryMeeting', status(0));
    await vi.waitFor(() => expect(controller.getSnapshot().devices.canSendAudio).toBe(false));
    expect(controller.getSnapshot().media.muted).toBe(true);
  });
});

describe('CallSessionController: quality and degraded mode (guidelines 11.6)', () => {
  it('aggregates 30 seconds of samples into a level and a connectionStats event', async () => {
    vi.useFakeTimers();
    const { controller, av } = await joined();
    av.emit('metricsDidReceive', metrics({ currentRoundTripTimeMs: 180, audioUpstreamJitterMs: 10, audioPacketsReceivedFractionLoss: 0 }));
    av.emit('metricsDidReceive', metrics({ currentRoundTripTimeMs: 220, audioUpstreamJitterMs: 20, audioPacketsReceivedFractionLoss: 0 }));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(controller.getSnapshot().quality).toMatchObject({ level: 'degraded', metrics: { rtt: 200, jitter: 15, packetLoss: 0 } });
    const stats = controller.getClientEvents().find((e) => e.eventName === 'connectionStats');
    expect(stats?.metrics).toEqual({ rtt: 200, jitter: 15, packetLoss: 0 });
  });

  it('lowers resolution first, pauses video after two poor intervals, resumes after 10 s of recovery', async () => {
    vi.useFakeTimers();
    const { controller, av } = await joined();
    const poor = metrics({ currentRoundTripTimeMs: 450, audioPacketLossPercent: 5, audioPacketsReceivedFractionLoss: 5 });

    av.emit('metricsDidReceive', poor);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(controller.getSnapshot().quality).toMatchObject({ level: 'poor', lowResolution: true, videoPaused: false });
    expect(av.chooseVideoInputQuality).toHaveBeenLastCalledWith(640, 360, 15);
    expect(av.stopLocalVideoTile).not.toHaveBeenCalled();

    av.emit('metricsDidReceive', poor);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(controller.getSnapshot().quality).toMatchObject({ videoPaused: true });
    expect(av.stopLocalVideoTile).toHaveBeenCalled();

    const fair = metrics({ currentRoundTripTimeMs: 200 });
    av.emit('metricsDidReceive', fair);
    await vi.advanceTimersByTimeAsync(5_000);
    av.emit('metricsDidReceive', fair);
    expect(controller.getSnapshot().quality.videoPaused).toBe(true);
    await vi.advanceTimersByTimeAsync(5_000);
    av.emit('metricsDidReceive', fair);
    expect(controller.getSnapshot().quality).toMatchObject({ videoPaused: false, lowResolution: false, level: 'degraded' });
    expect(av.chooseVideoInputQuality).toHaveBeenLastCalledWith(960, 540, 15);
    expect(av.startLocalVideoTile).toHaveBeenCalledTimes(2);
  });

  it('reads SDK packet loss as a percentage (0.5 % good, 1.5 % degraded, 3 % poor)', async () => {
    vi.useFakeTimers();
    const { controller, av } = await joined();
    const cases: Array<[number, string, number]> = [
      [0.5, 'good', 0.005],
      [1.5, 'degraded', 0.015],
      [3, 'poor', 0.03],
    ];
    for (const [percent, level, fraction] of cases) {
      av.emit('metricsDidReceive', metrics({ currentRoundTripTimeMs: 40, audioPacketsReceivedFractionLoss: percent }));
      await vi.advanceTimersByTimeAsync(30_000);
      const quality = controller.getSnapshot().quality;
      expect(quality.level).toBe(level);
      expect(quality.metrics?.packetLoss).toBeCloseTo(fraction, 6);
    }
    const sent = controller.getClientEvents().filter((e) => e.eventName === 'connectionStats');
    expect(sent.map((e) => e.metrics?.packetLoss)).toEqual([0.005, 0.015, 0.03]);
  });

  it('bases degraded mode on upstream loss: heavy received loss alone does not touch outgoing video', async () => {
    vi.useFakeTimers();
    const { controller, av } = await joined();
    const downstreamOnly = metrics({ currentRoundTripTimeMs: 40, audioPacketsReceivedFractionLoss: 5, audioPacketLossPercent: 0.2 });
    av.emit('metricsDidReceive', downstreamOnly);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(controller.getSnapshot().quality).toMatchObject({ level: 'poor', lowResolution: false });
    expect(av.chooseVideoInputQuality).not.toHaveBeenCalled();

    av.emit('metricsDidReceive', metrics({ currentRoundTripTimeMs: 40, audioPacketsReceivedFractionLoss: 0, audioPacketLossPercent: 4 }));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(controller.getSnapshot().quality).toMatchObject({ level: 'poor', lowResolution: true });
    expect(av.chooseVideoInputQuality).toHaveBeenLastCalledWith(640, 360, 15);
  });

  it('a poor sample during recovery restarts the 10-second clock', async () => {
    vi.useFakeTimers();
    const { controller, av } = await joined();
    const poor = metrics({ currentRoundTripTimeMs: 450 });
    for (let i = 0; i < 2; i += 1) {
      av.emit('metricsDidReceive', poor);
      await vi.advanceTimersByTimeAsync(30_000);
    }
    av.emit('metricsDidReceive', metrics({ currentRoundTripTimeMs: 100 }));
    await vi.advanceTimersByTimeAsync(8_000);
    av.emit('metricsDidReceive', poor);
    await vi.advanceTimersByTimeAsync(4_000);
    av.emit('metricsDidReceive', metrics({ currentRoundTripTimeMs: 100 }));
    expect(controller.getSnapshot().quality.videoPaused).toBe(true);
  });
});

describe('CallSessionController: tiles, media and telemetry', () => {
  it('tracks local, remote and content tiles', async () => {
    const { controller, av } = await joined();
    av.emit('videoTileDidUpdate', { tileId: 1, localTile: true, isContent: false, paused: false, boundAttendeeId: 'attendee-1' });
    av.emit('videoTileDidUpdate', { tileId: 2, localTile: false, isContent: false, paused: false, boundAttendeeId: 'attendee-2' });
    av.emit('videoTileDidUpdate', { tileId: 3, localTile: false, isContent: true, paused: false, boundAttendeeId: 'attendee-2#content' });
    expect(controller.getSnapshot().tiles).toEqual({
      localTileId: 1,
      contentTileId: 3,
      remote: [{ tileId: 2, attendeeId: 'attendee-2', paused: false }],
    });
    av.emit('videoTileWasRemoved', 2);
    av.emit('videoTileWasRemoved', 3);
    expect(controller.getSnapshot().tiles).toEqual({ localTileId: 1, contentTileId: null, remote: [] });
  });

  it('does not show the expert their own screen share as the main tile', async () => {
    const { controller, av } = await joined(create('expert'), { ...JOIN, role: 'expert' });
    av.emit('videoTileDidUpdate', { tileId: 4, localTile: false, isContent: true, paused: false, boundAttendeeId: 'attendee-1#content' });
    expect(controller.getSnapshot().tiles.contentTileId).toBeNull();
  });

  it('mutes and unmutes through the realtime API', async () => {
    const { controller, av } = await joined();
    controller.setMuted(true);
    expect(av.realtimeMuteLocalAudio).toHaveBeenCalled();
    expect(controller.getSnapshot().media.muted).toBe(true);
    controller.setMuted(false);
    expect(av.realtimeUnmuteLocalAudio).toHaveBeenCalled();
    expect(controller.getSnapshot().media.muted).toBe(false);
  });

  it('shares the screen for the expert only', async () => {
    const expert = await joined(create('expert'), { ...JOIN, role: 'expert' });
    await expert.controller.setScreenShare(true);
    expect(expert.av.startContentShareFromScreenCapture).toHaveBeenCalled();
    expert.av.emitContent('contentShareDidStart');
    expect(expert.controller.getSnapshot().media.sharingScreen).toBe(true);

    const employee = await joined(create('employee'));
    await employee.controller.setScreenShare(true);
    expect(employee.av.startContentShareFromScreenCapture).not.toHaveBeenCalled();
  });

  it('records only connection metadata: every event passes the strict contract and carries no device label', async () => {
    const onClientEvent = vi.fn();
    h.state.videoInputFeedback = 1;
    const controller = create('employee', { onClientEvent, userAgent: 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' });
    await controller.checkReadiness();
    const { av } = await joined(controller);
    av.emit('audioVideoDidStartConnecting', true);
    av.emit('audioVideoDidStart');
    const events = controller.getClientEvents();
    expect(events.length).toBeGreaterThan(2);
    for (const event of events) {
      expect(ClientEventRequestSchema.safeParse(event).success).toBe(true);
      expect(event).toMatchObject({ browser: 'chrome', os: 'windows' });
    }
    expect(JSON.stringify(events)).not.toMatch(/Built-in|USB|Headset|participant-1|token-1/);
    expect(onClientEvent).toHaveBeenCalledTimes(events.length);
    expect(controller.drainClientEvents()).toHaveLength(events.length);
    expect(controller.getClientEvents()).toHaveLength(0);
  });
});
