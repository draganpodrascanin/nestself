/**
 * CallsService unit tests (T-CW-1.1): the join rules of guidelines 4.1 to 4.3
 * (participant, status and window checks, the creation lock, the credential
 * cache), the explicit end, the outcome, feedback, signal and client-event
 * paths, the diagnostics DTO allowlist (CW-R-86) and token hygiene (CW-R-69).
 *
 * The repositories are in memory; the provider is the real
 * `FakeVideoProvider` and the store the real `MemoryKeyValueStore`. Only
 * `Date` is faked, so the loser's polling runs on real timers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import {
  CALL_JOIN_WINDOW_AFTER_MINUTES,
  CALL_JOIN_WINDOW_BEFORE_MINUTES,
  CALL_ROOM_CLOSE_AFTER_MINUTES,
  CallJoinResponseSchema,
  CallSignalPayloadSchema,
  DIAGNOSTICS_PARTICIPANT_FIELDS,
  DIAGNOSTICS_RESPONSE_FIELDS,
  type AppointmentStatus,
  type CallParticipantRole,
  type Principal,
} from '@nestself/contracts';
import { ApiHttpException } from '../common/api-error.js';
import { ParticipantForbiddenException } from '../appointments/appointment-non-disclosure.filter.js';
import type { AppointmentRecord, AppointmentsRepository } from '../appointments/appointments.repository.js';
import type { AuditEventInput, AuditWriter } from '../audit/audit-writer.js';
import type { DbService } from '../db/db.service.js';
import { MemoryKeyValueStore } from '../redis/memory-key-value-store.js';
import { callCreateLockKey, callParticipantCredentialsKey } from '../redis/redis-keys.js';
import { FakeVideoProvider } from '../video/fake-video-provider.js';
import type { RoomEmitter } from '../ws/room-emitter.js';
import { toDiagnosticsResponse } from './call-mapper.js';
import type {
  CallConnectionMetrics,
  CallParticipantRecord,
  CallSessionRecord,
  ClientEventSummary,
  NewCallClientEvent,
  NewCallFeedback,
  NewCallOutcome,
  CallsRepository,
} from './calls.repository.js';
import { CallsService } from './calls.service.js';

const NOW = new Date('2026-11-10T15:00:00.000Z');
const MINUTE = 60_000;
const EXPERT = 'user_milica';
const EMPLOYEE = 'user_jovan';
const OUTSIDER = 'user_ana';
const ORG = 'org_sample';

function principal(userId: string): Principal {
  return { userId } as Principal;
}

function appointment(overrides: Partial<AppointmentRecord> = {}): AppointmentRecord {
  return {
    id: 'appt_1',
    orgId: ORG,
    expertUserId: EXPERT,
    employeeUserId: EMPLOYEE,
    startsAt: new Date(NOW.getTime() + 5 * MINUTE),
    endsAt: new Date(NOW.getTime() + 55 * MINUTE),
    status: 'confirmed',
    serviceCategory: 'psychological',
    timeZone: 'Europe/Belgrade',
    fundingRef: null,
    followUpOf: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

/** The repository surface the service uses, in memory. */
class InMemoryCallsRepository {
  readonly sessions = new Map<string, CallSessionRecord>();
  readonly participants = new Map<string, CallParticipantRecord>();
  readonly clientEvents: NewCallClientEvent[] = [];
  readonly outcomes: NewCallOutcome[] = [];
  readonly feedback: NewCallFeedback[] = [];
  private seq = 0;

  async findSessionById(id: string): Promise<CallSessionRecord | null> {
    const session = this.sessions.get(id);
    return session ? { ...session } : null;
  }

  async findLiveSessionByAppointment(appointmentId: string): Promise<CallSessionRecord | null> {
    return this.liveSession(appointmentId);
  }

