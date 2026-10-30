/**
 * The browser half of `FakeVideoProvider` for the consultation journeys.
 *
 * The API runs with `VIDEO_PROVIDER=none`: the join endpoint hands out a
 * deterministic fake meeting (`fake-meeting-{sessionId}`, media URLs on
 * `fake-chime.invalid`) that no Chime media service will ever answer. So the
 * journeys serve the app a wrapped `amazon-chime-sdk-js`: every export is the
 * real SDK (the pre-join check, device lists, preview and readiness checker
 * stay real and use Chromium's fake camera and microphone), except that a
 * `DefaultMeetingSession` built for a fake meeting gets an in-page media
 * session. It "connects" at once, sends the fake camera as the self-view
 * tile and lets the test drive the rest through `window.__nestselfFakeChime`
 * (the other participant's video, a reconnect, quality samples), the way
 * `FakeVideoProvider.simulateEvent` drives the server side.
 *
 * Interception is by URL: the dev server's pre-bundled
 * `/deps/amazon-chime-sdk-js.js?v=…`. The wrapper imports the real file with
 * an extra `e2e-real` query, which the route lets through. The app's
 * CommonJS interop reads the module's default export, so that is what the
 * wrapper replaces.
 *
 * Nothing here runs in the nightly smoke test, which joins a real meeting.
 */
import type { BrowserContext, Page } from '@playwright/test';

const SDK_URL = /\/deps\/amazon-chime-sdk-js\.js(?:\?|$)/;

/**
 * The served module. Plain browser JavaScript; `__REAL__` is replaced with
 * the real module's URL.
 */
