/**
 * SPIKE-CW-07: what is the delivery latency of direct SQS (CreateMeeting
 * NotificationsConfiguration) versus EventBridge to the same queue? (OPS-14,
 * OPS open question 8, binds D-CW-12.)
 *
 * Both paths end in the stack's chime-events queue (D-CW-12, video-stack.ts), so
 * every event of a meeting with NotificationsConfiguration should arrive twice.
 *   1. Control meeting (no NotificationsConfiguration): its events can only come
 *      through EventBridge, which identifies EventBridge's SenderId and envelope.
 *   2. Test meeting (NotificationsConfiguration.SqsQueueArn): 10 CreateAttendee and
 *      10 DeleteAttendee calls give 20 attendee events (chime:AttendeeAdded,
 *      chime:AttendeeDeleted, OPS-10); nobody joins media, so no attendee-minutes.
 * Latency per path = SQS SentTimestamp minus the event's own timestamp (both AWS
 * clocks). For each event seen on both paths, the gap between the two arrivals.
 * It also records what the dedupe key of D-CW-12 needs: whether both copies carry
 * the same timestamp, and the envelope keys each path delivers.
 *
 * This also proves that direct delivery works with the queue and key policies in
 * video-stack.ts (the comment above the ChimeMeetingsEncryptEvents statement).
 *
 * Messages of this run's meetings (and of any spike-cw-* meeting) are deleted
 * from the queue; other messages are left alone. Stop the local worker
 * (chime.events.consume) while this runs so it does not consume the events first.
 *
 *   pnpm --filter @nestself/api exec tsx scripts/spikes/spike-cw-07-sqs-latency.ts
 */
import { CreateAttendeeCommand, DeleteAttendeeCommand } from '@aws-sdk/client-chime-sdk-meetings';
import { DeleteMessageCommand, GetQueueAttributesCommand, ReceiveMessageCommand, type Message } from '@aws-sdk/client-sqs';
import {
  CAPABILITIES,
  EXTERNAL_MEETING_ID_PREFIX,
  createSpikeMeeting,
  meetingCleanupKey,
  numberArg,
  runSpike,
  spikeName,
  summarize,
  type SpikeContext,
} from './lib.js';

type Path = 'direct' | 'eventbridge';

