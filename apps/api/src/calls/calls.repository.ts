/**
 * CallsRepository: call sessions, participants, client telemetry, outcomes
 * and feedback (T-CW-1.1). Every method returns contract spellings; the
 * UPPER_CASE enums are mapped in `call-mapper.ts` (CW-R-19a).
 *
 * Every method takes an optional `tx`. The service passes a
 * `DbService.withOrgScope` transaction (RLS) for every write and for every
 * read where the organization is already known (from the appointment or the
 * session). Without a `tx` a read runs in system context; that is left to
 * the lookups that precede the organization: the `callSessionResource`
 * resolver and the first read of a session by id (client events,
 * diagnostics), each after the caller is authorized. No method reads or
 * writes a join token: the credentials live in Redis only (D-CW-08,
 * CW-R-13).
 */
import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, ne, sql } from 'drizzle-orm';
import {
  CLIENT_EVENT_NAMES,
  type CallFormat,
  type CallOutcomeStatus,
  type CallParticipantRole,
  type CallQualityMetrics,
  type CallSessionStatus,
  type ClientEventName,
} from '@nestself/contracts';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { DbService, type DbExecutor } from '../db/db.service.js';
import {
  callClientEvents,
  callEvents,
  callFeedback,
  callOutcomes,
  callParticipants,
  callSessions,
} from '../db/schema/index.js';
import type { AppointmentRecord } from '../appointments/appointments.repository.js';
import {
  fromDbFormat,
  fromDbOutcomeStatus,
  fromDbParticipantRole,
  fromDbSessionStatus,
  toDbFormat,
  toDbOutcomeStatus,
  toDbParticipantRole,
  toDbSessionStatus,
} from './call-mapper.js';

type SessionRow = typeof callSessions.$inferSelect;
type ParticipantRow = typeof callParticipants.$inferSelect;
type DbEndReason = NonNullable<SessionRow['endReason']>;

/**
 * What closed an ENDED session (migration 0009, T-CW-1.2, D-CW-09): the
 * expert's end, Chime's own `MeetingEnded`, or the `calls.cleanup` and
 * `calls.reconcile` jobs. Only `provider` lets a later join inside the window
 * start a new session.
 */
export const CALL_SESSION_END_REASONS = ['expert', 'provider', 'cleanup', 'reconcile'] as const;
export type CallSessionEndReason = (typeof CALL_SESSION_END_REASONS)[number];

const toDbEndReason = (reason: CallSessionEndReason): DbEndReason => reason.toUpperCase() as DbEndReason;
const fromDbEndReason = (reason: DbEndReason): CallSessionEndReason => reason.toLowerCase() as CallSessionEndReason;

