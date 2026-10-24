/**
 * EventApplier unit tests (T-CW-1.2, CW-R-39, CW-R-83): duplicates are
 * dropped on the `call_events` key, attendee timestamps survive any arrival
 * order, `MeetingEnded` closes the session exactly once with its side
 * effects, unknown events are stored and ignored, unknown meetings are
 * reported, and `MeetingStarted` schedules `calls.cleanup`.
 *
 * The repository is in memory and mirrors the SQL semantics the real one
 * uses (the unique key, `least`, `greatest`, `coalesce`); the e2e suite
 * (`test/jobs.e2e.spec.ts`) runs the same paths against PostgreSQL.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import type { AuditEventInput, AuditWriter } from '../audit/audit-writer.js';
import type { DbService } from '../db/db.service.js';
import type { CallsJobSchedulerService } from '../jobs/calls-job-scheduler.service.js';
import { MemoryKeyValueStore } from '../redis/memory-key-value-store.js';
import { callParticipantCredentialsKey } from '../redis/redis-keys.js';
import type { RoomEmitter } from '../ws/room-emitter.js';
import type {
  CallParticipantRecord,
  CallSessionEndReason,
  CallSessionRecord,
  CallsRepository,
  NewProviderEvent,
} from './calls.repository.js';
import type { CallsService } from './calls.service.js';
import { CallEventNotReadyError, EventApplier, type CallProviderEvent } from './event-applier.js';
import { CallSessionLifecycle } from './session-lifecycle.js';

const ORG = 'org_sample';
const SESSION = 'session_1';
const MEETING = 'meeting_1';
const EXPERT_PARTICIPANT = 'participant_expert';
const EMPLOYEE_PARTICIPANT = 'participant_employee';
const T0 = new Date('2026-11-10T15:00:00.000Z');
const at = (seconds: number): Date => new Date(T0.getTime() + seconds * 1000);

/** The repository surface the applier and the lifecycle use, in memory. */
class InMemoryCallsRepository {
  readonly sessions = new Map<string, CallSessionRecord>();
  readonly participants = new Map<string, CallParticipantRecord>();
  readonly events: NewProviderEvent[] = [];

  async findSessionById(id: string): Promise<CallSessionRecord | null> {
    return this.sessions.get(id) ?? null;
  }

  async findSessionByProviderMeetingId(providerMeetingId: string): Promise<CallSessionRecord | null> {
    return [...this.sessions.values()].find((s) => s.providerMeetingId === providerMeetingId) ?? null;
  }

  async findParticipantById(id: string): Promise<CallParticipantRecord | null> {
    return this.participants.get(id) ?? null;
  }

  async findParticipantByProviderAttendee(sessionId: string, attendeeId: string): Promise<CallParticipantRecord | null> {
    return (
      [...this.participants.values()].find((p) => p.sessionId === sessionId && p.providerAttendeeId === attendeeId) ??
      null
    );
  }

  async listParticipants(sessionId: string): Promise<CallParticipantRecord[]> {
    return [...this.participants.values()].filter((p) => p.sessionId === sessionId);
  }

  /** `call_events_dedup_idx`: NULLS NOT DISTINCT on the four key fields. */
  async insertProviderEvent(values: NewProviderEvent): Promise<boolean> {
    const duplicate = this.events.some(
      (e) =>
        e.providerMeetingId === values.providerMeetingId &&
        e.eventType === values.eventType &&
        e.providerAttendeeId === values.providerAttendeeId &&
        e.occurredAt.getTime() === values.occurredAt.getTime(),
    );
    if (duplicate) return false;
    this.events.push(values);
    return true;
  }

  async hasLaterProviderEvent(meetingId: string, attendeeId: string, eventType: string, after: Date): Promise<boolean> {
    return this.events.some(
      (e) =>
        e.providerMeetingId === meetingId &&
        e.providerAttendeeId === attendeeId &&
        e.eventType === eventType &&
        e.occurredAt.getTime() > after.getTime(),
    );
  }

  async recordParticipantJoined(id: string, when: Date): Promise<void> {
    const p = this.participants.get(id)!;
    p.firstJoinedAt = p.firstJoinedAt && p.firstJoinedAt < when ? p.firstJoinedAt : when;
  }

  async recordParticipantLeft(id: string, when: Date): Promise<void> {
    const p = this.participants.get(id)!;
    p.lastLeftAt = p.lastLeftAt && p.lastLeftAt > when ? p.lastLeftAt : when;
  }

  async stampEndReason(id: string, reason: CallSessionEndReason): Promise<boolean> {
    const s = this.sessions.get(id);
    if (!s || s.status !== 'active' || s.endReason) return false;
    s.endReason = reason;
    return true;
  }

