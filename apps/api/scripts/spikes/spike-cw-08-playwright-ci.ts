/**
 * SPIKE-CW-08: can two Playwright Chromium contexts join one real meeting in CI?
 * (OPS-32, OPS-33, OPS open question 6, binds D-CW-33; prototype of the nightly
 * `video-smoke` workflow of T-CW-1.7.)
 *
 * One consultation meeting with two attendees. Two browser contexts (separate
 * cookies, devices and WebRTC stacks) in one headless Chromium with
 * `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream` open the
 * spike harness page, join with the fake camera and microphone, and report
 * audioVideoDidStart, the other side's video tile and the other side's audio
 * volume. Passing means both joined, both saw the other's video and both heard
 * the other's audio, which is the assertion the nightly workflow needs.
 *
 * In CI the script is skipped, not failed, unless VIDEO_SMOKE_ENABLED=true (CW-R-90).
 *
 * --device keeps one Chromium far end in the meeting and serves a second slot
 * for a phone's WebView on a fixed loopback port (SPIKE-CW-05, variant A).
 *
 *   pnpm --filter @nestself/api exec tsx scripts/spikes/spike-cw-08-playwright-ci.ts [--headed]
 *   pnpm --filter @nestself/api exec tsx scripts/spikes/spike-cw-08-playwright-ci.ts --device --port 5199 --minutes 20
 */
import {
  launchBrowser,
  loadChromium,
  openSlot,
  prepareChimeBundle,
  readState,
  slotSummary,
  startHarnessServer,
  waitForPhase,
  type HarnessSlot,
} from './browser-harness.js';
import { CAPABILITIES, createSpikeMeeting, flagArg, numberArg, requireAttendee, runSpike } from './lib.js';

if (process.env.CI && process.env.VIDEO_SMOKE_ENABLED !== 'true') {
  console.log('SPIKE-CW-08 skipped: CI is set and VIDEO_SMOKE_ENABLED is not "true" (CW-R-90).');
  console.log(JSON.stringify({ spike: 'SPIKE-CW-08', ok: true, outcome: 'skipped', measurements: {} }));
  process.exit(0);
}