interface Received {
  readonly meetingId?: string;
  readonly externalMeetingId?: string;
  readonly eventType?: string;
  readonly attendeeId?: string;
  readonly eventTimestampMs?: number;
  readonly timestampField: string;
  readonly sentTimestampMs?: number;
  readonly senderId?: string;
  readonly topLevelKeys: string[];
  readonly detailKeys: string[];
  readonly eventBridgeEnvelope: boolean;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function parseMessage(message: Message): Received | null {
  let body: unknown;
  try {
    body = JSON.parse(message.Body ?? '');
  } catch {
    return null;
  }
  if (!body || typeof body !== 'object') return null;
  const o = body as Record<string, unknown>;
  const detail = o.detail && typeof o.detail === 'object' ? (o.detail as Record<string, unknown>) : o;
  let eventTimestampMs: number | undefined;
  let timestampField = 'none';
  if (typeof detail.timestamp === 'number') {
    eventTimestampMs = detail.timestamp < 1e12 ? detail.timestamp * 1000 : detail.timestamp;
    timestampField = detail === o ? 'timestamp' : 'detail.timestamp';
  } else if (typeof detail.timestamp === 'string' && !Number.isNaN(Date.parse(detail.timestamp))) {
    eventTimestampMs = Date.parse(detail.timestamp);
    timestampField = detail === o ? 'timestamp (string)' : 'detail.timestamp (string)';
  } else if (typeof o.time === 'string' && !Number.isNaN(Date.parse(o.time))) {
    eventTimestampMs = Date.parse(o.time);
    timestampField = 'time';
  }
  const sent = Number(message.Attributes?.SentTimestamp);
  const meetingId = str(detail.meetingId) ?? str(o.meetingId);
  const externalMeetingId = str(detail.externalMeetingId) ?? str(o.externalMeetingId);
  const eventType = str(detail.eventType) ?? str(o.eventType) ?? str(o['detail-type']);
  const attendeeId = str(detail.attendeeId) ?? str(o.attendeeId);
  const senderId = message.Attributes?.SenderId;
  return {
    ...(meetingId ? { meetingId } : {}),
    ...(externalMeetingId ? { externalMeetingId } : {}),
    ...(eventType ? { eventType } : {}),
    ...(attendeeId ? { attendeeId } : {}),
    ...(eventTimestampMs !== undefined ? { eventTimestampMs } : {}),
    timestampField,
    ...(Number.isFinite(sent) ? { sentTimestampMs: sent } : {}),
    ...(senderId ? { senderId } : {}),
    topLevelKeys: Object.keys(o).sort(),
    detailKeys: detail === o ? [] : Object.keys(detail).sort(),
    eventBridgeEnvelope: ['id', 'account', 'detail', 'resources', 'source'].every((k) => k in o),
  };
}

interface Collector {
  readonly byMeeting: Map<string, Received[]>;
  foreign: number;
  unparsable: number;
  lastRelevantAt: number;
  stop: boolean;
}

async function collect(ctx: SpikeContext, queueUrl: string, meetingIds: ReadonlySet<string>, collector: Collector): Promise<void> {
  while (!collector.stop && !ctx.signal.aborted) {
    const response = await ctx.sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 2,
        MessageSystemAttributeNames: ['SentTimestamp', 'SenderId', 'ApproximateReceiveCount'],
      }),
    );
    for (const message of response.Messages ?? []) {
      const parsed = parseMessage(message);
      if (!parsed) {
        collector.unparsable += 1;
        continue;
      }
      const ours = parsed.meetingId !== undefined && meetingIds.has(parsed.meetingId);
      const spikeLeftover = parsed.externalMeetingId?.toLowerCase().startsWith(EXTERNAL_MEETING_ID_PREFIX) ?? false;
      if (!ours && !spikeLeftover) {
        collector.foreign += 1; // not ours: left in the queue untouched
        continue;
      }
      if (ours && parsed.meetingId) {
        const list = collector.byMeeting.get(parsed.meetingId) ?? [];
        list.push(parsed);
        collector.byMeeting.set(parsed.meetingId, list);
        collector.lastRelevantAt = Date.now();
      }
      if (message.ReceiptHandle) await ctx.sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: message.ReceiptHandle }));
    }
  }
}

function inversions(events: readonly Received[]): number {
  const ordered = events
    .filter((e) => e.sentTimestampMs !== undefined && e.eventTimestampMs !== undefined)
    .sort((a, b) => (a.sentTimestampMs ?? 0) - (b.sentTimestampMs ?? 0));
  let count = 0;
  for (let i = 1; i < ordered.length; i += 1) {
    if ((ordered[i]?.eventTimestampMs ?? 0) < (ordered[i - 1]?.eventTimestampMs ?? 0)) count += 1;
  }
  return count;
}

function pathReport(events: readonly Received[]): Record<string, unknown> {
  const keys = new Map<string, number>();
  for (const e of events) keys.set(`${e.eventType}|${e.attendeeId ?? ''}`, (keys.get(`${e.eventType}|${e.attendeeId ?? ''}`) ?? 0) + 1);
  const eventTypes: Record<string, number> = {};
  for (const e of events) eventTypes[e.eventType ?? 'unknown'] = (eventTypes[e.eventType ?? 'unknown'] ?? 0) + 1;
  return {
    count: events.length,
    eventTypes,
    latencyMs: summarize(events.flatMap((e) => (e.sentTimestampMs !== undefined && e.eventTimestampMs !== undefined ? [e.sentTimestampMs - e.eventTimestampMs] : []))),
    duplicates: [...keys.values()].filter((n) => n > 1).length,
    outOfOrder: inversions(events),
    distinctSenderIds: new Set(events.map((e) => e.senderId ?? 'none')).size,
    timestampFields: [...new Set(events.map((e) => e.timestampField))],
    eventBridgeEnvelope: events.filter((e) => e.eventBridgeEnvelope).length,
    topLevelKeys: [...new Set(events.flatMap((e) => e.topLevelKeys))].sort(),
    detailKeys: [...new Set(events.flatMap((e) => e.detailKeys))].sort(),
  };
}

