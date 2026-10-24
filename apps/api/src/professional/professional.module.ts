/**
 * ProfessionalModule: the confidential professional-interaction domain
 * (T-2.4, section 4.7). Its own module and route prefix; no other module
 * imports ProfessionalService (CONF-R-03).
 */
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ProfessionalController } from './professional.controller.js';
import { ProfessionalService } from './professional.service.js';

@Module({
  imports: [AuthModule],
  controllers: [ProfessionalController],
  providers: [ProfessionalService],
})
export class ProfessionalModule {}
