/**
 * ApprovalNotifier: who hears about a follow-up approval step, after it is
 * committed (T-CW-1.10, D-CW-37, guidelines 10.5).
 *
 * | Step      | `call:{sessionId}` of the finished consultation       | Email                                                                  |
 * | --------- | ----------------------------------------------------- | ---------------------------------------------------------------------- |
 * | requested |                                                       | `appointment.approval.requested`, the approver and the alternate       |
 * | reminder  |                                                       | `appointment.approval.reminder`, the approver and the alternate        |
 * | approved  | `appointment.follow_up.confirmed` (`confirmed`)       | `appointment.approval.decided` (approved, calendar file), the employee; `appointment.follow_up.confirmed` (calendar file), the expert |
 * | rejected  | `appointment.follow_up.declined`                      | `appointment.approval.decided` (rejected, with the safe reason), the employee; `appointment.follow_up.declined`, the expert |
 * | expired   | `appointment.follow_up.declined`                      | `appointment.approval.decided` (expired), the employee; `appointment.follow_up.declined`, the expert |
 *
 * The approver's emails carry the employee's display name, the fixed
 * description, the date and the duration only (CW-R-119, LAW-14). The expert
 * never learns the reason. Best effort: a failed emit or email is logged with
 * ids only and never thrown. A suspended or deactivated user gets no email.
 */
import { Injectable, Logger } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ConfigService } from '@nestjs/config';
import { LocaleSchema, defaultLocale, type Locale } from '@nestself/contracts';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { IdentityRepository } from '../db/repositories/identity.repository.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { Mailer, type MailInput } from '../mailer/mailer.js';
import type { AppointmentRecord } from './appointments.repository.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { FollowUpCallRoom } from './follow-up-call-room.js';

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}

function localeOf(value: string | null | undefined): Locale {
  const parsed = LocaleSchema.safeParse(value);
  return parsed.success ? parsed.data : defaultLocale;
}

@Injectable()
export class ApprovalNotifier {
  private readonly logger = new Logger(ApprovalNotifier.name);

  constructor(
    private readonly callRoom: FollowUpCallRoom,
    private readonly mailer: Mailer,
    private readonly identities: IdentityRepository,
    private readonly config: ConfigService,
  ) {}

  /** The request email to one decider (the approver or the alternate). */
  async requested(appointment: AppointmentRecord, userId: string, employeeDisplayName: string): Promise<void> {
    await this.mailTo(appointment, userId, 'requested', (to, locale) => ({
      to,
      locale,
      template: 'appointment.approval.requested',
      data: { employeeDisplayName, appointment: this.windowOf(appointment), approvalsUrl: this.approvalsUrl() },
    }));
  }

  /**
   * The reminder to one decider. Throws when the email fails, so the job
   * retries; true when an email went out, false when the user may not get one.
   */
  async reminder(appointment: AppointmentRecord, userId: string, employeeDisplayName: string): Promise<boolean> {
    const user = await this.recipient(userId);
    if (!user) return false;
    await this.mailer.send({
      to: user.email,
      locale: user.locale,
      template: 'appointment.approval.reminder',
      data: { employeeDisplayName, appointment: this.windowOf(appointment), approvalsUrl: this.approvalsUrl() },
    });
    return true;
  }

  async approved(appointment: AppointmentRecord): Promise<void> {
    await this.toCallRoom(appointment, 'approved', (sessionId) =>
      this.callRoom.emitConfirmed(sessionId, {
        appointmentId: appointment.followUpOf ?? appointment.id,
        followUpId: appointment.id,
        status: 'confirmed',
      }),
    );
    await this.mailTo(appointment, appointment.employeeUserId, 'approved', (to, locale) => ({
      to,
      locale,
      template: 'appointment.approval.decided',
      data: {
        appointment: this.fullWindowOf(appointment),
        decision: 'approved',
        joinUrl: this.appointmentUrl('employee', appointment.id),
      },
    }));
    await this.mailTo(appointment, appointment.expertUserId, 'approved', (to, locale) => ({
      to,
      locale,
      template: 'appointment.follow_up.confirmed',
      data: { appointment: this.fullWindowOf(appointment), joinUrl: this.appointmentUrl('expert', appointment.id) },
    }));
  }

