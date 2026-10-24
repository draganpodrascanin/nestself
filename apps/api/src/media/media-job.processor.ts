/**
 * Media job processor — runs on the `nestself-media` queue (8.4).
 *
 * Concurrency 2, worker process only.
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
  private connection: Redis | null = null;
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

    this.connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.queue = new Queue(MEDIA_QUEUE, { connection: this.connection });

    this.worker = new Worker(
      MEDIA_QUEUE,
      async (job: Job<MediaJobData>) => {
        this.logger.log(`Processing media asset: ${job.data.assetId}`);
        return this.mediaService.processAsset(job.data.assetId);
      },
      { connection: this.connection, concurrency: 2 },
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
   */
  async enqueue(assetId: string): Promise<void> {
    const redisUrl = this.config.get<string>('REDIS_URL');
    if (!redisUrl) {
      // In development/test without Redis, process inline
      this.logger.warn(`No Redis; processing asset ${assetId} inline`);
      await this.mediaService.processAsset(assetId);
      return;
    }

    if (!this.queue) {
      // API process: create a queue connection for enqueuing only
      const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
      this.queue = new Queue(MEDIA_QUEUE, { connection });
    }

    await this.queue.add('process', { assetId } satisfies MediaJobData, {
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 100 },
      attempts: 3,
      backoff: { type: 'exponential', delay: 10_000 },
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close().catch(() => {});
    await this.queue?.close().catch(() => {});
    this.connection?.disconnect();
    this.worker = null;
    this.queue = null;
    this.connection = null;
  }
}
