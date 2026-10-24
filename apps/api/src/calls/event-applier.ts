/**
 * EventApplier: applies one provider meeting event to the call tables
 * (T-CW-1.2, D-CW-12, guidelines 9.1, CW-R-39).
 *
 * Events arrive at least once and out of order (OPS-15): the SQS consumer
 * delivers both the direct `CreateMeeting` notification and the EventBridge
 * copy, and `FakeVideoProvider` delivers in process. Every event is first
 * written to `call_events` under its unique key `(provider_meeting_id,
 * event_type, provider_attendee_id, occurred_at)`; a copy that hits the key
 * is a duplicate and changes nothing. The insert and the state change share
 * one transaction, so a failure leaves neither and the redelivered copy is
 * applied in full.
 *
 * State changes, safe in any order:
 * - `MeetingStarted`: schedules `calls.cleanup` at `endsAt + 15 minutes`
 *   (D-CW-09). The join path (`CallsService`) does not schedule it, so this is
 *   where a session becomes known to the jobs; `calls.reconcile` is the safety
 *   net for a session whose event never came.
 * - `AttendeeJoined`: `first_joined_at` keeps the earliest join.
 * - `AttendeeLeft` and `AttendeeDropped`: `last_left_at` keeps the latest
 *   leave; the call room hears `call.participant.left` unless a later
 *   `AttendeeJoined` of the same attendee (a reconnect, OPS-12) is already
 *   stored.
 * - `MeetingEnded`: the session closes exactly once (`CallSessionLifecycle`):
 *   ENDED, `ended_at`, location text cleared, credentials dropped,
 *   `call.session.ended` emitted. Its end reason is `provider` unless the
 *   expert or a job stamped theirs before calling the provider.
 *
 * Other event names (`AttendeeAuthorized`, `AttendeeVideoStarted` and the
 * rest of OPS-10) are stored and otherwise ignored. An event for a meeting no
 * session knows is reported as `unknown_meeting`, and the consumer deletes it
 * rather than retrying. `MeetingEnded` for a session still CREATING throws
 * {@link CallEventNotReadyError}, so the message is retried after its
 * visibility timeout, when the session is ACTIVE.
 *
 * Logs carry ids only, at debug level (an event has meeting and attendee ids,
 * never a token).
 */
import { Injectable, Logger } from '@nestjs/common';
import type { DbExecutor } from '../db/db.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { CallsJobSchedulerService } from '../jobs/calls-job-scheduler.service.js';
import { VIDEO_PROVIDER_EVENT_TYPES, type VideoProviderEventType } from '../video/video-provider.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { CallsRepository, type CallParticipantRecord, type CallSessionRecord } from './calls.repository.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { CallsService } from './calls.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { CallSessionLifecycle } from './session-lifecycle.js';

/** Where a copy of an event came from; stored as the event's only payload. */
export type CallProviderEventSource = 'notification' | 'eventbridge' | 'fake';

/**
 * One provider meeting event in the shape the applier takes, whatever the
 * envelope it arrived in (`normaliseChimeEvent`, `fromFakeEvent`).
 */
export interface CallProviderEvent {
  /** The Chime event name without its `chime:` prefix (`AttendeeJoined`). */
  eventType: string;
  providerMeetingId: string;
  /** Null for meeting-level events. */
  providerAttendeeId: string | null;
  occurredAt: Date;
  /** `ExternalMeetingId`: the `call_sessions.id`. */
  externalMeetingId: string | null;
  /** `ExternalUserId`: the `call_participants.id`; null for meeting-level events. */
  externalUserId: string | null;
  source: CallProviderEventSource;
}

export type ApplyResult = 'applied' | 'duplicate' | 'unknown_meeting';

/** The event cannot be applied yet; the consumer leaves the message for redelivery. */
export class CallEventNotReadyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CallEventNotReadyError';
  }
}

/** What to do once the transaction committed. */
interface Effects {
  scheduleCleanup?: boolean;
  left?: CallParticipantRecord;
  closed?: CallSessionRecord;
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}

/** The event names the applier acts on, as the fake provider emits them; null for any other. */
function knownEventType(name: string): VideoProviderEventType | null {
  return (VIDEO_PROVIDER_EVENT_TYPES as readonly string[]).includes(name) ? (name as VideoProviderEventType) : null;
}

@Injectable()
export class EventApplier {
  private readonly logger = new Logger(EventApplier.name);

  constructor(
    private readonly repo: CallsRepository,
    private readonly lifecycle: CallSessionLifecycle,
    private readonly calls: CallsService,
    private readonly scheduler: CallsJobSchedulerService,
  ) {}

