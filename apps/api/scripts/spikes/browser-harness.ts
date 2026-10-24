/**
 * Media producers for the Chime SDK spikes (SPIKE-CW-03 with --with-browsers,
 * SPIKE-CW-04, SPIKE-CW-05 through SPIKE-CW-08 --device, SPIKE-CW-08).
 *
 * A tiny HTTP server on 127.0.0.1 serves one HTML page and a browser build of
 * amazon-chime-sdk-js. Each participant is a "slot": the page at
 * `/?slot=<name>` fetches that slot's meeting and attendee from the server
 * (never from the URL, so join tokens stay out of URLs and logs), joins the
 * meeting and reports its state back. Playwright drives Chromium contexts with
 * fake media (`--use-fake-device-for-media-stream`, `--use-fake-ui-for-media-stream`,
 * OPS-32); a phone's WebView can open the same page for SPIKE-CW-05.
 *
 * The Chime SDK browser build comes from, in order:
 * 1. SPIKE_CHIME_SDK_BUNDLE: a prebuilt single-file build that defines the global `ChimeSDK`;
 * 2. amazon-chime-sdk-js resolved from packages/video (T-CW-1.4), the web apps or the
 *    repository root, bundled once with the workspace app's Vite into the OS temp directory.
 * When neither is available the spike prints the exact step and exits before creating any meeting.
 */
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Attendee, Meeting } from '@aws-sdk/client-chime-sdk-meetings';
import type { Browser, BrowserContext, BrowserType, Page } from '@playwright/test';
import { describeError, redact, type SpikeContext } from './lib.js';

export const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/** Chromium flags for fake camera and microphone (OPS-32) plus audio autoplay. */
export const FAKE_MEDIA_ARGS = [
  '--use-fake-device-for-media-stream',
  '--use-fake-ui-for-media-stream',
  '--autoplay-policy=no-user-gesture-required',
] as const;

const SDK_ANCHORS = ['packages/video', 'apps/workspace', 'apps/admin', '.', 'apps/api'] as const;
const VITE_ANCHORS = ['packages/video', 'apps/workspace', 'apps/admin', 'packages/ui'] as const;

export interface HarnessSlot {
  /** URL-safe slot name, e.g. `presenter`. */
  readonly slot: string;
  /** Text drawn on the slot's canvas video, e.g. `PRESENTER`; no personal data. */
  readonly label: string;
  readonly meeting: Meeting;
  /** Contains the join token; it only ever leaves this process in the slot's credentials response. */
  readonly attendee: Attendee;
  readonly audio: 'mic' | 'none';
  /** `canvas`: a labelled canvas stream; `camera`: the (fake or real) camera; `none`: receive only. */
  readonly video: 'canvas' | 'camera' | 'none';
  /** CSS named colour of the canvas background (named colours only; no hex literals). */
  readonly colour?: string;
}

export interface HarnessEvent {
  readonly slot: string;
  readonly name: string;
  readonly at: number;
  readonly detail: Record<string, unknown>;
}

export interface PageState {
  readonly slot: string;
  readonly phase: string;
  readonly startedAt: number | null;
  readonly stoppedCode: string | null;
  readonly remoteVideo: Record<string, { content: boolean; at: number }>;
  readonly remoteAudioMax: Record<string, number>;
  readonly present: Record<string, boolean>;
  readonly audioAutoplayBlocked: boolean;
  readonly error: { name: string; message: string } | null;
}

// ── Resolution and bundling ──────────────────────────────────────────────────

function resolveFrom(specifier: string, anchors: readonly string[]): { path: string; anchor: string } | null {
  for (const anchor of anchors) {
    const packageJson = join(REPO_ROOT, anchor, 'package.json');
    if (!existsSync(packageJson)) continue;
    try {
      return { path: createRequire(packageJson).resolve(specifier), anchor };
    } catch {
      // not resolvable from this anchor; try the next one
    }
  }
  return null;
}

