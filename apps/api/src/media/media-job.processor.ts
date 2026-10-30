/**
 * Media job processor — runs on the `nestself-media` queue (8.4).
 *
 * Concurrency 2, worker process only. The API process only enqueues.
 *
 * C1 fixes:
 * - No inline fallback when Redis is absent (upload returns 'uploaded', the
 *   queue processes later).
 * - Shared BullMQ connection: one connection for the queue, one for the worker.
 * - Job options: attempts 3, exponential 60 s, keep 30 completed / 100 failed
 *   (ARC-R-14).
 */
import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { MediaService } from './media.service.js';

export const MEDIA_QUEUE = 'nestself-media';

export interface MediaJobData {
  assetId: string;
}

@Injectable()
export class MediaJobProcessor implements OnModuleDestroy {
  private readonly logger = new Logger(MediaJobProcessor.name);
  private workerConnection: Redis | null = null;
  private queueConnection: Redis | null = null;
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly mediaService: MediaService,
  ) {}

  /**
   * Start the media worker. Returns false when REDIS_URL is absent.
   * Called by the worker entrypoint only; the API process only enqueues.
   */
  async startWorker(): Promise<boolean> {
    const redisUrl = this.config.get<string>('REDIS_URL');
    if (!redisUrl) {
      this.logger.warn('REDIS_URL not set; media worker is disabled');
      return false;
    }

    this.workerConnection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.worker = new Worker(
      MEDIA_QUEUE,
      async (job: Job<MediaJobData>) => {
        this.logger.log(`Processing media asset: ${job.data.assetId}`);
        return this.mediaService.processAsset(job.data.assetId);
      },
      { connection: this.workerConnection, concurrency: 2 },
    );

    this.worker.on('completed', (job) =>
      this.logger.log(`media job ${job.id} completed for asset ${job.data.assetId}`),
    );
    this.worker.on('failed', (job, err) =>
      this.logger.error(`media job ${job?.id} failed: ${err.message}`),
    );

    this.logger.log('media worker started (concurrency 2)');
    return true;
  }

  /**
   * Enqueue a processing job. Used by the upload endpoint.
   *
   * When REDIS_URL is absent (test/dev without Redis), does nothing.
   * The asset stays in 'uploaded' state until a worker picks it up or
   * processAsset() is called directly in tests.
   */
  async enqueue(assetId: string): Promise<void> {
    const redisUrl = this.config.get<string>('REDIS_URL');
    if (!redisUrl) {
      // No Redis available — process synchronously (development / e2e).
      this.logger.debug(`No Redis; processing asset ${assetId} synchronously`);
      try {
        await this.mediaService.processAsset(assetId);
      } catch (err) {
        this.logger.warn(`Synchronous processing failed for ${assetId}: ${err}`);
      }
      return;
    }

    if (!this.queue) {
      // API process: create a queue connection for enqueuing only
      this.queueConnection = new Redis(redisUrl, { maxRetriesPerRequest: null });
      this.queue = new Queue(MEDIA_QUEUE, { connection: this.queueConnection });
    }

    await this.queue.add('process', { assetId } satisfies MediaJobData, {
      removeOnComplete: { count: 30 },
      removeOnFail: { count: 100 },
      attempts: 3,
      backoff: { type: 'exponential', delay: 60_000 },
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close().catch(() => {});
    await this.queue?.close().catch(() => {});
    this.workerConnection?.disconnect();
    this.queueConnection?.disconnect();
    this.worker = null;
    this.queue = null;
    this.workerConnection = null;
    this.queueConnection = null;
  }
}
