/**
 * FollowUpNotifier: who hears about a follow-up step, after it is committed
 * (T-CW-1.9, D-CW-37, guidelines 8 and 10.5).
 *
 * | Step             | `call:{sessionId}` of the finished consultation | Also                                   | Email                                        |
 * | ---------------- | ----------------------------------------------- | -------------------------------------- | -------------------------------------------- |
 * | proposed         | `appointment.follow_up.proposed`                | `user:{employee}` (CALL-42)            | `appointment.follow_up.proposed`, employee   |
 * | confirmed        | `appointment.follow_up.confirmed`               |                                        | `appointment.follow_up.confirmed` with the calendar file, both parties |
 * | awaiting approval| `appointment.follow_up.confirmed` (`awaiting_approval`) |                                | none here: the approver's email is T-CW-1.10's |
 * | times suggested  | `appointment.times_suggested`                   | `user:{expert}`                        | none (guidelines 10.5 names none)            |
 * | declined         | `appointment.follow_up.declined`                | `user:{expert}` (T-CW-1.5)             | `appointment.follow_up.declined`, expert     |
 * | canceled (any appointment, CALL-27) |                              |                                        | `appointment.canceled`, both parties         |
 *
 * Everything here is best effort: the step has already succeeded, so a
 * failed emit or email is logged with ids only and never thrown. Payloads
 * carry ids, statuses and times (CW-R-36); emails are neutral and in the
 * recipient's locale (D-CW-26). A suspended or deactivated user gets no email.
 */
import { Injectable, Logger } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ConfigService } from '@nestjs/config';
import {
  LocaleSchema,
  defaultLocale,
  type FollowUpConfirmedPayload,
  type FollowUpTimeWindow,
  type Locale,
} from '@nestself/contracts';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { IdentityRepository } from '../db/repositories/identity.repository.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { Mailer, type MailInput } from '../mailer/mailer.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { RoomEmitter } from '../ws/room-emitter.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { FollowUpCallRoom } from './follow-up-call-room.js';
import type { AppointmentRecord } from './appointments.repository.js';

type Role = 'employee' | 'expert';

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}

function localeOf(value: string | null | undefined): Locale {
  const parsed = LocaleSchema.safeParse(value);
  return parsed.success ? parsed.data : defaultLocale;
}

function durationMinutesOf(appointment: Pick<AppointmentRecord, 'startsAt' | 'endsAt'>): number {
  return Math.round((appointment.endsAt.getTime() - appointment.startsAt.getTime()) / 60_000);
}

@Injectable()
export class FollowUpNotifier {
  private readonly logger = new Logger(FollowUpNotifier.name);

  constructor(
    private readonly callRoom: FollowUpCallRoom,
    private readonly rooms: RoomEmitter,
    private readonly mailer: Mailer,
    private readonly identities: IdentityRepository,
    private readonly config: ConfigService,
  ) {}

  async proposed(followUp: AppointmentRecord): Promise<void> {
    const payload = {
      appointmentId: followUp.followUpOf ?? followUp.id,
      followUpId: followUp.id,
      startsAt: followUp.startsAt.toISOString(),
      durationMinutes: durationMinutesOf(followUp),
    };
    await this.toCallRoom(followUp, 'proposed', (sessionId) => this.callRoom.emitProposed(sessionId, payload));
    this.guard(followUp, 'userRoom', () => this.rooms.emitToUser(followUp.employeeUserId, 'appointment.follow_up.proposed', payload));
    await this.mail(followUp, 'employee', (to, locale) => ({
      to,
      locale,
      template: 'appointment.follow_up.proposed',
      data: { appointment: this.windowOf(followUp), appointmentUrl: this.appointmentUrl('employee', followUp.id) },
    }));
  }

  async confirmed(followUp: AppointmentRecord, status: FollowUpConfirmedPayload['status']): Promise<void> {
    await this.toCallRoom(followUp, 'confirmed', (sessionId) =>
      this.callRoom.emitConfirmed(sessionId, {
        appointmentId: followUp.followUpOf ?? followUp.id,
        followUpId: followUp.id,
        status,
      }),
    );
    if (status !== 'confirmed') return;
    for (const role of ['employee', 'expert'] as const) {
      await this.mail(followUp, role, (to, locale) => ({
        to,
        locale,
        template: 'appointment.follow_up.confirmed',
        data: { appointment: this.windowOf(followUp), joinUrl: this.appointmentUrl(role, followUp.id) },
      }));
    }
  }

