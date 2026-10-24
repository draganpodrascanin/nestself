/**
 * CallsSchedulerModule: provides {@link CallsJobSchedulerService}, the
 * producer side of the `nestself-calls` queue (T-CW-1.2). It depends on
 * configuration only, so `AppointmentsModule` (reminders on creation, removal
 * on cancel) and the calls jobs can import it without a module cycle.
 */
import { Module } from '@nestjs/common';
import { CallsJobSchedulerService } from './calls-job-scheduler.service.js';

@Module({
  providers: [CallsJobSchedulerService],
  exports: [CallsJobSchedulerService],
})
export class CallsSchedulerModule {}
