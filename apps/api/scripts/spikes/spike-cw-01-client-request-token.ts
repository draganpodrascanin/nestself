/**
 * SPIKE-CW-01: does a repeated ClientRequestToken on CreateMeetingWithAttendees
 * return the same meeting, a ConflictException, or a second meeting? (OPS-01,
 * binds D-CW-07 and CW-R-11.)
 *
 * Three phases, each with its own token and ExternalMeetingId:
 *   A. two calls with identical input launched together (0 ms apart);
 *   B. two calls with identical input 2 s apart;
 *   C. after B's meeting is deleted, a third call with B's token: does the token
 *      hand back the deleted meeting? (A session whose meeting auto-ended after
 *      5 empty minutes would reuse its `call_sessions.id` as the token.)
 * No attendee joins media, so no attendee-minutes accrue.
 *
 *   pnpm --filter @nestself/api exec tsx scripts/spikes/spike-cw-01-client-request-token.ts
 */
import { CreateMeetingWithAttendeesCommand, GetMeetingCommand } from '@aws-sdk/client-chime-sdk-meetings';
import {
  CAPABILITIES,
  attendeeIds,
  buildCreateMeetingInput,
  describeError,
  isNotFound,
  meetingCleanupKey,
  newClientRequestToken,
  numberArg,
  registerMeeting,
  runSpike,
  type ErrorInfo,
  type SpikeContext,
} from './lib.js';

type CallResult =
  | { readonly ok: true; readonly meetingId: string; readonly attendeeIds: string[]; readonly startedAtMs: number; readonly ms: number }
  | { readonly ok: false; readonly error: ErrorInfo; readonly startedAtMs: number; readonly ms: number };

type PairOutcome = 'same-meeting' | 'second-meeting' | 'conflict' | 'first-call-failed' | `error:${string}`;

async function createOnce(ctx: SpikeContext, input: ReturnType<typeof buildCreateMeetingInput>, t0: number): Promise<CallResult> {
  const startedAtMs = Date.now() - t0;
  const started = Date.now();
  try {
    const response = await ctx.meetings.send(new CreateMeetingWithAttendeesCommand(input));
    const meetingId = response.Meeting?.MeetingId;
    if (!meetingId) throw new Error('CreateMeetingWithAttendees returned no meeting');
    registerMeeting(ctx, meetingId);
    return { ok: true, meetingId, attendeeIds: attendeeIds(response.Attendees ?? []), startedAtMs, ms: Date.now() - started };
  } catch (error) {
    return { ok: false, error: describeError(error), startedAtMs, ms: Date.now() - started };
  }
}

function classify(first: CallResult, second: CallResult): PairOutcome {
  if (!first.ok && !second.ok) return 'first-call-failed';
  // In a concurrent pair either call may lose; normalise so `winner` succeeded.
  const [winner, other] = first.ok ? [first, second] : [second, first];
  if (!winner.ok) return 'first-call-failed';
  if (other.ok) return other.meetingId === winner.meetingId ? 'same-meeting' : 'second-meeting';
  return other.error.name === 'ConflictException' ? 'conflict' : `error:${other.error.name}`;
}

function show(label: string, result: CallResult): void {
  const at = `t+${result.startedAtMs} ms, ${result.ms} ms`;
  console.log(
    result.ok
      ? `  ${label}: meeting ${result.meetingId}, attendees ${result.attendeeIds.join(', ')} (${at})`
      : `  ${label}: ${result.error.name}${result.error.httpStatus ? ` (HTTP ${result.error.httpStatus})` : ''}: ${result.error.message} (${at})`,
  );
}

function summary(result: CallResult): Record<string, unknown> {
  return result.ok
    ? { meetingId: result.meetingId, attendeeIds: result.attendeeIds, startedAtMs: result.startedAtMs, ms: result.ms }
    : { error: result.error, startedAtMs: result.startedAtMs, ms: result.ms };
}