/** A `call_sessions` row in contract spelling. `locationText` never leaves the module. */
export interface CallSessionRecord {
  id: string;
  appointmentId: string | null;
  webinarId: string | null;
  orgId: string | null;
  format: CallFormat;
  providerMeetingId: string | null;
  status: CallSessionStatus;
  startsAt: Date;
  endsAt: Date;
  startedAt: Date | null;
  endedAt: Date | null;
  /**
   * What closed the session; null while it is open. Always set by this
   * repository; optional so records built by hand in tests stay valid.
   */
  endReason?: CallSessionEndReason | null;
  locationText: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** A `call_participants` row in contract spelling. */
export interface CallParticipantRecord {
  id: string;
  sessionId: string;
  orgId: string | null;
  userId: string;
  role: CallParticipantRole;
  providerAttendeeId: string | null;
  firstJoinedAt: Date | null;
  lastLeftAt: Date | null;
  reconnectCount: number;
  createdAt: Date;
}

export interface NewCallParticipant {
  sessionId: string;
  orgId: string | null;
  userId: string;
  role: CallParticipantRole;
}

/** Fields a session transition may set besides the status. */
export type CallSessionTransitionFields = Partial<
  Pick<CallSessionRecord, 'providerMeetingId' | 'startedAt' | 'endedAt' | 'locationText'>
>;

export interface NewCallClientEvent {
  sessionId: string;
  orgId: string | null;
  participantId: string;
  eventName: ClientEventName;
  durationMs: number | null;
  metrics: CallQualityMetrics | null;
  deviceError: string | null;
  browser: string | null;
  os: string | null;
}

/**
 * Connection metadata attached to an outcome (CALL-23 criterion 4): the
 * session duration, the client-reported reconnects and the average quality.
 */
export type CallConnectionMetrics = CallQualityMetrics & {
  durationSeconds?: number;
  reconnectCount: number;
};

export interface NewCallOutcome {
  sessionId: string;
  orgId: string | null;
  status: CallOutcomeStatus;
  recordedByUserId: string;
  connectionMetrics: CallConnectionMetrics;
}

export interface NewCallFeedback {
  sessionId: string;
  orgId: string | null;
  userId: string;
  score: number;
  comment: string | null;
}

/**
 * One provider event for `call_events` (D-CW-12). The first four key fields
 * are the dedup key. `payload` carries the source of the copy only, never
 * the provider body.
 */
export interface NewProviderEvent {
  sessionId: string;
  orgId: string | null;
  providerMeetingId: string;
  eventType: string;
  providerAttendeeId: string | null;
  occurredAt: Date;
  payload: Record<string, unknown> | null;
}

/** One participant's client telemetry, summarised for diagnostics. */
export interface ClientEventSummary {
  qualityMetrics: CallQualityMetrics | null;
  /** Failure event names and device error names, codes only. */
  errorCodes: string[];
  reconnectCount: number;
  browser: string | null;
  os: string | null;
}

/** Client events that report a failure; their names are diagnostic error codes. */
const FAILURE_EVENT_NAMES: readonly ClientEventName[] = CLIENT_EVENT_NAMES.filter(
  (name) => name !== 'meetingStartSucceeded' && name !== 'meetingReconnected' && name !== 'connectionStats',
);

/** Provider events that report a failure for an attendee (D-CW-12). */
const PROVIDER_FAILURE_EVENTS = ['AttendeeDropped'] as const;

function toSessionRecord(row: SessionRow): CallSessionRecord {
  return {
    ...row,
    format: fromDbFormat(row.format),
    status: fromDbSessionStatus(row.status),
    endReason: row.endReason ? fromDbEndReason(row.endReason) : null,
  };
}

function toParticipantRecord(row: ParticipantRow): CallParticipantRecord {
  return {
    id: row.id,
    sessionId: row.sessionId,
    orgId: row.orgId,
    userId: row.userId,
    role: fromDbParticipantRole(row.role),
    providerAttendeeId: row.providerAttendeeId,
    firstJoinedAt: row.firstJoinedAt,
    lastLeftAt: row.lastLeftAt,
    reconnectCount: row.reconnectCount,
    createdAt: row.createdAt,
  };
}

/** Average of one metric over the `connectionStats` events, as a float or null. */
function avgMetric(name: keyof CallQualityMetrics) {
  return sql<number | null>`avg((${callClientEvents.metrics} ->> ${name})::float8) filter (where ${callClientEvents.eventName} = 'connectionStats')`;
}

function qualityFrom(row: {
  rtt: number | null;
  jitter: number | null;
  packetLoss: number | null;
  outgoingBitrate: number | null;
}): CallQualityMetrics | null {
  const metrics: CallQualityMetrics = {};
  for (const key of ['rtt', 'jitter', 'packetLoss', 'outgoingBitrate'] as const) {
    const value = row[key];
    if (value !== null && value !== undefined) metrics[key] = Number(value);
  }
  return Object.keys(metrics).length > 0 ? metrics : null;
}

@Injectable()
export class CallsRepository {
  constructor(private readonly dbs: DbService) {}

  private exec(tx?: DbExecutor): DbExecutor {
    return tx ?? this.dbs.db;
  }

  // ── Sessions ──────────────────────────────────────────────────────────────

  async findSessionById(id: string, tx?: DbExecutor): Promise<CallSessionRecord | null> {
    const [row] = await this.exec(tx).select().from(callSessions).where(eq(callSessions.id, id));
    return row ? toSessionRecord(row) : null;
  }