  async timesSuggested(followUp: AppointmentRecord, windows: FollowUpTimeWindow[]): Promise<void> {
    const payload = { appointmentId: followUp.followUpOf ?? followUp.id, followUpId: followUp.id, windows };
    await this.toCallRoom(followUp, 'timesSuggested', (sessionId) => this.callRoom.emitTimesSuggested(sessionId, payload));
    // The expert's own room: the follow-up page refreshes wherever the expert is (T-CW-1.9).
    this.guard(followUp, 'userRoom', () => this.rooms.emitToUser(followUp.expertUserId, 'appointment.times_suggested', payload));
  }

  async declined(followUp: AppointmentRecord): Promise<void> {
    const payload = { appointmentId: followUp.followUpOf ?? followUp.id, followUpId: followUp.id };
    await this.toCallRoom(followUp, 'declined', (sessionId) => this.callRoom.emitDeclined(sessionId, payload));
    // The expert's own room: the decline shows live wherever the expert is in the admin app (T-CW-1.5).
    this.guard(followUp, 'userRoom', () => this.rooms.emitToUser(followUp.expertUserId, 'appointment.follow_up.declined', payload));
    await this.mail(followUp, 'expert', (to, locale) => ({
      to,
      locale,
      template: 'appointment.follow_up.declined',
      data: { appointment: this.windowOf(followUp), appointmentUrl: this.appointmentUrl('expert', followUp.id) },
    }));
  }

  /**
   * CALL-27 criterion 6: the appointment was canceled. Both participants get
   * `appointment.canceled` (with the calendar's CANCEL part) in their own
   * locale, each with their own appointment page.
   */
  async canceled(appointment: AppointmentRecord): Promise<void> {
    for (const role of ['employee', 'expert'] as const) {
      await this.mail(appointment, role, (to, locale) => ({
        to,
        locale,
        template: 'appointment.canceled',
        data: { appointment: this.windowOf(appointment), appointmentUrl: this.appointmentUrl(role, appointment.id) },
      }));
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Emits on the finished consultation's latest session room, when it had one. */
  private async toCallRoom(
    followUp: AppointmentRecord,
    step: string,
    emit: (sessionId: string) => boolean,
  ): Promise<void> {
    if (!followUp.followUpOf) return;
    try {
      const sessionId = await this.callRoom.latestSessionId({ id: followUp.followUpOf, orgId: followUp.orgId });
      if (!sessionId) return;
      if (!emit(sessionId)) {
        this.logger.warn({ appointmentId: followUp.id, step, operation: 'callRoom' }, 'Follow-up room event not emitted');
      }
    } catch (error) {
      this.logger.error(
        { appointmentId: followUp.id, step, operation: 'callRoom', error: errorName(error) },
        'Follow-up room event not emitted',
      );
    }
  }

  private guard(followUp: AppointmentRecord, operation: string, emit: () => boolean): void {
    try {
      if (!emit()) this.logger.warn({ appointmentId: followUp.id, operation }, 'Follow-up event not emitted');
    } catch (error) {
      this.logger.error({ appointmentId: followUp.id, operation, error: errorName(error) }, 'Follow-up event not emitted');
    }
  }

  private async mail(
    followUp: AppointmentRecord,
    role: Role,
    build: (to: string, locale: Locale) => MailInput,
  ): Promise<void> {
    try {
      const user = await this.identities.findUserById(role === 'expert' ? followUp.expertUserId : followUp.employeeUserId);
      if (!user || user.suspendedAt || user.deactivatedAt) return;
      await this.mailer.send(build(user.email, localeOf(user.locale)));
    } catch (error) {
      this.logger.error(
        { appointmentId: followUp.id, role, operation: 'mail', error: errorName(error) },
        'Follow-up email not sent',
      );
    }
  }

  private windowOf(appointment: AppointmentRecord) {
    return {
      id: appointment.id,
      startsAt: appointment.startsAt.toISOString(),
      endsAt: appointment.endsAt.toISOString(),
      timeZone: appointment.timeZone,
    };
  }

  /** The appointment page: the workspace for the employee, the admin app for the expert. */
  private appointmentUrl(role: Role, appointmentId: string): string {
    const id = encodeURIComponent(appointmentId);
    if (role === 'expert') {
      return `${this.config.get<string>('ADMIN_URL') ?? 'http://localhost:5174'}/consultations/${id}`;
    }
    return `${this.config.get<string>('WORKSPACE_URL') ?? 'http://localhost:5173'}/appointments/${id}`;
  }
}
