/**
 * ListeningOpsController: NestSelf operations routes of the listening module
 * (spec CFG-01, CFG-03, SUR-01; ADR 0002). Every route needs a web session in
 * the operations context (API-R-28).
 *
 * GET  /ops/orgs/:orgId/listening/configuration            listening.configure   operationsOrgResource
 * PUT  /ops/orgs/:orgId/listening/configuration            listening.configure   operationsOrgResource   10/60 s
 * GET  /ops/listening/questionnaires                       listening.templates.write
 * POST /ops/listening/questionnaires                       listening.templates.write (201)              10/60 s
 * PATCH /ops/listening/questionnaires/:id                  listening.templates.write                     10/60 s
 * POST /ops/listening/questionnaires/:id/submit-review     listening.templates.write                     10/60 s
 * POST /ops/listening/questionnaires/:id/archive           listening.templates.write                     10/60 s
 * POST /ops/listening/questionnaires/:id/publish           listening.templates.publish                   10/60 s
 *
 * `listening.configure` reaches an organization through a platform grant
 * (`listening_administrator`, `platform_owner`) or a CLIENT assignment
 * (`client_operations`); the questionnaire routes are platform resources.
 */
import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ACTIONS,
  ListeningConfigurationUpdateRequestSchema,
  QuestionnaireDraftRequestSchema,
  type ListeningConfigurationResponse,
  type ListeningConfigurationUpdateRequest,
  type Principal,
  type QuestionnaireDraftRequest,
  type QuestionnaireListResponse,
  type QuestionnaireVersionResponse,
} from '@nestself/contracts';
import { CurrentPrincipal } from '../auth/current-principal.decorator.js';
import { Authorize } from '../authz/authorize.decorator.js';
import { operationsOrgResource, operationsResource } from '../authz/resolvers.js';
import { WRITE_THROTTLE } from '../authz/throttles.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ListeningConfigurationService } from './listening-configuration.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { QuestionnaireService } from './questionnaire.service.js';

const configurationResource = operationsOrgResource('listening_configuration');
const questionnaireResource = operationsResource('questionnaire', (req) => (req['params'] as Record<string, string>)?.['id']);

@Controller('ops')
export class ListeningOpsController {
  constructor(
    private readonly configuration: ListeningConfigurationService,
    private readonly questionnaires: QuestionnaireService,
  ) {}

  @Get('orgs/:orgId/listening/configuration')
  @Authorize(ACTIONS['listening.configure'], configurationResource)
  getConfiguration(@Param('orgId') orgId: string): Promise<ListeningConfigurationResponse> {
    return this.configuration.get(orgId);
  }

  @Put('orgs/:orgId/listening/configuration')
  @Throttle(WRITE_THROTTLE)
  @Authorize(ACTIONS['listening.configure'], configurationResource)
  updateConfiguration(
    @Param('orgId') orgId: string,
    @Body(new ZodValidationPipe(ListeningConfigurationUpdateRequestSchema)) body: ListeningConfigurationUpdateRequest,
    @CurrentPrincipal() principal: Principal,
  ): Promise<ListeningConfigurationResponse> {
    return this.configuration.update(orgId, body, principal);
  }

  @Get('listening/questionnaires')
  @Authorize(ACTIONS['listening.templates.write'], questionnaireResource)
  listQuestionnaires(): Promise<QuestionnaireListResponse> {
    return this.questionnaires.list();
  }

  @Post('listening/questionnaires')
  @HttpCode(201)
  @Throttle(WRITE_THROTTLE)
  @Authorize(ACTIONS['listening.templates.write'], questionnaireResource)
  createQuestionnaire(
    @Body(new ZodValidationPipe(QuestionnaireDraftRequestSchema)) body: QuestionnaireDraftRequest,
    @CurrentPrincipal() principal: Principal,
  ): Promise<QuestionnaireVersionResponse> {
    return this.questionnaires.createDraft(body, principal);
  }

  @Patch('listening/questionnaires/:id')
  @Throttle(WRITE_THROTTLE)
  @Authorize(ACTIONS['listening.templates.write'], questionnaireResource)
  updateQuestionnaire(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(QuestionnaireDraftRequestSchema)) body: QuestionnaireDraftRequest,
    @CurrentPrincipal() principal: Principal,
  ): Promise<QuestionnaireVersionResponse> {
    return this.questionnaires.updateDraft(id, body, principal);
  }

  @Post('listening/questionnaires/:id/submit-review')
  @HttpCode(200)
  @Throttle(WRITE_THROTTLE)
  @Authorize(ACTIONS['listening.templates.write'], questionnaireResource)
  submitReview(@Param('id') id: string, @CurrentPrincipal() principal: Principal): Promise<QuestionnaireVersionResponse> {
    return this.questionnaires.submitReview(id, principal);
  }

  @Post('listening/questionnaires/:id/archive')
  @HttpCode(200)
  @Throttle(WRITE_THROTTLE)
  @Authorize(ACTIONS['listening.templates.write'], questionnaireResource)
  archive(@Param('id') id: string, @CurrentPrincipal() principal: Principal): Promise<QuestionnaireVersionResponse> {
    return this.questionnaires.archive(id, principal);
  }

  @Post('listening/questionnaires/:id/publish')
  @HttpCode(200)
  @Throttle(WRITE_THROTTLE)
  @Authorize(ACTIONS['listening.templates.publish'], questionnaireResource)
  publish(@Param('id') id: string, @CurrentPrincipal() principal: Principal): Promise<QuestionnaireVersionResponse> {
    return this.questionnaires.publish(id, principal);
  }
}