  /**
   * The appointment's newest session that has not failed. The partial unique
   * index allows one besides those the provider ended on its own (T-CW-1.2),
   * so the newest is the live one.
   */
  async findLiveSessionByAppointment(appointmentId: string, tx?: DbExecutor): Promise<CallSessionRecord | null> {
    const [row] = await this.exec(tx)
      .select()
      .from(callSessions)
      .where(and(eq(callSessions.appointmentId, appointmentId), ne(callSessions.status, 'FAILED')))
      .orderBy(desc(callSessions.createdAt), desc(callSessions.id))
      .limit(1);
    return row ? toSessionRecord(row) : null;
  }

  /** The appointment's most recent session in any status, a FAILED one included. */
  async findLatestSessionByAppointment(appointmentId: string, tx?: DbExecutor): Promise<CallSessionRecord | null> {
    const [row] = await this.exec(tx)
      .select()
      .from(callSessions)
      .where(eq(callSessions.appointmentId, appointmentId))
      .orderBy(desc(callSessions.createdAt), desc(callSessions.id))
      .limit(1);
    return row ? toSessionRecord(row) : null;
  }

  /**
   * The appointment's live session, created PENDING with its scheduled window
   * when there is none. Concurrent callers converge on one row: the insert
   * yields to the partial unique index and the select reads the winner.
   */
  async createSessionForAppointment(appointment: AppointmentRecord, tx?: DbExecutor): Promise<CallSessionRecord> {
    const [inserted] = await this.exec(tx)
      .insert(callSessions)
      .values({
        appointmentId: appointment.id,
        orgId: appointment.orgId,
        format: toDbFormat('consultation'),
        status: toDbSessionStatus('pending'),
        startsAt: appointment.startsAt,
        endsAt: appointment.endsAt,
      })
      .onConflictDoNothing()
      .returning();
    if (inserted) return toSessionRecord(inserted);
    const live = await this.findLiveSessionByAppointment(appointment.id, tx);
    if (!live) throw new Error(`call session for appointment ${appointment.id} vanished during creation`);
    return live;
  }

  /**
   * Moves the session to `to` when its status is one of `from` (guidelines
   * 4.9, CW-R-18), setting `fields` in the same statement. Null when the row
   * is missing or another request moved it first.
   */
  async transitionSession(
    id: string,
    from: readonly CallSessionStatus[],
    to: CallSessionStatus,
    fields: CallSessionTransitionFields = {},
    tx?: DbExecutor,
  ): Promise<CallSessionRecord | null> {
    const [row] = await this.exec(tx)
      .update(callSessions)
      .set({ ...fields, status: toDbSessionStatus(to) })
      .where(and(eq(callSessions.id, id), inArray(callSessions.status, from.map(toDbSessionStatus))))
      .returning();
    return row ? toSessionRecord(row) : null;
  }

  /** Sets or clears the CALL-34 location text whatever the status (clearing on outcome). */
  async setLocationText(id: string, locationText: string | null, tx?: DbExecutor): Promise<void> {
    await this.exec(tx).update(callSessions).set({ locationText }).where(eq(callSessions.id, id));
  }

  /**
   * Stores the CALL-34 location text only on an ACTIVE session, so it never
   * lands on a row that fails or never starts (CW-R-80a). False otherwise.
   */
  async setLocationTextIfActive(id: string, locationText: string, tx?: DbExecutor): Promise<boolean> {
    const updated = await this.exec(tx)
      .update(callSessions)
      .set({ locationText })
      .where(and(eq(callSessions.id, id), eq(callSessions.status, toDbSessionStatus('active'))))
      .returning({ id: callSessions.id });
    return updated.length > 0;
  }

  /** The session whose provider meeting this is (T-CW-1.2, event applier). */
  async findSessionByProviderMeetingId(providerMeetingId: string, tx?: DbExecutor): Promise<CallSessionRecord | null> {
    const [row] = await this.exec(tx)
      .select()
      .from(callSessions)
      .where(eq(callSessions.providerMeetingId, providerMeetingId));
    return row ? toSessionRecord(row) : null;
  }

