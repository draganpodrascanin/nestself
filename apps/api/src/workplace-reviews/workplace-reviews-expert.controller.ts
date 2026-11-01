/**
 * WorkplaceReviewsExpertController: the assigned reviewer's side (spec
 * REV-04, REV-07..09), in the expert context. Every route is
 * `@Authenticated()`; the service authorizes the engagement through the
 * reviewer's CASE assignment and answers every denial as 404.
 *
 * GET  /expert/workplace-reviews/engagements
 * GET  /expert/workplace-reviews/engagements/:id
 * GET  /expert/workplace-reviews/engagements/:id/pack            needs an active sharing grant (409 sharing_revoked otherwise)
 * GET  /expert/workplace-reviews/engagements/:id/report          the current version
 * PUT  /expert/workplace-reviews/engagements/:id/report          saves the draft (workplace_reviews.report.write)   10/60 s
 * POST /expert/workplace-reviews/engagements/:id/report/submit-review                                               10/60 s
 * POST /expert/workplace-reviews/engagements/:id/report/share    workplace_reviews.report.publish                   10/60 s
 * GET  /expert/workplace-reviews/engagements/:id/notes
 * POST /expert/workplace-reviews/engagements/:id/notes                                                              201, 10/60 s
 * GET  /expert/workplace-reviews/engagements/:id/actions
 * POST /expert/workplace-reviews/engagements/:id/actions         proposes an action                                201, 10/60 s
 * POST /expert/workplace-reviews/engagements/:id/follow-up                                                          10/60 s
 * POST /expert/workplace-reviews/engagements/:id/complete                                                           10/60 s
 */
import { Body, Controller, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ImprovementActionCreateRequestSchema,
  ReviewFollowUpRequestSchema,
  ReviewNoteRequestSchema,
  ReviewReportDraftRequestSchema,
  type ImprovementActionCreateRequest,
  type ImprovementActionsResponse,
  type Principal,
  type ReviewEngagementListResponse,
  type ReviewEngagementResponse,
  type ReviewFollowUpRequest,
  type ReviewNoteRequest,
  type ReviewNotesResponse,
  type ReviewPackResponse,
  type ReviewReportDraftRequest,
  type ReviewReportView,
} from '@nestself/contracts';
import { CurrentPrincipal } from '../auth/current-principal.decorator.js';
import { Authenticated } from '../authz/authenticated.decorator.js';
import { WRITE_THROTTLE } from '../authz/throttles.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ImprovementActionsService } from './improvement-actions.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ReviewEngagementsService } from './review-engagements.service.js';
import { assertExpertContext } from './review-errors.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ReviewReportsService } from './review-reports.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ReviewSharingService } from './review-sharing.service.js';

@Controller('expert/workplace-reviews/engagements')
export class WorkplaceReviewsExpertController {
  constructor(
    private readonly engagements: ReviewEngagementsService,
    private readonly sharing: ReviewSharingService,
    private readonly reports: ReviewReportsService,
    private readonly actions: ImprovementActionsService,
  ) {}

  @Get()
  @Authenticated()
  list(@CurrentPrincipal() principal: Principal): Promise<ReviewEngagementListResponse> {
    assertExpertContext(principal);
    return this.engagements.listForReviewer(principal);
  }

  @Get(':id')
  @Authenticated()
  get(@CurrentPrincipal() principal: Principal, @Param('id') id: string): Promise<ReviewEngagementResponse> {
    assertExpertContext(principal);
    return this.engagements.getForReviewer(principal, id);
  }

  @Get(':id/pack')
  @Authenticated()
  pack(@CurrentPrincipal() principal: Principal, @Param('id') id: string): Promise<ReviewPackResponse> {
    assertExpertContext(principal);
    return this.sharing.pack(principal, id);
  }

  @Get(':id/report')
  @Authenticated()
  report(@CurrentPrincipal() principal: Principal, @Param('id') id: string): Promise<ReviewReportView> {
    assertExpertContext(principal);
    return this.reports.current(principal, id);
  }

  @Put(':id/report')
  @Throttle(WRITE_THROTTLE)
  @Authenticated()
  saveReport(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ReviewReportDraftRequestSchema)) body: ReviewReportDraftRequest,
  ): Promise<ReviewReportView> {
    assertExpertContext(principal);
    return this.reports.saveDraft(principal, id, body);
  }

  @Post(':id/report/submit-review')
  @HttpCode(200)
  @Throttle(WRITE_THROTTLE)
  @Authenticated()
  submitReview(@CurrentPrincipal() principal: Principal, @Param('id') id: string): Promise<ReviewReportView> {
    assertExpertContext(principal);
    return this.reports.submitReview(principal, id);
  }

  @Post(':id/report/share')
  @HttpCode(200)
  @Throttle(WRITE_THROTTLE)
  @Authenticated()
  share(@CurrentPrincipal() principal: Principal, @Param('id') id: string): Promise<ReviewReportView> {
    assertExpertContext(principal);
    return this.reports.share(principal, id);
  }

  @Get(':id/notes')
  @Authenticated()
  notes(@CurrentPrincipal() principal: Principal, @Param('id') id: string): Promise<ReviewNotesResponse> {
    assertExpertContext(principal);
    return this.reports.notes(principal, id);
  }

  @Post(':id/notes')
  @HttpCode(201)
  @Throttle(WRITE_THROTTLE)
  @Authenticated()
  addNote(@CurrentPrincipal() principal: Principal, @Param('id') id: string, @Body(new ZodValidationPipe(ReviewNoteRequestSchema)) body: ReviewNoteRequest): Promise<ReviewNotesResponse> {
    assertExpertContext(principal);
    return this.reports.addNote(principal, id, body);
  }

  @Get(':id/actions')
  @Authenticated()
  listActions(@CurrentPrincipal() principal: Principal, @Param('id') id: string): Promise<ImprovementActionsResponse> {
    assertExpertContext(principal);
    return this.actions.listForReviewer(principal, id);
  }

  @Post(':id/actions')
  @HttpCode(201)
  @Throttle(WRITE_THROTTLE)
  @Authenticated()
  propose(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ImprovementActionCreateRequestSchema)) body: ImprovementActionCreateRequest,
  ): Promise<ImprovementActionsResponse> {
    assertExpertContext(principal);
    return this.actions.proposeByReviewer(principal, id, body);
  }

  @Post(':id/follow-up')
  @HttpCode(200)
  @Throttle(WRITE_THROTTLE)
  @Authenticated()
  followUp(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ReviewFollowUpRequestSchema)) body: ReviewFollowUpRequest,
  ): Promise<ReviewEngagementResponse> {
    assertExpertContext(principal);
    return this.engagements.planFollowUp(principal, id, body);
  }

  @Post(':id/complete')
  @HttpCode(200)
  @Throttle(WRITE_THROTTLE)
  @Authenticated()
  complete(@CurrentPrincipal() principal: Principal, @Param('id') id: string): Promise<ReviewEngagementResponse> {
    assertExpertContext(principal);
    return this.engagements.complete(principal, id);
  }
}
