/**
 * OrgUnitsModule — organization tree administration (5.3 org-unit endpoints).
 */
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { OrgUnitsController } from './org-units.controller.js';
import { OrgUnitsService } from './org-units.service.js';

@Module({
  imports: [AuthModule],
  controllers: [OrgUnitsController],
  providers: [OrgUnitsService],
})
export class OrgUnitsModule {}
