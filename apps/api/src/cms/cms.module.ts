/**
 * CmsModule -- content workflow (T-C1.10).
 *
 * Provides the CmsController, CmsService, CmsResourceLoader
 * and the OutboxWriter for M1 slice endpoints.
 */
import { Module } from '@nestjs/common';
import { CmsController } from './cms.controller.js';
import { CmsService } from './cms.service.js';
import { CmsResourceLoader } from './cms-resource-loader.js';
import { CmsScopeService } from '../authz/cms-scope.service.js';
import { OutboxWriter } from '../notifications/outbox/outbox-writer.js';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { AvailabilityModule } from '../library/availability/availability.module.js';

@Module({
  imports: [AuditModule, AuthModule, AvailabilityModule],
  controllers: [CmsController],
  providers: [
    CmsService,
    CmsResourceLoader,
    CmsScopeService,
    OutboxWriter,
  ],
  exports: [CmsService, CmsResourceLoader, OutboxWriter],
})
export class CmsModule {}