  /** Check and insert without yielding, as the partial unique index makes it atomic in PostgreSQL. */
  async createSessionForAppointment(record: AppointmentRecord): Promise<CallSessionRecord> {
    const live = this.liveSession(record.id);
    if (live) return live;
    const session: CallSessionRecord = {
      id: `session_${++this.seq}`,
      appointmentId: record.id,
      webinarId: null,
      orgId: record.orgId,
      format: 'consultation',
      providerMeetingId: null,
      status: 'pending',
      startsAt: record.startsAt,
      endsAt: record.endsAt,
      startedAt: null,
      endedAt: null,
      locationText: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.sessions.set(session.id, session);
    return { ...session };
  }

  private liveSession(appointmentId: string): CallSessionRecord | null {
    for (const session of this.sessions.values()) {
      if (session.appointmentId === appointmentId && session.status !== 'failed') return { ...session };
    }
    return null;
  }

  async transitionSession(
    id: string,
    from: CallSessionRecord['status'][],
    to: CallSessionRecord['status'],
    set: Partial<Pick<CallSessionRecord, 'providerMeetingId' | 'startedAt' | 'endedAt' | 'locationText'>> = {},
  ): Promise<CallSessionRecord | null> {
    const session = this.sessions.get(id);
    if (!session || !from.includes(session.status)) return null;
    Object.assign(session, set, { status: to });
    return { ...session };
  }

  async setLocationText(id: string, locationText: string | null): Promise<void> {
    const session = this.sessions.get(id);
    if (session) session.locationText = locationText;
  }

  async findParticipant(sessionId: string, userId: string): Promise<CallParticipantRecord | null> {
    for (const p of this.participants.values()) {
      if (p.sessionId === sessionId && p.userId === userId) return { ...p };
    }
    return null;
  }

  async ensureParticipant(input: {
    sessionId: string;
    orgId: string | null;
    userId: string;
    role: CallParticipantRole;
  }): Promise<CallParticipantRecord> {
    const existing = [...this.participants.values()].find(
      (p) => p.sessionId === input.sessionId && p.userId === input.userId,
    );
    if (existing) return { ...existing };
    const participant: CallParticipantRecord = {
      id: `participant_${++this.seq}`,
      ...input,
      providerAttendeeId: null,
      firstJoinedAt: null,
      lastLeftAt: null,
      reconnectCount: 0,
      createdAt: new Date(),
    };
    this.participants.set(participant.id, participant);
    return { ...participant };
  }

  async setProviderAttendee(participantId: string, providerAttendeeId: string): Promise<void> {
    const participant = this.participants.get(participantId);
    if (participant) participant.providerAttendeeId = providerAttendeeId;
  }

  async listParticipants(sessionId: string): Promise<CallParticipantRecord[]> {
    return [...this.participants.values()].filter((p) => p.sessionId === sessionId).map((p) => ({ ...p }));
  }

  async insertClientEvents(rows: NewCallClientEvent[]): Promise<void> {
    this.clientEvents.push(...rows);
  }

  async connectionMetrics(session: CallSessionRecord): Promise<CallConnectionMetrics> {
    const events = this.clientEvents.filter((e) => e.sessionId === session.id);
    const rtts = events.flatMap((e) => (e.metrics?.rtt === undefined ? [] : [e.metrics.rtt]));
    return {
      reconnectCount: events.filter((e) => e.eventName === 'meetingReconnected').length,
      ...(rtts.length > 0 ? { rtt: rtts.reduce((a, b) => a + b, 0) / rtts.length } : {}),
    };
  }

  async insertOutcome(values: NewCallOutcome): Promise<void> {
    this.outcomes.push(values);
  }

  async insertFeedback(values: NewCallFeedback): Promise<boolean> {
    if (this.feedback.some((f) => f.sessionId === values.sessionId && f.userId === values.userId)) return false;
    this.feedback.push(values);
    return true;
  }

  async clientEventSummaries(sessionId: string): Promise<Map<string, ClientEventSummary>> {
    const summaries = new Map<string, ClientEventSummary>();
    for (const event of this.clientEvents.filter((e) => e.sessionId === sessionId)) {
      const summary = summaries.get(event.participantId) ?? {
        qualityMetrics: null,
        errorCodes: [],
        reconnectCount: 0,
        browser: null,
        os: null,
      };
      if (event.metrics) summary.qualityMetrics = { ...event.metrics };
      if (event.deviceError) summary.errorCodes.push(event.deviceError);
      if (event.eventName === 'meetingFailed') summary.errorCodes.push(event.eventName);
      summary.browser = event.browser ?? summary.browser;
      summary.os = event.os ?? summary.os;
      summaries.set(event.participantId, summary);
    }
    return summaries;
  }

  async providerErrorCodes(): Promise<Map<string, string[]>> {
    return new Map();
  }
}

class InMemoryAppointments {
  readonly rows = new Map<string, AppointmentRecord>();

  async findById(id: string): Promise<AppointmentRecord | null> {
    const row = this.rows.get(id);
    return row ? { ...row } : null;
  }

