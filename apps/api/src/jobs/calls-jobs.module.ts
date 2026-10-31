/**
 * CallsJobsModule: the background side of the consultation calls (T-CW-1.2,
 * D-CW-09, D-CW-12, D-CW-26).
 *
 * - `CallsJobsService`: what `calls.cleanup`, `calls.reconcile`,
 *   `appointment.remind` and `calls.no_show_followup` do; the worker process
 *   passes it to `CallsJobSchedulerService.start()`.
 * - `EventApplier`, `CallSessionLifecycle` and `ChimeEventsConsumer`
 *   (`apps/api/src/calls/`): provider events into `call_events`, the
 *   participants' timestamps and the session's end. The worker starts the
 *   consumer; nothing here runs in the API process until started.
 *
 * Kept apart from `CallsModule` so the HTTP module does not depend on the
 * mailer or the queue consumer.
 */
import { Module } from '@nestjs/common';
import { AppointmentsModule } from '../appointments/appointments.module.js';
import { ChimeEventsConsumer } from '../calls/chime-event-consumer.js';
import { CallsModule } from '../calls/calls.module.js';
import { EventApplier } from '../calls/event-applier.js';
import { CallSessionLifecycle } from '../calls/session-lifecycle.js';
import { MailerModule } from '../mailer/mailer.module.js';
import { VideoModule } from '../video/video.module.js';
import { WsModule } from '../ws/ws.module.js';
import { CallsJobsService } from './calls-jobs.service.js';
import { CallsSchedulerModule } from './calls-scheduler.module.js';

@Module({
  imports: [CallsModule, AppointmentsModule, VideoModule, WsModule, MailerModule, CallsSchedulerModule],
  providers: [CallSessionLifecycle, EventApplier, ChimeEventsConsumer, CallsJobsService],
  exports: [CallSessionLifecycle, EventApplier, ChimeEventsConsumer, CallsJobsService, CallsSchedulerModule],
})
export class CallsJobsModule {}
