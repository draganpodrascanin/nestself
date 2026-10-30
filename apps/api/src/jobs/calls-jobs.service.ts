/**
 * CallsJobsService: what the `nestself-calls` jobs do (T-CW-1.2). The
 * {@link CallsJobSchedulerService} worker hands every job here; tests call the
 * methods directly with a fixed clock.
 *
 * - `calls.cleanup` (D-CW-09, CW-R-17, OPS-42): once the room has closed
 *   (`endsAt + 15 minutes`), asks the provider whether the meeting still
 *   exists and deletes it whatever the attendee count (a recording pipeline
 *   keeps a meeting alive), then closes an ACTIVE session. The end reason is
 *   stamped before the provider call, so the `MeetingEnded` event the
 *   deletion triggers keeps it. A job that runs early does nothing and
 *   leaves the session to `calls.reconcile`. Deleting a meeting is always
 *   safe, so a canceled appointment does not stop it (CW-R-37 otherwise).
 * - `calls.reconcile` (every 5 minutes, CW-R-38): the same cleanup for every
 *   ACTIVE session whose room should have closed, and a `calls.cleanup` job
 *   for every ACTIVE session whose room is still open (a `MeetingStarted`
 *   that never arrived). Idempotent: `endSession` on an ended meeting is a
 *   no-op (CW-R-16). Sessions more than 20 minutes past their end are logged
 *   as overdue (guidelines 16.2).
 * - `appointment.remind` (D-CW-26): the `appointment.reminder` email, with
 *   its calendar file, to the employee and the expert in their own locale,
 *   while the appointment is still `confirmed` and has not started. Who has
 *   been sent the email is kept in the job data, so a retry sends only what
 *   is missing. Each recipient also gets the in-app reminder toast,
 *   `appointment.remind` on their `user:{userId}` room (CALL-01 criterion 5,
 *   T-CW-1.10), whether or not they may get an email.
 * - `appointment.approval.remind` and `appointment.approval.expire`
 *   (T-CW-1.10, CALL-40): handed to `ApprovalService`.
 * - `calls.no_show_followup` (CALL-07): the `appointment.no_show_followup`
 *   email to the employee, while the appointment is still `no_show` and its
 *   latest outcome is `no_show_employee`.
 *
 * Logs carry ids, never an address or a token.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ConfigService } from '@nestjs/config';
import { LocaleSchema, defaultLocale, type Locale } from '@nestself/contracts';
import { toAppointmentResponse } from '../appointments/appointment-mapper.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { AppointmentsRepository, type AppointmentRecord } from '../appointments/appointments.repository.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ApprovalService } from '../appointments/approval.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { CallsRepository, type CallSessionRecord } from '../calls/calls.repository.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { CallSessionLifecycle } from '../calls/session-lifecycle.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { IdentityRepository } from '../db/repositories/identity.repository.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { Mailer } from '../mailer/mailer.js';
import { VIDEO_PROVIDER, type VideoProvider } from '../video/video-provider.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { RoomEmitter } from '../ws/room-emitter.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import {
  CallsJobSchedulerService,
  roomClosesAt,
  type CallsJobContext,
  type CallsJobData,
  type CallsJobHandler,
  type CallsJobName,
  type ReminderRecipient,
} from './calls-job-scheduler.service.js';

const MINUTE_MS = 60_000;
/** Guidelines 16.2: an ACTIVE session this long past its end means cleanup keeps failing. */
const OVERDUE_AFTER_END_MINUTES = 20;

export type CleanupReason = 'cleanup' | 'reconcile';

export interface CleanupResult {
  sessionId: string;
  outcome: 'missing' | 'early' | 'done';
  meetingDeleted: boolean;
  closed: boolean;
}

export interface ReconcileReport {
  job: 'calls.reconcile';
  /** Sessions whose meeting was deleted or whose row was closed. */
  cleaned: string[];
  /** Sessions whose room is still open and got a `calls.cleanup` job. */
  scheduled: string[];
  failed: string[];
  overdue: number;
}

export interface MailJobResult {
  appointmentId: string;
  skipped?: 'not_found' | 'status' | 'started' | 'outcome';
  sentTo: ReminderRecipient[];
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}

/** The user's stored locale, or the default when it is not one of the four (as the invitation flow falls back). */
function localeOf(value: string | null | undefined): Locale {
  const parsed = LocaleSchema.safeParse(value);
  return parsed.success ? parsed.data : defaultLocale;
}

@Injectable()
export class CallsJobsService implements CallsJobHandler {
  private readonly logger = new Logger(CallsJobsService.name);

