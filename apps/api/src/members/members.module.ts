/**
 * MembersModule — organization membership administration (T-1.16, 5.3).
 */
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { MembersController } from './members.controller.js';
import { MembersService } from './members.service.js';
import { MembersAdminController } from './members-admin.controller.js';
import { MembersAdminService } from './members-admin.service.js';
import { OpsMembersController } from './ops-members.controller.js';

@Module({
  imports: [AuthModule],
  controllers: [MembersController, MembersAdminController, OpsMembersController],
  providers: [MembersService, MembersAdminService],
})
export class MembersModule {}
