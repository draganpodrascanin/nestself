/**
 * FeedbackCasesController (spec FBK-01..06; ADR 0002).
 *
 * Employee (personal context):
 * GET  /me/feedback/routes                 feedback_case.create.self  personalOrgResource('feedback_case')
 * POST /me/feedback/cases                  feedback_case.create.self  personalOrgResource('feedback_case')  201, Idempotency-Key, 10/60 s
 * GET  /me/feedback/cases                  feedback_case.read.self    personalOrgResource('feedback_case')
 * GET  /me/feedback/cases/:id              authenticated; the service checks feedback_case.read.self on the loaded case (404 on denial)
 * POST /me/feedback/cases/:id/messages     authenticated; the service checks feedback_case.reply.self (404 on denial)  Idempotency-Key, 10/60 s
 *
 * Handler (organization context):
 * GET  /feedback/inbox                     authenticated; the caller's CASE assignments, each re-checked for feedback_case.handle
 * GET  /feedback/cases/:id                 feedback_case.handle       feedbackCaseResource (404 on denial)
 * POST /feedback/cases/:id/messages        feedback_case.handle       feedbackCaseResource  Idempotency-Key, 10/60 s
 * POST /feedback/cases/:id/state           feedback_case.handle       feedbackCaseResource  10/60 s
 * POST /feedback/cases/:id/reassign        feedback_case.assign       feedbackCaseResource  10/60 s
 *
 * Organization settings:
 * GET  /orgs/:orgId/feedback/routes        org.settings               orgResourceFromContext('feedback_route')
 * PUT  /orgs/:orgId/feedback/routes        org.settings               orgResourceFromContext('feedback_route')  10/60 s
 *
 * `feedback_case.handle` and `feedback_case.assign` are restricted step-up
 * actions: the guard answers 403 `step_up_required` when the sign-in or the
 * last step-up is too old.
 */
import { Body, Controller, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ACTIONS,
  FeedbackCaseCreateRequestSchema,
  FeedbackMessageRequestSchema,
  FeedbackReassignRequestSchema,
  FeedbackReporterMessageRequestSchema,
  FeedbackRoutesUpdateRequestSchema,
  FeedbackStateRequestSchema,
  type FeedbackCaseCreateRequest,
  type FeedbackCaseCreateResponse,
  type FeedbackMessageRequest,
  type FeedbackReassignRequest,
  type FeedbackReporterMessageRequest,
  type FeedbackRoutesAdminResponse,
  type FeedbackRoutesResponse,
  type FeedbackRoutesUpdateRequest,
  type FeedbackStateRequest,
  type HandlerFeedbackCaseResponse,
  type HandlerFeedbackInboxResponse,
  type MyFeedbackCaseResponse,
  type MyFeedbackCasesResponse,
  type Principal,
} from '@nestself/contracts';
import { CurrentPrincipal } from '../auth/current-principal.decorator.js';
import { Authenticated } from '../authz/authenticated.decorator.js';
import { Authorize } from '../authz/authorize.decorator.js';
import { orgResourceFromContext, personalOrgResource } from '../authz/resolvers.js';
import { WRITE_THROTTLE } from '../authz/throttles.js';
import { Idempotent } from '../common/idempotency/index.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { feedbackCaseResource } from './feedback-case.resolver.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { FeedbackCasesService } from './feedback-cases.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { FeedbackRoutesService } from './feedback-routes.service.js';

const DENY_AS_NOT_FOUND = { denyAs: 'not_found' } as const;

@Controller()
export class FeedbackCasesController {
  constructor(
    private readonly cases: FeedbackCasesService,
    private readonly routes: FeedbackRoutesService,
  ) {}

  // ── Employee ─────────────────────────────────────────────────────────────

  @Get('me/feedback/routes')
  @Authorize(ACTIONS['feedback_case.create.self'], personalOrgResource('feedback_case'))
  routesForEmployee(@CurrentPrincipal() principal: Principal): Promise<FeedbackRoutesResponse> {
    return this.cases.routesForEmployee(principal);
  }