  async apply(event: CallProviderEvent): Promise<ApplyResult> {
    const session = await this.findSession(event);
    if (!session) {
      this.logger.debug(
        { providerMeetingId: event.providerMeetingId, eventType: event.eventType },
        'Provider event for an unknown meeting dropped',
      );
      return 'unknown_meeting';
    }

    // A meeting other than the session's own: one a lost creation race left behind (CallsService).
    const stray = session.providerMeetingId !== null && session.providerMeetingId !== event.providerMeetingId;
    if (!stray && event.eventType === 'MeetingEnded' && session.status === 'creating') {
      throw new CallEventNotReadyError('MeetingEnded arrived before the session became active');
    }

    const effects = await this.lifecycle.scoped(session.orgId, async (tx) => {
      const stored = await this.repo.insertProviderEvent(
        {
          sessionId: session.id,
          orgId: session.orgId,
          providerMeetingId: event.providerMeetingId,
          eventType: event.eventType,
          providerAttendeeId: event.providerAttendeeId,
          occurredAt: event.occurredAt,
          payload: { source: event.source },
        },
        tx,
      );
      if (!stored) return null;
      return stray ? {} : this.applyState(event, session, tx);
    });

    if (!effects) {
      this.logger.debug(
        { sessionId: session.id, eventType: event.eventType, providerAttendeeId: event.providerAttendeeId },
        'Duplicate provider event dropped',
      );
      return 'duplicate';
    }
    await this.afterCommit(session, effects);
    this.logger.debug(
      { sessionId: session.id, eventType: event.eventType, providerAttendeeId: event.providerAttendeeId },
      'Provider event applied',
    );
    return 'applied';
  }

  private async applyState(event: CallProviderEvent, session: CallSessionRecord, tx: DbExecutor): Promise<Effects> {
    const eventType = knownEventType(event.eventType);
    // Any other name (OPS-10) is stored and otherwise ignored.
    if (!eventType) return {};
    switch (eventType) {
      case 'MeetingStarted':
        return { scheduleCleanup: session.status !== 'ended' && session.status !== 'failed' };
      case 'AttendeeJoined': {
        const participant = await this.findParticipant(event, session, tx);
        if (participant) await this.repo.recordParticipantJoined(participant.id, event.occurredAt, tx);
        return {};
      }
      case 'AttendeeLeft':
      case 'AttendeeDropped': {
        const participant = await this.findParticipant(event, session, tx);
        if (!participant) return {};
        await this.repo.recordParticipantLeft(participant.id, event.occurredAt, tx);
        const rejoined = event.providerAttendeeId
          ? await this.repo.hasLaterProviderEvent(
              event.providerMeetingId,
              event.providerAttendeeId,
              'AttendeeJoined',
              event.occurredAt,
              tx,
            )
          : false;
        return rejoined ? {} : { left: participant };
      }
      case 'MeetingEnded': {
        const closed = await this.lifecycle.closeInTransaction(
          session.id,
          { endedAt: event.occurredAt, reason: 'provider' },
          tx,
        );
        return closed ? { closed } : {};
      }
      default: {
        const unhandled: never = eventType;
        throw new Error(`Unhandled provider event ${String(unhandled)}`);
      }
    }
  }

  private async afterCommit(session: CallSessionRecord, effects: Effects): Promise<void> {
    if (effects.scheduleCleanup) {
      try {
        await this.scheduler.scheduleCleanup(session);
      } catch (error) {
        // calls.reconcile schedules it on its next sweep.
        this.logger.warn({ sessionId: session.id, operation: 'scheduleCleanup', error: errorName(error) }, 'Cleanup not scheduled');
      }
    }
    if (effects.left) {
      try {
        this.calls.notifyParticipantLeft(session.id, effects.left);
      } catch (error) {
        this.logger.warn({ sessionId: session.id, operation: 'notifyLeft', error: errorName(error) }, 'Leave not announced');
      }
    }
    // Never throws: the event is committed, and its redelivery would be a duplicate.
    if (effects.closed) await this.lifecycle.announceClosed(effects.closed);
  }

  /** By provider meeting id; a session still CREATING has none yet and is found by its own id. */
  private async findSession(event: CallProviderEvent): Promise<CallSessionRecord | null> {
    const byMeeting = await this.repo.findSessionByProviderMeetingId(event.providerMeetingId);
    if (byMeeting) return byMeeting;
    return event.externalMeetingId ? this.repo.findSessionById(event.externalMeetingId) : null;
  }

  /** By `ExternalUserId` (the participant id), else by attendee id, within the session. */
  private async findParticipant(
    event: CallProviderEvent,
    session: CallSessionRecord,
    tx: DbExecutor,
  ): Promise<CallParticipantRecord | null> {
    if (event.externalUserId) {
      const byId = await this.repo.findParticipantById(event.externalUserId, tx);
      if (byId?.sessionId === session.id) return byId;
    }
    return event.providerAttendeeId
      ? this.repo.findParticipantByProviderAttendee(session.id, event.providerAttendeeId, tx)
      : null;
  }
}