runSpike({
  meta: {
    id: 'SPIKE-CW-01',
    file: 'spike-cw-01-client-request-token.ts',
    question: 'Does a repeated ClientRequestToken return the same meeting, a ConflictException, or a second meeting?',
    binds: ['D-CW-07'],
  },
  requiredEnv: ['CHIME_EVENTS_QUEUE_ARN'],
  options: {
    'gap-ms': { type: 'string', default: '2000', description: 'Delay between the two calls of phase B, in milliseconds' },
  },
  help: ['Creates up to four meetings with one attendee each; nobody joins media. Every meeting is deleted at the end.'],
  async run(ctx) {
    const gapMs = numberArg(ctx.args, 'gap-ms', 2000);
    const attendees = [{ key: 'p1', capabilities: CAPABILITIES.expert }];

    // Phase A: same token, launched together.
    const inputA = buildCreateMeetingInput(ctx, { format: 'consultation', label: 'a', attendees, clientRequestToken: newClientRequestToken(ctx) });
    ctx.log(`phase A: two CreateMeetingWithAttendees with token ${inputA.ClientRequestToken} launched together`);
    const t0 = Date.now();
    const [a1, a2] = await Promise.all([createOnce(ctx, inputA, t0), createOnce(ctx, inputA, t0)]);
    show('A call 1', a1);
    show('A call 2', a2);
    const outcomeA = classify(a1, a2);

    // Phase B: same token, gapMs apart.
    const inputB = buildCreateMeetingInput(ctx, { format: 'consultation', label: 'b', attendees, clientRequestToken: newClientRequestToken(ctx) });
    ctx.log(`phase B: two calls with token ${inputB.ClientRequestToken}, ${gapMs} ms apart`);
    const t1 = Date.now();
    const b1 = await createOnce(ctx, inputB, t1);
    await ctx.sleep(gapMs);
    const b2 = await createOnce(ctx, inputB, t1);
    show('B call 1', b1);
    show('B call 2', b2);
    const outcomeB = classify(b1, b2);

    // Phase C: B's token again after B's meeting is deleted.
    let outcomeC = 'skipped';
    let c: CallResult | undefined;
    let returnedMeetingAlive: boolean | null = null;
    const deletedIds = new Set([b1, b2].flatMap((r) => (r.ok ? [r.meetingId] : [])));
    if (deletedIds.size > 0 && !ctx.signal.aborted) {
      for (const id of deletedIds) await ctx.cleanup.release(meetingCleanupKey(id));
      ctx.log(`phase C: deleted ${[...deletedIds].join(', ')}; calling again with token ${inputB.ClientRequestToken} after 2 s`);
      await ctx.sleep(2000);
      c = await createOnce(ctx, inputB, Date.now());
      show('C call', c);
      if (c.ok) {
        try {
          await ctx.meetings.send(new GetMeetingCommand({ MeetingId: c.meetingId }));
          returnedMeetingAlive = true;
        } catch (error) {
          if (!isNotFound(error)) throw error;
          returnedMeetingAlive = false;
        }
        outcomeC = deletedIds.has(c.meetingId)
          ? returnedMeetingAlive
            ? 'deleted-meeting-id-returned-and-alive'
            : 'deleted-meeting-returned'
          : 'new-meeting';
      } else {
        outcomeC = c.error.name === 'ConflictException' ? 'conflict' : `error:${c.error.name}`;
      }
    }

    console.log(`--- answer ---\n  0 ms apart: ${outcomeA}\n  ${gapMs} ms apart: ${outcomeB}\n  after delete: ${outcomeC}`);
    return {
      outcome: `0ms=${outcomeA}; ${gapMs}ms=${outcomeB}; after-delete=${outcomeC}`,
      ok: outcomeA !== 'first-call-failed' && outcomeB !== 'first-call-failed',
      measurements: {
        phaseA: { outcome: outcomeA, calls: [summary(a1), summary(a2)] },
        phaseB: { outcome: outcomeB, gapMs, calls: [summary(b1), summary(b2)] },
        phaseC: { outcome: outcomeC, call: c ? summary(c) : null, returnedMeetingAlive },
      },
    };
  },
});