  constructor(
    private readonly repo: CallsRepository,
    private readonly appointments: AppointmentsRepository,
    @Inject(VIDEO_PROVIDER) private readonly video: VideoProvider,
    private readonly lifecycle: CallSessionLifecycle,
    private readonly scheduler: CallsJobSchedulerService,
    private readonly mailer: Mailer,
    private readonly identities: IdentityRepository,
    private readonly config: ConfigService,
    private readonly rooms: RoomEmitter,
    private readonly approvals: ApprovalService,
  ) {}

  handle<N extends CallsJobName>(name: N, data: CallsJobData[N], context: CallsJobContext<N>): Promise<unknown> {
    switch (name) {
      case 'calls.cleanup':
        return this.cleanup((data as CallsJobData['calls.cleanup']).sessionId, 'cleanup');
      case 'calls.reconcile':
        return this.reconcile();
      case 'appointment.remind':
        return this.remind(
          data as CallsJobData['appointment.remind'],
          context as unknown as CallsJobContext<'appointment.remind'>,
        );
      case 'calls.no_show_followup':
        return this.noShowFollowUp(data as CallsJobData['calls.no_show_followup']);
      case 'appointment.approval.remind':
        return this.approvals.remindDeciders(
          data as CallsJobData['appointment.approval.remind'],
          context as unknown as CallsJobContext<'appointment.approval.remind'>,
        );
      case 'appointment.approval.expire':
        return this.approvals.expire((data as CallsJobData['appointment.approval.expire']).approvalId);
      default:
        throw new Error(`Unknown calls job: ${String(name)}`);
    }
  }

  // ── calls.cleanup (D-CW-09) ───────────────────────────────────────────────

  async cleanup(sessionId: string, reason: CleanupReason, now: Date = new Date()): Promise<CleanupResult> {
    const session = await this.repo.findSessionById(sessionId);
    if (!session) return { sessionId, outcome: 'missing', meetingDeleted: false, closed: false };
    if (now.getTime() < roomClosesAt(session.endsAt).getTime()) {
      return { sessionId, outcome: 'early', meetingDeleted: false, closed: false };
    }
    return this.cleanUp(session, reason, now);
  }

  private async cleanUp(session: CallSessionRecord, reason: CleanupReason, now: Date): Promise<CleanupResult> {
    let meetingDeleted = false;
    if (session.providerMeetingId) {
      const providerMeetingId = session.providerMeetingId;
      // Recording attendees keep a meeting alive, so the attendee count does not matter (CW-R-17).
      if (await this.video.describeSession({ providerMeetingId })) {
        if (session.status === 'active') await this.lifecycle.stampEndReason(session, reason);
        await this.video.endSession({ providerMeetingId });
        meetingDeleted = true;
      }
    }
    const closed = session.status === 'active' ? await this.lifecycle.close(session, { endedAt: now, reason }) : null;
    this.logger.log(
      { sessionId: session.id, operation: reason, meetingDeleted, closed: closed !== null },
      'Call session cleaned up',
    );
    return { sessionId: session.id, outcome: 'done', meetingDeleted, closed: closed !== null };
  }

  // ── calls.reconcile (CW-R-38) ─────────────────────────────────────────────

  async reconcile(now: Date = new Date()): Promise<ReconcileReport> {
    const report: ReconcileReport = { job: 'calls.reconcile', cleaned: [], scheduled: [], failed: [], overdue: 0 };
    for (const session of await this.repo.listActiveSessions()) {
      try {
        if (now.getTime() >= roomClosesAt(session.endsAt).getTime()) {
          if (now.getTime() - session.endsAt.getTime() > OVERDUE_AFTER_END_MINUTES * MINUTE_MS) report.overdue += 1;
          const result = await this.cleanUp(session, 'reconcile', now);
          if (result.meetingDeleted || result.closed) report.cleaned.push(session.id);
        } else if (await this.scheduler.scheduleCleanup(session, now)) {
          report.scheduled.push(session.id);
        }
      } catch (error) {
        report.failed.push(session.id);
        this.logger.error({ sessionId: session.id, operation: 'reconcile', error: errorName(error) }, 'Reconcile failed');
      }
    }
    if (report.overdue > 0) {
      this.logger.warn({ operation: 'reconcile', overdue: report.overdue }, 'Active sessions past their end');
    }
    return report;
  }

  // ── appointment.remind (D-CW-26) ──────────────────────────────────────────

