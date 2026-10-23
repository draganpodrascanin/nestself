/**
 * Worker entrypoint: the ECS `worker` service and `pnpm --filter @nestself/api
 * worker` run this instead of `main.ts`. It boots the application context
 * (no HTTP listener, no gateways) and starts the maintenance scheduler.
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from '../app.module.js';
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
  logger.log('Worker running');
}

bootstrap();
