/**
 * WebinarsModule: webinar occurrences, registration, the live session, the
 * chat, the floor and polls (T-CW-2.1, NS-CALLS-01).
 *
 * Binds the repository to the `@Authorize()` resolvers, which run inside the
 * global AuthorizationGuard outside dependency injection.
 *
 * Exports `WebinarsRepository` for the `webinar:{id}` and
 * `webinar:{id}:moderation` room resolvers of T-CW-2.3 (`findById`,
 * `findRegistration`, `findHost`), `WebinarAccess` for the same
 * authorization rules, and `WebinarJobsService` for the worker, which starts
 * `WebinarJobSchedulerService` with it. Provides `WebinarsService` under
 * `WEBINAR_SESSION_CLOSED_HANDLER`, which the session lifecycle looks up to
 * end a live webinar whose meeting closed, and the recording pipeline
 * (`WebinarRecordingService`, T-CW-2.5).
 */
import { Module, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CallsModule } from '../calls/calls.module.js';
import { WEBINAR_SESSION_CLOSED_HANDLER } from '../calls/session-lifecycle.js';
import { WebinarJobSchedulerService } from '../jobs/webinar-job-scheduler.service.js';
import { MailerModule } from '../mailer/mailer.module.js';
import { VideoModule } from '../video/video.module.js';
import { WsModule } from '../ws/ws.module.js';
import { WebinarRecordingsRepository } from './recording.repository.js';
import { WebinarRecordingService } from './recording.service.js';
import { WebinarAccess } from './webinar-access.js';
import { WebinarJobsService } from './webinar-jobs.service.js';
import { WebinarLiveService } from './webinar-live.service.js';
import { WebinarMailer } from './webinar-mailer.js';
import { WebinarOpsService } from './webinar-ops.service.js';
import { WebinarRoomEvents } from './webinar-room-events.js';
import { bindWebinarLookup } from './webinar.resolver.js';
import { WebinarsOpsController } from './webinars-ops.controller.js';
import { WebinarsController } from './webinars.controller.js';
import { WebinarsRepository } from './webinars.repository.js';
import { WebinarsService } from './webinars.service.js';

@Module({
  imports: [AuthModule, CallsModule, VideoModule, WsModule, MailerModule],
  controllers: [WebinarsController, WebinarsOpsController],
  providers: [
    WebinarsRepository,
    WebinarAccess,
    WebinarsService,
    WebinarLiveService,
    WebinarOpsService,
    WebinarRoomEvents,
    WebinarMailer,
    WebinarJobSchedulerService,
    WebinarJobsService,
    WebinarRecordingsRepository,
    WebinarRecordingService,
    // The session lifecycle (CallsJobsModule) ends a live webinar whose session closed (T-CW-2.5).
    { provide: WEBINAR_SESSION_CLOSED_HANDLER, useExisting: WebinarsService },
  ],
  exports: [WebinarsRepository, WebinarAccess, WebinarJobSchedulerService, WebinarJobsService],
})
export class WebinarsModule implements OnModuleInit, OnModuleDestroy {
  constructor(private readonly repo: WebinarsRepository) {}

  onModuleInit(): void {
    bindWebinarLookup(this.repo);
  }

  onModuleDestroy(): void {
    bindWebinarLookup(null);
  }
}
