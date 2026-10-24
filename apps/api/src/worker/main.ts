/**
 * Worker entrypoint: the ECS `worker` service and `pnpm --filter @nestself/api
 * worker` run this instead of `main.ts`. It boots the application context
 * (no HTTP listener, no gateways) and starts the maintenance scheduler
 * and the media processing worker.
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from '../app.module.js';
import { JobSchedulerService } from '../jobs/job-scheduler.service.js';
import { MediaJobProcessor } from '../media/media-job.processor.js';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  const logger = app.get(Logger);
  app.useLogger(logger);
  app.enableShutdownHooks();

  const schedulerStarted = await app.get(JobSchedulerService).start();
  if (!schedulerStarted) {
    logger.error('Worker exiting: no Redis connection to schedule on');
    await app.close();
    process.exitCode = 1;
    return;
  }

  // Start the media processing worker (C1)
  const mediaStarted = await app.get(MediaJobProcessor).startWorker();
  if (!mediaStarted) {
    logger.warn('Media worker not started (REDIS_URL absent)');
  }

  logger.log('Worker running');
}

bootstrap();