  async transitionStatus(id: string, to: AppointmentStatus): Promise<AppointmentRecord | null> {
    const row = this.rows.get(id);
    if (!row || row.status !== 'confirmed') return null;
    row.status = to;
    return { ...row };
  }
}

describe('CallsService', () => {
  let repo: InMemoryCallsRepository;
  let appointments: InMemoryAppointments;
  let video: FakeVideoProvider;
  let kv: MemoryKeyValueStore;
  let audit: { record: ReturnType<typeof vi.fn> };
  let rooms: { emit: ReturnType<typeof vi.fn> };
  let service: CallsService;
  let logged: unknown[][];

  const audited = (action: string): AuditEventInput[] =>
    audit.record.mock.calls.map((call) => call[0] as AuditEventInput).filter((input) => input.action === action);

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    repo = new InMemoryCallsRepository();
    appointments = new InMemoryAppointments();
    appointments.rows.set('appt_1', appointment());
    video = new FakeVideoProvider();
    kv = new MemoryKeyValueStore();
    audit = { record: vi.fn(async () => undefined) };
    rooms = { emit: vi.fn(() => true) };
    const dbs = { withOrgScope: (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn(undefined) };
    service = new CallsService(
      repo as unknown as CallsRepository,
      appointments as unknown as AppointmentsRepository,
      dbs as unknown as DbService,
      video,
      kv,
      rooms as unknown as RoomEmitter,
      audit as unknown as AuditWriter,
      { get: () => 'none' } as never,
    );
    service.pollIntervalMs = 5;
    logged = [];
    for (const level of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
      vi.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
        logged.push(args);
      });
    }
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    await kv.close();
  });

  async function expectApiError(promise: Promise<unknown>, status: number, code: string): Promise<ApiHttpException> {
    const error = await promise.then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ApiHttpException);
    expect((error as ApiHttpException).getStatus()).toBe(status);
    expect((error as ApiHttpException).code).toBe(code);
    return error as ApiHttpException;
  }

  // ── Join (guidelines 4.1 to 4.3, D-CW-07, D-CW-08) ──────────────────────

  describe('join', () => {
    it('answers 404 to a caller who is neither the expert nor the employee, before any other check', async () => {
      appointments.rows.set('appt_1', appointment({ status: 'canceled' }));
      const create = vi.spyOn(video, 'createSession');
      await expectApiError(service.join('appt_1', principal(OUTSIDER), {}), 404, 'not_found');
      await expectApiError(service.join('appt_missing', principal(EXPERT), {}), 404, 'not_found');
      expect(create).not.toHaveBeenCalled();
      expect(repo.sessions.size).toBe(0);
    });

    it('answers 409 appointment_not_joinable to a participant of an appointment that is not confirmed', async () => {
      for (const status of ['canceled', 'completed', 'proposed', 'awaiting_approval', 'no_show'] as const) {
        appointments.rows.set('appt_1', appointment({ status }));
        await expectApiError(service.join('appt_1', principal(EMPLOYEE), {}), 409, 'appointment_not_joinable');
      }
      expect(repo.sessions.size).toBe(0);
    });

    it('opens the window 15 minutes before the start and closes it 10 minutes after the end (403 join_window_closed)', async () => {
      const startsAt = appointment().startsAt.getTime();
      const endsAt = appointment().endsAt.getTime();
      const opens = startsAt - CALL_JOIN_WINDOW_BEFORE_MINUTES * MINUTE;
      const closes = endsAt + CALL_JOIN_WINDOW_AFTER_MINUTES * MINUTE;

      vi.setSystemTime(opens - 1);
      await expectApiError(service.join('appt_1', principal(EMPLOYEE), {}), 403, 'join_window_closed');
      vi.setSystemTime(closes + 1);
      await expectApiError(service.join('appt_1', principal(EMPLOYEE), {}), 403, 'join_window_closed');
      expect(repo.sessions.size).toBe(0);

      vi.setSystemTime(opens);
      await expect(service.join('appt_1', principal(EMPLOYEE), {})).resolves.toBeDefined();
      vi.setSystemTime(closes);
      await expect(service.join('appt_1', principal(EXPERT), {})).resolves.toBeDefined();
    });

    it('creates the meeting on the first join: session ACTIVE, credentials cached until the room closes, audited', async () => {
      const create = vi.spyOn(video, 'createSession');
      const response = await service.join('appt_1', principal(EXPERT), {});

      expect(CallJoinResponseSchema.parse(response)).toEqual(response);
      const [session] = [...repo.sessions.values()];
      const [participant] = [...repo.participants.values()];
      expect(session).toMatchObject({
        status: 'active',
        providerMeetingId: `fake-meeting-${session!.id}`,
        startedAt: NOW,
        appointmentId: 'appt_1',
        orgId: ORG,
        format: 'consultation',
      });
      expect(participant).toMatchObject({
        sessionId: session!.id,
        userId: EXPERT,
        role: 'expert',
        orgId: ORG,
        providerAttendeeId: `fake-attendee-${participant!.id}`,
      });
      expect(response).toMatchObject({
        sessionId: session!.id,
        participantId: participant!.id,
        role: 'expert',
        format: 'consultation',
        startsAt: appointment().startsAt.toISOString(),
        endsAt: appointment().endsAt.toISOString(),
      });
      // ExternalUserId is the participant id, never the user id (CW-R-71).
      expect(response.attendee.ExternalUserId).toBe(participant!.id);
      expect(response.attendee.ExternalUserId).not.toBe(EXPERT);
      // Chime's EventIngestionUrl and the provider-only fields are dropped (CW-R-48).
      expect(response.meeting.MediaPlacement).not.toHaveProperty('EventIngestionUrl');
      expect(response.meeting).not.toHaveProperty('MeetingArn');
      expect(response.meeting).not.toHaveProperty('TenantIds');

      expect(create).toHaveBeenCalledTimes(1);
      expect(create).toHaveBeenCalledWith({
        sessionId: session!.id,
        format: 'consultation',
        capacity: 2,
        orgId: ORG,
        webinarId: null,
        participant: { participantId: participant!.id, role: 'expert' },
      });

      // D-CW-08: cached under the canonical key until endsAt + 15 minutes; the lock is released.
      const key = callParticipantCredentialsKey(session!.id, participant!.id);
      expect(JSON.parse((await kv.get(key))!)).toEqual({ meeting: response.meeting, attendee: response.attendee });
      expect(await kv.ttl(key)).toBe((55 + CALL_ROOM_CLOSE_AFTER_MINUTES) * 60);
      expect(await kv.get(callCreateLockKey(session!.id))).toBeNull();

      expect(audited('call.session.created').map((e) => e.details)).toEqual([
        { sessionId: session!.id, appointmentId: 'appt_1', format: 'consultation' },
      ]);
      expect(audited('call.joined')).toEqual([
        expect.objectContaining({
          actorUserId: EXPERT,
          orgId: ORG,
          recordType: 'call_session',
          recordId: session!.id,
          result: 'ALLOWED',
          details: { sessionId: session!.id, participantId: participant!.id, role: 'expert' },
        }),
      ]);
      expect(rooms.emit).toHaveBeenCalledWith(`call:${session!.id}`, 'call.participant.joined', {
        participantId: participant!.id,
        role: 'expert',
      });
    });

    it('the second participant gets an attendee in the same meeting', async () => {
      const first = await service.join('appt_1', principal(EXPERT), {});
      const create = vi.spyOn(video, 'createSession');
      const add = vi.spyOn(video, 'createParticipant');
      const second = await service.join('appt_1', principal(EMPLOYEE), {});

      expect(create).not.toHaveBeenCalled();
      expect(add).toHaveBeenCalledTimes(1);
      expect(second.sessionId).toBe(first.sessionId);
      expect(second.meeting.MeetingId).toBe(first.meeting.MeetingId);
      expect(second.role).toBe('employee');
      expect(second.participantId).not.toBe(first.participantId);
      expect(second.attendee.AttendeeId).not.toBe(first.attendee.AttendeeId);
    });

    it('concurrent first joins create exactly one meeting: one lock winner, one loser that waits', async () => {
      const create = vi.spyOn(video, 'createSession');
      const add = vi.spyOn(video, 'createParticipant');
      const [expert, employee] = await Promise.all([
        service.join('appt_1', principal(EXPERT), {}),
        service.join('appt_1', principal(EMPLOYEE), {}),
      ]);

      expect(create).toHaveBeenCalledTimes(1);
      expect(add).toHaveBeenCalledTimes(1);
      expect(repo.sessions.size).toBe(1);
      expect(expert.meeting.MeetingId).toBe(employee.meeting.MeetingId);
      expect(audited('call.session.created')).toHaveLength(1);
      expect(audited('call.joined')).toHaveLength(2);
    });

    it('a rejoin returns the identical cached credentials and calls no provider', async () => {
      const first = await service.join('appt_1', principal(EMPLOYEE), {});
      const create = vi.spyOn(video, 'createSession');
      const add = vi.spyOn(video, 'createParticipant');
      const again = await service.join('appt_1', principal(EMPLOYEE), {});

      expect(again).toEqual(first);
      expect(create).not.toHaveBeenCalled();
      expect(add).not.toHaveBeenCalled();
      expect(repo.participants.size).toBe(1);
      expect(audited('call.joined')).toHaveLength(2);
    });

    it('re-issues an attendee for the same participant when the cache is gone but the session is active', async () => {
      const first = await service.join('appt_1', principal(EMPLOYEE), {});
      await kv.del(callParticipantCredentialsKey(first.sessionId, first.participantId));
      const add = vi.spyOn(video, 'createParticipant');
      const again = await service.join('appt_1', principal(EMPLOYEE), {});

      expect(add).toHaveBeenCalledWith({
        providerMeetingId: first.meeting.MeetingId,
        participantId: first.participantId,
        role: 'employee',
      });
      expect(again.participantId).toBe(first.participantId);
      expect(await kv.get(callParticipantCredentialsKey(first.sessionId, first.participantId))).not.toBeNull();
    });

    it('a loser that never sees the meeting gives up with 503 video_provider_unavailable', async () => {
      service.pollTimeoutMs = 30;
      const session = await repo.createSessionForAppointment(appointment());
      const participant = await repo.ensureParticipant({ sessionId: session.id, orgId: ORG, userId: EXPERT, role: 'expert' });
      await kv.set(callCreateLockKey(session.id), participant.id, { onlyIfAbsent: true, ttlSeconds: 30 });

      await expectApiError(service.join('appt_1', principal(EMPLOYEE), {}), 503, 'video_provider_unavailable');
      expect(repo.sessions.get(session.id)!.status).toBe('pending');
    });

    it('a failed creation marks the session FAILED, releases the lock, and the next join starts a new session', async () => {
      vi.spyOn(video, 'createSession').mockRejectedValueOnce(
        new ApiHttpException({ status: 503, code: 'video_provider_unavailable', message: 'down' }),
      );
      await expectApiError(service.join('appt_1', principal(EXPERT), {}), 503, 'video_provider_unavailable');
      const [failed] = [...repo.sessions.values()];
      expect(failed!.status).toBe('failed');
      expect(await kv.get(callCreateLockKey(failed!.id))).toBeNull();
      expect(audited('call.joined')).toEqual([]);

      const retry = await service.join('appt_1', principal(EXPERT), {});
      expect(retry.sessionId).not.toBe(failed!.id);
      expect(repo.sessions.get(retry.sessionId)!.status).toBe('active');
    });

    it('answers 409 once the expert has ended the session', async () => {
      await service.join('appt_1', principal(EXPERT), {});
      await service.end('appt_1', principal(EXPERT));
      await expectApiError(service.join('appt_1', principal(EMPLOYEE), {}), 409, 'appointment_not_joinable');
    });

    it('keeps the employee location for a psychological session and refuses it from anyone else (CALL-34)', async () => {
      const joined = await service.join('appt_1', principal(EMPLOYEE), { locationText: 'Novi Sad' });
      expect(repo.sessions.get(joined.sessionId)!.locationText).toBe('Novi Sad');
      expect(JSON.stringify(audit.record.mock.calls)).not.toContain('Novi Sad');
      expect(JSON.stringify(logged)).not.toContain('Novi Sad');

      const fromExpert = await expectApiError(
        service.join('appt_1', principal(EXPERT), { locationText: 'Belgrade' }),
        400,
        'validation',
      );
      expect(fromExpert.details).toEqual({ field: 'locationText' });

      appointments.rows.set('appt_1', appointment({ serviceCategory: 'legal' }));
      await expectApiError(service.join('appt_1', principal(EMPLOYEE), { locationText: 'Subotica' }), 400, 'validation');
    });

    it('never puts a join token in audit details, logs or room events (CW-R-69)', async () => {
      await Promise.all([
        service.join('appt_1', principal(EXPERT), {}),
        service.join('appt_1', principal(EMPLOYEE), {}),
      ]);
      await service.join('appt_1', principal(EMPLOYEE), {});
      for (const sink of [audit.record.mock.calls, logged, rooms.emit.mock.calls]) {
        const text = JSON.stringify(sink);
        expect(text).not.toContain('fake-token-');
        expect(text).not.toMatch(/joinToken/i);
      }
    });
  });

  // ── End (D-CW-09, CALL-21) ───────────────────────────────────────────────

  describe('end', () => {
    it('only the expert ends; the employee gets a 403 that the non-disclosure filter keeps', async () => {
      await service.join('appt_1', principal(EMPLOYEE), {});
      const error = await expectApiError(service.end('appt_1', principal(EMPLOYEE)), 403, 'forbidden');
      expect(error).toBeInstanceOf(ParticipantForbiddenException);
      await expectApiError(service.end('appt_1', principal(OUTSIDER)), 404, 'not_found');
    });

    it('deletes the meeting, closes the session, drops the cached credentials and tells the room', async () => {
      const expert = await service.join('appt_1', principal(EXPERT), {});
      const employee = await service.join('appt_1', principal(EMPLOYEE), { locationText: 'Novi Sad' });
      const endSession = vi.spyOn(video, 'endSession');
      vi.setSystemTime(NOW.getTime() + 40 * MINUTE);

      await service.end('appt_1', principal(EXPERT));

      expect(endSession).toHaveBeenCalledWith({ providerMeetingId: expert.meeting.MeetingId });
      const session = repo.sessions.get(expert.sessionId)!;
      expect(session).toMatchObject({ status: 'ended', endedAt: new Date(NOW.getTime() + 40 * MINUTE), locationText: null });
      expect(await kv.get(callParticipantCredentialsKey(expert.sessionId, expert.participantId))).toBeNull();
      expect(await kv.get(callParticipantCredentialsKey(employee.sessionId, employee.participantId))).toBeNull();
      expect(rooms.emit).toHaveBeenCalledWith(`call:${expert.sessionId}`, 'call.session.ended', {
        sessionId: expert.sessionId,
        endedAt: session.endedAt!.toISOString(),
      });
      expect(audited('call.ended').map((e) => e.details)).toEqual([
        { sessionId: expert.sessionId, endedByUserId: EXPERT },
      ]);

      // A second end is a no-op.
      await service.end('appt_1', principal(EXPERT));
      expect(endSession).toHaveBeenCalledTimes(1);
      expect(audited('call.ended')).toHaveLength(1);
    });

    it('answers 409 when there is no running meeting to end', async () => {
      await expectApiError(service.end('appt_1', principal(EXPERT)), 409, 'appointment_not_joinable');
    });
  });

  // ── Outcome (CALL-23, CALL-24, D-CW-25) ─────────────────────────────────

  describe('recordOutcome', () => {
    it('writes the outcome with aggregated connection metrics and moves the appointment', async () => {
      const joined = await service.join('appt_1', principal(EXPERT), {});
      await service.recordClientEvents(joined.sessionId, principal(EXPERT), {
        events: [
          { eventName: 'connectionStats', metrics: { rtt: 40 } },
          { eventName: 'connectionStats', metrics: { rtt: 60 } },
          { eventName: 'meetingReconnected' },
        ],
      });

      const response = await service.recordOutcome('appt_1', principal(EXPERT), { status: 'completed' });

      expect(response).toMatchObject({ id: 'appt_1', status: 'completed' });
      expect(repo.outcomes).toEqual([
        {
          sessionId: joined.sessionId,
          orgId: ORG,
          status: 'completed',
          recordedByUserId: EXPERT,
          connectionMetrics: expect.objectContaining({ rtt: 50, reconnectCount: 1 }),
        },
      ]);
      expect(audited('call.outcome.recorded').map((e) => [e.details, e.orgId])).toEqual([
        [{ sessionId: joined.sessionId, outcomeStatus: 'completed' }, ORG],
      ]);
      expect(audited('appointment.completed').map((e) => e.details)).toEqual([{ appointmentId: 'appt_1' }]);
    });

    it('maps each outcome to the appointment status', async () => {
      const cases = [
        ['completed', 'completed'],
        ['no_show_employee', 'no_show'],
        ['no_show_expert', 'no_show'],
        ['technical_failure', 'canceled'],
        ['canceled', 'canceled'],
      ] as const;
      for (const [outcome, expected] of cases) {
        appointments.rows.set('appt_1', appointment());
        repo.sessions.clear();
        const response = await service.recordOutcome('appt_1', principal(EXPERT), { status: outcome });
        expect(response.status, outcome).toBe(expected);
      }
      expect(audited('appointment.no_show').map((e) => e.details)).toEqual([
        { appointmentId: 'appt_1', status: 'no_show_employee' },
        { appointmentId: 'appt_1', status: 'no_show_expert' },
      ]);
      expect(audited('appointment.canceled').map((e) => e.details)).toEqual([
        { appointmentId: 'appt_1', canceledByUserId: EXPERT },
        { appointmentId: 'appt_1', canceledByUserId: EXPERT },
      ]);
    });

    it('answers 409 when the appointment is no longer confirmed, and 404 to anyone but the expert', async () => {
      await service.recordOutcome('appt_1', principal(EXPERT), { status: 'completed' });
      await expectApiError(
        service.recordOutcome('appt_1', principal(EXPERT), { status: 'completed' }),
        409,
        'appointment_not_joinable',
      );
      expect(repo.outcomes).toHaveLength(1);
      await expectApiError(service.recordOutcome('appt_1', principal(OUTSIDER), { status: 'completed' }), 404, 'not_found');
    });
  });

  // ── Feedback (CALL-15) ───────────────────────────────────────────────────

  describe('submitFeedback', () => {
    it('stores the employee feedback once and audits the session id only', async () => {
      const joined = await service.join('appt_1', principal(EMPLOYEE), {});
      await service.submitFeedback('appt_1', principal(EMPLOYEE), { score: 5, comment: 'Very helpful' });

      expect(repo.feedback).toEqual([
        { sessionId: joined.sessionId, orgId: ORG, userId: EMPLOYEE, score: 5, comment: 'Very helpful' },
      ]);
      expect(audited('call.feedback.submitted').map((e) => e.details)).toEqual([{ sessionId: joined.sessionId }]);
      expect(JSON.stringify(audit.record.mock.calls)).not.toContain('Very helpful');

      await expectApiError(service.submitFeedback('appt_1', principal(EMPLOYEE), { score: 4 }), 409, 'conflict');
    });

    it('refuses the expert (403 kept) and an employee who never joined (409)', async () => {
      await expectApiError(service.submitFeedback('appt_1', principal(EMPLOYEE), { score: 4 }), 409, 'appointment_not_joinable');
      await service.join('appt_1', principal(EXPERT), {});
      const error = await expectApiError(service.submitFeedback('appt_1', principal(EXPERT), { score: 4 }), 403, 'forbidden');
      expect(error).toBeInstanceOf(ParticipantForbiddenException);
      expect(repo.feedback).toEqual([]);
    });
  });

  // ── Signal (CALL-05, CALL-11, CALL-19, D-CW-27) ──────────────────────────

  describe('signal', () => {
    it('emits the signal to the call room without persisting it', async () => {
      await service.signal('appt_1', principal(EMPLOYEE), { type: 'cannot_hear' });
      await service.signal('appt_1', principal(EXPERT), { type: 'running_late', etaMinutes: 5 });

      const [session] = [...repo.sessions.values()];
      const signals = rooms.emit.mock.calls.filter((call) => call[1] === 'call.signal');
      expect(signals).toEqual([
        [`call:${session!.id}`, 'call.signal', { type: 'cannot_hear', fromRole: 'employee' }],
        [`call:${session!.id}`, 'call.signal', { type: 'running_late', etaMinutes: 5, fromRole: 'expert' }],
      ]);
      for (const [, , payload] of signals) CallSignalPayloadSchema.parse(payload);
      expect(repo.participants.size).toBe(0);
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('only the expert sends running late; signals need a confirmed appointment inside the window', async () => {
      const error = await expectApiError(
        service.signal('appt_1', principal(EMPLOYEE), { type: 'running_late' }),
        403,
        'forbidden',
      );
      expect(error).toBeInstanceOf(ParticipantForbiddenException);
      await expectApiError(service.signal('appt_1', principal(OUTSIDER), { type: 'cannot_see' }), 404, 'not_found');

      vi.setSystemTime(NOW.getTime() - 60 * MINUTE);
      await expectApiError(service.signal('appt_1', principal(EXPERT), { type: 'running_late' }), 403, 'join_window_closed');
      vi.setSystemTime(NOW);
      appointments.rows.set('appt_1', appointment({ status: 'canceled' }));
      await expectApiError(service.signal('appt_1', principal(EXPERT), { type: 'running_late' }), 409, 'appointment_not_joinable');
      expect(rooms.emit).not.toHaveBeenCalled();
    });
  });

  // ── Client events (D-CW-13, PLT-18) ──────────────────────────────────────

  describe('recordClientEvents', () => {
    it('stores the batch against the caller participant and answers 404 to anyone else', async () => {
      const joined = await service.join('appt_1', principal(EMPLOYEE), {});
      await service.recordClientEvents(joined.sessionId, principal(EMPLOYEE), {
        events: [
          { eventName: 'meetingStartSucceeded', durationMs: 1800, browser: 'Chrome 130', os: 'macOS 15' },
          { eventName: 'audioInputFailed', deviceError: 'NotAllowedError' },
        ],
      });
      expect(repo.clientEvents).toEqual([
        {
          sessionId: joined.sessionId,
          orgId: ORG,
          participantId: joined.participantId,
          eventName: 'meetingStartSucceeded',
          durationMs: 1800,
          metrics: null,
          deviceError: null,
          browser: 'Chrome 130',
          os: 'macOS 15',
        },
        {
          sessionId: joined.sessionId,
          orgId: ORG,
          participantId: joined.participantId,
          eventName: 'audioInputFailed',
          durationMs: null,
          metrics: null,
          deviceError: 'NotAllowedError',
          browser: null,
          os: null,
        },
      ]);

      // The expert has not joined yet, so has no participant row in this session.
      await expectApiError(
        service.recordClientEvents(joined.sessionId, principal(EXPERT), { events: [{ eventName: 'meetingFailed' }] }),
        404,
        'not_found',
      );
      await expectApiError(
        service.recordClientEvents('session_missing', principal(EMPLOYEE), { events: [{ eventName: 'meetingFailed' }] }),
        404,
        'not_found',
      );
    });
  });

  // ── Diagnostics (D-CW-28, CW-R-73, CW-R-86) ──────────────────────────────

  describe('diagnostics', () => {
    it('returns exactly the 4.7.5 fields and audits the view', async () => {
      const joined = await service.join('appt_1', principal(EMPLOYEE), { locationText: 'Novi Sad' });
      await service.join('appt_1', principal(EXPERT), {});
      await service.recordClientEvents(joined.sessionId, principal(EMPLOYEE), {
        events: [
          { eventName: 'connectionStats', metrics: { rtt: 40, jitter: 3, packetLoss: 0.01, outgoingBitrate: 900_000 } },
          { eventName: 'meetingFailed', browser: 'Firefox 132', os: 'Windows 11' },
        ],
      });

      const response = await service.diagnostics(joined.sessionId, principal('user_nikola'));

      expect(Object.keys(response).sort()).toEqual([...DIAGNOSTICS_RESPONSE_FIELDS].sort());
      expect(response.participants).toHaveLength(2);
      for (const participant of response.participants) {
        expect(Object.keys(participant).sort()).toEqual([...DIAGNOSTICS_PARTICIPANT_FIELDS].sort());
      }
      expect(response).toMatchObject({
        sessionId: joined.sessionId,
        appointmentId: 'appt_1',
        webinarId: null,
        status: 'active',
        provider: 'none',
        providerMeetingId: joined.meeting.MeetingId,
        startedAt: NOW.toISOString(),
        endedAt: null,
      });
      expect(response.participants.find((p) => p.role === 'employee')).toEqual({
        role: 'employee',
        joinedAt: null,
        leftAt: null,
        reconnectCount: 0,
        qualityMetrics: { rtt: 40, jitter: 3, packetLoss: 0.01, outgoingBitrate: 900_000 },
        errorCodes: ['meetingFailed'],
        browser: 'Firefox 132',
        os: 'Windows 11',
      });
      const text = JSON.stringify(response);
      for (const leak of ['Novi Sad', EMPLOYEE, EXPERT, joined.participantId, 'psychological', 'fake-token-']) {
        expect(text).not.toContain(leak);
      }

      expect(audited('call.diagnostics.viewed')).toEqual([
        expect.objectContaining({
          actorUserId: 'user_nikola',
          orgId: ORG,
          recordType: 'call_session',
          recordId: joined.sessionId,
          details: { sessionId: joined.sessionId, viewedByUserId: 'user_nikola' },
        }),
      ]);
    });

    it('answers 404 for an unknown session', async () => {
      await expectApiError(service.diagnostics('session_missing', principal('user_nikola')), 404, 'not_found');
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('the DTO builder refuses any field outside the allowlist (serialisation test)', () => {
      const session = {
        id: 's1',
        appointmentId: 'a1',
        webinarId: null,
        orgId: ORG,
        format: 'consultation',
        providerMeetingId: 'm1',
        status: 'ended',
        startsAt: NOW,
        endsAt: NOW,
        startedAt: NOW,
        endedAt: NOW,
        locationText: 'Novi Sad',
        createdAt: NOW,
        updatedAt: NOW,
      } satisfies CallSessionRecord;
      const participant = {
        id: 'p1',
        sessionId: 's1',
        orgId: ORG,
        userId: EMPLOYEE,
        role: 'employee',
        providerAttendeeId: 'att1',
        firstJoinedAt: NOW,
        lastLeftAt: NOW,
        reconnectCount: 2,
        createdAt: NOW,
      } satisfies CallParticipantRecord;
      const dto = toDiagnosticsResponse(
        session,
        [participant],
        new Map([['p1', { qualityMetrics: null, errorCodes: ['signalingDropped'], reconnectCount: 3, browser: null, os: null }]]),
        new Map([['att1', ['AttendeeDropped']]]),
        'chime',
      );
      expect(Object.keys(dto).sort()).toEqual([...DIAGNOSTICS_RESPONSE_FIELDS].sort());
      expect(dto.participants).toEqual([
        {
          role: 'employee',
          joinedAt: NOW.toISOString(),
          leftAt: NOW.toISOString(),
          reconnectCount: 3,
          qualityMetrics: null,
          errorCodes: ['AttendeeDropped', 'signalingDropped'],
          browser: null,
          os: null,
        },
      ]);
    });
  });
});
