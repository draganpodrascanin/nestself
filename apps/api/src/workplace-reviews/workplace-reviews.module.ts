/**
 * WorkplaceReviewsModule: review requests, scopes, engagements, booking,
 * sharing, reports, actions and follow-up (ADR 0002, D-EL-03, D-EL-04,
 * D-EL-11, D-EL-12; spec Epics G and H). Binds the resource resolvers' lookup
 * and the listening module's active-review lookup at start-up.
 */
import { Module, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { AppointmentsModule } from '../appointments/appointments.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { CallsSchedulerModule } from '../jobs/calls-scheduler.module.js';
import { ListeningModule } from '../listening/listening.module.js';
import { bindActiveReviewLookup } from '../listening/review-offer.service.js';
import { MailerModule } from '../mailer/mailer.module.js';
import { ImprovementActionsService } from './improvement-actions.service.js';
import { ReviewEngagementsService } from './review-engagements.service.js';
import { ReviewNotifier } from './review-notifier.js';
import { ReviewReportsService } from './review-reports.service.js';
import { ReviewRequestsService } from './review-requests.service.js';
import { bindReviewLookup } from './review-resolvers.js';
import { ReviewScopesService } from './review-scopes.service.js';
import { ReviewSharingService } from './review-sharing.service.js';
import { WorkplaceReviewsExpertController } from './workplace-reviews-expert.controller.js';
import { WorkplaceReviewsOpsController } from './workplace-reviews-ops.controller.js';
import { WorkplaceReviewsController } from './workplace-reviews.controller.js';
import { WorkplaceReviewsRepository } from './workplace-reviews.repository.js';

@Module({
  imports: [AuthModule, MailerModule, ListeningModule, AppointmentsModule, CallsSchedulerModule],
  controllers: [WorkplaceReviewsController, WorkplaceReviewsOpsController, WorkplaceReviewsExpertController],
  providers: [
    WorkplaceReviewsRepository,
    ReviewNotifier,
    ReviewEngagementsService,
    ReviewRequestsService,
    ReviewScopesService,
    ReviewSharingService,
    ReviewReportsService,
    ImprovementActionsService,
  ],
  exports: [WorkplaceReviewsRepository, ReviewEngagementsService, ReviewRequestsService, ReviewScopesService, ReviewSharingService, ReviewReportsService, ImprovementActionsService],
})
export class WorkplaceReviewsModule implements OnModuleInit, OnModuleDestroy {
  constructor(private readonly repo: WorkplaceReviewsRepository) {}

  onModuleInit(): void {
    bindReviewLookup(this.repo);
    bindActiveReviewLookup(this.repo);
  }

  onModuleDestroy(): void {
    bindReviewLookup(null);
    bindActiveReviewLookup(null);
  }
}