  async closeSession(
    id: string,
    close: { endedAt: Date; reason: CallSessionEndReason },
  ): Promise<CallSessionRecord | null> {
    const s = this.sessions.get(id);
    if (!s || s.status !== 'active') return null;
    s.status = 'ended';
    s.endedAt = close.endedAt;
    s.locationText = null;
    s.endReason = s.endReason ?? close.reason;
    return { ...s };
  }
}

function session(overrides: Partial<CallSessionRecord> = {}): CallSessionRecord {
  return {
    id: SESSION,
    appointmentId: 'appt_1',
    webinarId: null,
    orgId: ORG,
    format: 'consultation',
    providerMeetingId: MEETING,
    status: 'active',
    startsAt: at(0),
    endsAt: at(50 * 60),
    startedAt: at(0),
    endedAt: null,
    endReason: null,
    locationText: 'Novi Sad',
    createdAt: at(0),
    updatedAt: at(0),
    ...overrides,
  };
}

function participant(id: string, role: 'expert' | 'employee'): CallParticipantRecord {
  return {
    id,
    sessionId: SESSION,
    orgId: ORG,
    userId: role === 'expert' ? 'user_milica' : 'user_jovan',
    role,
    providerAttendeeId: `attendee-${id}`,
    firstJoinedAt: null,
    lastLeftAt: null,
    reconnectCount: 0,
    createdAt: at(0),
  };
}

function event(eventType: string, seconds: number, participantId?: string): CallProviderEvent {
  return {
    eventType,
    providerMeetingId: MEETING,
    providerAttendeeId: participantId ? `attendee-${participantId}` : null,
    occurredAt: at(seconds),
    externalMeetingId: SESSION,
    externalUserId: participantId ?? null,
    source: 'notification',
  };
}

