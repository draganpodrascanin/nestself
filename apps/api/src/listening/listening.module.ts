/**
 * ListeningModule: employee surveys, protected reporting, exports and the
 * review offer (ADR 0002, D-EL-01). Configuration and questionnaire versions
 * arrive first (spec CFG-01, CFG-03, SUR-01); cycles, participation,
 * finalization, reports and jobs follow in later tasks of the plan.
 */
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ListeningConfigurationService } from './listening-configuration.service.js';
import { ListeningOpsController } from './listening-ops.controller.js';
import { ListeningRepository } from './listening.repository.js';
import { QuestionnaireService } from './questionnaire.service.js';

@Module({
  imports: [AuthModule],
  controllers: [ListeningOpsController],
  providers: [ListeningRepository, ListeningConfigurationService, QuestionnaireService],
  exports: [ListeningRepository, ListeningConfigurationService, QuestionnaireService],
})
export class ListeningModule {}