const WRAPPER = String.raw`
import realSdk from '__REAL__';

const FAKE_MEETING = 'fake-meeting-';
const hooks = (window.__nestselfFakeChime ??= { sessions: [] });

/**
 * In-call video: a calm placeholder in the page's own colour tokens with a
 * "sample video" caption, so screenshots never show a person and never the
 * camera test pattern full screen. The pre-join preview keeps Chromium's
 * fake camera (the real SDK shows it).
 */
function placeholderStream(caption) {
  const canvas = document.createElement('canvas');
  canvas.width = 960;
  canvas.height = 540;
  const context = canvas.getContext('2d');
  const token = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || 'gray';
  const draw = () => {
    const width = canvas.width;
    const height = canvas.height;
    context.fillStyle = token('--color-tint');
    context.fillRect(0, 0, width, height);
    context.fillStyle = token('--color-border-subtle');
    context.beginPath();
    context.arc(width / 2, height * 0.4, height * 0.14, 0, Math.PI * 2);
    context.fill();
    context.beginPath();
    context.ellipse(width / 2, height * 0.86, height * 0.3, height * 0.24, 0, Math.PI, 0);
    context.fill();
    context.fillStyle = token('--color-text-secondary');
    context.font = '28px sans-serif';
    context.textAlign = 'center';
    context.fillText(caption, width / 2, height * 0.6);
  };
  draw();
  const timer = setInterval(draw, 200);
  const stream = canvas.captureStream(5);
  stream.getTracks()[0].addEventListener('ended', () => clearInterval(timer));
  stream.stopPlaceholder = () => { clearInterval(timer); stream.getTracks().forEach((track) => track.stop()); };
  return stream;
}

function constraintsFor(device) {
  if (device && typeof device.getInnerDevice === 'function') return constraintsFor(device.getInnerDevice());
  if (typeof device === 'string') return { deviceId: { exact: device } };
  if (device && typeof device === 'object' && !(device instanceof MediaStream)) return device;
  return true;
}

class FakeAudioVideo {
  constructor(configuration) {
    this.selfAttendeeId = configuration.credentials?.attendeeId ?? 'self';
    this.observers = new Set();
    this.contentObservers = new Set();
    this.muteSubscribers = new Set();
    this.muted = false;
    this.audioStream = null;
    this.videoStream = null;
    this.remoteStream = null;
    this.selfStream = null;
    this.tiles = new Map();
    this.started = false;
    this.stopped = false;
    hooks.sessions.push(this);
    hooks.current = this;
  }
  notify(name, ...args) {
    for (const observer of [...this.observers]) observer[name]?.(...args);
  }
  addObserver(observer) { this.observers.add(observer); }
  removeObserver(observer) { this.observers.delete(observer); }
  addContentShareObserver(observer) { this.contentObservers.add(observer); }
  removeContentShareObserver(observer) { this.contentObservers.delete(observer); }
  realtimeSubscribeToMuteAndUnmuteLocalAudio(callback) { this.muteSubscribers.add(callback); }
  realtimeUnsubscribeToMuteAndUnmuteLocalAudio(callback) { this.muteSubscribers.delete(callback); }
  realtimeMuteLocalAudio() { this.muted = true; for (const callback of this.muteSubscribers) callback(true); }
  realtimeUnmuteLocalAudio() { this.muted = false; for (const callback of this.muteSubscribers) callback(false); return true; }
  realtimeIsLocalAudioMuted() { return this.muted; }
  async startAudioInput(device) {
    this.audioStream?.getTracks().forEach((track) => track.stop());
    this.audioStream = await navigator.mediaDevices.getUserMedia({ audio: constraintsFor(device) });
    return this.audioStream;
  }
  async stopAudioInput() { this.audioStream?.getTracks().forEach((track) => track.stop()); this.audioStream = null; }
  async startVideoInput(device) {
    this.videoStream?.getTracks().forEach((track) => track.stop());
    this.videoStream = await navigator.mediaDevices.getUserMedia({ video: constraintsFor(device) });
    return this.videoStream;
  }
  async stopVideoInput() { this.videoStream?.getTracks().forEach((track) => track.stop()); this.videoStream = null; }
  chooseVideoInputQuality() {}
  async bindAudioElement() { return true; }
  unbindAudioElement() {}
  async chooseAudioOutput() {}
  async listVideoInputDevices() { return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput'); }
  async listAudioInputDevices() { return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput'); }
  async listAudioOutputDevices() { return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput'); }
  startVideoPreviewForVideoInput(element) { if (this.videoStream) element.srcObject = this.videoStream; }
  stopVideoPreviewForVideoInput(element) { if (element) element.srcObject = null; }
  createAnalyserNodeForAudioInput() { return null; }
  start() {
    this.started = true;
    setTimeout(() => {
      if (this.stopped) return;
      this.notify('audioVideoDidStartConnecting', false);
      this.notify('audioVideoDidStart');
    }, 300);
  }
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    const status = new realSdk.MeetingSessionStatus(realSdk.MeetingSessionStatusCode.Left);
    setTimeout(() => this.notify('audioVideoDidStop', status), 0);
  }
  tileState(tileId) {
    const tile = this.tiles.get(tileId);
    return { tileId, localTile: tile.local, isContent: false, boundAttendeeId: tile.attendeeId, active: true, paused: false, boundVideoStream: tile.stream };
  }
  startLocalVideoTile() {
    this.selfStream ??= placeholderStream('');
    this.tiles.set(1, { local: true, attendeeId: this.selfAttendeeId, stream: this.selfStream, element: null });
    this.notify('videoTileDidUpdate', this.tileState(1));
    return 1;
  }
  stopLocalVideoTile() {
    if (!this.tiles.delete(1)) return;
    this.notify('videoTileWasRemoved', 1);
  }
  bindVideoElement(tileId, element) {
    const tile = this.tiles.get(tileId);
    if (!tile) return;
    tile.element = element;
    element.srcObject = tile.stream;
    void element.play?.().catch(() => undefined);
  }
  unbindVideoElement(tileId) {
    const tile = this.tiles.get(tileId);
    if (tile?.element) tile.element.srcObject = null;
  }
  async startContentShareFromScreenCapture() {}
  stopContentShare() {}
  // Media replication (D-CW-14): a replica attendee given the floor joins the primary, audio only.
  async promoteToPrimaryMeeting(credentials) {
    this.primaryAttendeeId = credentials?.attendeeId ?? null;
    hooks.promotions = [...(hooks.promotions ?? []), this.primaryAttendeeId];
    return new realSdk.MeetingSessionStatus(realSdk.MeetingSessionStatusCode.OK);
  }
  demoteFromPrimaryMeeting() {
    this.primaryAttendeeId = null;
    hooks.demotions = (hooks.demotions ?? 0) + 1;
    setTimeout(() => this.notify('audioVideoWasDemotedFromPrimaryMeeting', new realSdk.MeetingSessionStatus(realSdk.MeetingSessionStatusCode.OK)), 0);
  }

  // Test controls (the other participant and the network)
  async remoteJoined(attendeeId = 'fake-remote') {
    this.remoteStream ??= placeholderStream('Sample video');
    this.tiles.set(2, { local: false, attendeeId, stream: this.remoteStream, element: null });
    this.notify('videoTileDidUpdate', this.tileState(2));
  }
  remoteLeft() {
    if (this.tiles.delete(2)) this.notify('videoTileWasRemoved', 2);
  }
  reconnecting() { this.notify('audioVideoDidStartConnecting', true); }
  reconnected() { this.notify('audioVideoDidStart'); }
  metrics(observable) { this.notify('metricsDidReceive', { getObservableMetrics: () => observable }); }
  dispose() {
    for (const stream of [this.audioStream, this.videoStream]) stream?.getTracks().forEach((track) => track.stop());
    for (const stream of [this.selfStream, this.remoteStream]) stream?.stopPlaceholder();
  }
}

class DefaultMeetingSession extends realSdk.DefaultMeetingSession {
  constructor(configuration, logger, deviceController, eventController) {
    if (typeof configuration?.meetingId === 'string' && configuration.meetingId.startsWith(FAKE_MEETING)) {
      // A derived constructor may return its own object; the real session is never built.
      const audioVideo = new FakeAudioVideo(configuration);
      return {
        configuration,
        logger,
        deviceController,
        eventController,
        audioVideo,
        contentShare: null,
        destroy: async () => audioVideo.dispose(),
      };
    }
    super(configuration, logger, deviceController, eventController);
  }
}

export default { ...realSdk, DefaultMeetingSession };
`;

