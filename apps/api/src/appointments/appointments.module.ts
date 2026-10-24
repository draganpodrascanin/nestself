/**
 * AppointmentsModule: the appointment spine (T-CW-0.6, NS-CALLS-01). Binds
 * its repository to `appointmentResource`, which runs inside the global
 * AuthorizationGuard, outside dependency injection. Imports the calls job
 * producer so a new appointment schedules its reminders and a cancellation
 * removes them (T-CW-1.2).
 *
 * Follow-ups (T-CW-1.9): `FollowUpService` with the organization policy
 * reader, the approval seam (`FOLLOW_UP_APPROVAL`, bound to
 * `NotConfiguredFollowUpApproval` until T-CW-1.10 binds the approval
 * service), the room and email notifier (`WsModule`, `MailerModule`) and the
 * calls-module adapter, which looks the calls providers up at first use
 * because `CallsModule` imports this module.
 */
import { Module, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CallsSchedulerModule } from '../jobs/calls-scheduler.module.js';
import { MailerModule } from '../mailer/mailer.module.js';
import { WsModule } from '../ws/ws.module.js';
import { bindAppointmentLookup } from './appointment.resolver.js';
import { AppointmentsController } from './appointments.controller.js';
import { AppointmentsRepository } from './appointments.repository.js';
import { AppointmentsService } from './appointments.service.js';
import { FOLLOW_UP_APPROVAL, NotConfiguredFollowUpApproval } from './follow-up-approval.js';
import { FollowUpCallRoom } from './follow-up-call-room.js';
import { FollowUpNotifier } from './follow-up-notifier.js';
import { FollowUpPolicyReader } from './follow-up-policy.js';
import { FollowUpService } from './follow-up.service.js';

@Module({
  imports: [AuthModule, CallsSchedulerModule, MailerModule, WsModule],
  controllers: [AppointmentsController],
  providers: [
    AppointmentsRepository,
    AppointmentsService,
    FollowUpService,
    FollowUpPolicyReader,
    FollowUpCallRoom,
    FollowUpNotifier,
    { provide: FOLLOW_UP_APPROVAL, useClass: NotConfiguredFollowUpApproval },
  ],
  exports: [AppointmentsRepository, AppointmentsService, FollowUpPolicyReader, FOLLOW_UP_APPROVAL],
})
export class AppointmentsModule implements OnModuleInit, OnModuleDestroy {
  constructor(private readonly repo: AppointmentsRepository) {}

  onModuleInit(): void {
    bindAppointmentLookup(this.repo);
  }

  onModuleDestroy(): void {
    bindAppointmentLookup(null);
  }
}