runSpike({
  meta: {
    id: 'SPIKE-CW-07',
    file: 'spike-cw-07-sqs-latency.ts',
    question: 'What is the delivery latency of direct SQS versus EventBridge to the queue?',
    binds: ['D-CW-12'],
  },
  requiredEnv: ['CHIME_EVENTS_QUEUE_URL', 'CHIME_EVENTS_QUEUE_ARN'],
  options: {
    events: { type: 'string', default: '20', description: 'Attendee events to generate on the test meeting (half added, half deleted)' },
    'interval-ms': { type: 'string', default: '500', description: 'Pause between attendee calls' },
    'collect-seconds': { type: 'string', default: '120', description: 'How long to keep reading the queue after the last call' },
  },
  help: ['Stop the local worker first: it consumes the same queue. Runs about 3 minutes; nobody joins media.'],
  async run(ctx) {
    const queueUrl = ctx.env.queueUrl ?? '';
    const cycles = Math.max(1, Math.ceil(numberArg(ctx.args, 'events', 20) / 2));
    const intervalMs = numberArg(ctx.args, 'interval-ms', 500);
    const collectSeconds = numberArg(ctx.args, 'collect-seconds', 120);

    const attributes = await ctx.sqs.send(
      new GetQueueAttributesCommand({ QueueUrl: queueUrl, AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible'] }),
    );
    const backlog = {
      visible: Number(attributes.Attributes?.ApproximateNumberOfMessages ?? 0),
      inFlight: Number(attributes.Attributes?.ApproximateNumberOfMessagesNotVisible ?? 0),
    };
    if (backlog.visible + backlog.inFlight > 0) {
      ctx.log(`queue backlog before the run: ${backlog.visible} visible, ${backlog.inFlight} in flight (spike-cw-* leftovers are deleted, others left alone)`);
    }

    const meetingIds = new Set<string>();
    const collector: Collector = { byMeeting: new Map(), foreign: 0, unparsable: 0, lastRelevantAt: Date.now(), stop: false };
    let readError: unknown;
    const reading = collect(ctx, queueUrl, meetingIds, collector).catch((error: unknown) => {
      readError = error;
      collector.stop = true;
    });

    const cycle = async (meetingId: string, keyPrefix: string, count: number): Promise<number> => {
      const created: string[] = [];
      let calls = 0;
      for (let i = 1; i <= count && !ctx.signal.aborted; i += 1) {
        const response = await ctx.meetings.send(
          new CreateAttendeeCommand({ MeetingId: meetingId, ExternalUserId: spikeName(ctx, `${keyPrefix}${i}`), Capabilities: CAPABILITIES.employee }),
        );
        if (response.Attendee?.AttendeeId) created.push(response.Attendee.AttendeeId);
        calls += 1;
        await ctx.sleep(intervalMs);
      }
      for (const attendeeId of created) {
        if (ctx.signal.aborted) break;
        await ctx.meetings.send(new DeleteAttendeeCommand({ MeetingId: meetingId, AttendeeId: attendeeId }));
        calls += 1;
        await ctx.sleep(intervalMs);
      }
      return calls;
    };

    try {
      // 1. Control meeting: EventBridge only.
      const control = await createSpikeMeeting(ctx, {
        format: 'consultation',
        label: 'control',
        notifications: false,
        attendees: [{ key: 'c0', capabilities: CAPABILITIES.expert }],
      });
      meetingIds.add(control.meetingId);
      await cycle(control.meetingId, 'c', 2);
      await ctx.cleanup.release(meetingCleanupKey(control.meetingId));

      // 2. Test meeting: direct SQS and EventBridge.
      const test = await createSpikeMeeting(ctx, {
        format: 'consultation',
        label: 'test',
        notifications: true,
        attendees: [{ key: 't0', capabilities: CAPABILITIES.expert }],
      });
      meetingIds.add(test.meetingId);
      const calls = await cycle(test.meetingId, 't', cycles);
      await ctx.cleanup.release(meetingCleanupKey(test.meetingId));
      ctx.log(`made ${calls} attendee calls on the test meeting; reading the queue for up to ${collectSeconds} s`);

      // 3. Read until both paths have delivered the test events and the queue is quiet, or the time is up.
      const deadline = Date.now() + collectSeconds * 1000;
      while (Date.now() < deadline && !ctx.signal.aborted && !collector.stop) {
        const testEvents = collector.byMeeting.get(test.meetingId) ?? [];
        const quietFor = Date.now() - collector.lastRelevantAt;
        if (testEvents.length >= 4 * cycles && quietFor > 20_000) break;
        await ctx.sleep(2000);
      }
      collector.stop = true;
      await reading;
      if (readError) throw readError;

      // 4. Classify by SenderId learnt from the control meeting, else by envelope.
      const controlEvents = collector.byMeeting.get(control.meetingId) ?? [];
      const eventBridgeSenders = new Set(controlEvents.flatMap((e) => (e.senderId ? [e.senderId] : [])));
      const classification = eventBridgeSenders.size > 0 ? 'sender-id-from-control-meeting' : 'envelope-heuristic';
      const pathOf = (e: Received): Path =>
        eventBridgeSenders.size > 0 && e.senderId ? (eventBridgeSenders.has(e.senderId) ? 'eventbridge' : 'direct') : e.eventBridgeEnvelope ? 'eventbridge' : 'direct';
      const testEvents = collector.byMeeting.get(test.meetingId) ?? [];
      const byPath: Record<Path, Received[]> = { direct: [], eventbridge: [] };
      for (const e of testEvents) byPath[pathOf(e)].push(e);

      // 5. Pair the two copies of each event.
      const first = (events: readonly Received[]): Map<string, Received> => {
        const map = new Map<string, Received>();
        for (const e of events) {
          const key = `${e.eventType}|${e.attendeeId ?? ''}`;
          if (!map.has(key)) map.set(key, e);
        }
        return map;
      };
      const direct = first(byPath.direct);
      const eventbridge = first(byPath.eventbridge);
      const gaps: number[] = [];
      let sameTimestamp = 0;
      let pairs = 0;
      for (const [key, d] of direct) {
        const e = eventbridge.get(key);
        if (!e) continue;
        pairs += 1;
        if (d.eventTimestampMs !== undefined && d.eventTimestampMs === e.eventTimestampMs) sameTimestamp += 1;
        if (d.sentTimestampMs !== undefined && e.sentTimestampMs !== undefined) gaps.push(e.sentTimestampMs - d.sentTimestampMs);
      }

      const directReport = pathReport(byPath.direct);
      const eventBridgeReport = pathReport(byPath.eventbridge);
      const gapSummary = summarize(gaps);
      const outcome =
        byPath.direct.length === 0
          ? 'direct-path-missing'
          : byPath.eventbridge.length === 0
            ? 'eventbridge-path-missing'
            : `both-paths: direct median ${String((directReport.latencyMs as { median: number | null }).median)} ms, eventbridge median ${String((eventBridgeReport.latencyMs as { median: number | null }).median)} ms`;
      console.log(`--- answer ---\n  ${outcome}\n  pairs ${pairs}, EventBridge minus direct arrival gap median ${String(gapSummary.median)} ms, identical timestamps ${sameTimestamp}/${pairs}`);
      return {
        outcome,
        ok: byPath.direct.length > 0 && byPath.eventbridge.length > 0,
        measurements: {
          backlogBefore: backlog,
          generated: { testMeetingAttendeeCalls: calls, expectedAttendeeEvents: 2 * cycles },
          controlMeeting: { meetingId: control.meetingId, ...pathReport(controlEvents) },
          classification,
          direct: directReport,
          eventbridge: eventBridgeReport,
          pairs: { count: pairs, eventBridgeMinusDirectMs: gapSummary, identicalTimestamps: sameTimestamp },
          foreignMessagesLeftInQueue: collector.foreign,
          unparsableMessages: collector.unparsable,
        },
        notes:
          byPath.direct.length === 0
            ? ['No direct notification arrived: check the ChimeMeetingsSendEvents queue statement and the ChimeMeetingsEncryptEvents key statement in video-stack.ts (see the comment there), then re-run.']
            : [],
      };
    } finally {
      collector.stop = true;
      await reading;
    }
  },
});
