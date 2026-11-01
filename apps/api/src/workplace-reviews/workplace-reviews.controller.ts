/**
 * WorkplaceReviewsController: the employer side (spec REV-01..06, REV-08..10;
 * ADR 0002). Every route is scoped to `:orgId` through the organization
 * context.
 *
 * GET  /orgs/:orgId/workplace-reviews/services                              workplace_reviews.request
 * POST /orgs/:orgId/workplace-reviews/requests                              workplace_reviews.request        201, Idempotency-Key, 10/60 s
 * GET  /orgs/:orgId/workplace-reviews/requests                              workplace_reviews.request
 * GET  /orgs/:orgId/workplace-reviews/requests/:id                          workplace_reviews.request
 * POST /orgs/:orgId/workplace-reviews/requests/:id/cancel                   workplace_reviews.request        10/60 s
 * POST /orgs/:orgId/workplace-reviews/requests/:id/information              workplace_reviews.request        10/60 s
 * POST /orgs/:orgId/workplace-reviews/scopes/:scopeId/accept                workplace_reviews.scope.accept   reviewScopeResource (amount, currency), financial step-up
 * POST /orgs/:orgId/workplace-reviews/scopes/:scopeId/reject                workplace_reviews.scope.accept   reviewScopeResource
 * GET  /orgs/:orgId/workplace-reviews/engagements                           workplace_reviews.engagement.read
 * GET  /orgs/:orgId/workplace-reviews/engagements/:id                       workplace_reviews.engagement.read
 * POST /orgs/:orgId/workplace-reviews/engagements/:id/book                  workplace_reviews.request        10/60 s
 * POST /orgs/:orgId/workplace-reviews/engagements/:id/cancel                workplace_reviews.request        10/60 s
 * POST /orgs/:orgId/workplace-reviews/engagements/:id/sharing               workplace_reviews.request        201, 10/60 s
 * POST /orgs/:orgId/workplace-reviews/engagements/:id/sharing/:grantId/revoke workplace_reviews.request      10/60 s
 * GET  /orgs/:orgId/workplace-reviews/engagements/:id/report                workplace_reviews.engagement.read (the latest shared version)
 * GET  /orgs/:orgId/workplace-reviews/engagements/:id/actions               workplace_reviews.engagement.read
 * POST /orgs/:orgId/workplace-reviews/engagements/:id/actions               workplace_reviews.actions.manage 201
 * PATCH /orgs/:orgId/workplace-reviews/engagements/:id/actions/:actionId    workplace_reviews.actions.manage
 */
import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ACTIONS,
  ImprovementActionCreateRequestSchema,
  ImprovementActionUpdateRequestSchema,
  ReviewBookRequestSchema,
  ReviewCancelRequestSchema,
  ReviewInformationRequestSchema,
  ReviewRequestCreateRequestSchema,
  ReviewSharingGrantRequestSchema,
  type ImprovementActionCreateRequest,
  type ImprovementActionUpdateRequest,
  type ImprovementActionsResponse,
  type Principal,
  type ReviewBookRequest,
  type ReviewCancelRequest,
  type ReviewEngagementListResponse,
  type ReviewEngagementResponse,
  type ReviewInformationRequest,
  type ReviewReportView,
  type ReviewRequestCreateRequest,
  type ReviewRequestListResponse,
  type ReviewRequestResponse,
  type ReviewServicesResponse,
  type ReviewSharingGrantRequest,
} from '@nestself/contracts';
import { CurrentPrincipal } from '../auth/current-principal.decorator.js';
import { Authorize } from '../authz/authorize.decorator.js';
import { orgResourceFromContext } from '../authz/resolvers.js';
import { WRITE_THROTTLE } from '../authz/throttles.js';
import { Idempotent } from '../common/idempotency/index.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ImprovementActionsService } from './improvement-actions.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ReviewEngagementsService } from './review-engagements.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ReviewReportsService } from './review-reports.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ReviewRequestsService } from './review-requests.service.js';
import { reviewScopeResource } from './review-resolvers.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ReviewScopesService } from './review-scopes.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ReviewSharingService } from './review-sharing.service.js';