  async remind(
    data: CallsJobData['appointment.remind'],
    context: CallsJobContext<'appointment.remind'>,
    now: Date = new Date(),
  ): Promise<MailJobResult> {
    const sentTo = [...(data.sentTo ?? [])];
    const appointment = await this.appointments.findById(data.appointmentId);
    if (!appointment) return { appointmentId: data.appointmentId, skipped: 'not_found', sentTo };
    if (appointment.status !== 'confirmed') return { appointmentId: appointment.id, skipped: 'status', sentTo };
    if (appointment.startsAt.getTime() <= now.getTime()) {
      return { appointmentId: appointment.id, skipped: 'started', sentTo };
    }

    const window = this.windowOf(appointment);
    for (const role of ['employee', 'expert'] as const) {
      if (sentTo.includes(role)) continue;
      const userId = role === 'expert' ? appointment.expertUserId : appointment.employeeUserId;
      this.toast(userId, appointment, data.offsetMinutes);
      const user = await this.recipient(userId);
      if (user) {
        await this.mailer.send({
          to: user.email,
          locale: user.locale,
          template: 'appointment.reminder',
          data: { appointment: window, joinUrl: this.appointmentUrl(role, appointment.id) },
        });
      }
      sentTo.push(role);
      await context.updateData({ ...data, sentTo });
    }
    this.logger.log({ appointmentId: appointment.id, operation: 'remind', offsetMinutes: data.offsetMinutes }, 'Reminder sent');
    return { appointmentId: appointment.id, sentTo };
  }

  // ── calls.no_show_followup (CALL-07) ──────────────────────────────────────

  async noShowFollowUp(data: CallsJobData['calls.no_show_followup']): Promise<MailJobResult> {
    const appointment = await this.appointments.findById(data.appointmentId);
    if (!appointment) return { appointmentId: data.appointmentId, skipped: 'not_found', sentTo: [] };
    if (appointment.status !== 'no_show') return { appointmentId: appointment.id, skipped: 'status', sentTo: [] };
    const outcome = await this.repo.findLatestOutcomeStatus(appointment.id);
    if (outcome !== 'no_show_employee') return { appointmentId: appointment.id, skipped: 'outcome', sentTo: [] };

    const employee = await this.recipient(appointment.employeeUserId);
    if (employee) {
      await this.mailer.send({
        to: employee.email,
        locale: employee.locale,
        template: 'appointment.no_show_followup',
        data: { appointment: this.windowOf(appointment), reportProblemUrl: this.appointmentUrl('employee', appointment.id) },
      });
    }
    this.logger.log({ appointmentId: appointment.id, operation: 'noShowFollowUp' }, 'No-show follow-up sent');
    return { appointmentId: appointment.id, sentTo: employee ? ['employee'] : [] };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** The in-app reminder on the user's own room; best effort, ids and times only. */
  private toast(userId: string, appointment: AppointmentRecord, offsetMinutes: number): void {
    try {
      const payload = {
        appointmentId: appointment.id,
        startsAt: appointment.startsAt.toISOString(),
        offsetMinutes,
        timeZone: appointment.timeZone,
      };
      if (!this.rooms.emitToUser(userId, 'appointment.remind', payload)) {
        this.logger.warn({ appointmentId: appointment.id, operation: 'remindToast' }, 'Reminder toast not emitted');
      }
    } catch (error) {
      this.logger.error(
        { appointmentId: appointment.id, operation: 'remindToast', error: errorName(error) },
        'Reminder toast not emitted',
      );
    }
  }

  /** An active user's address and locale; null for a missing, suspended or deactivated user. */
  private async recipient(userId: string): Promise<{ email: string; locale: Locale } | null> {
    const user = await this.identities.findUserById(userId);
    if (!user || user.suspendedAt || user.deactivatedAt) return null;
    return { email: user.email, locale: localeOf(user.locale) };
  }

  private windowOf(appointment: AppointmentRecord) {
    const { id, startsAt, endsAt, timeZone } = toAppointmentResponse(appointment);
    return { id, startsAt, endsAt, timeZone };
  }

  /** The page with the join button: the workspace for the employee, the admin app for the expert. */
  private appointmentUrl(role: ReminderRecipient, appointmentId: string): string {
    const id = encodeURIComponent(appointmentId);
    if (role === 'expert') {
      return `${this.config.get<string>('ADMIN_URL') ?? 'http://localhost:5174'}/consultations/${id}`;
    }
    return `${this.config.get<string>('WORKSPACE_URL') ?? 'http://localhost:5173'}/appointments/${id}`;
  }
}
