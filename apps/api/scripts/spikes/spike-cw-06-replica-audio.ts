/**
 * SPIKE-CW-06: do attendees given the floor in replica meetings lose audio after
 * 40 to 50 minutes? (WEB-39, research/02 open question 2, binds D-CW-14 and D-CW-36;
 * T-CW-3.1, run at the start of M3 before replication is built.)
 *
 * The replica floor, call by call (WEB-07, WEB-09, D-CW-35, and the documentation of
 * promoteToPrimaryMeeting in amazon-chime-sdk-js 3.32.0):
 *   1. Server: CreateMeetingWithAttendees for the PRIMARY meeting (webinar features,
 *      D-CW-10) with the presenter (SendReceive on audio, video and content).
 *   2. Server: CreateMeetingWithAttendees with PrimaryMeetingId = the primary, which makes
 *      a REPLICA, with the attendee (Receive on audio, video and content, D-CW-35).
 *   3. Clients: the presenter joins the primary, the attendee joins the replica.
 *   4. Floor, server: CreateAttendee on the PRIMARY meeting (not on the replica) for that
 *      attendee, with Audio SendReceive, Video Receive, Content Receive (D-CW-35).
 *      BatchCreateAttendee is the batch form of this step; the video stack's API policy
 *      grants CreateAttendee only. There is no server-side "promote" API.
 *   5. Floor, client: the replica attendee calls
 *      audioVideo.promoteToPrimaryMeeting(MeetingSessionCredentials { attendeeId,
 *      externalUserId, joinToken } of the step-4 attendee). It resolves to a
 *      MeetingSessionStatus: OK, AudioAuthenticationRejected, AudioCallAtCapacity (the
 *      promotion takes a slot of the primary) or a retryable signalling failure. The client
 *      then unmutes (realtimeUnmuteLocalAudio) and its audio reaches the primary over the
 *      same WebRTC connection.
 *   6. Take the floor back: client demoteFromPrimaryMeeting(), or server DeleteAttendee on
 *      the step-4 attendee (the client then gets audioVideoWasDemotedFromPrimaryMeeting with
 *      AudioAuthenticationRejected). Any disconnection demotes automatically, and the SDK
 *      documentation says to call promoteToPrimaryMeeting again with the same credentials.
 * T-CW-3.1 step 3 names UpdateAttendeeCapabilities: that is the single-meeting floor of
 * D-CW-35. A replica attendee speaks only through steps 4 and 5, the path WEB-39 reports.
 *
 * The soak: both clients run in Chromium contexts with fake media (the presenter's and the
 * attendee's fake microphones both beep). After the promotion, each page samples its peer
 * connection every 2 s: audio packets received and sent, and the volume of the other side
 * (the presenter watches the floor attendee, the attendee watches the presenter). A counter
 * that stops for 10 s opens a dropout ("stall"); the script records the minute after the
 * promotion. Every --sample-seconds (30) it writes one row to the CSV and keeps it for the
 * JSON line. After the first dropout it demotes and promotes again with the same
 * credentials (unless --no-repromote) and records whether audio returns: the workaround
 * T-CW-3.2 would build.
 *
 * Without --run the script prints this plan and the request shapes and makes no AWS call.
 *
 *   AWS_PROFILE=nestself-dev AWS_REGION=eu-central-1 pnpm --filter @nestself/api exec tsx scripts/spikes/spike-cw-06-replica-audio.ts --run [--minutes 60]
 */
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  CreateAttendeeCommand,
  type Attendee,
  type CreateAttendeeCommandInput,
  type CreateMeetingWithAttendeesCommandInput,
} from '@aws-sdk/client-chime-sdk-meetings';
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
  type OpenSlot,
  type PageState,
  type Stall,
} from './browser-harness.js';
import {
  AWS_COMMAND_PREFIX,
  CAPABILITIES,
  CHIME_REGION,
  MEETING_FEATURES,
  createSpikeMeeting,
  flagArg,
  numberArg,
  requireAttendee,
  runPrintOnlySpike,
  runSpike,
  spikeName,
  stringArg,
  type SpikeMeta,
  type SpikeOption,
} from './lib.js';

