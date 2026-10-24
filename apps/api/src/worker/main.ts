/**
 * Worker entrypoint: the ECS `worker` service and `pnpm --filter @nestself/api
 * worker` run this instead of `main.ts`. It boots the application context
 * (no HTTP listener, no gateways) and starts:
 *
 * - the maintenance scheduler (`nestself-maintenance`, `JobSchedulerService`);
 * - the calls job scheduler (`nestself-calls`: `calls.cleanup`,
 *   `calls.reconcile`, `appointment.remind`, `calls.no_show_followup`,
 *   T-CW-1.2) with `CallsJobsService` as its handler;
 * - `chime.events.consume` (`ChimeEventsConsumer`): the chime-events SQS
 *   queue with `VIDEO_PROVIDER=chime`, otherwise the fake provider's
 *   in-process events (D-CW-12, CW-R-41).
 *
 * Shutdown: `enableShutdownHooks` turns SIGTERM and SIGINT into `app.close()`,
 * whose module-destroy hooks stop the consumer's receive loop and wait for
 * the message being applied, then close both BullMQ workers (which finish
 * their active jobs) before the database pool and Redis close.
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from '../app.module.js';
import { ChimeEventsConsumer } from '../calls/chime-event-consumer.js';
import { CallsJobSchedulerService } from '../jobs/calls-job-scheduler.service.js';
import { CallsJobsService } from '../jobs/calls-jobs.service.js';
import { JobSchedulerService } from '../jobs/job-scheduler.service.js';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  const logger = app.get(Logger);
  app.useLogger(logger);
  app.enableShutdownHooks();

  const started = await app.get(JobSchedulerService).start();
  if (!started) {
    logger.error('Worker exiting: no Redis connection to schedule on');
    await app.close();
    process.exitCode = 1;
    return;
  }
  await app.get(CallsJobSchedulerService).start(app.get(CallsJobsService));
  const events = app.get(ChimeEventsConsumer).start();
  logger.log(`Worker running (chime events: ${events})`);
}

bootstrap();
