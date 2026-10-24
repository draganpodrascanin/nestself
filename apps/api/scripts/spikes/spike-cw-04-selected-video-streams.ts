/**
 * SPIKE-CW-04: do SelectedVideoStreams and CompositedVideo PresenterOnly combine
 * into one presenter-only composited MP4? (WEB open question 3, WEB-25, WEB-26,
 * binds D-CW-18.)
 *
 * A 3-minute test webinar: one presenter (SendReceive on everything, D-CW-10) and
 * two attendees (Receive on audio, video and content, D-CW-35), each in its own
 * Chromium context with fake media. The presenter sends a labelled blue canvas as
 * camera video and, from 45 s until 45 s before the end, a green canvas as content
 * share, so the recording shows both the PresenterOnly layout (content with the
 * presenter picture-in-picture) and the plain presenter tile.
 *
 * The capture pipeline uses the D-CW-18 shape: SelectedVideoStreams = the
 * presenter's attendee id, CompositedVideo GridView with ContentShareLayout
 * PresenterOnly at HD, audio muxed with the composited video, individual video and
 * content artifacts off. After the capture stops, a concatenation pipeline joins
 * the segments into one MP4 (WEB-29). Everything is written under
 * raw/spike-cw-04/<runId>/ in the recordings bucket, which expires after 30 days.
 *
 * --control-sender turns the second attendee into a video sender (red canvas, not
 * in SelectedVideoStreams) to prove the filter excludes a stream that exists; the
 * product never lets an attendee send video (D-CW-35), so this is a control only.
 *
 *   AWS_PROFILE=nestself-dev AWS_REGION=eu-central-1 pnpm --filter @nestself/api exec tsx scripts/spikes/spike-cw-04-selected-video-streams.ts [--control-sender]
 */
import {
  CreateMediaConcatenationPipelineCommand,
  GetMediaPipelineCommand,
  type ArtifactsConcatenationConfiguration,
} from '@aws-sdk/client-chime-sdk-media-pipelines';
import {
  launchBrowser,
  loadChromium,
  openSlot,
  pageControl,
  prepareChimeBundle,
  readState,
  slotSummary,
  startHarnessServer,
  waitForPhase,
} from './browser-harness.js';
import {
  AWS_COMMAND_PREFIX,
  CAPABILITIES,
  CHIME_REGION,
  bucketArn,
  capturePipelineCleanupKey,
  createSpikeMeeting,
  describeError,
  flagArg,
  newClientRequestToken,
  numberArg,
  recordingsPrefix,
  registerMediaPipeline,
  requireAttendee,
  runSpike,
  startCapturePipeline,
  waitForCaptureStatus,
  webinarCaptureConfiguration,
  type ErrorInfo,
  type StatusSample,
} from './lib.js';

const CONCATENATION_ARTIFACTS: ArtifactsConcatenationConfiguration = {
  Audio: { State: 'Enabled' },
  Video: { State: 'Disabled' },
  Content: { State: 'Disabled' },
  DataChannel: { State: 'Disabled' },
  TranscriptionMessages: { State: 'Disabled' },
  MeetingEvents: { State: 'Disabled' },
  CompositedVideo: { State: 'Enabled' },
};

