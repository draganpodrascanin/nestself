/**
 * EmergencyModule: emergency access to restricted professional records
 * (T-2.5, section 4.7). Reads the professional rows through
 * `ProfessionalRepository` and the shared `professional-records` helpers,
 * never through `ProfessionalService` (CONF-R-03). The expiry sweeper lives
 * with the other scheduled jobs (`MaintenanceJobsService`).
 */
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { EmergencyController } from './emergency.controller.js';
import { EmergencyService } from './emergency.service.js';

@Module({
  imports: [AuthModule],
  controllers: [EmergencyController],
  providers: [EmergencyService],
})
export class EmergencyModule {}
