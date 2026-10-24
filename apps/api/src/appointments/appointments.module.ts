/**
 * AppointmentsModule: the appointment spine (T-CW-0.6, NS-CALLS-01). Binds
 * its repository to `appointmentResource`, which runs inside the global
 * AuthorizationGuard, outside dependency injection. Imports the calls job
 * producer so a new appointment schedules its reminders and a cancellation
 * removes them (T-CW-1.2).
 */
import { Module, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CallsSchedulerModule } from '../jobs/calls-scheduler.module.js';
import { bindAppointmentLookup } from './appointment.resolver.js';
import { AppointmentsController } from './appointments.controller.js';
import { AppointmentsRepository } from './appointments.repository.js';
import { AppointmentsService } from './appointments.service.js';

@Module({
  imports: [AuthModule, CallsSchedulerModule],
  controllers: [AppointmentsController],
  providers: [AppointmentsRepository, AppointmentsService],
  exports: [AppointmentsRepository, AppointmentsService],
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