  /** Every ACTIVE session, soonest end first (`calls.reconcile`, CW-R-38). */
  async listActiveSessions(tx?: DbExecutor): Promise<CallSessionRecord[]> {
    const rows = await this.exec(tx)
      .select()
      .from(callSessions)
      .where(eq(callSessions.status, toDbSessionStatus('active')))
      .orderBy(asc(callSessions.endsAt), asc(callSessions.id));
    return rows.map(toSessionRecord);
  }

  /**
   * Records who is ending an ACTIVE session before the provider is asked to
   * end it, so a `MeetingEnded` event that arrives first keeps this reason
   * (T-CW-1.2). The first stamp wins. False when the session is not ACTIVE or
   * already stamped.
   */
  async stampEndReason(id: string, reason: CallSessionEndReason, tx?: DbExecutor): Promise<boolean> {
    const updated = await this.exec(tx)
      .update(callSessions)
      .set({ endReason: toDbEndReason(reason) })
      .where(
        and(
          eq(callSessions.id, id),
          eq(callSessions.status, toDbSessionStatus('active')),
          sql`${callSessions.endReason} IS NULL`,
        ),
      )
      .returning({ id: callSessions.id });
    return updated.length > 0;
  }

  /**
   * ACTIVE to ENDED exactly once (guidelines 4.9, CW-R-39): sets `ended_at`,
   * clears the location text (CW-R-80a) and keeps an earlier end-reason stamp
   * over `reason`. Null when the session is not ACTIVE.
   */
  async closeSession(
    id: string,
    close: { endedAt: Date; reason: CallSessionEndReason },
    tx?: DbExecutor,
  ): Promise<CallSessionRecord | null> {
    const [row] = await this.exec(tx)
      .update(callSessions)
      .set({
        status: toDbSessionStatus('ended'),
        endedAt: close.endedAt,
        locationText: null,
        endReason: sql`coalesce(${callSessions.endReason}, ${toDbEndReason(close.reason)}::call_session_end_reason)`,
      })
      .where(and(eq(callSessions.id, id), eq(callSessions.status, toDbSessionStatus('active'))))
      .returning();
    return row ? toSessionRecord(row) : null;
  }

  // ── Participants ──────────────────────────────────────────────────────────

  async findParticipant(sessionId: string, userId: string, tx?: DbExecutor): Promise<CallParticipantRecord | null> {
    const [row] = await this.exec(tx)
      .select()
      .from(callParticipants)
      .where(and(eq(callParticipants.sessionId, sessionId), eq(callParticipants.userId, userId)));
    return row ? toParticipantRecord(row) : null;
  }

  /** The person's participant row in the session, created with a fresh random id on first use (D-CW-11). */
  async ensureParticipant(input: NewCallParticipant, tx?: DbExecutor): Promise<CallParticipantRecord> {
    const [inserted] = await this.exec(tx)
      .insert(callParticipants)
      .values({ ...input, role: toDbParticipantRole(input.role) })
      .onConflictDoNothing()
      .returning();
    if (inserted) return toParticipantRecord(inserted);
    const existing = await this.findParticipant(input.sessionId, input.userId, tx);
    if (!existing) throw new Error(`call participant of session ${input.sessionId} vanished during creation`);
    return existing;
  }

  /** A participant by its id, the provider's `ExternalUserId` (T-CW-1.2). */
  async findParticipantById(id: string, tx?: DbExecutor): Promise<CallParticipantRecord | null> {
    const [row] = await this.exec(tx).select().from(callParticipants).where(eq(callParticipants.id, id));
    return row ? toParticipantRecord(row) : null;
  }

  /** The session's participant holding this provider attendee (T-CW-1.2). */
  async findParticipantByProviderAttendee(
    sessionId: string,
    providerAttendeeId: string,
    tx?: DbExecutor,
  ): Promise<CallParticipantRecord | null> {
    const [row] = await this.exec(tx)
      .select()
      .from(callParticipants)
      .where(and(eq(callParticipants.sessionId, sessionId), eq(callParticipants.providerAttendeeId, providerAttendeeId)));
    return row ? toParticipantRecord(row) : null;
  }

