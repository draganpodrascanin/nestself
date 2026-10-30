/**
 * SPIKE-CW-03: does a media-pipeline attendee count against Attendee.MaxCount,
 * and does it keep the meeting alive past 5 empty minutes? (OPS-42, OPS open
 * question 5, binds D-CW-10 and D-CW-18.)
 *
 * 1. Meeting A: MaxCount 2, two attendees (p1, p2).
 *    With --with-browsers both join from Chromium with fake media first, so the
 *    test also holds if MaxCount counts connected attendees rather than created ones.
 * 2. Control: a third CreateAttendee on A must be refused if MaxCount is enforced
 *    when attendees are created. If it is accepted, it is deleted again at once.
 * 3. A capture pipeline in the D-CW-18 shape starts on A. If it reaches InProgress
 *    while MaxCount is full, the pipeline does not count against MaxCount.
 * 4. The browsers leave (if any). Meeting C (no pipeline, nobody joins) is created
 *    as the control for the 5-minute auto-end (OPS-03). Both meetings are polled
 *    with GetMeeting every 30 s for --wait-minutes.
 *
 *   AWS_PROFILE=nestself-dev AWS_REGION=eu-central-1 pnpm --filter @nestself/api exec tsx scripts/spikes/spike-cw-03-pipeline-attendee-count.ts [--with-browsers]
 */
import { CreateAttendeeCommand, DeleteAttendeeCommand, GetMeetingCommand } from '@aws-sdk/client-chime-sdk-meetings';
import type { BrowserType } from '@playwright/test';
import {
  launchBrowser,
  loadChromium,
  openSlot,
  prepareChimeBundle,
  readState,
  slotSummary,
  startHarnessServer,
  waitForPhase,
  type OpenSlot,
} from './browser-harness.js';
import {
  CAPABILITIES,
  captureStatus,
  createSpikeMeeting,
  describeError,
  flagArg,
  isNotFound,
  numberArg,
  recordingsPrefix,
  requireAttendee,
  runSpike,
  spikeName,
  startCapturePipeline,
  waitForCaptureStatus,
  webinarCaptureConfiguration,
  type CapturePipeline,
  type ErrorInfo,
  type SpikeContext,
  type StatusSample,
} from './lib.js';