/** Serves the wrapped SDK to every page of the context. */
export async function installCallHarness(context: BrowserContext): Promise<void> {
  await context.route(SDK_URL, async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.has('e2e-real')) return route.continue();
    url.searchParams.set('e2e-real', '1');
    await route.fulfill({
      status: 200,
      contentType: 'text/javascript',
      headers: { 'cache-control': 'no-store' },
      body: WRAPPER.replace('__REAL__', `${url.pathname}${url.search}`),
    });
  });
}

type FakeChimeControl = 'remoteJoined' | 'remoteLeft' | 'reconnecting' | 'reconnected';

/** Drives the page's fake media session (the other participant arriving, a dropped connection). */
export async function fakeChime(page: Page, control: FakeChimeControl): Promise<void> {
  await page.waitForFunction(() => !!(window as unknown as { __nestselfFakeChime?: { current?: unknown } }).__nestselfFakeChime?.current);
  await page.evaluate(async (name) => {
    const hooks = (window as unknown as { __nestselfFakeChime: { current: Record<string, () => Promise<void> | void> } }).__nestselfFakeChime;
    await hooks.current[name]!();
  }, control);
}

/** One quality sample, as the SDK's `metricsDidReceive` reports it (observable metrics). */
export async function fakeChimeMetrics(page: Page, observable: Record<string, number>): Promise<void> {
  await page.evaluate((metrics) => {
    const hooks = (window as unknown as { __nestselfFakeChime: { current: { metrics: (m: Record<string, number>) => void } } }).__nestselfFakeChime;
    hooks.current.metrics(metrics);
  }, observable);
}
