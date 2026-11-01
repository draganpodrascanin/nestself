/**
 * ListeningController: the employee's survey and the organization's cycles
 * (spec EMP-01..02, SUR-02; ADR 0002). Report routes join in the reporting
 * task.
 *
 * GET  /me/listening/survey                      listening.respond.self   personalOrgResource('survey_participation')
 * PUT  /me/listening/survey/:cycleId/draft       listening.respond.self   personalOrgResource('survey_participation')
 * POST /me/listening/survey/:cycleId/submit      listening.respond.self   personalOrgResource('survey_participation')  Idempotency-Key, 10/60 s
 * GET  /orgs/:orgId/listening/cycles             listening.cycles.manage  orgResourceFromContext('survey_cycle')
 * POST /orgs/:orgId/listening/cycles             listening.cycles.manage  orgResourceFromContext('survey_cycle')      201, 10/60 s
 * POST /orgs/:orgId/listening/cycles/:id/cancel  listening.cycles.manage  orgResourceFromContext('survey_cycle')      10/60 s
 * GET  /orgs/:orgId/listening/configuration      listening.reports.read | listening.cycles.manage (read-only view of the client's rules)
 * GET  /orgs/:orgId/listening/overview           listening.reports.read   orgResourceFromContext('listening_report')
 * GET  /orgs/:orgId/listening/heatmap            listening.reports.read   orgResourceFromContext('listening_report')  ?snapshotId=
 * GET  /orgs/:orgId/listening/dimensions/:key    listening.reports.read   orgResourceFromContext('listening_report')  ?snapshotId=
 * POST /orgs/:orgId/listening/offer/dismiss      workplace_reviews.request orgResourceFromContext('workplace_review')
 *
 * The employee routes resolve the organization from the personal context and
 * the caller's own participation row; nothing lists other participants.
 */
import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ACTIONS,
  HeatmapQuerySchema,
  ListeningDimensionKeySchema,
  OfferDismissRequestSchema,
  SurveyCycleScheduleRequestSchema,
  SurveyDraftRequestSchema,
  SurveySubmitRequestSchema,
  type HeatmapQuery,
  type ListeningConfigurationResponse,
  type ListeningDimensionDetailResponse,
  type ListeningDimensionKey,
  type ListeningHeatmapResponse,
  type ListeningOverviewResponse,
  type MySurveyResponse,
  type OfferDismissRequest,
  type OfferDismissResponse,
  type Principal,
  type SurveyCycleListResponse,
  type SurveyCycleResponse,
  type SurveyCycleScheduleRequest,
  type SurveyDraftRequest,
  type SurveyDraftResponse,
  type SurveyReceiptResponse,
  type SurveySubmitRequest,
} from '@nestself/contracts';
import { CurrentPrincipal } from '../auth/current-principal.decorator.js';
import { Authorize } from '../authz/authorize.decorator.js';
import { orgResourceFromContext, personalOrgResource } from '../authz/resolvers.js';
import { WRITE_THROTTLE } from '../authz/throttles.js';
import { Idempotent } from '../common/idempotency/index.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { CyclesService } from './cycles.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ListeningConfigurationService } from './listening-configuration.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ParticipationService } from './participation.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ReportsService } from './reports.service.js';

const participationResource = personalOrgResource('survey_participation');
const cycleResource = orgResourceFromContext('survey_cycle');
const reportResource = orgResourceFromContext('listening_report');
const reviewResource = orgResourceFromContext('workplace_review');

@Controller()
export class ListeningController {
  constructor(
    private readonly participation: ParticipationService,
    private readonly cycles: CyclesService,
    private readonly configuration: ListeningConfigurationService,
    private readonly reports: ReportsService,
  ) {}

  // ── Employee ─────────────────────────────────────────────────────────────

  @Get('me/listening/survey')
  @Authorize(ACTIONS['listening.respond.self'], participationResource)
  mySurvey(@CurrentPrincipal() principal: Principal): Promise<MySurveyResponse> {
    return this.participation.current(principal);
  }

  @Put('me/listening/survey/:cycleId/draft')
  @Authorize(ACTIONS['listening.respond.self'], participationResource)
  saveDraft(
    @Param('cycleId') cycleId: string,
    @Body(new ZodValidationPipe(SurveyDraftRequestSchema)) body: SurveyDraftRequest,
    @CurrentPrincipal() principal: Principal,
  ): Promise<SurveyDraftResponse> {
    return this.participation.saveDraft(principal, cycleId, body);
  }