async function meetingAlive(ctx: SpikeContext, meetingId: string): Promise<boolean> {
  try {
    await ctx.meetings.send(new GetMeetingCommand({ MeetingId: meetingId }));
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

runSpike({
  meta: {
    id: 'SPIKE-CW-03',
    file: 'spike-cw-03-pipeline-attendee-count.ts',
    question: 'Does a media-pipeline attendee count against Attendee.MaxCount, and does it keep the meeting alive past 5 empty minutes?',
    binds: ['D-CW-10', 'D-CW-18'],
  },
  requiredEnv: ['CHIME_EVENTS_QUEUE_ARN', 'RECORDINGS_BUCKET'],
  options: {
    'wait-minutes': { type: 'string', default: '8', description: 'How long to watch both meetings after the room is empty' },
    'with-browsers': { type: 'boolean', description: 'Join p1 and p2 from Chromium before the pipeline starts (needs the Chime SDK bundle)' },
    headed: { type: 'boolean', description: 'Show the Chromium windows' },
  },
  help: ['Runs about 10 minutes. One capture pipeline (D-CW-18 shape) runs for that time; segments land under raw/ and expire after 30 days.'],
  async run(ctx) {
    const waitMinutes = numberArg(ctx.args, 'wait-minutes', 8);
    const withBrowsers = flagArg(ctx.args, 'with-browsers');
    const bucket = ctx.env.bucket ?? '';

    // Resolve the media producers before anything costs money.
    let harness: { bundlePath: string; chromium: BrowserType } | undefined;
    if (withBrowsers) {
      const bundle = await prepareChimeBundle(ctx);
      if (!bundle.ok) throw new Error(bundle.instructions);
      const loaded = await loadChromium();
      if (!loaded.ok) throw new Error(loaded.instructions);
      harness = { bundlePath: bundle.path, chromium: loaded.chromium };
    }

    // 1. Meeting A with MaxCount 2 and two attendees.
    const a = await createSpikeMeeting(ctx, {
      format: 'consultation',
      label: 'a',
      maxCount: 2,
      attendees: [
        { key: 'p1', capabilities: CAPABILITIES.expert },
        { key: 'p2', capabilities: CAPABILITIES.employee },
      ],
    });
    const p1 = requireAttendee(a, 'p1');
    const p2 = requireAttendee(a, 'p2');
    const aCreatedAt = Date.now();

    let opened: OpenSlot[] = [];
    let browserStatesBefore: Record<string, unknown> | null = null;
    if (harness) {
      const server = await startHarnessServer(ctx, {
        bundlePath: harness.bundlePath,
        slots: [
          { slot: 'p1', label: 'P1', meeting: a.meeting, attendee: p1, audio: 'mic', video: 'canvas', colour: 'royalblue' },
          { slot: 'p2', label: 'P2', meeting: a.meeting, attendee: p2, audio: 'mic', video: 'canvas', colour: 'slategray' },
        ],
      });
      const browser = await launchBrowser(ctx, harness.chromium, { headed: flagArg(ctx.args, 'headed') });
      opened = await Promise.all([openSlot(browser, server, 'p1'), openSlot(browser, server, 'p2')]);
      const joined = await Promise.all(opened.map(async (o) => ({ o, state: await waitForPhase(ctx, o, ['started'], 60_000) })));
      browserStatesBefore = Object.fromEntries(joined.map(({ o, state }) => [o.slot, slotSummary(o, state)]));
      if (joined.some(({ state }) => state.phase !== 'started')) throw new Error(`browsers did not join: ${JSON.stringify(browserStatesBefore)}`);
      ctx.log('p1 and p2 are connected');
    }

    // 2. Control: is MaxCount enforced when attendees are created?
    let controlThirdAttendee: { outcome: 'refused' | 'created'; error?: ErrorInfo };
    try {
      const response = await ctx.meetings.send(
        new CreateAttendeeCommand({ MeetingId: a.meetingId, ExternalUserId: spikeName(ctx, 'p3'), Capabilities: CAPABILITIES.employee }),
      );
      controlThirdAttendee = { outcome: 'created' };
      const p3 = response.Attendee?.AttendeeId;
      if (p3) await ctx.meetings.send(new DeleteAttendeeCommand({ MeetingId: a.meetingId, AttendeeId: p3 }));
      ctx.log(`control: a third attendee was created (${p3 ?? 'no id'}) and deleted again; MaxCount is not enforced at CreateAttendee`);
    } catch (error) {
      controlThirdAttendee = { outcome: 'refused', error: describeError(error) };
      ctx.log(`control: third attendee refused (${describeError(error).name}); MaxCount 2 is full`);
    }

    // 3. Capture pipeline in the D-CW-18 shape while MaxCount is full.
    let pipeline: CapturePipeline | undefined;
    let pipelineCreateError: ErrorInfo | undefined;
    let pipelineHistory: StatusSample[] = [];
    let pipelineSettled = 'not-started';
    try {
      pipeline = await startCapturePipeline(ctx, {
        meeting: a.meeting,
        sinkPrefix: recordingsPrefix(ctx),
        configuration: webinarCaptureConfiguration([p1.AttendeeId ?? '']),
      });
      const settled = await waitForCaptureStatus(ctx, pipeline.pipelineId, { until: ['InProgress', 'Failed', 'Stopped'], timeoutMs: 120_000 });
      pipelineHistory = settled.history;
      pipelineSettled = settled.status;
    } catch (error) {
      pipelineCreateError = describeError(error);
      ctx.log(`capture pipeline not created: ${pipelineCreateError.name}: ${pipelineCreateError.message}`);
    }

    let browserStatesAfter: Record<string, unknown> | null = null;
    if (opened.length > 0) {
      browserStatesAfter = Object.fromEntries(await Promise.all(opened.map(async (o) => [o.slot, slotSummary(o, await readState(o.page))] as const)));
      await Promise.all(opened.map((o) => o.context.close()));
      ctx.log('p1 and p2 left; the room is empty from now');
    }

    // A pipeline that fails or is refused does not show why: MaxCount is one possible cause among
    // several (bucket policy, KMS, quota), so the answer stays inconclusive and the JSON line carries
    // the error and the status history for the founder to read.
    let countsAgainstMaxCount: string;
    if (pipelineCreateError || pipelineSettled === 'Failed') countsAgainstMaxCount = 'inconclusive-pipeline-failed';
    else if (pipelineSettled !== 'InProgress') countsAgainstMaxCount = 'inconclusive';
    else if (controlThirdAttendee.outcome === 'refused' || withBrowsers) countsAgainstMaxCount = 'no';
    else countsAgainstMaxCount = 'inconclusive-rerun-with-browsers';

    // 4. Auto-end: meeting A (pipeline) against control meeting C (no pipeline).
    const emptySince = Date.now();
    const c = await createSpikeMeeting(ctx, {
      format: 'consultation',
      label: 'c',
      maxCount: 2,
      attendees: [{ key: 'c1', capabilities: CAPABILITIES.expert }],
    });
    const cCreatedAt = Date.now();
    const ended: Record<'a' | 'c', number | null> = { a: null, c: null };
    const pipelineDuringWait: StatusSample[] = [];
    const deadline = emptySince + waitMinutes * 60_000;
    ctx.log(`watching meetings ${a.meetingId} (pipeline) and ${c.meetingId} (control) for ${waitMinutes} minutes`);
    while (Date.now() < deadline) {
      if (ended.a === null && !(await meetingAlive(ctx, a.meetingId))) {
        ended.a = Date.now();
        ctx.log(`meeting A ended ${Math.round((ended.a - emptySince) / 1000)} s after the room emptied`);
      }
      if (ended.c === null && !(await meetingAlive(ctx, c.meetingId))) {
        ended.c = Date.now();
        ctx.log(`control meeting C ended ${Math.round((ended.c - cCreatedAt) / 1000)} s after it was created`);
      }
      if (pipeline) {
        const status = await captureStatus(ctx, pipeline.pipelineId);
        if (pipelineDuringWait.at(-1)?.status !== status) {
          pipelineDuringWait.push({ atSeconds: Math.round((Date.now() - emptySince) / 1000), status });
        }
      }
      if (ended.a !== null && ended.c !== null) break;
      if (!(await ctx.sleep(30_000))) break;
    }

    let keepsMeetingAlive: string;
    if (!pipeline || pipelineSettled !== 'InProgress') keepsMeetingAlive = 'not-measured';
    else if (ended.c === null) keepsMeetingAlive = 'inconclusive-control-did-not-end';
    else if (ended.a === null) keepsMeetingAlive = 'yes';
    else keepsMeetingAlive = 'no';

    console.log(`--- answer ---\n  pipeline counts against MaxCount: ${countsAgainstMaxCount}\n  pipeline keeps the empty meeting alive: ${keepsMeetingAlive}`);
    return {
      outcome: `counts-against-max-count=${countsAgainstMaxCount}; keeps-meeting-alive=${keepsMeetingAlive}`,
      ok: !pipelineCreateError,
      measurements: {
        withBrowsers,
        meetingA: a.meetingId,
        attendees: { p1: p1.AttendeeId, p2: p2.AttendeeId },
        controlThirdAttendee,
        pipeline: {
          pipelineId: pipeline?.pipelineId ?? null,
          sourceArnStyle: pipeline?.sourceArnStyle ?? null,
          settled: pipelineSettled,
          statusHistory: pipelineHistory,
          createError: pipelineCreateError ?? null,
        },
        browsersBeforePipeline: browserStatesBefore,
        browsersAfterPipeline: browserStatesAfter,
        countsAgainstMaxCount,
        autoEnd: {
          waitMinutes,
          meetingA: { endedSecondsAfterEmpty: ended.a ? Math.round((ended.a - emptySince) / 1000) : null, endedSecondsAfterCreate: ended.a ? Math.round((ended.a - aCreatedAt) / 1000) : null },
          controlMeetingC: { meetingId: c.meetingId, endedSecondsAfterCreate: ended.c ? Math.round((ended.c - cCreatedAt) / 1000) : null },
          pipelineStatusDuringWait: pipelineDuringWait,
          keepsMeetingAlive,
        },
        recordings: pipeline ? `s3://${bucket}/${pipeline.sinkPrefix}/` : null,
      },
    };
  },
});
