/**
 * MembersModule — organization membership administration (T-1.16, 5.3).
 */
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { MembersController } from './members.controller.js';
import { MembersService } from './members.service.js';
import { MembersAdminController } from './members-admin.controller.js';
import { MembersAdminService } from './members-admin.service.js';

@Module({
  imports: [AuthModule],
  controllers: [MembersController, MembersAdminController],
  providers: [MembersService, MembersAdminService],
})
export class MembersModule {}
