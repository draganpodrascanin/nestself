/**
 * SPIKE-CW-02: does CreateAttendee with a repeated ExternalUserId return the
 * existing attendee? (OPS open question 2, binds D-CW-08.)
 *
 * One consultation meeting, created with the expert's attendee. Then:
 *   A. CreateAttendee twice in sequence with the same ExternalUserId (the employee);
 *   B. CreateAttendee twice concurrently with another ExternalUserId (two devices at once);
 *   C. CreateAttendee with the ExternalUserId of the attendee CreateMeetingWithAttendees made
 *      (the first joiner's credentials lost from Redis).
 * Join tokens are compared for equality inside this process; they are never printed.
 * No attendee joins media.
 *
 *   AWS_PROFILE=nestself-dev AWS_REGION=eu-central-1 pnpm --filter @nestself/api exec tsx scripts/spikes/spike-cw-02-external-user-id.ts
 */
import { CreateAttendeeCommand, type Attendee } from '@aws-sdk/client-chime-sdk-meetings';
import { CAPABILITIES, createSpikeMeeting, describeError, requireAttendee, runSpike, spikeName, type ErrorInfo, type SpikeContext } from './lib.js';

type AttendeeResult = { readonly ok: true; readonly attendee: Attendee; readonly ms: number } | { readonly ok: false; readonly error: ErrorInfo; readonly ms: number };

async function createAttendee(ctx: SpikeContext, meetingId: string, externalUserId: string): Promise<AttendeeResult> {
  const started = Date.now();
  try {
    const response = await ctx.meetings.send(
      new CreateAttendeeCommand({ MeetingId: meetingId, ExternalUserId: externalUserId, Capabilities: CAPABILITIES.employee }),
    );
    if (!response.Attendee?.AttendeeId) throw new Error('CreateAttendee returned no attendee');
    return { ok: true, attendee: response.Attendee, ms: Date.now() - started };
  } catch (error) {
    return { ok: false, error: describeError(error), ms: Date.now() - started };
  }
}

function compare(first: AttendeeResult | Attendee, second: AttendeeResult): Record<string, unknown> & { outcome: string } {
  const a = 'ok' in first ? (first.ok ? first.attendee : undefined) : first;
  if (!a) return { outcome: 'first-call-failed', first: 'ok' in first && !first.ok ? first.error : null };
  if (!second.ok) return { outcome: `error:${second.error.name}`, firstAttendeeId: a.AttendeeId, secondError: second.error };
  const b = second.attendee;
  return {
    outcome: a.AttendeeId === b.AttendeeId ? 'same-attendee' : 'new-attendee',
    firstAttendeeId: a.AttendeeId,
    secondAttendeeId: b.AttendeeId,
    joinTokenEqual: a.JoinToken === b.JoinToken,
    secondMs: second.ms,
  };
}

runSpike({
  meta: {
    id: 'SPIKE-CW-02',
    file: 'spike-cw-02-external-user-id.ts',
    question: 'Does CreateAttendee with a repeated ExternalUserId return the existing attendee?',
    binds: ['D-CW-08'],
  },
  requiredEnv: ['CHIME_EVENTS_QUEUE_ARN'],
  help: ['Creates one meeting (MaxCount 10) and up to six attendees; nobody joins media. The meeting is deleted at the end.'],
  async run(ctx) {
    const meeting = await createSpikeMeeting(ctx, {
      format: 'consultation',
      label: 'm',
      // The expert plus up to five more attendees (cases A, B and C) must fit.
      maxCount: 10,
      attendees: [{ key: 'expert', capabilities: CAPABILITIES.expert }],
    });
    const expert = requireAttendee(meeting, 'expert');

    ctx.log('case A: CreateAttendee twice in sequence with the same ExternalUserId');
    const employeeId = spikeName(ctx, 'employee');
    const a1 = await createAttendee(ctx, meeting.meetingId, employeeId);
    const a2 = await createAttendee(ctx, meeting.meetingId, employeeId);
    const caseA = compare(a1, a2);

    ctx.log('case B: CreateAttendee twice concurrently with the same ExternalUserId');
    const deviceId = spikeName(ctx, 'two-devices');
    const [b1, b2] = await Promise.all([createAttendee(ctx, meeting.meetingId, deviceId), createAttendee(ctx, meeting.meetingId, deviceId)]);
    const caseB = compare(b1, b2);

    ctx.log('case C: CreateAttendee with the ExternalUserId CreateMeetingWithAttendees used');
    const c = await createAttendee(ctx, meeting.meetingId, spikeName(ctx, 'expert'));
    const caseC = compare(expert, c);

    console.log(`--- answer ---\n  sequential: ${caseA.outcome}\n  concurrent: ${caseB.outcome}\n  after CreateMeetingWithAttendees: ${caseC.outcome}`);
    return {
      outcome: `sequential=${caseA.outcome}; concurrent=${caseB.outcome}; after-create-with-attendees=${caseC.outcome}`,
      ok: caseA.outcome !== 'first-call-failed',
      measurements: { meetingId: meeting.meetingId, sequential: caseA, concurrent: caseB, afterCreateWithAttendees: caseC },
    };
  },
});
