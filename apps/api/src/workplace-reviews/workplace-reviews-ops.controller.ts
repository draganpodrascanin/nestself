/**
 * WorkplaceReviewsOpsController: the coordinator's queue and actions (spec
 * REV-03, REV-05, OPS-02), in the operations context with
 * `workplace_reviews.coordinate`.
 *
 * GET  /ops/workplace-reviews/requests                   the queue: organization, scope, status, owner, response target
 * GET  /ops/workplace-reviews/requests/:id
 * POST /ops/workplace-reviews/requests/:id/triage        in_review | needs_information | declined           10/60 s
 * POST /ops/workplace-reviews/requests/:id/scopes        sends a versioned scope                            201, 10/60 s
 * GET  /ops/workplace-reviews/reviewers?q=               experts with an APPROVED workplace_review credential the engine allows
 * GET  /ops/workplace-reviews/engagements/:id
 * POST /ops/workplace-reviews/engagements/:id/assign                                                        10/60 s
 * POST /ops/workplace-reviews/engagements/:id/windows                                                       10/60 s
 * POST /ops/workplace-reviews/engagements/:id/cancel                                                        10/60 s
 */
import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ACTIONS,
  ReviewAssignRequestSchema,
  ReviewCancelRequestSchema,
  ReviewScopeCreateRequestSchema,
  ReviewTriageRequestSchema,
  ReviewWindowsRequestSchema,
  type Principal,
  type ReviewAssignRequest,
  type ReviewCancelRequest,
  type ReviewEngagementResponse,
  type ReviewQueueResponse,
  type ReviewRequestOpsResponse,
  type ReviewScopeCreateRequest,
  type ReviewTriageRequest,
  type ReviewWindowsRequest,
  type ReviewerCandidatesResponse,
} from '@nestself/contracts';
import { CurrentPrincipal } from '../auth/current-principal.decorator.js';
import { Authorize } from '../authz/authorize.decorator.js';
import { operationsResource } from '../authz/resolvers.js';
import { WRITE_THROTTLE } from '../authz/throttles.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ReviewEngagementsService } from './review-engagements.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ReviewRequestsService } from './review-requests.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ReviewScopesService } from './review-scopes.service.js';

const requestId = (req: Record<string, unknown>) => (req['params'] as Record<string, string | undefined> | undefined)?.['id'];

@Controller('ops/workplace-reviews')
export class WorkplaceReviewsOpsController {
  constructor(
    private readonly requests: ReviewRequestsService,
    private readonly scopes: ReviewScopesService,
    private readonly engagements: ReviewEngagementsService,
  ) {}

  @Get('requests')
  @Authorize(ACTIONS['workplace_reviews.coordinate'], operationsResource('review_request'))
  queue(): Promise<ReviewQueueResponse> {
    return this.requests.queue();
  }

  @Get('requests/:id')
  @Authorize(ACTIONS['workplace_reviews.coordinate'], operationsResource('review_request', requestId))
  get(@Param('id') id: string): Promise<ReviewRequestOpsResponse> {
    return this.requests.getOps(id);
  }

  @Post('requests/:id/triage')
  @HttpCode(200)
  @Throttle(WRITE_THROTTLE)
  @Authorize(ACTIONS['workplace_reviews.coordinate'], operationsResource('review_request', requestId))
  triage(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ReviewTriageRequestSchema)) body: ReviewTriageRequest,
  ): Promise<ReviewRequestOpsResponse> {
    return this.requests.triage(id, body, principal);
  }

  @Post('requests/:id/scopes')
  @HttpCode(201)
  @Throttle(WRITE_THROTTLE)
  @Authorize(ACTIONS['workplace_reviews.coordinate'], operationsResource('review_request', requestId))
  sendScope(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ReviewScopeCreateRequestSchema)) body: ReviewScopeCreateRequest,
  ): Promise<ReviewRequestOpsResponse> {
    return this.scopes.send(id, body, principal);
  }

  @Get('reviewers')
  @Authorize(ACTIONS['workplace_reviews.coordinate'], operationsResource('review_engagement'))
  reviewers(@Query('q') q?: string): Promise<ReviewerCandidatesResponse> {
    return this.engagements.reviewerCandidates(q?.trim() || undefined);
  }

  @Get('engagements/:id')
  @Authorize(ACTIONS['workplace_reviews.coordinate'], operationsResource('review_engagement', requestId))
  engagement(@Param('id') id: string): Promise<ReviewEngagementResponse> {
    return this.engagements.getOps(id);
  }

  @Post('engagements/:id/assign')
  @HttpCode(200)
  @Throttle(WRITE_THROTTLE)
  @Authorize(ACTIONS['workplace_reviews.coordinate'], operationsResource('review_engagement', requestId))
  assign(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ReviewAssignRequestSchema)) body: ReviewAssignRequest,
  ): Promise<ReviewEngagementResponse> {
    return this.engagements.assign(id, body, principal);
  }

  @Post('engagements/:id/windows')
  @HttpCode(200)
  @Throttle(WRITE_THROTTLE)
  @Authorize(ACTIONS['workplace_reviews.coordinate'], operationsResource('review_engagement', requestId))
  windows(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ReviewWindowsRequestSchema)) body: ReviewWindowsRequest,
  ): Promise<ReviewEngagementResponse> {
    return this.engagements.proposeWindows(id, body, principal);
  }

  @Post('engagements/:id/cancel')
  @HttpCode(200)
  @Throttle(WRITE_THROTTLE)
  @Authorize(ACTIONS['workplace_reviews.coordinate'], operationsResource('review_engagement', requestId))
  cancel(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ReviewCancelRequestSchema)) body: ReviewCancelRequest,
  ): Promise<ReviewEngagementResponse> {
    return this.engagements.cancel(id, body, principal);
  }
}
