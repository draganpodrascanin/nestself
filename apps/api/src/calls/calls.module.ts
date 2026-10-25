/**
 * CallsModule: consultation call sessions (T-CW-1.1, NS-CALLS-01). Binds the
 * call session lookup to `callSessionResource`, which runs inside the global
 * AuthorizationGuard, outside dependency injection.
 *
 * Provider events in the API process (T-CW-1.2): with `VIDEO_PROVIDER=none`
 * the fake provider lives in each process, so the worker's consumer never
 * sees the events of the meetings this process creates and ends. On
 * application bootstrap this module therefore starts `ChimeEventsConsumer`
 * in its fake mode here, so a fake `MeetingEnded` (or
 * `FakeVideoProvider.simulateEvent`) reaches the event applier as it would
 * from the chime-events queue. With `VIDEO_PROVIDER=chime` nothing starts:
 * the worker polls the queue. `VIDEO_FAKE_EVENTS_IN_API=false` turns the
 * subscription off for a test that drives the applier itself. The consumer
 * belongs to `CallsJobsModule`, which imports this module, so it is looked up
 * at bootstrap rather than injected; without it nothing starts.
 */
import {
  Logger,
  Module,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ModuleRef } from '@nestjs/core';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ConfigService } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module.js';
import { AppointmentsModule } from '../appointments/appointments.module.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { AppointmentsRepository } from '../appointments/appointments.repository.js';
import { CallsSchedulerModule } from '../jobs/calls-scheduler.module.js';
import { VideoModule } from '../video/video.module.js';
import { WsModule } from '../ws/ws.module.js';
import { bindCallSessionLookup } from './call-session.resolver.js';
import { CallsController } from './calls.controller.js';
import { CallsRepository } from './calls.repository.js';
import { CallsService } from './calls.service.js';
import { ChimeEventsConsumer } from './chime-event-consumer.js';
import { ProblemReportsService } from './problem-reports.service.js';
import { VideoMetrics } from './video-metrics.js';

/** Set to `false` to keep the API process from applying the fake provider's events. */
export const VIDEO_FAKE_EVENTS_IN_API = 'VIDEO_FAKE_EVENTS_IN_API';

/** Whether this process should subscribe the applier to the in-process fake provider. */
export function shouldApplyFakeEventsInApi(config: Pick<ConfigService, 'get'>): boolean {
  const provider = config.get<string>('VIDEO_PROVIDER') || 'none';
  // The validated environment holds a boolean (T-CW-2.5); a raw string still counts.
  return provider === 'none' && String(config.get<unknown>(VIDEO_FAKE_EVENTS_IN_API)) !== 'false';
}

@Module({
  imports: [AuthModule, AppointmentsModule, VideoModule, WsModule, CallsSchedulerModule],
  controllers: [CallsController],
  providers: [CallsRepository, CallsService, VideoMetrics, ProblemReportsService],
  exports: [CallsRepository, CallsService, VideoMetrics],
})
export class CallsModule implements OnModuleInit, OnModuleDestroy, OnApplicationBootstrap {
  private readonly logger = new Logger(CallsModule.name);

  constructor(
    private readonly repo: CallsRepository,
    private readonly appointments: AppointmentsRepository,
    private readonly config: ConfigService,
    private readonly moduleRef: ModuleRef,
  ) {}

  onModuleInit(): void {
    bindCallSessionLookup({
      findSessionById: (id) => this.repo.findSessionById(id),
      findAppointmentById: (id) => this.appointments.findById(id),
    });
  }

  onApplicationBootstrap(): void {
    if (!shouldApplyFakeEventsInApi(this.config)) return;
    let consumer: ChimeEventsConsumer;
    try {
      consumer = this.moduleRef.get(ChimeEventsConsumer, { strict: false });
    } catch {
      this.logger.warn('ChimeEventsConsumer is not part of this application; fake provider events are not applied');
      return;
    }
    // Idempotent: the worker's own start() returns the running mode.
    const mode = consumer.start();
    this.logger.log(`Fake provider events applied in this process (consumer: ${mode})`);
  }

  onModuleDestroy(): void {
    bindCallSessionLookup(null);
  }
}