runSpike({
  meta: {
    id: 'SPIKE-CW-08',
    file: 'spike-cw-08-playwright-ci.ts',
    question: 'Can two Playwright Chromium contexts join one real meeting in CI?',
    binds: ['D-CW-33'],
  },
  requiredEnv: ['CHIME_EVENTS_QUEUE_ARN'],
  options: {
    'observe-seconds': { type: 'string', default: '20', description: 'How long both contexts stay in the meeting after joining' },
    headed: { type: 'boolean', description: 'Show the Chromium window (local runs only)' },
    device: { type: 'boolean', description: 'SPIKE-CW-05: one Chromium far end plus a slot for a phone WebView' },
    port: { type: 'string', description: 'Harness port (default: random; 5199 with --device)' },
    minutes: { type: 'string', default: '15', description: 'With --device: how long to keep the meeting open' },
  },
  help: [
    'Needs the Chime SDK browser bundle and Playwright Chromium (see research/07-spikes.md). About two attendee-minutes per run.',
    'With --device, open http://127.0.0.1:<port>/?slot=device in the phone WebView; spike-cw-05-mobile-webview.ts prints the steps.',
  ],
  async run(ctx) {
    const deviceMode = flagArg(ctx.args, 'device');
    const bundle = await prepareChimeBundle(ctx);
    if (!bundle.ok) throw new Error(bundle.instructions);
    const loaded = await loadChromium();
    if (!loaded.ok) throw new Error(loaded.instructions);

    const keys = deviceMode ? (['farend', 'device'] as const) : (['a', 'b'] as const);
    const meeting = await createSpikeMeeting(ctx, {
      format: 'consultation',
      label: deviceMode ? 'device' : 'smoke',
      attendees: [
        { key: keys[0], capabilities: CAPABILITIES.expert },
        { key: keys[1], capabilities: CAPABILITIES.employee },
      ],
    });
    const first = requireAttendee(meeting, keys[0]);
    const second = requireAttendee(meeting, keys[1]);
    const ids = { [keys[0]]: first.AttendeeId ?? '', [keys[1]]: second.AttendeeId ?? '' };

    const slots: HarnessSlot[] = deviceMode
      ? [
          { slot: 'farend', label: 'FAR END', meeting: meeting.meeting, attendee: first, audio: 'mic', video: 'canvas', colour: 'royalblue' },
          { slot: 'device', label: 'DEVICE', meeting: meeting.meeting, attendee: second, audio: 'mic', video: 'camera' },
        ]
      : [
          { slot: 'a', label: 'CONTEXT A', meeting: meeting.meeting, attendee: first, audio: 'mic', video: 'camera' },
          { slot: 'b', label: 'CONTEXT B', meeting: meeting.meeting, attendee: second, audio: 'mic', video: 'camera' },
        ];
    const port = numberArg(ctx.args, 'port', deviceMode ? 5199 : 0);
    const server = await startHarnessServer(ctx, { bundlePath: bundle.path, slots, port });
    const browser = await launchBrowser(ctx, loaded.chromium, { headed: flagArg(ctx.args, 'headed') });

    if (deviceMode) {
      const farEnd = await openSlot(browser, server, 'farend');
      const farState = await waitForPhase(ctx, farEnd, ['started'], 60_000);
      if (farState.phase !== 'started') throw new Error(`the far end did not join: ${JSON.stringify(slotSummary(farEnd, farState))}`);
      const minutes = numberArg(ctx.args, 'minutes', 15);
      console.log(rule(`Open ${server.urlFor('device')} in the phone WebView now (see spike-cw-05-mobile-webview.ts).`));
      console.log(`  Android: adb reverse tcp:${server.port} tcp:${server.port}`);
      console.log(`  The meeting stays open for ${minutes} minutes; press Ctrl-C to finish earlier.`);
      await ctx.sleep(minutes * 60_000);
      const final = await readState(farEnd.page);
      const deviceEvents = server.events.filter((e) => e.slot === 'device');
      const deviceJoined = deviceEvents.some((e) => e.name === 'audioVideoDidStart');
      const deviceId = ids.device ?? '';
      const farEndSawVideo = deviceId in final.remoteVideo;
      const farEndHeardAudio = (final.remoteAudioMax[deviceId] ?? 0) > 0;
      const outcome = !deviceJoined ? 'device-did-not-join' : farEndSawVideo && farEndHeardAudio ? 'device-joined-with-audio-and-video' : 'device-joined-partial-media';
      return {
        outcome,
        ok: deviceJoined,
        measurements: {
          meetingId: meeting.meetingId,
          attendees: ids,
          farEnd: slotSummary(farEnd, final),
          farEndSawDeviceVideo: farEndSawVideo,
          farEndHeardDevice: farEndHeardAudio,
          deviceEvents: deviceEvents.map((e) => ({ name: e.name, atSeconds: Math.round((e.at - farEnd.openedAt) / 1000), ...e.detail })),
          platform: 'to fill in: iOS Simulator / Android device model and OS version',
        },
      };
    }

    const opened = await Promise.all(['a', 'b'].map((s) => openSlot(browser, server, s)));
    const joined = await Promise.all(opened.map(async (o) => ({ o, state: await waitForPhase(ctx, o, ['started'], 60_000) })));
    const bothJoined = joined.every(({ state }) => state.phase === 'started');
    if (bothJoined) {
      const observe = numberArg(ctx.args, 'observe-seconds', 20);
      ctx.log(`both contexts joined; observing for ${observe} s`);
      await ctx.sleep(observe * 1000);
    }
    const results = await Promise.all(opened.map(async (o) => ({ o, state: await readState(o.page) })));
    const other = (slot: string): string => (slot === 'a' ? (ids.b ?? '') : (ids.a ?? ''));
    const perSlot = Object.fromEntries(
      results.map(({ o, state }) => [
        o.slot,
        {
          ...slotSummary(o, state),
          sawOtherVideo: other(o.slot) in state.remoteVideo,
          heardOtherAudio: (state.remoteAudioMax[other(o.slot)] ?? 0) > 0,
        },
      ]),
    );
    const mediaBothWays = results.every(({ o, state }) => other(o.slot) in state.remoteVideo && (state.remoteAudioMax[other(o.slot)] ?? 0) > 0);
    const outcome = !bothJoined ? 'join-failed' : mediaBothWays ? 'both-joined-with-audio-and-video' : 'both-joined-media-incomplete';
    console.log(`--- answer ---\n  ${outcome}`);
    return {
      outcome,
      ok: bothJoined && mediaBothWays,
      measurements: {
        meetingId: meeting.meetingId,
        attendees: ids,
        chromium: browser.version(),
        headless: !flagArg(ctx.args, 'headed'),
        bundle: bundle.source,
        contexts: perSlot,
      },
    };
  },
});

function rule(text: string): string {
  return `${'-'.repeat(78)}\n${text}\n${'-'.repeat(78)}`;
}