  async rejected(appointment: AppointmentRecord, reason: string): Promise<void> {
    await this.closed(appointment, 'rejected', (to, locale) => ({
      to,
      locale,
      template: 'appointment.approval.decided',
      data: {
        appointment: this.fullWindowOf(appointment),
        decision: 'rejected',
        reason,
        appointmentUrl: this.appointmentUrl('employee', appointment.id),
      },
    }));
  }

  async expired(appointment: AppointmentRecord): Promise<void> {
    await this.closed(appointment, 'expired', (to, locale) => ({
      to,
      locale,
      template: 'appointment.approval.decided',
      data: {
        appointment: this.fullWindowOf(appointment),
        decision: 'expired',
        appointmentUrl: this.appointmentUrl('employee', appointment.id),
      },
    }));
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** A rejected or expired follow-up: declined on the room, the employee told why, the expert told it is off. */
  private async closed(
    appointment: AppointmentRecord,
    step: string,
    employeeMail: (to: string, locale: Locale) => MailInput,
  ): Promise<void> {
    await this.toCallRoom(appointment, step, (sessionId) =>
      this.callRoom.emitDeclined(sessionId, {
        appointmentId: appointment.followUpOf ?? appointment.id,
        followUpId: appointment.id,
      }),
    );
    await this.mailTo(appointment, appointment.employeeUserId, step, employeeMail);
    await this.mailTo(appointment, appointment.expertUserId, step, (to, locale) => ({
      to,
      locale,
      template: 'appointment.follow_up.declined',
      data: { appointment: this.fullWindowOf(appointment), appointmentUrl: this.appointmentUrl('expert', appointment.id) },
    }));
  }

  private async toCallRoom(appointment: AppointmentRecord, step: string, emit: (sessionId: string) => boolean): Promise<void> {
    if (!appointment.followUpOf) return;
    try {
      const sessionId = await this.callRoom.latestSessionId({ id: appointment.followUpOf, orgId: appointment.orgId });
      if (sessionId && !emit(sessionId)) {
        this.logger.warn({ appointmentId: appointment.id, step, operation: 'callRoom' }, 'Approval room event not emitted');
      }
    } catch (error) {
      this.logger.error(
        { appointmentId: appointment.id, step, operation: 'callRoom', error: errorName(error) },
        'Approval room event not emitted',
      );
    }
  }

  private async recipient(userId: string): Promise<{ email: string; locale: Locale } | null> {
    const user = await this.identities.findUserById(userId);
    if (!user || user.suspendedAt || user.deactivatedAt) return null;
    return { email: user.email, locale: localeOf(user.locale) };
  }

  private async mailTo(
    appointment: AppointmentRecord,
    userId: string,
    step: string,
    build: (to: string, locale: Locale) => MailInput,
  ): Promise<void> {
    try {
      const user = await this.recipient(userId);
      if (!user) return;
      await this.mailer.send(build(user.email, user.locale));
    } catch (error) {
      this.logger.error(
        { appointmentId: appointment.id, step, operation: 'mail', error: errorName(error) },
        'Approval email not sent',
      );
    }
  }

  private windowOf(appointment: AppointmentRecord) {
    return {
      startsAt: appointment.startsAt.toISOString(),
      endsAt: appointment.endsAt.toISOString(),
      timeZone: appointment.timeZone,
    };
  }

  private fullWindowOf(appointment: AppointmentRecord) {
    return { id: appointment.id, ...this.windowOf(appointment) };
  }

  private approvalsUrl(): string {
    return `${this.config.get<string>('WORKSPACE_URL') ?? 'http://localhost:5173'}/approvals`;
  }

  /** The appointment page: the workspace for the employee, the admin app for the expert. */
  private appointmentUrl(role: 'employee' | 'expert', appointmentId: string): string {
    const id = encodeURIComponent(appointmentId);
    if (role === 'expert') {
      return `${this.config.get<string>('ADMIN_URL') ?? 'http://localhost:5174'}/consultations/${id}`;
    }
    return `${this.config.get<string>('WORKSPACE_URL') ?? 'http://localhost:5173'}/appointments/${id}`;
  }
}