runSpike({
  meta: {
    id: 'SPIKE-CW-04',
    file: 'spike-cw-04-selected-video-streams.ts',
    question: 'Do SelectedVideoStreams and CompositedVideo PresenterOnly combine into one presenter-only composited MP4?',
    binds: ['D-CW-18'],
  },
  requiredEnv: ['CHIME_EVENTS_QUEUE_ARN', 'RECORDINGS_BUCKET'],
  options: {
    minutes: { type: 'string', default: '3', description: 'Length of the recording in minutes' },
    'control-sender': { type: 'boolean', description: 'Second attendee sends video that is not selected (filter control)' },
    'include-content-attendee': {
      type: 'boolean',
      description: "Also list the presenter's content attendee (<attendeeId>#content) in SelectedVideoStreams",
    },
    'no-concatenate': { type: 'boolean', description: 'Skip the concatenation pipeline' },
    headed: { type: 'boolean', description: 'Show the Chromium windows' },
  },
  help: [
    'Runs about 6 minutes plus concatenation. Needs the Chime SDK browser bundle and Playwright Chromium (see research/07-spikes.md).',
    'After the run, download the MP4 with the printed aws s3 commands and check it by eye.',
  ],
  async run(ctx) {
    const minutes = numberArg(ctx.args, 'minutes', 3);
    const controlSender = flagArg(ctx.args, 'control-sender');
    const bucket = ctx.env.bucket ?? '';

    // Media producers first: nothing is created if the harness cannot run.
    const bundle = await prepareChimeBundle(ctx);
    if (!bundle.ok) throw new Error(bundle.instructions);
    const loaded = await loadChromium();
    if (!loaded.ok) throw new Error(loaded.instructions);

    const meeting = await createSpikeMeeting(ctx, {
      format: 'webinar',
      label: 'webinar',
      attendees: [
        { key: 'presenter', capabilities: CAPABILITIES.presenter },
        { key: 'attendee1', capabilities: CAPABILITIES.webinarAttendee },
        {
          key: 'attendee2',
          capabilities: controlSender ? { Audio: 'Receive', Video: 'SendReceive', Content: 'Receive' } : CAPABILITIES.webinarAttendee,
        },
      ],
    });
    const presenter = requireAttendee(meeting, 'presenter');
    const attendee1 = requireAttendee(meeting, 'attendee1');
    const attendee2 = requireAttendee(meeting, 'attendee2');
    const presenterId = presenter.AttendeeId ?? '';

    const server = await startHarnessServer(ctx, {
      bundlePath: bundle.path,
      slots: [
        { slot: 'presenter', label: 'PRESENTER', meeting: meeting.meeting, attendee: presenter, audio: 'mic', video: 'canvas', colour: 'royalblue' },
        { slot: 'attendee1', label: 'ATTENDEE 1', meeting: meeting.meeting, attendee: attendee1, audio: 'mic', video: 'none' },
        {
          slot: 'attendee2',
          label: 'CONTROL SENDER',
          meeting: meeting.meeting,
          attendee: attendee2,
          audio: 'mic',
          video: controlSender ? 'canvas' : 'none',
          colour: 'crimson',
        },
      ],
    });
    const browser = await launchBrowser(ctx, loaded.chromium, { headed: flagArg(ctx.args, 'headed') });
    const slots = await Promise.all(['presenter', 'attendee1', 'attendee2'].map((s) => openSlot(browser, server, s)));
    const joined = await Promise.all(slots.map(async (o) => ({ o, state: await waitForPhase(ctx, o, ['started'], 60_000) })));
    if (joined.some(({ state }) => state.phase !== 'started')) {
      throw new Error(`not every participant joined: ${JSON.stringify(Object.fromEntries(joined.map(({ o, state }) => [o.slot, slotSummary(o, state)])))}`);
    }
    const presenterSlot = slots[0];
    if (!presenterSlot) throw new Error('presenter slot missing');
    ctx.log('presenter and both attendees are connected');

    // Capture in the D-CW-18 shape.
    const selected = flagArg(ctx.args, 'include-content-attendee') ? [presenterId, `${presenterId}#content`] : [presenterId];
    let pipelineError: ErrorInfo | undefined;
    let capture: Awaited<ReturnType<typeof startCapturePipeline>> | undefined;
    let captureHistory: StatusSample[] = [];
    try {
      capture = await startCapturePipeline(ctx, {
        meeting: meeting.meeting,
        sinkPrefix: recordingsPrefix(ctx, 'capture'),
        configuration: webinarCaptureConfiguration(selected),
      });
      captureHistory = (await waitForCaptureStatus(ctx, capture.pipelineId, { until: ['InProgress', 'Failed'], timeoutMs: 120_000 })).history;
    } catch (error) {
      pipelineError = describeError(error);
      ctx.log(`the API refused the combination: ${pipelineError.name}: ${pipelineError.message}`);
    }
    const captureStarted = captureHistory.at(-1)?.status === 'InProgress';

    const timeline: { atSeconds: number; event: string }[] = [];
    if (capture && captureStarted) {
      const t0 = Date.now();
      const mark = (event: string): void => {
        timeline.push({ atSeconds: Math.round((Date.now() - t0) / 1000), event });
        ctx.log(`t+${timeline.at(-1)?.atSeconds ?? 0} s: ${event}`);
      };
      const totalMs = minutes * 60_000;
      const contentFrom = Math.min(45_000, totalMs / 4);
      mark('recording in progress');
      if (await ctx.sleep(contentFrom)) {
        await pageControl(presenterSlot, 'startContent');
        mark('presenter content share on');
        if (await ctx.sleep(Math.max(0, totalMs - 2 * contentFrom))) {
          await pageControl(presenterSlot, 'stopContent');
          mark('presenter content share off');
          await ctx.sleep(contentFrom);
        }
      }
      mark('stopping capture');
    }

    const participants = Object.fromEntries(await Promise.all(slots.map(async (o) => [o.slot, slotSummary(o, await readState(o.page))] as const)));

    // Stop the capture (DeleteMediaCapturePipeline), then leave and end the meeting.
    let captureStopped = 'not-started';
    if (capture) {
      await ctx.cleanup.release(capturePipelineCleanupKey(capture.pipelineId));
      captureStopped = (await waitForCaptureStatus(ctx, capture.pipelineId, { until: ['Stopped', 'Failed'], timeoutMs: 60_000 })).status;
    }
    await Promise.all(slots.map((o) => o.context.close()));

    // One MP4 from the segments (WEB-29), as T-CW-2.5 will do.
    let concatenation: Record<string, unknown> = { skipped: true };
    const concatenatedPrefix = recordingsPrefix(ctx, 'concatenated');
    if (capture && captureStarted && !flagArg(ctx.args, 'no-concatenate')) {
      try {
        const response = await ctx.pipelines.send(
          new CreateMediaConcatenationPipelineCommand({
            ClientRequestToken: newClientRequestToken(ctx),
            Sources: [
              {
                Type: 'MediaCapturePipeline',
                MediaCapturePipelineSourceConfiguration: {
                  MediaPipelineArn: capture.pipelineArn,
                  ChimeSdkMeetingConfiguration: { ArtifactsConfiguration: CONCATENATION_ARTIFACTS },
                },
              },
            ],
            Sinks: [{ Type: 'S3Bucket', S3BucketSinkConfiguration: { Destination: bucketArn(bucket, concatenatedPrefix) } }],
          }),
        );
        const id = response.MediaConcatenationPipeline?.MediaPipelineId;
        if (!id) throw new Error('CreateMediaConcatenationPipeline returned no id');
        registerMediaPipeline(ctx, id);
        ctx.log(`concatenation pipeline ${id} started`);
        const history: StatusSample[] = [];
        const started = Date.now();
        let status = 'unknown';
        while (Date.now() - started < 15 * 60_000) {
          const got = await ctx.pipelines.send(new GetMediaPipelineCommand({ MediaPipelineId: id }));
          status = got.MediaPipeline?.MediaConcatenationPipeline?.Status ?? 'unknown';
          if (history.at(-1)?.status !== status) {
            history.push({ atSeconds: Math.round((Date.now() - started) / 1000), status });
            ctx.log(`concatenation pipeline ${id}: ${status}`);
          }
          if (status === 'Stopped' || status === 'Failed') break;
          if (!(await ctx.sleep(10_000))) break;
        }
        concatenation = { pipelineId: id, status, history };
      } catch (error) {
        concatenation = { error: describeError(error) };
      }
    }

    const s3 = `s3://${bucket}/${recordingsPrefix(ctx)}/`;
    const local = `./spike-cw-04-${ctx.runId}`;
    console.log('--- check the recording by hand ---');
    console.log(`  ${AWS_COMMAND_PREFIX} aws s3 ls ${s3} --recursive --region ${CHIME_REGION}`);
    console.log(`  ${AWS_COMMAND_PREFIX} aws s3 cp s3://${bucket}/${concatenatedPrefix}/ ${local}/ --recursive --region ${CHIME_REGION}`);
    console.log(
      `  ${AWS_COMMAND_PREFIX} aws s3api head-object --bucket ${bucket} --key <one key from the listing> --region ${CHIME_REGION}   # ServerSideEncryption, SSEKMSKeyId`,
    );
    console.log(`  ffprobe -hide_banner ${local}/<file>.mp4   # if ffmpeg is installed`);
    console.log('  Expected: only the blue PRESENTER tile; the green content with the presenter in the top-right corner between the');
    console.log('  content-share marks above; no ATTENDEE tile; with --control-sender, never the red CONTROL SENDER tile.');

    const outcome = pipelineError
      ? `api-refused:${pipelineError.name}`
      : captureStarted
        ? 'recorded-check-mp4-by-hand'
        : `capture-did-not-start:${captureHistory.at(-1)?.status ?? 'unknown'}`;
    return {
      outcome,
      ok: captureStarted || Boolean(pipelineError),
      measurements: {
        meetingId: meeting.meetingId,
        attendees: { presenter: presenterId, attendee1: attendee1.AttendeeId, attendee2: attendee2.AttendeeId },
        controlSender,
        selectedVideoStreams: selected,
        captureRequestAccepted: !pipelineError,
        captureError: pipelineError ?? null,
        capture: capture ? { pipelineId: capture.pipelineId, sourceArnStyle: capture.sourceArnStyle, history: captureHistory, stopped: captureStopped } : null,
        timeline,
        participants,
        concatenation,
        s3Prefix: s3,
        manualChecks: {
          presenterOnly: 'to fill in',
          contentShareVisibleWithPresenterPip: 'to fill in',
          controlSenderAbsent: controlSender ? 'to fill in' : 'not applicable',
          objectEncryption: 'to fill in from head-object',
        },
      },
      notes: ['The manualChecks fields are filled in by hand in research/07-spikes.md after watching the MP4.'],
    };
  },
});