  /**
   * `AttendeeJoined` (CW-R-39): the earliest join wins, so a reconnect never
   * moves `first_joined_at` and an out-of-order earlier join still lands.
   */
  async recordParticipantJoined(id: string, at: Date, tx?: DbExecutor): Promise<void> {
    await this.exec(tx)
      .update(callParticipants)
      .set({ firstJoinedAt: sql`least(${callParticipants.firstJoinedAt}, ${at.toISOString()}::timestamptz)` })
      .where(eq(callParticipants.id, id));
  }

  /** `AttendeeLeft` and `AttendeeDropped` (CW-R-39): `last_left_at` only moves forward. */
  async recordParticipantLeft(id: string, at: Date, tx?: DbExecutor): Promise<void> {
    await this.exec(tx)
      .update(callParticipants)
      .set({ lastLeftAt: sql`greatest(${callParticipants.lastLeftAt}, ${at.toISOString()}::timestamptz)` })
      .where(eq(callParticipants.id, id));
  }

  async setProviderAttendee(participantId: string, providerAttendeeId: string, tx?: DbExecutor): Promise<void> {
    await this.exec(tx)
      .update(callParticipants)
      .set({ providerAttendeeId })
      .where(eq(callParticipants.id, participantId));
  }

  async listParticipants(sessionId: string, tx?: DbExecutor): Promise<CallParticipantRecord[]> {
    const rows = await this.exec(tx)
      .select()
      .from(callParticipants)
      .where(eq(callParticipants.sessionId, sessionId))
      .orderBy(asc(callParticipants.createdAt), asc(callParticipants.id));
    return rows.map(toParticipantRecord);
  }

  // ── Client telemetry (D-CW-13) ────────────────────────────────────────────

  async insertClientEvents(rows: readonly NewCallClientEvent[], tx?: DbExecutor): Promise<void> {
    if (rows.length === 0) return;
    await this.exec(tx).insert(callClientEvents).values([...rows]);
  }

  /** Outcome metadata: duration from the session, reconnects and average quality from the client events. */
  async connectionMetrics(session: CallSessionRecord, now: Date, tx?: DbExecutor): Promise<CallConnectionMetrics> {
    const [row] = await this.exec(tx)
      .select({
        reconnectCount: sql<number>`count(*) filter (where ${callClientEvents.eventName} = 'meetingReconnected')`.mapWith(
          Number,
        ),
        rtt: avgMetric('rtt'),
        jitter: avgMetric('jitter'),
        packetLoss: avgMetric('packetLoss'),
        outgoingBitrate: avgMetric('outgoingBitrate'),
      })
      .from(callClientEvents)
      .where(eq(callClientEvents.sessionId, session.id));
    const metrics: CallConnectionMetrics = {
      ...(row ? qualityFrom(row) : null),
      reconnectCount: row?.reconnectCount ?? 0,
    };
    if (session.startedAt) {
      const end = session.endedAt ?? now;
      metrics.durationSeconds = Math.max(0, Math.round((end.getTime() - session.startedAt.getTime()) / 1000));
    }
    return metrics;
  }

  /** Per participant id: average quality, failure codes, reconnects and the latest browser and OS. */
  async clientEventSummaries(sessionId: string, tx?: DbExecutor): Promise<Map<string, ClientEventSummary>> {
    const failures = sql.join(
      FAILURE_EVENT_NAMES.map((name) => sql`${name}`),
      sql`, `,
    );
    const rows = await this.exec(tx)
      .select({
        participantId: callClientEvents.participantId,
        rtt: avgMetric('rtt'),
        jitter: avgMetric('jitter'),
        packetLoss: avgMetric('packetLoss'),
        outgoingBitrate: avgMetric('outgoingBitrate'),
        failures: sql<
          string[] | null
        >`array_agg(distinct ${callClientEvents.eventName}) filter (where ${callClientEvents.eventName} in (${failures}))`,
        deviceErrors: sql<
          string[] | null
        >`array_agg(distinct ${callClientEvents.deviceError}) filter (where ${callClientEvents.deviceError} is not null)`,
        reconnectCount: sql<number>`count(*) filter (where ${callClientEvents.eventName} = 'meetingReconnected')`.mapWith(
          Number,
        ),
        browser: sql<
          string | null
        >`(array_agg(${callClientEvents.browser} order by ${callClientEvents.createdAt} desc) filter (where ${callClientEvents.browser} is not null))[1]`,
        os: sql<
          string | null
        >`(array_agg(${callClientEvents.os} order by ${callClientEvents.createdAt} desc) filter (where ${callClientEvents.os} is not null))[1]`,
      })
      .from(callClientEvents)
      .where(eq(callClientEvents.sessionId, sessionId))
      .groupBy(callClientEvents.participantId);
    return new Map(
      rows.map((row) => [
        row.participantId,
        {
          qualityMetrics: qualityFrom(row),
          errorCodes: [...(row.failures ?? []), ...(row.deviceErrors ?? [])],
          reconnectCount: row.reconnectCount,
          browser: row.browser,
          os: row.os,
        },
      ]),
    );
  }

