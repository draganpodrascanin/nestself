/**
 * MediaModule — media upload, processing, and delivery (T-C1.08).
 *
 * Provides the MEDIA_STORAGE token (local or s3), the MediaService for
 * database operations, MediaJobProcessor for background processing,
 * and the two controllers (ops and library).
 */
import { Module, type DynamicModule, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolve } from 'node:path';
import { MEDIA_STORAGE, type MediaStorage } from './storage/media-storage.js';
import { LocalMediaStorage } from './storage/local-media-storage.js';
import { MediaService } from './media.service.js';
import { MediaJobProcessor } from './media-job.processor.js';
import { MediaOpsController } from './media-ops.controller.js';
import { MediaLibraryController } from './media-library.controller.js';
import { AuditModule } from '../audit/audit.module.js';
import { CmsScopeService } from '../authz/cms-scope.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { AvailabilityModule } from '../library/availability/availability.module.js';

@Module({})
export class MediaModule {
  static register(): DynamicModule {
    return {
      module: MediaModule,
      imports: [AuditModule, AuthModule, AvailabilityModule],
      controllers: [MediaOpsController, MediaLibraryController],
      providers: [
        {
          provide: MEDIA_STORAGE,
          inject: [ConfigService],
          useFactory: (config: ConfigService): MediaStorage => {
            const mode = config.get<string>('MEDIA_STORAGE') ?? 'local';
            const nodeEnv = config.get<string>('NODE_ENV') ?? 'development';

            if (mode === 's3') {
              // S3 driver: deferred to T-C2.09
              // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy load to avoid bundling unused S3 deps
              const mod = require('./storage/s3-media-storage.js') as { S3MediaStorage: new () => MediaStorage };
              return new mod.S3MediaStorage();
            }

            if (mode === 'local' && nodeEnv === 'production') {
              throw new Error(
                'MEDIA_STORAGE=local is not allowed when NODE_ENV=production. Use s3.',
              );
            }

            const baseDir = config.get<string>('MEDIA_LOCAL_DIR') ??
              resolve(process.cwd(), '.media');
            const logger = new Logger('MediaModule');
            logger.log(`Local media storage: ${baseDir}`);
            return new LocalMediaStorage(baseDir);
          },
        },
        MediaService,
        MediaJobProcessor,
        CmsScopeService,
      ],
      exports: [MEDIA_STORAGE, MediaService, MediaJobProcessor],
    };
  }
}