const META: SpikeMeta = {
  id: 'SPIKE-CW-06',
  file: 'spike-cw-06-replica-audio.ts',
  question: 'Do attendees given the floor in replica meetings lose audio after 40 to 50 minutes (WEB-39)?',
  binds: ['D-CW-14', 'D-CW-36'],
};

const OPTIONS: Readonly<Record<string, SpikeOption>> = {
  run: { type: 'boolean', description: 'Run the soak against the dev account; without it the plan is printed and no AWS call is made' },
  minutes: { type: 'string', default: '60', description: 'Soak length after the promotion, in minutes' },
  'sample-seconds': { type: 'string', default: '30', description: 'Interval of the rows written to the CSV and the JSON line' },
  csv: { type: 'string', description: 'CSV path (default: <OS temp dir>/nestself-spikes/spike-cw-06-<runId>.csv)' },
  'no-repromote': { type: 'boolean', description: 'Do not demote and promote again after the first dropout' },
  headed: { type: 'boolean', description: 'Show the Chromium windows' },
};

const HELP = [
  'Without --run: prints the plan and the request shapes (no AWS call, exit 0).',
  'With --run: a primary and a replica meeting, two Chromium contexts, the floor by promotion, a soak of --minutes.',
  'About $0.82 for 60 minutes (07-spikes.md, running order and cost). Needs Playwright Chromium and the Chime SDK bundle.',
];

/** The WEB-39 window: promoted attendees reported losing audio after about 40 to 50 minutes. */
const WEB39_WINDOW_MINUTES = [40, 50] as const;

const CSV_COLUMNS = [
  'elapsedSeconds',
  'attendeePhase',
  'attendeePromoted',
  'attendeeRx',
  'attendeeRxDelta',
  'attendeeTx',
  'attendeeTxDelta',
  'presenterRx',
  'presenterRxDelta',
  'presenterTx',
  'presenterTxDelta',
  'floorHeardSecondsAgo',
  'presenterHeardSecondsAgo',
  'openStalls',
] as const;

type Cell = string | number | boolean | null;

interface Dropout {
  readonly page: 'attendee' | 'presenter';
  readonly kind: Stall['kind'];
  readonly startMinute: number;
  readonly durationSeconds: number | null;
}

function plannedRequests(): Record<string, unknown> {
  const primary: CreateMeetingWithAttendeesCommandInput = {
    ClientRequestToken: '<spike token>',
    ExternalMeetingId: 'spike-cw-06-<runId>-primary',
    MediaRegion: CHIME_REGION,
    MeetingFeatures: MEETING_FEATURES.webinar,
    NotificationsConfiguration: { SqsQueueArn: '<CHIME_EVENTS_QUEUE_ARN>' },
    TenantIds: ['spike-cw'],
    Attendees: [{ ExternalUserId: 'spike-cw-06-<runId>-presenter', Capabilities: CAPABILITIES.presenter }],
  };
  const replica: CreateMeetingWithAttendeesCommandInput = {
    ...primary,
    ExternalMeetingId: 'spike-cw-06-<runId>-replica-1',
    PrimaryMeetingId: '<primary MeetingId>',
    Attendees: [{ ExternalUserId: 'spike-cw-06-<runId>-attendee', Capabilities: CAPABILITIES.webinarAttendee }],
  };
  const floorOnPrimary: CreateAttendeeCommandInput = {
    MeetingId: '<primary MeetingId>',
    ExternalUserId: 'spike-cw-06-<runId>-floor',
    Capabilities: CAPABILITIES.floor,
  };
  return { primary, replica, floorOnPrimary, client: 'audioVideo.promoteToPrimaryMeeting(credentials of floorOnPrimary), then realtimeUnmuteLocalAudio()' };
}

function minutesSince(start: number, at: number): number {
  return Math.round(((at - start) / 60_000) * 10) / 10;
}

function secondsAgo(now: number, at: number | undefined): number | null {
  return at === undefined ? null : Math.round((now - at) / 1000);
}

function dropoutsOf(promotedAt: number, page: Dropout['page'], state: PageState): Dropout[] {
  return (state.sampler?.stalls ?? []).map((stall) => ({
    page,
    kind: stall.kind,
    startMinute: minutesSince(promotedAt, stall.startedAt),
    durationSeconds: stall.endedAt === null ? null : Math.round((stall.endedAt - stall.startedAt) / 1000),
  }));
}