  /** Per provider attendee id: the provider failure events it had (D-CW-12; written by T-CW-1.2). */
  async providerErrorCodes(sessionId: string, tx?: DbExecutor): Promise<Map<string, string[]>> {
    const rows = await this.exec(tx)
      .selectDistinct({ attendeeId: callEvents.providerAttendeeId, eventType: callEvents.eventType })
      .from(callEvents)
      .where(and(eq(callEvents.sessionId, sessionId), inArray(callEvents.eventType, [...PROVIDER_FAILURE_EVENTS])));
    const codes = new Map<string, string[]>();
    for (const row of rows) {
      if (!row.attendeeId) continue;
      codes.set(row.attendeeId, [...(codes.get(row.attendeeId) ?? []), row.eventType]);
    }
    return codes;
  }

  // ── Provider events (D-CW-12, T-CW-1.2) ───────────────────────────────────

  /**
   * Stores one provider event. False when an event with the same
   * `(provider_meeting_id, event_type, provider_attendee_id, occurred_at)` is
   * already stored: the copy is a duplicate and must change nothing.
   */
  async insertProviderEvent(values: NewProviderEvent, tx?: DbExecutor): Promise<boolean> {
    const inserted = await this.exec(tx)
      .insert(callEvents)
      .values(values)
      .onConflictDoNothing()
      .returning({ id: callEvents.id });
    return inserted.length > 0;
  }

  /** Whether the attendee has an event of `eventType` after `after` (a rejoin after an older leave). */
  async hasLaterProviderEvent(
    providerMeetingId: string,
    providerAttendeeId: string,
    eventType: string,
    after: Date,
    tx?: DbExecutor,
  ): Promise<boolean> {
    const rows = await this.exec(tx)
      .select({ id: callEvents.id })
      .from(callEvents)
      .where(
        and(
          eq(callEvents.providerMeetingId, providerMeetingId),
          eq(callEvents.providerAttendeeId, providerAttendeeId),
          eq(callEvents.eventType, eventType),
          gt(callEvents.occurredAt, after),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  // ── Outcome and feedback ──────────────────────────────────────────────────

  /** The outcome recorded on the appointment's newest session that has one (`calls.no_show_followup`). */
  async findLatestOutcomeStatus(appointmentId: string, tx?: DbExecutor): Promise<CallOutcomeStatus | null> {
    const [row] = await this.exec(tx)
      .select({ status: callOutcomes.status })
      .from(callOutcomes)
      .innerJoin(callSessions, eq(callSessions.id, callOutcomes.sessionId))
      .where(eq(callSessions.appointmentId, appointmentId))
      .orderBy(desc(callOutcomes.createdAt), desc(callOutcomes.id))
      .limit(1);
    return row ? fromDbOutcomeStatus(row.status) : null;
  }

  async insertOutcome(values: NewCallOutcome, tx?: DbExecutor): Promise<void> {
    await this.exec(tx)
      .insert(callOutcomes)
      .values({ ...values, status: toDbOutcomeStatus(values.status) });
  }

  /** False when this person already gave feedback on the session. */
  async insertFeedback(values: NewCallFeedback, tx?: DbExecutor): Promise<boolean> {
    const inserted = await this.exec(tx)
      .insert(callFeedback)
      .values(values)
      .onConflictDoNothing()
      .returning({ id: callFeedback.id });
    return inserted.length > 0;
  }
}
