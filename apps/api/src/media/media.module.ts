/**
 * MediaModule — media upload, processing, and delivery (T-C1.08).
 *
 * Provides the MEDIA_STORAGE token (local or s3), the MediaService for
 * database operations, MediaJobProcessor for background processing,
 * and the two controllers (ops and library).
 *
 * The MULTER_MODULE_OPTIONS provider wires the custom streaming
 * UploadStorageEngine into multer so that FileInterceptor in the
 * ops controller uses it automatically (C2).
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
import { CmsResourceLoader } from '../cms/cms-resource-loader.js';
import { AuthModule } from '../auth/auth.module.js';
import { AvailabilityModule } from '../library/availability/availability.module.js';
import { createUploadStorageEngine } from './upload-storage-engine.js';
import { DbService } from '../db/db.service.js';
import { AuditWriter } from '../audit/audit-writer.js';

/**
 * Token used by `FileInterceptor` to pick up module-level multer options.
 * Value matches the constant in `@nestjs/platform-express/multer`.
 */
const MULTER_MODULE_OPTIONS = 'MULTER_MODULE_OPTIONS';

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
          useFactory: async (config: ConfigService): Promise<MediaStorage> => {
            const mode = config.get<string>('MEDIA_STORAGE') ?? 'local';
            const nodeEnv = config.get<string>('NODE_ENV') ?? 'development';

            if (mode === 's3') {
              // S3 driver: deferred to T-C2.09
              const bucket = config.get<string>('MEDIA_BUCKET');
              if (!bucket) {
                throw new Error(
                  'MEDIA_BUCKET is required when MEDIA_STORAGE=s3',
                );
              }
              // Dynamic import instead of require() (ESM-compatible)
              const { S3MediaStorage } = await import('./storage/s3-media-storage.js');
              return new S3MediaStorage();
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
        // Wire our custom streaming StorageEngine into multer (C2).
        // FileInterceptor injects MULTER_MODULE_OPTIONS (@Optional) and
        // merges it with local options.  Local limits win; module storage
        // is used because FileInterceptor passes no storage of its own.
        {
          provide: MULTER_MODULE_OPTIONS,
          inject: [MEDIA_STORAGE, DbService, AuditWriter, CmsScopeService, ConfigService],
          useFactory: (
            storage: MediaStorage,
            dbService: DbService,
            auditWriter: AuditWriter,
            cmsScopeService: CmsScopeService,
            configService: ConfigService,
          ) => ({
            storage: createUploadStorageEngine({
              storage,
              dbService,
              auditWriter,
              cmsScopeService,
              maxUploadBytes:
                configService.get<number>('MEDIA_MAX_UPLOAD_BYTES') ?? undefined,
            }),
          }),
        },
        MediaService,
        MediaJobProcessor,
        CmsScopeService,
        CmsResourceLoader,
      ],
      exports: [MEDIA_STORAGE, MediaService, MediaJobProcessor],
    };
  }
}