  @Post('me/feedback/cases')
  @HttpCode(201)
  @Throttle(WRITE_THROTTLE)
  @Idempotent('feedback_case')
  @Authorize(ACTIONS['feedback_case.create.self'], personalOrgResource('feedback_case'))
  create(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(FeedbackCaseCreateRequestSchema)) body: FeedbackCaseCreateRequest,
  ): Promise<FeedbackCaseCreateResponse> {
    return this.cases.create(principal, body);
  }

  @Get('me/feedback/cases')
  @Authorize(ACTIONS['feedback_case.read.self'], personalOrgResource('feedback_case'))
  listMine(@CurrentPrincipal() principal: Principal): Promise<MyFeedbackCasesResponse> {
    return this.cases.listMine(principal);
  }

  @Get('me/feedback/cases/:id')
  @Authenticated()
  readMine(@CurrentPrincipal() principal: Principal, @Param('id') id: string): Promise<MyFeedbackCaseResponse> {
    return this.cases.readMine(principal, id);
  }

  @Post('me/feedback/cases/:id/messages')
  @HttpCode(200)
  @Throttle(WRITE_THROTTLE)
  @Idempotent('feedback_reporter_message')
  @Authenticated()
  replyMine(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(FeedbackReporterMessageRequestSchema)) body: FeedbackReporterMessageRequest,
  ): Promise<MyFeedbackCaseResponse> {
    return this.cases.replyMine(principal, id, body);
  }

  // ── Handler ──────────────────────────────────────────────────────────────

  @Get('feedback/inbox')
  @Authenticated()
  inbox(@CurrentPrincipal() principal: Principal): Promise<HandlerFeedbackInboxResponse> {
    return this.cases.inbox(principal);
  }

  @Get('feedback/cases/:id')
  @Authorize(ACTIONS['feedback_case.handle'], feedbackCaseResource, DENY_AS_NOT_FOUND)
  readAssigned(@CurrentPrincipal() principal: Principal, @Param('id') id: string): Promise<HandlerFeedbackCaseResponse> {
    return this.cases.readAssigned(principal, id);
  }

  @Post('feedback/cases/:id/messages')
  @HttpCode(200)
  @Throttle(WRITE_THROTTLE)
  @Idempotent('feedback_handler_message')
  @Authorize(ACTIONS['feedback_case.handle'], feedbackCaseResource, DENY_AS_NOT_FOUND)
  postMessage(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(FeedbackMessageRequestSchema)) body: FeedbackMessageRequest,
  ): Promise<HandlerFeedbackCaseResponse> {
    return this.cases.postHandlerMessage(principal, id, body);
  }

  @Post('feedback/cases/:id/state')
  @HttpCode(200)
  @Throttle(WRITE_THROTTLE)
  @Authorize(ACTIONS['feedback_case.handle'], feedbackCaseResource, DENY_AS_NOT_FOUND)
  setState(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(FeedbackStateRequestSchema)) body: FeedbackStateRequest,
  ): Promise<HandlerFeedbackCaseResponse> {
    return this.cases.setState(principal, id, body);
  }

  @Post('feedback/cases/:id/reassign')
  @HttpCode(200)
  @Throttle(WRITE_THROTTLE)
  @Authorize(ACTIONS['feedback_case.assign'], feedbackCaseResource, DENY_AS_NOT_FOUND)
  reassign(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(FeedbackReassignRequestSchema)) body: FeedbackReassignRequest,
  ): Promise<HandlerFeedbackCaseResponse> {
    return this.cases.reassign(principal, id, body);
  }

  // ── Organization settings ────────────────────────────────────────────────

  @Get('orgs/:orgId/feedback/routes')
  @Authorize(ACTIONS['org.settings'], orgResourceFromContext('feedback_route'))
  listRoutes(@Param('orgId') orgId: string): Promise<FeedbackRoutesAdminResponse> {
    return this.routes.listForOrg(orgId);
  }

  @Put('orgs/:orgId/feedback/routes')
  @Throttle(WRITE_THROTTLE)
  @Authorize(ACTIONS['org.settings'], orgResourceFromContext('feedback_route'))
  updateRoutes(
    @CurrentPrincipal() principal: Principal,
    @Param('orgId') orgId: string,
    @Body(new ZodValidationPipe(FeedbackRoutesUpdateRequestSchema)) body: FeedbackRoutesUpdateRequest,
  ): Promise<FeedbackRoutesAdminResponse> {
    return this.routes.update(orgId, body, principal);
  }
}