@Controller('orgs/:orgId/workplace-reviews')
export class WorkplaceReviewsController {
  constructor(
    private readonly requests: ReviewRequestsService,
    private readonly scopes: ReviewScopesService,
    private readonly engagements: ReviewEngagementsService,
    private readonly sharing: ReviewSharingService,
    private readonly reports: ReviewReportsService,
    private readonly actions: ImprovementActionsService,
  ) {}

  @Get('services')
  @Authorize(ACTIONS['workplace_reviews.request'], orgResourceFromContext('workplace_review'))
  services(@Param('orgId') orgId: string): Promise<ReviewServicesResponse> {
    return this.requests.services(orgId);
  }

  @Post('requests')
  @HttpCode(201)
  @Throttle(WRITE_THROTTLE)
  @Idempotent('review_request')
  @Authorize(ACTIONS['workplace_reviews.request'], orgResourceFromContext('workplace_review'))
  create(
    @CurrentPrincipal() principal: Principal,
    @Param('orgId') orgId: string,
    @Body(new ZodValidationPipe(ReviewRequestCreateRequestSchema)) body: ReviewRequestCreateRequest,
  ): Promise<ReviewRequestResponse> {
    return this.requests.create(orgId, body, principal);
  }

  @Get('requests')
  @Authorize(ACTIONS['workplace_reviews.request'], orgResourceFromContext('workplace_review'))
  list(@Param('orgId') orgId: string): Promise<ReviewRequestListResponse> {
    return this.requests.list(orgId);
  }

  @Get('requests/:id')
  @Authorize(ACTIONS['workplace_reviews.request'], orgResourceFromContext('workplace_review'))
  get(@Param('orgId') orgId: string, @Param('id') id: string): Promise<ReviewRequestResponse> {
    return this.requests.get(orgId, id);
  }