function openStalls(attendee: PageState, presenter: PageState): string[] {
  return [
    ...(attendee.sampler?.stalls ?? []).filter((s) => s.endedAt === null).map((s) => `attendee:${s.kind}`),
    ...(presenter.sampler?.stalls ?? []).filter((s) => s.endedAt === null).map((s) => `presenter:${s.kind}`),
  ];
}

if (!process.argv.slice(2).includes('--run')) {
  runPrintOnlySpike({ meta: META, options: OPTIONS, help: HELP }, () => {
    console.log(`
PLAN (dry run: no AWS call; add --run to execute)
  1. Primary meeting with the presenter; one replica meeting (PrimaryMeetingId), WEB-07.
  2. Presenter joins the primary, attendee joins the replica, each in a Chromium context with fake media.
  3. Floor: CreateAttendee on the primary (audio SendReceive, video and content Receive, D-CW-35); the replica
     client calls promoteToPrimaryMeeting with those credentials and unmutes (WEB-09).
  4. Soak ${OPTIONS.minutes?.default ?? '60'} minutes: both pages sample audio packets in and out and the other side's volume every 2 s;
     no change for 10 s is a dropout, recorded with its minute after the promotion; a row every 30 s to CSV and JSON.
  5. First dropout: demote, promote again with the same credentials, record whether audio returns.
  6. Cleanup: browsers, local server, both meetings (the floor attendee goes with the primary).

PLANNED REQUESTS (typed against @aws-sdk/client-chime-sdk-meetings; placeholders in angle brackets)
${JSON.stringify(plannedRequests(), null, 2)}

RUN
  ${AWS_COMMAND_PREFIX} pnpm --filter @nestself/api exec tsx scripts/spikes/${META.file} --run --minutes 60`);
    return { outcome: 'plan-printed', measurements: { soakMinutes: Number(OPTIONS.minutes?.default ?? 60), dryRun: true } };
  });
} else {
  runSpike({
    meta: META,
    requiredEnv: ['CHIME_EVENTS_QUEUE_ARN'],
    options: OPTIONS,
    help: HELP,
    async run(ctx) {
      const minutes = numberArg(ctx.args, 'minutes', 60);
      const sampleMs = Math.max(5, numberArg(ctx.args, 'sample-seconds', 30)) * 1000;
      const csvPath = stringArg(ctx.args, 'csv', join(tmpdir(), 'nestself-spikes', `spike-cw-06-${ctx.runId}.csv`));
      const repromoteEnabled = !flagArg(ctx.args, 'no-repromote');

      // Media producers first: nothing is created if the harness cannot run.
      const bundle = await prepareChimeBundle(ctx);
      if (!bundle.ok) throw new Error(bundle.instructions);
      const loaded = await loadChromium();
      if (!loaded.ok) throw new Error(loaded.instructions);

      // Steps 1 and 2: primary and replica.
      const primary = await createSpikeMeeting(ctx, {
        format: 'webinar',
        label: 'primary',
        attendees: [{ key: 'presenter', capabilities: CAPABILITIES.presenter }],
      });
      const replica = await createSpikeMeeting(ctx, {
        format: 'webinar',
        label: 'replica-1',
        primaryMeetingId: primary.meetingId,
        attendees: [{ key: 'attendee', capabilities: CAPABILITIES.webinarAttendee }],
      });
      const presenter = requireAttendee(primary, 'presenter');
      const attendee = requireAttendee(replica, 'attendee');

      // Step 4: the floor attendee on the PRIMARY meeting (deleted with the primary in cleanup).
      const floorResponse = await ctx.meetings.send(
        new CreateAttendeeCommand({ MeetingId: primary.meetingId, ExternalUserId: spikeName(ctx, 'floor'), Capabilities: CAPABILITIES.floor }),
      );
      const floor: Attendee | undefined = floorResponse.Attendee;
      if (!floor?.AttendeeId) throw new Error('CreateAttendee on the primary meeting returned no attendee');
      ctx.log(`floor attendee ${floor.AttendeeId} created on primary ${primary.meetingId}`);
      const ids = { presenter: presenter.AttendeeId ?? '', replicaAttendee: attendee.AttendeeId ?? '', floorOnPrimary: floor.AttendeeId };

      // Step 3: both clients join.
      const server = await startHarnessServer(ctx, {
        bundlePath: bundle.path,
        slots: [
          { slot: 'presenter', label: 'PRESENTER', meeting: primary.meeting, attendee: presenter, audio: 'mic', video: 'canvas', colour: 'royalblue' },
          { slot: 'attendee', label: 'ATTENDEE', meeting: replica.meeting, attendee, audio: 'mic', video: 'none' },
        ],
      });
      server.setFloor('attendee', floor);
      const browser = await launchBrowser(ctx, loaded.chromium, { headed: flagArg(ctx.args, 'headed') });
      const presenterSlot: OpenSlot = await openSlot(browser, server, 'presenter');
      const attendeeSlot: OpenSlot = await openSlot(browser, server, 'attendee');
      for (const opened of [presenterSlot, attendeeSlot]) {
        const state = await waitForPhase(ctx, opened, ['started'], 60_000);
        if (state.phase !== 'started') throw new Error(`${opened.slot} did not join: ${JSON.stringify(slotSummary(opened, state))}`);
      }
      ctx.log('presenter joined the primary and the attendee joined the replica');

      // Step 5: promotion.
      const promotion = (await pageControl(attendeeSlot, 'promote')) as { ok: boolean; code: string };
      const promotedAt = Date.now();
      if (!promotion.ok) {
        return {
          outcome: `promotion-failed:${promotion.code}`,
          ok: false,
          measurements: { primaryMeetingId: primary.meetingId, replicaMeetingId: replica.meetingId, attendees: ids, promotion },
        };
      }
      ctx.log(`promoted to the primary (${promotion.code}); soaking for ${minutes} minutes`);
      await pageControl(presenterSlot, 'startSampling', ids.floorOnPrimary);
      await pageControl(attendeeSlot, 'startSampling', ids.presenter);

      // The soak.
      await mkdir(dirname(csvPath), { recursive: true });
      await writeFile(csvPath, `${CSV_COLUMNS.join(',')}\n`);
      const rows: Cell[][] = [];
      const deadline = promotedAt + minutes * 60_000;
      let firstDropout: Dropout | undefined;
      let repromote: { atMinute: number; result: unknown; promotedAgainAt: number; restoredWithinSeconds: number | null } | undefined;
      // Let the samplers take their first reading, so the first row's deltas start at the promotion.
      await ctx.sleep(2500);
      let attendeeState = await readState(attendeeSlot.page);
      let presenterState = await readState(presenterSlot.page);
      const previous = {
        attendeeRx: Math.max(0, attendeeState.sampler?.rx ?? 0),
        attendeeTx: Math.max(0, attendeeState.sampler?.tx ?? 0),
        presenterRx: Math.max(0, presenterState.sampler?.rx ?? 0),
        presenterTx: Math.max(0, presenterState.sampler?.tx ?? 0),
      };
      for (;;) {
        const keepGoing = await ctx.sleep(Math.min(sampleMs, Math.max(0, deadline - Date.now())));
        [attendeeState, presenterState] = await Promise.all([readState(attendeeSlot.page), readState(presenterSlot.page)]);
        const now = Date.now();
        const a = attendeeState.sampler;
        const p = presenterState.sampler;
        const open = openStalls(attendeeState, presenterState);
        const row: Cell[] = [
          Math.round((now - promotedAt) / 1000),
          attendeeState.phase,
          attendeeState.promoted,
          a?.rx ?? null,
          a ? a.rx - previous.attendeeRx : null,
          a?.tx ?? null,
          a ? a.tx - previous.attendeeTx : null,
          p?.rx ?? null,
          p ? p.rx - previous.presenterRx : null,
          p?.tx ?? null,
          p ? p.tx - previous.presenterTx : null,
          secondsAgo(now, presenterState.remoteAudioLastAt[ids.floorOnPrimary]),
          secondsAgo(now, attendeeState.remoteAudioLastAt[ids.presenter]),
          open.join(';'),
        ];
        Object.assign(previous, { attendeeRx: a?.rx ?? 0, attendeeTx: a?.tx ?? 0, presenterRx: p?.rx ?? 0, presenterTx: p?.tx ?? 0 });
        rows.push(row);
        await appendFile(csvPath, `${row.map((cell) => (cell === null ? '' : String(cell))).join(',')}\n`);
        ctx.log(
          `t+${minutesSince(promotedAt, now)} min: attendee rx +${String(row[4])} tx +${String(row[6])}, presenter rx +${String(row[8])} tx +${String(row[10])}, ` +
            `floor heard ${String(row[11])} s ago, presenter heard ${String(row[12])} s ago${open.length ? `; OPEN: ${open.join(' ')}` : ''}`,
        );

        const dropouts = [...dropoutsOf(promotedAt, 'attendee', attendeeState), ...dropoutsOf(promotedAt, 'presenter', presenterState)];
        if (!firstDropout && dropouts.length > 0) {
          firstDropout = dropouts.reduce((earliest, d) => (d.startMinute < earliest.startMinute ? d : earliest));
          ctx.log(`DROPOUT: ${firstDropout.page} ${firstDropout.kind} from minute ${firstDropout.startMinute}`);
          if (repromoteEnabled && keepGoing) {
            ctx.log('demoting and promoting again with the same primary credentials');
            await pageControl(attendeeSlot, 'demote');
            await ctx.sleep(5000);
            const result = await pageControl(attendeeSlot, 'promote');
            repromote = { atMinute: minutesSince(promotedAt, Date.now()), result, promotedAgainAt: Date.now(), restoredWithinSeconds: null };
          }
        } else if (repromote && repromote.restoredWithinSeconds === null && open.length === 0 && now > repromote.promotedAgainAt) {
          repromote.restoredWithinSeconds = Math.round((now - repromote.promotedAgainAt) / 1000);
          ctx.log(`audio restored ${repromote.restoredWithinSeconds} s after promoting again`);
        }
        if (!keepGoing || now >= deadline) break;
      }

      const minutesObserved = minutesSince(promotedAt, Date.now());
      const dropouts = [...dropoutsOf(promotedAt, 'attendee', attendeeState), ...dropoutsOf(promotedAt, 'presenter', presenterState)];
      const presenterHeardFloor = presenterState.sampler?.watchedEverHeard ?? false;
      const attendeeHeardPresenter = attendeeState.sampler?.watchedEverHeard ?? false;
      const outcome = !presenterHeardFloor
        ? 'floor-never-heard'
        : firstDropout
          ? `dropout-at-minute-${firstDropout.startMinute}`
          : `stable-for-${minutesObserved}-minutes`;
      console.log(`--- answer ---\n  ${outcome}\n  CSV: ${csvPath}`);
      return {
        outcome,
        ok: presenterHeardFloor,
        measurements: {
          primaryMeetingId: primary.meetingId,
          replicaMeetingId: replica.meetingId,
          attendees: ids,
          promotion: { ...promotion, at: new Date(promotedAt).toISOString() },
          soak: { minutesPlanned: minutes, minutesObserved, sampleSeconds: sampleMs / 1000, stallSeconds: 10, csvPath },
          presenterHeardFloor,
          attendeeHeardPresenter,
          firstDropout: firstDropout ?? null,
          inWeb39Window: firstDropout
            ? firstDropout.startMinute >= WEB39_WINDOW_MINUTES[0] && firstDropout.startMinute <= WEB39_WINDOW_MINUTES[1]
            : null,
          dropouts,
          repromote: repromote ?? (repromoteEnabled ? 'not-needed' : 'disabled'),
          promotions: attendeeState.promotions,
          samples: { columns: CSV_COLUMNS, rows },
          final: { presenter: slotSummary(presenterSlot, presenterState), attendee: slotSummary(attendeeSlot, attendeeState) },
          platform: 'to fill in: machine, OS, network',
        },
        notes: presenterHeardFloor ? [] : ['The presenter never heard the floor attendee after the promotion, so the soak cannot answer WEB-39; see the promotion events above.'],
      };
    },
  });
}
