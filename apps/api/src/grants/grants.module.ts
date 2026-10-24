/**
 * GrantsModule — grant administration (T-2.1): organization grants,
 * approval authorities and the operations grant endpoints.
 */
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ApprovalAuthoritiesController } from './approval-authorities.controller.js';
import { ApprovalAuthoritiesService } from './approval-authorities.service.js';
import { GrantsController } from './grants.controller.js';
import { GrantsService } from './grants.service.js';
import { OpsGrantsController } from './ops-grants.controller.js';

@Module({
  imports: [AuthModule],
  controllers: [GrantsController, ApprovalAuthoritiesController, OpsGrantsController],
  providers: [GrantsService, ApprovalAuthoritiesService],
})
export class GrantsModule {}