describe('EventApplier', () => {
  let repo: InMemoryCallsRepository;
  let kv: MemoryKeyValueStore;
  let emit: ReturnType<typeof vi.fn>;
  let audits: AuditEventInput[];
  let notifyParticipantLeft: ReturnType<typeof vi.fn>;
  let scheduleCleanup: ReturnType<typeof vi.fn>;
  let applier: EventApplier;

  beforeEach(async () => {
    vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    repo = new InMemoryCallsRepository();
    repo.sessions.set(SESSION, session());
    repo.participants.set(EXPERT_PARTICIPANT, participant(EXPERT_PARTICIPANT, 'expert'));
    repo.participants.set(EMPLOYEE_PARTICIPANT, participant(EMPLOYEE_PARTICIPANT, 'employee'));
    kv = new MemoryKeyValueStore();
    await kv.set(callParticipantCredentialsKey(SESSION, EXPERT_PARTICIPANT), '{}');
    await kv.set(callParticipantCredentialsKey(SESSION, EMPLOYEE_PARTICIPANT), '{}');
    await kv.set(callParticipantCredentialsKey('session_other', 'p'), '{}');
    emit = vi.fn(() => true);
    audits = [];
    notifyParticipantLeft = vi.fn();
    scheduleCleanup = vi.fn(async () => true);

    const dbs = {
      withOrgScope: <T>(_org: string, fn: (tx: undefined) => Promise<T>) => fn(undefined),
      withTransaction: <T>(fn: (tx: undefined) => Promise<T>) => fn(undefined),
    } as unknown as DbService;
    const audit = { record: async (input: AuditEventInput) => void audits.push(input) } as unknown as AuditWriter;
    const lifecycle = new CallSessionLifecycle(
      repo as unknown as CallsRepository,
      dbs,
      kv,
      { emit } as unknown as RoomEmitter,
      audit,
    );
    applier = new EventApplier(
      repo as unknown as CallsRepository,
      lifecycle,
      { notifyParticipantLeft } as unknown as CallsService,
      { scheduleCleanup } as unknown as CallsJobSchedulerService,
    );
  });

  // ── Idempotency (CW-R-83) ───────────────────────────────────────────────────

  it('stores the same event once and drops the second copy without any state change', async () => {
    const joined = event('AttendeeJoined', 10, EMPLOYEE_PARTICIPANT);
    expect(await applier.apply(joined)).toBe('applied');
    expect(await applier.apply({ ...joined, source: 'eventbridge' })).toBe('duplicate');

    expect(repo.events).toHaveLength(1);
    expect(repo.events[0]).toMatchObject({
      sessionId: SESSION,
      orgId: ORG,
      providerMeetingId: MEETING,
      eventType: 'AttendeeJoined',
      providerAttendeeId: `attendee-${EMPLOYEE_PARTICIPANT}`,
      occurredAt: at(10),
      payload: { source: 'notification' },
    });
    expect(repo.participants.get(EMPLOYEE_PARTICIPANT)!.firstJoinedAt).toEqual(at(10));
  });

  it('drops a repeated meeting-level event (null attendee is part of the key)', async () => {
    expect(await applier.apply(event('MeetingStarted', 0))).toBe('applied');
    expect(await applier.apply(event('MeetingStarted', 0))).toBe('duplicate');
    expect(repo.events).toHaveLength(1);
    expect(scheduleCleanup).toHaveBeenCalledTimes(1);
  });

  // ── Out of order (CW-R-39, OPS-15) ──────────────────────────────────────────

  it('sets both timestamps when AttendeeLeft arrives before AttendeeJoined', async () => {
    await applier.apply(event('AttendeeLeft', 600, EMPLOYEE_PARTICIPANT));
    await applier.apply(event('AttendeeJoined', 30, EMPLOYEE_PARTICIPANT));

    const employee = repo.participants.get(EMPLOYEE_PARTICIPANT)!;
    expect(employee.firstJoinedAt).toEqual(at(30));
    expect(employee.lastLeftAt).toEqual(at(600));
  });

  it('keeps the first join and the last leave whatever order a reconnect arrives in', async () => {
    // Joined at 30, dropped at 200, rejoined at 260, left at 900: delivered shuffled.
    for (const e of [
      event('AttendeeLeft', 900, EXPERT_PARTICIPANT),
      event('AttendeeJoined', 260, EXPERT_PARTICIPANT),
      event('AttendeeDropped', 200, EXPERT_PARTICIPANT),
      event('AttendeeJoined', 30, EXPERT_PARTICIPANT),
    ]) {
      await applier.apply(e);
    }
    const expert = repo.participants.get(EXPERT_PARTICIPANT)!;
    expect(expert.firstJoinedAt).toEqual(at(30));
    expect(expert.lastLeftAt).toEqual(at(900));
  });

  // ── Leave notifications ─────────────────────────────────────────────────────

  it('tells the call room an attendee left or dropped', async () => {
    await applier.apply(event('AttendeeDropped', 120, EMPLOYEE_PARTICIPANT));
    expect(notifyParticipantLeft).toHaveBeenCalledWith(SESSION, expect.objectContaining({ id: EMPLOYEE_PARTICIPANT, role: 'employee' }));
  });

  it('does not announce a leave that is older than a rejoin already applied', async () => {
    await applier.apply(event('AttendeeJoined', 260, EMPLOYEE_PARTICIPANT));
    await applier.apply(event('AttendeeDropped', 200, EMPLOYEE_PARTICIPANT));
    expect(notifyParticipantLeft).not.toHaveBeenCalled();
    expect(repo.participants.get(EMPLOYEE_PARTICIPANT)!.lastLeftAt).toEqual(at(200));
  });

  it('finds the participant by attendee id when the event has no external user id', async () => {
    await applier.apply({ ...event('AttendeeJoined', 40, EXPERT_PARTICIPANT), externalUserId: null });
    expect(repo.participants.get(EXPERT_PARTICIPANT)!.firstJoinedAt).toEqual(at(40));
  });

  // ── MeetingEnded (D-CW-12, CW-R-39) ─────────────────────────────────────────

  it('closes the session once: ENDED, ended_at, location cleared, credentials dropped, room told, audited', async () => {
    expect(await applier.apply(event('MeetingEnded', 1800))).toBe('applied');

    const closed = repo.sessions.get(SESSION)!;
    expect(closed).toMatchObject({ status: 'ended', endedAt: at(1800), locationText: null, endReason: 'provider' });
    expect(await kv.get(callParticipantCredentialsKey(SESSION, EXPERT_PARTICIPANT))).toBeNull();
    expect(await kv.get(callParticipantCredentialsKey(SESSION, EMPLOYEE_PARTICIPANT))).toBeNull();
    expect(await kv.get(callParticipantCredentialsKey('session_other', 'p'))).toBe('{}');
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(`call:${SESSION}`, 'call.session.ended', {
      sessionId: SESSION,
      endedAt: at(1800).toISOString(),
    });
    expect(audits).toEqual([
      expect.objectContaining({
        action: 'call.ended',
        actorUserId: null,
        actorKind: 'SYSTEM',
        recordId: SESSION,
        details: { sessionId: SESSION, endReason: 'provider' },
      }),
    ]);

    // A duplicate and a later copy with another timestamp change nothing.
    expect(await applier.apply(event('MeetingEnded', 1800))).toBe('duplicate');
    expect(await applier.apply(event('MeetingEnded', 1805))).toBe('applied');
    expect(repo.sessions.get(SESSION)!.endedAt).toEqual(at(1800));
    expect(emit).toHaveBeenCalledTimes(1);
    expect(audits).toHaveLength(1);
  });

  it('reports MeetingEnded as applied even when the audit after the commit fails', async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const failing = new EventApplier(
      repo as unknown as CallsRepository,
      new CallSessionLifecycle(
        repo as unknown as CallsRepository,
        {
          withOrgScope: <T>(_org: string, fn: (tx: undefined) => Promise<T>) => fn(undefined),
          withTransaction: <T>(fn: (tx: undefined) => Promise<T>) => fn(undefined),
        } as unknown as DbService,
        kv,
        { emit } as unknown as RoomEmitter,
        { record: async () => Promise.reject(new Error('audit db down')) } as unknown as AuditWriter,
      ),
      { notifyParticipantLeft } as unknown as CallsService,
      { scheduleCleanup } as unknown as CallsJobSchedulerService,
    );
    await expect(failing.apply(event('MeetingEnded', 1800))).resolves.toBe('applied');
    expect(repo.sessions.get(SESSION)).toMatchObject({ status: 'ended', endReason: 'provider' });
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('does not audit an expert end the provider event happened to close (end() audits it)', async () => {
    await repo.stampEndReason(SESSION, 'expert');
    await applier.apply(event('MeetingEnded', 1800));
    expect(repo.sessions.get(SESSION)).toMatchObject({ status: 'ended', endReason: 'expert' });
    expect(emit).toHaveBeenCalledTimes(1);
    expect(audits).toEqual([]);
  });

  it('keeps a reason stamped before the provider call (expert, cleanup, reconcile)', async () => {
    await repo.stampEndReason(SESSION, 'cleanup');
    await applier.apply(event('MeetingEnded', 1800));
    expect(repo.sessions.get(SESSION)).toMatchObject({ status: 'ended', endReason: 'cleanup' });
    expect(audits[0]).toMatchObject({ actorKind: 'JOB', details: { sessionId: SESSION, endReason: 'cleanup' } });
  });

  it('leaves a session someone else already ended alone', async () => {
    repo.sessions.set(SESSION, session({ status: 'ended', endedAt: at(1700), locationText: null }));
    expect(await applier.apply(event('MeetingEnded', 1800))).toBe('applied');
    expect(repo.sessions.get(SESSION)!.endedAt).toEqual(at(1700));
    expect(emit).not.toHaveBeenCalled();
    expect(audits).toEqual([]);
  });

  it('refuses MeetingEnded for a session still being created, so the message is retried', async () => {
    repo.sessions.set(SESSION, session({ status: 'creating', providerMeetingId: null }));
    await expect(applier.apply(event('MeetingEnded', 5))).rejects.toBeInstanceOf(CallEventNotReadyError);
    expect(repo.events).toEqual([]);
  });

  // ── Lookups ─────────────────────────────────────────────────────────────────

  it('reports an event for a meeting it does not know without storing it', async () => {
    const unknown = { ...event('AttendeeJoined', 10, 'nobody'), providerMeetingId: 'meeting_x', externalMeetingId: 'session_x' };
    expect(await applier.apply(unknown)).toBe('unknown_meeting');
    expect(repo.events).toEqual([]);
  });

  it('finds a session being created by its external meeting id (the session id)', async () => {
    repo.sessions.set(SESSION, session({ status: 'creating', providerMeetingId: null }));
    expect(await applier.apply(event('AttendeeJoined', 3, EXPERT_PARTICIPANT))).toBe('applied');
    expect(repo.participants.get(EXPERT_PARTICIPANT)!.firstJoinedAt).toEqual(at(3));
  });

  it('stores but does not apply an event of another meeting for the same session', async () => {
    const stray = { ...event('MeetingEnded', 50), providerMeetingId: 'meeting_stray' };
    expect(await applier.apply(stray)).toBe('applied');
    expect(repo.events).toHaveLength(1);
    expect(repo.sessions.get(SESSION)!.status).toBe('active');
  });

  it('stores an unknown event type and changes nothing else', async () => {
    expect(await applier.apply(event('AttendeeVideoStarted', 60, EXPERT_PARTICIPANT))).toBe('applied');
    expect(repo.events.map((e) => e.eventType)).toEqual(['AttendeeVideoStarted']);
    expect(repo.participants.get(EXPERT_PARTICIPANT)!.firstJoinedAt).toBeNull();
    expect(notifyParticipantLeft).not.toHaveBeenCalled();
  });

  // ── MeetingStarted ──────────────────────────────────────────────────────────

  it('schedules calls.cleanup when the meeting starts, and keeps going when scheduling fails', async () => {
    scheduleCleanup.mockRejectedValueOnce(new Error('redis down'));
    expect(await applier.apply(event('MeetingStarted', 0))).toBe('applied');
    expect(scheduleCleanup).toHaveBeenCalledWith(expect.objectContaining({ id: SESSION, endsAt: at(50 * 60) }));
  });

  it('does not schedule a cleanup for a session that already ended', async () => {
    repo.sessions.set(SESSION, session({ status: 'ended', endedAt: at(10) }));
    await applier.apply(event('MeetingStarted', 0));
    expect(scheduleCleanup).not.toHaveBeenCalled();
  });
});
