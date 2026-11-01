/**
 * ListeningModule: employee surveys, protected reporting, exports and the
 * review offer (ADR 0002, D-EL-01). Configuration and questionnaire versions
 * arrive first (spec CFG-01, CFG-03, SUR-01); cycles, participation,
 * finalization, reports and jobs follow in later tasks of the plan.
 */
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { MailerModule } from '../mailer/mailer.module.js';
import { CyclesService } from './cycles.service.js';
import { FinalizationService } from './finalization.service.js';
import { ListeningConfigurationService } from './listening-configuration.service.js';
import { ListeningJobSchedulerService } from './listening-job-scheduler.service.js';
import { CYCLE_FINALIZER, ListeningJobsService } from './listening-jobs.service.js';
import { ListeningNotifier } from './listening-notifier.js';
import { ListeningOpsController } from './listening-ops.controller.js';
import { ListeningController } from './listening.controller.js';
import { ListeningRepository } from './listening.repository.js';
import { ParticipationService } from './participation.service.js';
import { QuestionnaireService } from './questionnaire.service.js';
import { ReportsService } from './reports.service.js';
import { ReviewOfferService } from './review-offer.service.js';

@Module({
  imports: [AuthModule, MailerModule],
  controllers: [ListeningOpsController, ListeningController],
  providers: [
    ListeningRepository,
    ListeningConfigurationService,
    QuestionnaireService,
    ListeningNotifier,
    CyclesService,
    ParticipationService,
    FinalizationService,
    { provide: CYCLE_FINALIZER, useExisting: FinalizationService },
    ReviewOfferService,
    ReportsService,
    ListeningJobsService,
    ListeningJobSchedulerService,
  ],
  exports: [
    ListeningRepository,
    ListeningConfigurationService,
    QuestionnaireService,
    CyclesService,
    ParticipationService,
    FinalizationService,
    ReportsService,
    ReviewOfferService,
    ListeningJobsService,
    ListeningJobSchedulerService,
  ],
})
export class ListeningModule {}