  @Post('me/listening/survey/:cycleId/submit')
  @HttpCode(200)
  @Throttle(WRITE_THROTTLE)
  @Idempotent('survey_submit')
  @Authorize(ACTIONS['listening.respond.self'], participationResource)
  submit(
    @Param('cycleId') cycleId: string,
    @Body(new ZodValidationPipe(SurveySubmitRequestSchema)) body: SurveySubmitRequest,
    @CurrentPrincipal() principal: Principal,
  ): Promise<SurveyReceiptResponse> {
    return this.participation.submit(principal, cycleId, body);
  }

  // ── Organization ─────────────────────────────────────────────────────────

  @Get('orgs/:orgId/listening/cycles')
  @Authorize(ACTIONS['listening.cycles.manage'], cycleResource)
  listCycles(@Param('orgId') orgId: string): Promise<SurveyCycleListResponse> {
    return this.cycles.list(orgId);
  }

  @Post('orgs/:orgId/listening/cycles')
  @HttpCode(201)
  @Throttle(WRITE_THROTTLE)
  @Authorize(ACTIONS['listening.cycles.manage'], cycleResource)
  scheduleCycle(
    @Param('orgId') orgId: string,
    @Body(new ZodValidationPipe(SurveyCycleScheduleRequestSchema)) body: SurveyCycleScheduleRequest,
    @CurrentPrincipal() principal: Principal,
  ): Promise<SurveyCycleResponse> {
    return this.cycles.schedule(orgId, body, principal);
  }

  @Post('orgs/:orgId/listening/cycles/:id/cancel')
  @HttpCode(200)
  @Throttle(WRITE_THROTTLE)
  @Authorize(ACTIONS['listening.cycles.manage'], cycleResource)
  cancelCycle(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @CurrentPrincipal() principal: Principal,
  ): Promise<SurveyCycleResponse> {
    return this.cycles.cancel(orgId, id, principal);
  }

  // ── Reports (spec REP-01..03, REV-01) ─────────────────────────────────────

  @Get('orgs/:orgId/listening/overview')
  @Authorize(ACTIONS['listening.reports.read'], reportResource)
  overview(@Param('orgId') orgId: string, @CurrentPrincipal() principal: Principal): Promise<ListeningOverviewResponse> {
    return this.reports.overview(orgId, principal);
  }

  @Get('orgs/:orgId/listening/heatmap')
  @Authorize(ACTIONS['listening.reports.read'], reportResource)
  heatmap(
    @Param('orgId') orgId: string,
    @Query(new ZodValidationPipe(HeatmapQuerySchema)) query: HeatmapQuery,
    @CurrentPrincipal() principal: Principal,
  ): Promise<ListeningHeatmapResponse> {
    return this.reports.heatmap(orgId, principal, query.snapshotId);
  }

  @Get('orgs/:orgId/listening/dimensions/:key')
  @Authorize(ACTIONS['listening.reports.read'], reportResource)
  dimension(
    @Param('orgId') orgId: string,
    @Param('key', new ZodValidationPipe(ListeningDimensionKeySchema)) key: ListeningDimensionKey,
    @Query(new ZodValidationPipe(HeatmapQuerySchema)) query: HeatmapQuery,
    @CurrentPrincipal() principal: Principal,
  ): Promise<ListeningDimensionDetailResponse> {
    return this.reports.dimensionDetail(orgId, principal, key, query.snapshotId);
  }

  @Post('orgs/:orgId/listening/offer/dismiss')
  @HttpCode(200)
  @Throttle(WRITE_THROTTLE)
  @Authorize(ACTIONS['workplace_reviews.request'], reviewResource)
  async dismissOffer(
    @Param('orgId') orgId: string,
    @Body(new ZodValidationPipe(OfferDismissRequestSchema)) body: OfferDismissRequest,
    @CurrentPrincipal() principal: Principal,
  ): Promise<OfferDismissResponse> {
    await this.reports.dismissOffer(orgId, principal, body.snapshotId);
    return { dismissed: true };
  }

  /** The client's rules as the organization may read them; changes come from NestSelf operations. */
  @Get('orgs/:orgId/listening/configuration')
  @Authorize([ACTIONS['listening.reports.read'], ACTIONS['listening.cycles.manage']], orgResourceFromContext('listening_configuration'))
  readConfiguration(@Param('orgId') orgId: string): Promise<ListeningConfigurationResponse> {
    return this.configuration.get(orgId);
  }
}