function packageRootOf(entry: string, name: string): string | null {
  let dir = dirname(entry);
  for (let i = 0; i < 8; i += 1) {
    const candidate = join(dir, 'package.json');
    if (existsSync(candidate)) {
      try {
        const parsed = JSON.parse(readFileSync(candidate, 'utf8')) as { name?: string };
        if (parsed.name === name) return dir;
      } catch {
        // unreadable package.json; keep walking up
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Vite's ESM entry, found through its package.json (Vite 8 has no CommonJS entry). */
function resolveViteEntry(): string | null {
  for (const anchor of VITE_ANCHORS) {
    const packageJson = join(REPO_ROOT, anchor, 'package.json');
    if (!existsSync(packageJson)) continue;
    try {
      const viteManifest = createRequire(packageJson).resolve('vite/package.json');
      const manifest = JSON.parse(readFileSync(viteManifest, 'utf8')) as { exports?: Record<string, unknown> };
      const dot = manifest.exports?.['.'];
      const relative =
        typeof dot === 'string' ? dot : ((dot as { import?: unknown; default?: unknown } | undefined)?.import ?? (dot as { default?: unknown } | undefined)?.default);
      if (typeof relative === 'string') return join(dirname(viteManifest), relative);
    } catch {
      // vite not resolvable from this anchor
    }
  }
  return null;
}

export const CHIME_SDK_MISSING_INSTRUCTIONS = [
  'amazon-chime-sdk-js is not resolvable from this checkout (searched packages/video, apps/workspace, apps/admin, the repository root and apps/api).',
  'It is pinned in the catalog (pnpm-workspace.yaml, amazon-chime-sdk-js 3.32.0), but no workspace package depends on it until T-CW-1.4.',
  'To make it resolvable, either:',
  '  1. After T-CW-1.4 (packages/video, with "amazon-chime-sdk-js": "catalog:" in its package.json) is merged and `pnpm install` has run',
  '     at a moment when no parallel work is running, re-run this spike: the harness finds the SDK under packages/video and bundles it',
  "     with the workspace app's Vite. Nothing else is needed.",
  '  2. Or, before then, build a single-file browser bundle of amazon-chime-sdk-js 3.32.0 outside this repository (the SDK',
  '     repository\'s demos/singlejs produces one that defines the global ChimeSDK) and point the harness at it:',
  '       SPIKE_CHIME_SDK_BUNDLE=/absolute/path/to/amazon-chime-sdk.min.js pnpm --filter @nestself/api exec tsx scripts/spikes/<spike>.ts',
].join('\n');

/**
 * Returns the path of a browser build that defines `window.ChimeSDK`, or the
 * instructions to make one available.
 */
export async function prepareChimeBundle(ctx: Pick<SpikeContext, 'log'>): Promise<{ ok: true; path: string; source: string } | { ok: false; instructions: string }> {
  const prebuilt = process.env.SPIKE_CHIME_SDK_BUNDLE?.trim();
  if (prebuilt) {
    if (!existsSync(prebuilt)) return { ok: false, instructions: `SPIKE_CHIME_SDK_BUNDLE points at ${prebuilt}, which does not exist.` };
    return { ok: true, path: prebuilt, source: 'SPIKE_CHIME_SDK_BUNDLE' };
  }

  const sdk = resolveFrom('amazon-chime-sdk-js', SDK_ANCHORS);
  if (!sdk) return { ok: false, instructions: CHIME_SDK_MISSING_INSTRUCTIONS };
  const sdkRoot = packageRootOf(sdk.path, 'amazon-chime-sdk-js');
  const version = sdkRoot
    ? ((JSON.parse(readFileSync(join(sdkRoot, 'package.json'), 'utf8')) as { version?: string }).version ?? 'unknown')
    : 'unknown';

  const cacheDir = join(tmpdir(), 'nestself-spikes');
  const outDir = join(cacheDir, `dist-${version}`);
  const bundlePath = join(outDir, 'chime-sdk.iife.js');
  if (existsSync(bundlePath)) return { ok: true, path: bundlePath, source: `cached bundle of amazon-chime-sdk-js ${version} (from ${sdk.anchor})` };

  const viteEntry = resolveViteEntry();
  if (!viteEntry) {
    return {
      ok: false,
      instructions:
        `amazon-chime-sdk-js ${version} resolves from ${sdk.anchor}, but Vite (used to bundle it for the browser) does not resolve from ` +
        `${VITE_ANCHORS.join(', ')}. Run \`pnpm install\` at a moment when no parallel work is running, or set SPIKE_CHIME_SDK_BUNDLE.`,
    };
  }

  ctx.log(`bundling amazon-chime-sdk-js ${version} (from ${sdk.anchor}) for the browser with Vite; cached at ${bundlePath}`);
  const workDir = join(cacheDir, `src-${version}`);
  await mkdir(workDir, { recursive: true });
  const entry = join(workDir, 'entry.js');
  // A namespace import plus an explicit global: `export * from` a CommonJS module
  // re-exports nothing under Vite's bundler, so the IIFE would be empty.
  await writeFile(entry, "import * as ChimeSDK from 'amazon-chime-sdk-js';\nglobalThis.ChimeSDK = ChimeSDK;\n");
  const vite = (await import(pathToFileURL(viteEntry).href)) as { build: (config: Record<string, unknown>) => Promise<unknown> };
  await vite.build({
    configFile: false,
    root: workDir,
    logLevel: 'warn',
    publicDir: false,
    define: { global: 'globalThis', 'process.env.NODE_ENV': JSON.stringify('production') },
    resolve: { alias: [{ find: /^amazon-chime-sdk-js$/, replacement: sdk.path }] },
    build: {
      outDir,
      emptyOutDir: true,
      minify: false,
      sourcemap: false,
      reportCompressedSize: false,
      copyPublicDir: false,
      lib: { entry, name: 'ChimeSDKBundle', formats: ['iife'], fileName: () => 'chime-sdk.iife.js' },
    },
  });
  if (!existsSync(bundlePath)) return { ok: false, instructions: `Vite finished but ${bundlePath} was not written; set SPIKE_CHIME_SDK_BUNDLE instead.` };
  return { ok: true, path: bundlePath, source: `amazon-chime-sdk-js ${version} from ${sdk.anchor}, bundled with Vite` };
}

/** Loads Playwright's Chromium from the repository root (a root dev dependency), or returns instructions. */
export async function loadChromium(): Promise<{ ok: true; chromium: BrowserType } | { ok: false; instructions: string }> {
  try {
    const playwright = (await import('@playwright/test')) as { chromium: BrowserType };
    return { ok: true, chromium: playwright.chromium };
  } catch (error) {
    return {
      ok: false,
      instructions:
        `@playwright/test is not resolvable (${describeError(error).message}). It is a root dev dependency; ` +
        'run the spike from this checkout after the initial `pnpm install`.',
    };
  }
}

// ── The page ─────────────────────────────────────────────────────────────────

/* The page script is plain browser JavaScript (the API tsconfig has no DOM types). */
const PAGE_SCRIPT = String.raw`
(function () {
  'use strict';
  var params = new URLSearchParams(location.search);
  var slot = params.get('slot') || '';
  var state = { slot: slot, phase: 'loading', startedAt: null, stoppedCode: null, remoteVideo: {}, remoteAudioMax: {}, present: {}, audioAutoplayBlocked: false, error: null };
  window.__spike = state;
  var statusEl = document.getElementById('status');
  function setPhase(phase) { state.phase = phase; statusEl.textContent = slot + ': ' + phase; }
  function report(name, detail) {
    var body = JSON.stringify({ name: name, at: Date.now(), detail: detail || {} });
    fetch('/events/' + encodeURIComponent(slot), { method: 'POST', headers: { 'content-type': 'application/json' }, body: body }).catch(function () {});
  }
  function canvasStream(label, colour, fps) {
    var canvas = document.createElement('canvas');
    canvas.width = 640; canvas.height = 360;
    var g = canvas.getContext('2d');
    function draw() {
      g.fillStyle = colour; g.fillRect(0, 0, canvas.width, canvas.height);
      g.fillStyle = 'white'; g.font = 'bold 44px sans-serif'; g.fillText(label, 28, 120);
      g.font = '32px monospace'; g.fillText(new Date().toISOString().slice(11, 19), 28, 200);
    }
    draw(); setInterval(draw, Math.round(1000 / fps));
    return canvas.captureStream(fps);
  }
  function videoElement(containerId, tileId) {
    var id = 'tile-' + tileId;
    var el = document.getElementById(id);
    if (!el) {
      el = document.createElement('video');
      el.id = id; el.autoplay = true; el.muted = true; el.setAttribute('playsinline', '');
      document.getElementById(containerId).appendChild(el);
    }
    return el;
  }
  async function main() {
    var C = window.ChimeSDK;
    if (!C) throw new Error('window.ChimeSDK is missing: the SDK bundle did not load');
    if (!navigator.mediaDevices) throw new Error('navigator.mediaDevices is unavailable (insecure context or a WebView without media capture)');
    var response = await fetch('/credentials/' + encodeURIComponent(slot), { method: 'POST' });
    if (!response.ok) throw new Error('credentials request failed with HTTP ' + response.status);
    var cfg = await response.json();
    var logger = new C.ConsoleLogger('spike-' + slot, C.LogLevel.WARN);
    var deviceController = new C.DefaultDeviceController(logger);
    var configuration = new C.MeetingSessionConfiguration({ Meeting: cfg.meeting }, { Attendee: cfg.attendee });
    var session = new C.DefaultMeetingSession(configuration, logger, deviceController);
    var av = session.audioVideo;
    var self = cfg.attendee.AttendeeId;
    av.addObserver({
      audioVideoDidStart: function () { state.startedAt = Date.now(); setPhase('started'); report('audioVideoDidStart'); },
      audioVideoDidStartConnecting: function (reconnecting) { if (reconnecting) report('reconnecting'); },
      audioVideoDidStop: function (status) {
        var code = status.statusCode();
        state.stoppedCode = (C.MeetingSessionStatusCode && C.MeetingSessionStatusCode[code]) || String(code);
        setPhase('stopped'); report('audioVideoDidStop', { code: state.stoppedCode });
      },
      videoTileDidUpdate: function (tile) {
        if (tile.tileId == null || !tile.boundAttendeeId) return;
        if (tile.localTile) { av.bindVideoElement(tile.tileId, videoElement('local', tile.tileId)); return; }
        if (!state.remoteVideo[tile.boundAttendeeId]) {
          state.remoteVideo[tile.boundAttendeeId] = { content: !!tile.isContent, at: Date.now() };
          report('remoteVideoTile', { attendeeId: tile.boundAttendeeId, content: !!tile.isContent });
        }
        av.bindVideoElement(tile.tileId, videoElement('remote', tile.tileId));
      },
      connectionDidBecomePoor: function () { report('connectionDidBecomePoor'); },
    });
    av.realtimeSubscribeToAttendeeIdPresence(function (attendeeId, present) {
      state.present[attendeeId] = present;
      report(present ? 'attendeePresent' : 'attendeeAbsent', { attendeeId: attendeeId });
      if (!present || attendeeId === self || attendeeId.indexOf('#content') >= 0) return;
      av.realtimeSubscribeToVolumeIndicator(attendeeId, function (id, volume) {
        if (typeof volume !== 'number' || volume <= (state.remoteAudioMax[id] || 0)) return;
        if (!state.remoteAudioMax[id]) report('remoteAudioHeard', { attendeeId: id });
        state.remoteAudioMax[id] = volume;
      });
    });
    document.addEventListener('visibilitychange', function () { report('visibility', { state: document.visibilityState }); });
    var audioEl = document.getElementById('audio');
    await av.bindAudioElement(audioEl);
    if (cfg.audio === 'mic') {
      var mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      report('microphoneGranted');
      await av.startAudioInput(mic);
    }
    if (cfg.video === 'camera') {
      var camera = await navigator.mediaDevices.getUserMedia({ video: true });
      report('cameraGranted');
      await av.startVideoInput(camera);
    } else if (cfg.video === 'canvas') {
      await av.startVideoInput(canvasStream(cfg.label, cfg.colour || 'royalblue', 15));
    }
    setPhase('joining');
    av.start();
    if (cfg.video !== 'none') av.startLocalVideoTile();
    setTimeout(function () {
      if (audioEl.paused) {
        state.audioAutoplayBlocked = true;
        report('audioAutoplayBlocked');
        var button = document.getElementById('audio-start');
        button.hidden = false;
        button.onclick = function () { audioEl.play().then(function () { button.hidden = true; report('audioStartedByTap'); }); };
      }
    }, 3000);
    window.__spikeControl = {
      startContent: async function () { await av.startContentShare(canvasStream(cfg.label + ' CONTENT', 'darkgreen', 5)); report('contentShareStarted'); return true; },
      stopContent: function () { av.stopContentShare(); report('contentShareStopped'); return true; },
      leave: function () { av.stop(); return true; },
    };
  }
  main().catch(function (err) {
    state.error = { name: (err && err.name) || 'Error', message: String((err && err.message) || err) };
    setPhase('failed');
    report('failed', state.error);
  });
})();
`;

const PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Chime spike harness</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 16px; background: white; color: black; }
  video { width: 100%; max-width: 480px; background: black; display: block; margin: 8px 0; }
  #status { font-weight: 600; }
</style>
<script>window.global = window; window.process = window.process || { env: { NODE_ENV: 'production' } };</script>
<script src="/chime-sdk.js"></script>
</head>
<body>
<h1>Chime spike harness</h1>
<p>Test page for the NestSelf Chime SDK spikes. It joins a test meeting in the dev account; nothing here is a real consultation, and no booking, payment or message is created.</p>
<p id="status">loading</p>
<button id="audio-start" hidden>Tap to start audio</button>
<audio id="audio"></audio>
<div id="remote"></div>
<div id="local"></div>
<script>${PAGE_SCRIPT}</script>
</body>
</html>
`;

// ── The server ───────────────────────────────────────────────────────────────

export interface HarnessServer {
  readonly baseUrl: string;
  readonly port: number;
  readonly events: readonly HarnessEvent[];
  urlFor(slot: string): string;
  close(): Promise<void>;
}

async function readBody(req: IncomingMessage, limit = 4096): Promise<string> {
  let body = '';
  for await (const chunk of req) {
    body += String(chunk);
    if (body.length > limit) break;
  }
  return body.slice(0, limit);
}

/**
 * Starts the harness server on 127.0.0.1 (never on a public interface) and
 * registers its shutdown in cleanup. Slot events are logged as they arrive.
 */
export async function startHarnessServer(
  ctx: Pick<SpikeContext, 'log' | 'cleanup'>,
  options: { bundlePath: string; slots: readonly HarnessSlot[]; port?: number },
): Promise<HarnessServer> {
  const bundle = await readFile(options.bundlePath);
  const slots = new Map(options.slots.map((s) => [s.slot, s] as const));
  const claims = new Map<string, number>();
  const events: HarnessEvent[] = [];

  const send = (res: ServerResponse, status: number, type: string, body: string | Buffer): void => {
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(body);
  };

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (req.method === 'GET' && url.pathname === '/') return send(res, 200, 'text/html; charset=utf-8', PAGE_HTML);
      if (req.method === 'GET' && url.pathname === '/chime-sdk.js') return send(res, 200, 'text/javascript; charset=utf-8', bundle);
      const credentials = /^\/credentials\/([\w-]+)$/.exec(url.pathname);
      if (req.method === 'POST' && credentials?.[1]) {
        const slot = slots.get(credentials[1]);
        if (!slot) return send(res, 404, 'application/json', '{"error":"unknown slot"}');
        const count = (claims.get(slot.slot) ?? 0) + 1;
        claims.set(slot.slot, count);
        ctx.log(`harness: slot "${slot.slot}" fetched its credentials (#${count}, attendee ${slot.attendee.AttendeeId})`);
        // Chime's client event ingestion is not used (D-CW-13): drop its URL so the SDK reports nothing there.
        const placement = { ...(slot.meeting.MediaPlacement ?? {}) };
        delete placement.EventIngestionUrl;
        return send(
          res,
          200,
          'application/json',
          JSON.stringify({
            meeting: { ...slot.meeting, MediaPlacement: placement },
            attendee: slot.attendee,
            audio: slot.audio,
            video: slot.video,
            label: slot.label,
            colour: slot.colour,
          }),
        );
      }
      const event = /^\/events\/([\w-]+)$/.exec(url.pathname);
      if (req.method === 'POST' && event?.[1]) {
        try {
          const parsed = JSON.parse(await readBody(req)) as { name?: unknown; at?: unknown; detail?: unknown };
          const entry: HarnessEvent = {
            slot: event[1],
            name: typeof parsed.name === 'string' ? parsed.name : 'unknown',
            at: typeof parsed.at === 'number' ? parsed.at : Date.now(),
            detail: parsed.detail && typeof parsed.detail === 'object' ? (parsed.detail as Record<string, unknown>) : {},
          };
          events.push(entry);
          const detail = Object.keys(entry.detail).length > 0 ? ` ${redact(JSON.stringify(entry.detail))}` : '';
          ctx.log(`page[${entry.slot}]: ${entry.name}${detail}`);
        } catch {
          // malformed event body; ignore
        }
        return send(res, 204, 'text/plain', '');
      }
      return send(res, 404, 'text/plain', 'not found');
    })().catch(() => send(res, 500, 'text/plain', 'error'));
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: options.port ?? 0 }, () => resolve());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;
  ctx.log(`harness: serving ${baseUrl} (slots: ${[...slots.keys()].join(', ')})`);
  const close = (): Promise<void> =>
    new Promise((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  ctx.cleanup.add(`harness:${port}`, { label: `stop harness server on port ${port}`, run: close });
  return { baseUrl, port, events, urlFor: (slot) => `${baseUrl}/?slot=${encodeURIComponent(slot)}`, close };
}

// ── Playwright ───────────────────────────────────────────────────────────────

/** Launches Chromium with fake media; closed in cleanup before the meetings are deleted. */
export async function launchBrowser(
  ctx: Pick<SpikeContext, 'log' | 'cleanup'>,
  chromium: BrowserType,
  options: { headed: boolean },
): Promise<Browser> {
  let browser: Browser;
  try {
    browser = await chromium.launch({ headless: !options.headed, args: [...FAKE_MEDIA_ARGS] });
  } catch (error) {
    const info = describeError(error);
    throw new Error(
      `${info.message.split('\n')[0] ?? info.name}. If the browser is missing, run \`pnpm exec playwright install chromium\` from the repository root (it downloads a browser and does not touch the lockfile).`,
    );
  }
  ctx.log(`launched Chromium ${browser.version()} (${options.headed ? 'headed' : 'headless'}) with ${FAKE_MEDIA_ARGS.join(' ')}`);
  ctx.cleanup.add(`browser:${browser.version()}:${Date.now()}`, { label: 'close Chromium', run: () => browser.close() });
  return browser;
}

export interface OpenSlot {
  readonly slot: string;
  readonly context: BrowserContext;
  readonly page: Page;
  readonly openedAt: number;
  readonly pageErrors: string[];
  consoleErrors: number;
}

/** Opens one slot in its own browser context (its own cookies, devices and WebRTC stack). */
export async function openSlot(browser: Browser, server: HarnessServer, slot: string): Promise<OpenSlot> {
  const context = await browser.newContext({ permissions: ['camera', 'microphone'], viewport: { width: 800, height: 900 } });
  const page = await context.newPage();
  const opened: OpenSlot = { slot, context, page, openedAt: Date.now(), pageErrors: [], consoleErrors: 0 };
  // Console messages are counted, not printed: SDK log lines can carry signalling URLs.
  page.on('console', (message) => {
    if (message.type() === 'error') opened.consoleErrors += 1;
  });
  page.on('pageerror', (error) => opened.pageErrors.push(redact(`${error.name}: ${error.message}`).slice(0, 300)));
  await page.goto(server.urlFor(slot), { waitUntil: 'load' });
  return opened;
}

export async function readState(page: Page): Promise<PageState> {
  return (await page.evaluate('window.__spike')) as PageState;
}

/** Waits until the slot's page reaches one of `phases` (or `failed`), up to `timeoutMs`. */
export async function waitForPhase(
  ctx: Pick<SpikeContext, 'sleep'>,
  opened: OpenSlot,
  phases: readonly string[],
  timeoutMs: number,
): Promise<PageState> {
  const deadline = Date.now() + timeoutMs;
  let state = await readState(opened.page);
  while (!phases.includes(state.phase) && state.phase !== 'failed' && Date.now() < deadline) {
    if (!(await ctx.sleep(500))) break;
    state = await readState(opened.page);
  }
  return state;
}

/** Calls a control exposed by the page once it has joined: content share on and off, leave. */
export async function pageControl(opened: OpenSlot, action: 'startContent' | 'stopContent' | 'leave'): Promise<void> {
  await opened.page.evaluate(`window.__spikeControl && window.__spikeControl.${action}()`);
}

/** A compact, token-free summary of a slot for the JSON result. */
export function slotSummary(opened: OpenSlot, state: PageState): Record<string, unknown> {
  return {
    phase: state.phase,
    joinMs: state.startedAt ? state.startedAt - opened.openedAt : null,
    remoteVideoAttendees: Object.keys(state.remoteVideo),
    remoteAudioMax: state.remoteAudioMax,
    audioAutoplayBlocked: state.audioAutoplayBlocked,
    stoppedCode: state.stoppedCode,
    error: state.error,
    pageErrors: opened.pageErrors,
    consoleErrors: opened.consoleErrors,
  };
}
