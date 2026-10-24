/**
 * SPIKE-CW-06 (placeholder until M3): do attendees given the floor in replica
 * meetings lose audio after 40 to 50 minutes? (WEB-39, binds D-CW-14 and D-CW-36.)
 *
 * Run at the start of M3, before replication is built (T-CW-3.1 fills this in).
 * Today it prints the plan and the request shapes it will send, typed against
 * the SDK so they stay correct as the SDK moves; it makes no AWS call. A CHIME_REGION
 * other than eu-central-1 and --run are refused (exit 2, JSON line with status placeholder).
 *
 * Method (WEB-07, WEB-09, D-CW-35):
 *   1. Primary meeting (webinar features) with the presenter.
 *   2. Replica meeting: CreateMeeting with PrimaryMeetingId = the primary.
 *   3. A replica attendee (Receive on audio, video and content) joins the replica.
 *   4. The floor: the server creates an attendee for that person on the PRIMARY meeting with
 *      Audio SendReceive, Video Receive, Content Receive, and the client calls
 *      promoteToPrimaryMeeting with those credentials (WEB-09). T-CW-3.1 step 3 names
 *      UpdateAttendeeCapabilities, which is the single-meeting floor of D-CW-35; replica
 *      attendees only receive the primary's media (WEB-07) and speak by promotion (WEB-09),
 *      so the soak tests the promoted path, which is also the one WEB-39 reports.
 *   5. 60-minute soak: the presenter's page samples the promoted attendee's volume every
 *      10 seconds; the floor attendee sends a continuous fake tone. A dropout is any 30-second
 *      window with no volume while the promoted page still reports itself unmuted.
 *   6. Record the minute of any dropout, then demote (demoteFromPrimaryMeeting) and promote again
 *      to see whether that restores audio (the workaround T-CW-3.2 step 6 would implement).
 *
 *   AWS_PROFILE=nestself-dev AWS_REGION=eu-central-1 pnpm --filter @nestself/api exec tsx scripts/spikes/spike-cw-06-replica-audio.ts
 */
import type { CreateAttendeeCommandInput, CreateMeetingCommandInput } from '@aws-sdk/client-chime-sdk-meetings';
import { CAPABILITIES, CHIME_REGION, MEETING_FEATURES, SpikeRefusal, flagArg, runPrintOnlySpike } from './lib.js';

const SOAK_MINUTES = 60;

function plannedRequests(): Record<string, unknown> {
  const primary: CreateMeetingCommandInput = {
    ClientRequestToken: '<spike token>',
    ExternalMeetingId: 'spike-cw-06-<runId>-primary',
    MediaRegion: CHIME_REGION,
    MeetingFeatures: MEETING_FEATURES.webinar,
    NotificationsConfiguration: { SqsQueueArn: '<CHIME_EVENTS_QUEUE_ARN>' },
    TenantIds: ['spike-cw'],
  };
  const replica: CreateMeetingCommandInput = {
    ...primary,
    ExternalMeetingId: 'spike-cw-06-<runId>-replica-1',
    PrimaryMeetingId: '<primary MeetingId>',
  };
  const replicaAttendee: CreateAttendeeCommandInput = {
    MeetingId: '<replica MeetingId>',
    ExternalUserId: 'spike-cw-06-<runId>-attendee',
    Capabilities: CAPABILITIES.webinarAttendee,
  };
  const floorOnPrimary: CreateAttendeeCommandInput = {
    MeetingId: '<primary MeetingId>',
    ExternalUserId: 'spike-cw-06-<runId>-attendee-floor',
    Capabilities: CAPABILITIES.floor,
  };
  return { primary, replica, replicaAttendee, floorOnPrimary };
}

runPrintOnlySpike(
  {
    meta: {
      id: 'SPIKE-CW-06',
      file: 'spike-cw-06-replica-audio.ts',
      question: 'Do attendees given the floor in replica meetings lose audio after 40 to 50 minutes (WEB-39)?',
      binds: ['D-CW-14', 'D-CW-36'],
    },
    options: { run: { type: 'boolean', description: 'Refused until T-CW-3.1 implements the soak' } },
    help: ['Placeholder: prints the M3 plan and the planned request shapes. Makes no AWS call.'],
  },
  (args) => {
    if (flagArg(args, 'run')) {
      // A refusal: exit 2 with a JSON line carrying status "placeholder".
      throw new SpikeRefusal('The soak is implemented in T-CW-3.1 at the start of M3; this placeholder only prints the plan.', {
        status: 'placeholder',
      });
    }
    console.log(`
PLAN (T-CW-3.1, start of M3, before replication is built)
  1. Primary meeting with the presenter; one replica meeting (PrimaryMeetingId), WEB-07.
  2. A replica attendee joins the replica from Chromium with fake media (browser-harness.ts, a "replica" slot).
  3. The floor: CreateAttendee on the primary with Audio SendReceive, Video Receive, Content Receive (D-CW-35);
     the replica page calls promoteToPrimaryMeeting with those credentials (WEB-09).
  4. Soak ${SOAK_MINUTES} minutes. The presenter page samples the promoted attendee's volume every 10 seconds.
  5. Dropout = a 30-second window with no volume while the promoted page reports itself unmuted and connected.
  6. On a dropout: record the minute, demote and promote again, record whether audio returns.
  7. Cost planning: two attendees for ${SOAK_MINUTES} minutes plus one replica session (COST-01, COST-02; see 07-spikes.md).

PLANNED REQUESTS (typed against @aws-sdk/client-chime-sdk-meetings; placeholders in angle brackets)
${JSON.stringify(plannedRequests(), null, 2)}

HARNESS WORK FOR T-CW-3.1
  - Add a page control that calls audioVideo.promoteToPrimaryMeeting(credentials) and demoteFromPrimaryMeeting(),
    and report audioVideoWasDemotedFromPrimaryMeeting.
  - Sample remote volume per minute on the presenter page and return the per-minute series in the JSON result.`);
    return { outcome: 'placeholder-not-run', measurements: { soakMinutes: SOAK_MINUTES, plannedFor: 'T-CW-3.1' } };
  },
);
