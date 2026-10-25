/**
 * AppointmentsModule: the appointment spine (T-CW-0.6, NS-CALLS-01). Binds
 * its repository to `appointmentResource`, which runs inside the global
 * AuthorizationGuard, outside dependency injection. Imports the calls job
 * producer so a new appointment schedules its reminders and a cancellation
 * removes them (T-CW-1.2).
 *
 * Follow-ups (T-CW-1.9): `FollowUpService` with the organization policy
 * reader, the approval seam (`FOLLOW_UP_APPROVAL`), the room and email
 * notifier (`WsModule`, `MailerModule`) and the calls-module adapter, which
 * looks the calls providers up at first use because `CallsModule` imports
 * this module.
 *
 * Approvals (T-CW-1.10): `ApprovalController` and `ApprovalService`, bound to
 * `FOLLOW_UP_APPROVAL` and exported for the calls jobs
 * (`appointment.approval.remind`, `appointment.approval.expire`); the
 * repository is bound to `approvalResource` like the appointment lookup.
 */
import { Module, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CallsSchedulerModule } from '../jobs/calls-scheduler.module.js';
import { MailerModule } from '../mailer/mailer.module.js';
import { WsModule } from '../ws/ws.module.js';
import { bindAppointmentLookup } from './appointment.resolver.js';
import { AppointmentViewerReader } from './appointment-viewer.js';
import { AppointmentsController } from './appointments.controller.js';
import { AppointmentsRepository } from './appointments.repository.js';
import { AppointmentsService } from './appointments.service.js';
import { ApprovalNotifier } from './approval-notifier.js';
import { ApprovalController } from './approval.controller.js';
import { ApprovalRepository } from './approval.repository.js';
import { bindApprovalLookup } from './approval.resolver.js';
import { ApprovalService } from './approval.service.js';
import { FOLLOW_UP_APPROVAL } from './follow-up-approval.js';
import { FollowUpCallRoom } from './follow-up-call-room.js';
import { FollowUpNotifier } from './follow-up-notifier.js';
import { FollowUpPolicyReader } from './follow-up-policy.js';
import { FollowUpService } from './follow-up.service.js';

@Module({
  imports: [AuthModule, CallsSchedulerModule, MailerModule, WsModule],
  controllers: [AppointmentsController, ApprovalController],
  providers: [
    AppointmentsRepository,
    AppointmentsService,
    AppointmentViewerReader,
    FollowUpService,
    FollowUpPolicyReader,
    FollowUpCallRoom,
    FollowUpNotifier,
    ApprovalRepository,
    ApprovalNotifier,
    ApprovalService,
    { provide: FOLLOW_UP_APPROVAL, useExisting: ApprovalService },
  ],
  exports: [AppointmentsRepository, AppointmentsService, FollowUpPolicyReader, FOLLOW_UP_APPROVAL, ApprovalService],
})
export class AppointmentsModule implements OnModuleInit, OnModuleDestroy {
  constructor(
    private readonly repo: AppointmentsRepository,
    private readonly approvals: ApprovalRepository,
  ) {}

  onModuleInit(): void {
    bindAppointmentLookup(this.repo);
    bindApprovalLookup(this.approvals);
  }

  onModuleDestroy(): void {
    bindAppointmentLookup(null);
    bindApprovalLookup(null);
  }
}
