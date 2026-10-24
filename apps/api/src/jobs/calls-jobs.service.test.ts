/**
 * CallsJobsService unit tests (T-CW-1.2): `calls.cleanup` and
 * `calls.reconcile` against the real `FakeVideoProvider` (D-CW-09, CW-R-16,
 * CW-R-17, CW-R-38), `appointment.remind` (D-CW-26) with its in-app toast,
 * `calls.no_show_followup` (CALL-07) with an in-memory mailer, and the
 * hand-off of the approval jobs (T-CW-1.10).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { CALL_ROOM_CLOSE_AFTER_MINUTES, type CallOutcomeStatus } from '@nestself/contracts';
import type { AppointmentRecord, AppointmentsRepository } from '../appointments/appointments.repository.js';
import type { AuditWriter } from '../audit/audit-writer.js';
import type {
  CallParticipantRecord,
  CallSessionEndReason,
  CallSessionRecord,
  CallsRepository,
} from '../calls/calls.repository.js';
import { CallSessionLifecycle } from '../calls/session-lifecycle.js';
import type { DbService } from '../db/db.service.js';
import type { IdentityRepository } from '../db/repositories/identity.repository.js';
import type { Mailer, MailInput } from '../mailer/mailer.js';
import { MemoryKeyValueStore } from '../redis/memory-key-value-store.js';
import { FakeVideoProvider } from '../video/fake-video-provider.js';
import type { RoomEmitter } from '../ws/room-emitter.js';
import type { ApprovalService } from '../appointments/approval.service.js';
import type { CallsJobContext, CallsJobSchedulerService } from './calls-job-scheduler.service.js';
import { CallsJobsService } from './calls-jobs.service.js';

const MINUTE = 60_000;
const NOW = new Date('2026-11-10T15:00:00.000Z');
const ORG = 'org_sample';

class InMemoryRepo {
  readonly sessions = new Map<string, CallSessionRecord>();
  outcome: CallOutcomeStatus | null = null;

  async findSessionById(id: string) {
    return this.sessions.get(id) ?? null;
  }
  async listActiveSessions() {
    return [...this.sessions.values()].filter((s) => s.status === 'active');
  }
  async listParticipants(): Promise<CallParticipantRecord[]> {
    return [];
  }
  async stampEndReason(id: string, reason: CallSessionEndReason) {
    const s = this.sessions.get(id)!;
    if (s.status !== 'active' || s.endReason) return false;
    s.endReason = reason;
    return true;
  }
  async closeSession(id: string, close: { endedAt: Date; reason: CallSessionEndReason }) {
    const s = this.sessions.get(id);
    if (!s || s.status !== 'active') return null;
    Object.assign(s, { status: 'ended', endedAt: close.endedAt, locationText: null, endReason: s.endReason ?? close.reason });
    return { ...s };
  }
  async findLatestOutcomeStatus() {
    return this.outcome;
  }
}

function appointment(overrides: Partial<AppointmentRecord> = {}): AppointmentRecord {
  return {
    id: 'appt_1',
    orgId: ORG,
    expertUserId: 'user_milica',
    employeeUserId: 'user_jovan',
    startsAt: new Date(NOW.getTime() + 2 * 60 * MINUTE),
    endsAt: new Date(NOW.getTime() + 170 * MINUTE),
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

const USERS: Record<string, { email: string; locale: string; suspendedAt: Date | null; deactivatedAt: Date | null }> = {
  user_milica: { email: 'milica@example.test', locale: 'sr-Latn', suspendedAt: null, deactivatedAt: null },
  user_jovan: { email: 'jovan@example.test', locale: 'hu', suspendedAt: null, deactivatedAt: null },
};

describe('CallsJobsService', () => {
  let repo: InMemoryRepo;
  let video: FakeVideoProvider;
  let mail: MailInput[];
  let mailer: { send: ReturnType<typeof vi.fn> };
  let scheduleCleanup: ReturnType<typeof vi.fn>;
  let emit: ReturnType<typeof vi.fn>;
  let emitToUser: ReturnType<typeof vi.fn>;
  let approvals: { remindDeciders: ReturnType<typeof vi.fn>; expire: ReturnType<typeof vi.fn> };
  let current: AppointmentRecord | null;
  let jobs: CallsJobsService;

  async function activeSession(id: string, endsAt: Date): Promise<CallSessionRecord> {
    const created = await video.createSession({
      sessionId: id,
      format: 'consultation',
      capacity: 2,
      orgId: ORG,
      webinarId: null,
      participant: { participantId: `p-${id}`, role: 'expert' },
    });
    const session: CallSessionRecord = {
      id,
      appointmentId: 'appt_1',
      webinarId: null,
      orgId: ORG,
      format: 'consultation',
      providerMeetingId: created.providerMeetingId,
      status: 'active',
      startsAt: new Date(endsAt.getTime() - 50 * MINUTE),
      endsAt,
      startedAt: new Date(endsAt.getTime() - 50 * MINUTE),
      endedAt: null,
      endReason: null,
      locationText: null,
      createdAt: NOW,
      updatedAt: NOW,
    };
    repo.sessions.set(id, session);
    return session;
  }

  beforeEach(() => {
    for (const level of ['log', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
    }
    repo = new InMemoryRepo();
    video = new FakeVideoProvider({ now: () => NOW });
    mail = [];
    mailer = { send: vi.fn(async (input: MailInput) => void mail.push(input)) };
    scheduleCleanup = vi.fn(async () => true);
    emit = vi.fn(() => true);
    emitToUser = vi.fn(() => true);
    approvals = {
      remindDeciders: vi.fn(async () => ({ approvalId: 'appr_1', sentTo: [] })),
      expire: vi.fn(async () => ({ approvalId: 'appr_1', expired: true })),
    };
    current = appointment();

    const dbs = {
      withOrgScope: <T>(_org: string, fn: (tx: undefined) => Promise<T>) => fn(undefined),
      withTransaction: <T>(fn: (tx: undefined) => Promise<T>) => fn(undefined),
    } as unknown as DbService;
    const lifecycle = new CallSessionLifecycle(
      repo as unknown as CallsRepository,
      dbs,
      new MemoryKeyValueStore(),
      { emit } as unknown as RoomEmitter,
      { record: async () => undefined } as unknown as AuditWriter,
    );
    const config = {
      get: (key: string) =>
        ({ WORKSPACE_URL: 'https://app.nestself.test', ADMIN_URL: 'https://admin.nestself.test' })[key],
    } as unknown as ConfigService;
    jobs = new CallsJobsService(
      repo as unknown as CallsRepository,
      { findById: async () => current } as unknown as AppointmentsRepository,
      video,
      lifecycle,
      { scheduleCleanup } as unknown as CallsJobSchedulerService,
      mailer as unknown as Mailer,
      { findUserById: async (id: string) => USERS[id] ?? null } as unknown as IdentityRepository,
      config,
      { emitToUser } as unknown as RoomEmitter,
      approvals as unknown as ApprovalService,
    );
  });

  // ── calls.cleanup ───────────────────────────────────────────────────────────

  it('deletes a meeting still open after the room closed and closes the session as cleanup', async () => {
    const endsAt = new Date(NOW.getTime() - CALL_ROOM_CLOSE_AFTER_MINUTES * MINUTE);
    const session = await activeSession('s1', endsAt);
    const endSession = vi.spyOn(video, 'endSession');

    const result = await jobs.cleanup('s1', 'cleanup', NOW);

    expect(result).toEqual({ sessionId: 's1', outcome: 'done', meetingDeleted: true, closed: true });
    expect(endSession).toHaveBeenCalledWith({ providerMeetingId: session.providerMeetingId });
    expect(await video.describeSession({ providerMeetingId: session.providerMeetingId! })).toBeNull();
    expect(repo.sessions.get('s1')).toMatchObject({ status: 'ended', endedAt: NOW, endReason: 'cleanup' });
    expect(emit).toHaveBeenCalledWith('call:s1', 'call.session.ended', { sessionId: 's1', endedAt: NOW.toISOString() });
  });

  it('does nothing before the room closes', async () => {
    await activeSession('s1', new Date(NOW.getTime() - 5 * MINUTE));
    const endSession = vi.spyOn(video, 'endSession');
    expect(await jobs.cleanup('s1', 'cleanup', NOW)).toMatchObject({ outcome: 'early', meetingDeleted: false });
    expect(endSession).not.toHaveBeenCalled();
    expect(repo.sessions.get('s1')!.status).toBe('active');
  });

  it('is a no-op for a missing session and for one already ended at the provider (CW-R-16)', async () => {
    expect(await jobs.cleanup('nope', 'cleanup', NOW)).toMatchObject({ outcome: 'missing' });

    const session = await activeSession('s2', new Date(NOW.getTime() - 60 * MINUTE));
    await video.endSession({ providerMeetingId: session.providerMeetingId! });
    repo.sessions.set('s2', { ...session, status: 'ended', endedAt: NOW, endReason: 'expert' });
    const endSession = vi.spyOn(video, 'endSession');
    expect(await jobs.cleanup('s2', 'cleanup', NOW)).toEqual({
      sessionId: 's2',
      outcome: 'done',
      meetingDeleted: false,
      closed: false,
    });
    expect(endSession).not.toHaveBeenCalled();
    expect(repo.sessions.get('s2')!.endReason).toBe('expert');
  });

  it('still deletes a meeting the provider reports for a session the database thinks ended', async () => {
    const session = await activeSession('s3', new Date(NOW.getTime() - 60 * MINUTE));
    repo.sessions.set('s3', { ...session, status: 'ended', endedAt: NOW, endReason: 'provider' });
    expect(await jobs.cleanup('s3', 'cleanup', NOW)).toMatchObject({ meetingDeleted: true, closed: false });
  });

  // ── calls.reconcile ─────────────────────────────────────────────────────────

  it('cleans up every overdue ACTIVE session and schedules cleanup for the open ones', async () => {
    await activeSession('overdue', new Date(NOW.getTime() - 30 * MINUTE));
    await activeSession('closing', new Date(NOW.getTime() - CALL_ROOM_CLOSE_AFTER_MINUTES * MINUTE));
    await activeSession('open', new Date(NOW.getTime() + 20 * MINUTE));

    const report = await jobs.reconcile(NOW);

    expect(report).toEqual({
      job: 'calls.reconcile',
      cleaned: ['overdue', 'closing'],
      scheduled: ['open'],
      failed: [],
      overdue: 1,
    });
    expect(repo.sessions.get('overdue')).toMatchObject({ status: 'ended', endReason: 'reconcile' });
    expect(repo.sessions.get('open')!.status).toBe('active');
    expect(scheduleCleanup).toHaveBeenCalledWith(expect.objectContaining({ id: 'open' }), NOW);

    // Idempotent: the next sweep finds nothing left to clean (CW-R-38).
    const again = await jobs.reconcile(NOW);
    expect(again.cleaned).toEqual([]);
  });

  it('reports a session whose cleanup failed and carries on with the rest', async () => {
    await activeSession('bad', new Date(NOW.getTime() - 30 * MINUTE));
    await activeSession('good', new Date(NOW.getTime() - 30 * MINUTE));
    vi.spyOn(video, 'describeSession').mockRejectedValueOnce(new Error('throttled'));
    const report = await jobs.reconcile(NOW);
    expect(report.failed).toEqual(['bad']);
    expect(report.cleaned).toEqual(['good']);
  });

  // ── appointment.remind ──────────────────────────────────────────────────────

  function context(): CallsJobContext<'appointment.remind'> & { updates: unknown[] } {
    const updates: unknown[] = [];
    return { updates, updateData: async (data) => void updates.push(data) };
  }

  it('emails both participants in their own locale with the right link', async () => {
    const ctx = context();
    const result = await jobs.remind({ appointmentId: 'appt_1', offsetMinutes: 60 }, ctx, NOW);

    expect(result).toEqual({ appointmentId: 'appt_1', sentTo: ['employee', 'expert'] });
    expect(mail).toEqual([
      {
        to: 'jovan@example.test',
        locale: 'hu',
        template: 'appointment.reminder',
        data: {
          appointment: {
            id: 'appt_1',
            startsAt: current!.startsAt.toISOString(),
            endsAt: current!.endsAt.toISOString(),
            timeZone: 'Europe/Belgrade',
          },
          joinUrl: 'https://app.nestself.test/appointments/appt_1',
        },
      },
      expect.objectContaining({
        to: 'milica@example.test',
        locale: 'sr-Latn',
        data: expect.objectContaining({ joinUrl: 'https://admin.nestself.test/consultations/appt_1' }),
      }),
    ]);
    expect(ctx.updates.at(-1)).toEqual({ appointmentId: 'appt_1', offsetMinutes: 60, sentTo: ['employee', 'expert'] });
  });

  it('shows the in-app reminder on each participant’s own room, ids and times only (T-CW-1.10)', async () => {
    await jobs.remind({ appointmentId: 'appt_1', offsetMinutes: 60 }, context(), NOW);
    const payload = {
      appointmentId: 'appt_1',
      startsAt: current!.startsAt.toISOString(),
      offsetMinutes: 60,
      timeZone: 'Europe/Belgrade',
    };
    expect(emitToUser.mock.calls).toEqual([
      ['user_jovan', 'appointment.remind', payload],
      ['user_milica', 'appointment.remind', payload],
    ]);
  });

  it('a failed toast never stops the email', async () => {
    emitToUser.mockImplementation(() => {
      throw new Error('store down');
    });
    const result = await jobs.remind({ appointmentId: 'appt_1', offsetMinutes: 60 }, context(), NOW);
    expect(result.sentTo).toEqual(['employee', 'expert']);
    expect(mail).toHaveLength(2);
  });

  it('on a retry sends only to whoever did not get it', async () => {
    mailer.send.mockImplementationOnce(async (input: MailInput) => void mail.push(input));
    mailer.send.mockRejectedValueOnce(new Error('ses throttled'));
    const ctx = context();
    await expect(jobs.remind({ appointmentId: 'appt_1', offsetMinutes: 60 }, ctx, NOW)).rejects.toThrow('ses throttled');
    expect(ctx.updates).toEqual([{ appointmentId: 'appt_1', offsetMinutes: 60, sentTo: ['employee'] }]);

    mail.length = 0;
    await jobs.remind({ appointmentId: 'appt_1', offsetMinutes: 60, sentTo: ['employee'] }, context(), NOW);
    expect(mail.map((m) => m.to)).toEqual(['milica@example.test']);
    expect(emitToUser.mock.calls.at(-1)?.[0]).toBe('user_milica');
  });

  it('skips an appointment that is no longer confirmed, has started or is gone', async () => {
    current = appointment({ status: 'canceled' });
    expect(await jobs.remind({ appointmentId: 'appt_1', offsetMinutes: 60 }, context(), NOW)).toMatchObject({ skipped: 'status' });
    current = appointment({ startsAt: new Date(NOW.getTime() - MINUTE) });
    expect(await jobs.remind({ appointmentId: 'appt_1', offsetMinutes: 60 }, context(), NOW)).toMatchObject({ skipped: 'started' });
    current = null;
    expect(await jobs.remind({ appointmentId: 'appt_1', offsetMinutes: 60 }, context(), NOW)).toMatchObject({ skipped: 'not_found' });
    expect(mailer.send).not.toHaveBeenCalled();
    expect(emitToUser).not.toHaveBeenCalled();
  });

  it('falls back to the default locale and skips a suspended user', async () => {
    USERS.user_jovan!.locale = 'de';
    USERS.user_milica!.suspendedAt = NOW;
    try {
      await jobs.remind({ appointmentId: 'appt_1', offsetMinutes: 1440 }, context(), NOW);
      expect(mail).toEqual([expect.objectContaining({ to: 'jovan@example.test', locale: 'en' })]);
    } finally {
      USERS.user_jovan!.locale = 'hu';
      USERS.user_milica!.suspendedAt = null;
    }
  });

  // ── calls.no_show_followup ──────────────────────────────────────────────────

  it('emails the employee after an employee no-show', async () => {
    current = appointment({ status: 'no_show' });
    repo.outcome = 'no_show_employee';
    expect(await jobs.noShowFollowUp({ appointmentId: 'appt_1' })).toEqual({ appointmentId: 'appt_1', sentTo: ['employee'] });
    expect(mail).toEqual([
      expect.objectContaining({
        to: 'jovan@example.test',
        locale: 'hu',
        template: 'appointment.no_show_followup',
        data: expect.objectContaining({ reportProblemUrl: 'https://app.nestself.test/appointments/appt_1' }),
      }),
    ]);
  });

  it('sends no follow-up for an expert no-show or a changed appointment', async () => {
    current = appointment({ status: 'no_show' });
    repo.outcome = 'no_show_expert';
    expect(await jobs.noShowFollowUp({ appointmentId: 'appt_1' })).toMatchObject({ skipped: 'outcome' });
    current = appointment({ status: 'completed' });
    expect(await jobs.noShowFollowUp({ appointmentId: 'appt_1' })).toMatchObject({ skipped: 'status' });
    expect(mailer.send).not.toHaveBeenCalled();
  });

  // ── Dispatch ────────────────────────────────────────────────────────────────

  it('dispatches each job name to its method', async () => {
    const cleanup = vi.spyOn(jobs, 'cleanup').mockResolvedValue({ sessionId: 's', outcome: 'missing', meetingDeleted: false, closed: false });
    const reconcile = vi.spyOn(jobs, 'reconcile').mockResolvedValue({ job: 'calls.reconcile', cleaned: [], scheduled: [], failed: [], overdue: 0 });
    const followUp = vi.spyOn(jobs, 'noShowFollowUp').mockResolvedValue({ appointmentId: 'a', sentTo: [] });
    await jobs.handle('calls.cleanup', { sessionId: 's', appointmentId: 'a' }, { updateData: async () => undefined });
    await jobs.handle('calls.reconcile', {}, { updateData: async () => undefined });
    await jobs.handle('calls.no_show_followup', { appointmentId: 'a' }, { updateData: async () => undefined });
    expect(cleanup).toHaveBeenCalledWith('s', 'cleanup');
    expect(reconcile).toHaveBeenCalled();
    expect(followUp).toHaveBeenCalledWith({ appointmentId: 'a' });
  });

  it('hands the approval jobs to the approval service', async () => {
    const ctx = { updateData: async () => undefined };
    await jobs.handle('appointment.approval.remind', { approvalId: 'appr_1' }, ctx);
    await jobs.handle('appointment.approval.expire', { approvalId: 'appr_1' }, ctx);
    expect(approvals.remindDeciders).toHaveBeenCalledWith({ approvalId: 'appr_1' }, ctx);
    expect(approvals.expire).toHaveBeenCalledWith('appr_1');
  });
});