  @Post('requests/:id/cancel')
  @HttpCode(200)
  @Throttle(WRITE_THROTTLE)
  @Authorize(ACTIONS['workplace_reviews.request'], orgResourceFromContext('workplace_review'))
  cancelRequest(
    @CurrentPrincipal() principal: Principal,
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ReviewCancelRequestSchema)) body: ReviewCancelRequest,
  ): Promise<ReviewRequestResponse> {
    return this.requests.cancel(orgId, id, body, principal);
  }

  @Post('requests/:id/information')
  @HttpCode(200)
  @Throttle(WRITE_THROTTLE)
  @Authorize(ACTIONS['workplace_reviews.request'], orgResourceFromContext('workplace_review'))
  answerInformation(
    @CurrentPrincipal() principal: Principal,
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ReviewInformationRequestSchema)) body: ReviewInformationRequest,
  ): Promise<ReviewRequestResponse> {
    return this.requests.answerInformation(orgId, id, body, principal);
  }

  @Post('scopes/:scopeId/accept')
  @HttpCode(200)
  @Throttle(WRITE_THROTTLE)
  @Authorize(ACTIONS['workplace_reviews.scope.accept'], reviewScopeResource)
  acceptScope(@CurrentPrincipal() principal: Principal, @Param('orgId') orgId: string, @Param('scopeId') scopeId: string): Promise<ReviewEngagementResponse> {
    return this.scopes.accept(orgId, scopeId, principal);
  }

  @Post('scopes/:scopeId/reject')
  @HttpCode(200)
  @Throttle(WRITE_THROTTLE)
  @Authorize(ACTIONS['workplace_reviews.scope.accept'], reviewScopeResource)
  async rejectScope(@CurrentPrincipal() principal: Principal, @Param('orgId') orgId: string, @Param('scopeId') scopeId: string): Promise<{ rejected: true }> {
    await this.scopes.reject(orgId, scopeId, principal);
    return { rejected: true };
  }

  @Get('engagements')
  @Authorize(ACTIONS['workplace_reviews.engagement.read'], orgResourceFromContext('review_engagement'))
  listEngagements(@Param('orgId') orgId: string): Promise<ReviewEngagementListResponse> {
    return this.engagements.list(orgId);
  }

  @Get('engagements/:id')
  @Authorize(ACTIONS['workplace_reviews.engagement.read'], orgResourceFromContext('review_engagement'))
  getEngagement(@Param('orgId') orgId: string, @Param('id') id: string): Promise<ReviewEngagementResponse> {
    return this.engagements.get(orgId, id);
  }

  @Post('engagements/:id/book')
  @HttpCode(200)
  @Throttle(WRITE_THROTTLE)
  @Authorize(ACTIONS['workplace_reviews.request'], orgResourceFromContext('review_engagement'))
  book(
    @CurrentPrincipal() principal: Principal,
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ReviewBookRequestSchema)) body: ReviewBookRequest,
  ): Promise<ReviewEngagementResponse> {
    return this.engagements.book(orgId, id, body, principal);
  }

  @Post('engagements/:id/cancel')
  @HttpCode(200)
  @Throttle(WRITE_THROTTLE)
  @Authorize(ACTIONS['workplace_reviews.request'], orgResourceFromContext('review_engagement'))
  cancelEngagement(
    @CurrentPrincipal() principal: Principal,
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ReviewCancelRequestSchema)) body: ReviewCancelRequest,
  ): Promise<ReviewEngagementResponse> {
    return this.engagements.cancel(id, body, principal, new Date(), orgId);
  }

  @Post('engagements/:id/sharing')
  @HttpCode(201)
  @Throttle(WRITE_THROTTLE)
  @Authorize(ACTIONS['workplace_reviews.request'], orgResourceFromContext('review_engagement'))
  share(
    @CurrentPrincipal() principal: Principal,
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ReviewSharingGrantRequestSchema)) body: ReviewSharingGrantRequest,
  ): Promise<ReviewEngagementResponse> {
    return this.sharing.grant(orgId, id, body, principal);
  }

  @Post('engagements/:id/sharing/:grantId/revoke')
  @HttpCode(200)
  @Throttle(WRITE_THROTTLE)
  @Authorize(ACTIONS['workplace_reviews.request'], orgResourceFromContext('review_engagement'))
  revoke(@CurrentPrincipal() principal: Principal, @Param('orgId') orgId: string, @Param('id') id: string, @Param('grantId') grantId: string): Promise<ReviewEngagementResponse> {
    return this.sharing.revoke(orgId, id, grantId, principal);
  }

  @Get('engagements/:id/report')
  @Authorize(ACTIONS['workplace_reviews.engagement.read'], orgResourceFromContext('review_engagement'))
  report(@CurrentPrincipal() principal: Principal, @Param('orgId') orgId: string, @Param('id') id: string): Promise<ReviewReportView> {
    return this.reports.sharedReport(orgId, id, principal);
  }

  @Get('engagements/:id/actions')
  @Authorize(ACTIONS['workplace_reviews.engagement.read'], orgResourceFromContext('review_engagement'))
  listActions(@Param('orgId') orgId: string, @Param('id') id: string): Promise<ImprovementActionsResponse> {
    return this.actions.list(orgId, id);
  }

  @Post('engagements/:id/actions')
  @HttpCode(201)
  @Throttle(WRITE_THROTTLE)
  @Authorize(ACTIONS['workplace_reviews.actions.manage'], orgResourceFromContext('review_engagement'))
  createAction(
    @CurrentPrincipal() principal: Principal,
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ImprovementActionCreateRequestSchema)) body: ImprovementActionCreateRequest,
  ): Promise<ImprovementActionsResponse> {
    return this.actions.createByEmployer(orgId, id, body, principal);
  }

  @Patch('engagements/:id/actions/:actionId')
  @Throttle(WRITE_THROTTLE)
  @Authorize(ACTIONS['workplace_reviews.actions.manage'], orgResourceFromContext('review_engagement'))
  updateAction(
    @CurrentPrincipal() principal: Principal,
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Param('actionId') actionId: string,
    @Body(new ZodValidationPipe(ImprovementActionUpdateRequestSchema)) body: ImprovementActionUpdateRequest,
  ): Promise<ImprovementActionsResponse> {
    return this.actions.update(orgId, id, actionId, body, principal);
  }
}
