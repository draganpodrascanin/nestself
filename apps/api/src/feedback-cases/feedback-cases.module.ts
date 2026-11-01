/**
 * FeedbackCasesModule: the employer-anonymous feedback channel (ADR 0002,
 * D-EL-01 and D-EL-06; spec Epic F). Binds the case lookup of the handler
 * routes' resource resolver at start-up, like `AppointmentsModule`.
 */
import { Module, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ListeningModule } from '../listening/listening.module.js';
import { MailerModule } from '../mailer/mailer.module.js';
import { bindFeedbackCaseLookup } from './feedback-case.resolver.js';
import { FeedbackCasesController } from './feedback-cases.controller.js';
import { FeedbackCasesRepository } from './feedback-cases.repository.js';
import { FeedbackCasesService } from './feedback-cases.service.js';
import { FeedbackEscalationService } from './feedback-escalation.service.js';
import { FeedbackNotifier } from './feedback-notifier.js';
import { FeedbackRoutesService } from './feedback-routes.service.js';

@Module({
  imports: [AuthModule, MailerModule, ListeningModule],
  controllers: [FeedbackCasesController],
  providers: [FeedbackCasesRepository, FeedbackNotifier, FeedbackRoutesService, FeedbackCasesService, FeedbackEscalationService],
  exports: [FeedbackCasesRepository, FeedbackRoutesService, FeedbackCasesService, FeedbackEscalationService],
})
export class FeedbackCasesModule implements OnModuleInit, OnModuleDestroy {
  constructor(private readonly repo: FeedbackCasesRepository) {}

  onModuleInit(): void {
    bindFeedbackCaseLookup(this.repo);
  }

  onModuleDestroy(): void {
    bindFeedbackCaseLookup(null);
  }
}
