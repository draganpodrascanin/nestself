/**
 * GrantsModule — organization grant administration (T-2.1).
 */
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { GrantsController } from './grants.controller.js';
import { GrantsService } from './grants.service.js';

@Module({
  imports: [AuthModule],
  controllers: [GrantsController],
  providers: [GrantsService],
})
export class GrantsModule {}
