/**
 * WebinarsOpsController: the occurrence form and the operations views
 * (T-CW-2.1, guidelines 7.3, WBN-30 to WBN-33).
 *
 * GET   /ops/webinars                                   authenticated  manage or moderate, operations context; `mine=true`: the caller's hosted occurrences, any context (service)
 * GET   /ops/webinars/host-candidates                   authenticated  event.manage, operations context (service)
 * GET   /ops/webinars/:id                               authenticated  event.manage or event.moderate, operations context (service)
 * POST  /ops/webinars                          10/60 s  event.manage   webinarOpsCreateResource
 * PATCH /ops/webinars/:id                      10/60 s  event.manage   webinarOpsResource
 * POST  /ops/webinars/:id/publish               5/60 s  event.manage   webinarOpsResource
 * POST  /ops/webinars/:id/cancel                5/60 s  event.manage   webinarOpsResource
 * GET   /ops/webinars/:id/attendance                    authenticated  event.manage or event.moderate, operations context (service, WBN-33)
 * GET   /ops/orgs                                       authenticated  event.manage, operations context (service): the audience picker
 *
 * `GET /ops/webinars` (with `mine`), `GET /ops/webinars/:id`,
 * `GET /ops/webinars/host-candidates` and `GET /ops/orgs` are additions to
 * the decision record's route list (the admin index, the presenter's list and
 * the occurrence form). Every denial, and a call from outside the operations
 * context (`context_mismatch`), answers 404: an employer-scoped principal
 * learns nothing about an occurrence's registrations or attendance (D-CW-30).
 * A capacity above 250 answers 400 `capacity_above_limit` (D-CW-36); an edit
 * the status no longer allows 409 `not_editable`.
 */
import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, UseFilters } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ACTIONS,
  OpsOrganizationsQuerySchema,
  WebinarCreateRequestSchema,
  WebinarHostCandidatesQuerySchema,
  WebinarOpsListQuerySchema,
  WebinarUpdateRequestSchema,
  type OpsOrganizationsQuery,
  type OpsOrganizationsResponse,
  type Principal,
  type WebinarAttendanceResponse,
  type WebinarCreateRequest,
  type WebinarHostCandidatesQuery,
  type WebinarHostCandidatesResponse,
  type WebinarOpsListQuery,
  type WebinarOpsListResponse,
  type WebinarOpsResponse,
  type WebinarStatusResponse,
  type WebinarUpdateRequest,
} from '@nestself/contracts';
import { AppointmentNonDisclosureFilter } from '../appointments/appointment-non-disclosure.filter.js';
import { CurrentPrincipal } from '../auth/current-principal.decorator.js';
import { Authenticated } from '../authz/authenticated.decorator.js';
import { Authorize } from '../authz/authorize.decorator.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { WebinarOpsService } from './webinar-ops.service.js';
import { WebinarFormValidationPipe } from './webinar-validation.pipe.js';
import { webinarOpsCreateResource, webinarOpsResource } from './webinar.resolver.js';

const perMinute = (limit: number) => ({ default: { limit, ttl: 60_000 } });

@Controller('ops')
@UseFilters(AppointmentNonDisclosureFilter)
export class WebinarsOpsController {
  constructor(private readonly ops: WebinarOpsService) {}

  @Get('webinars')
  @Authenticated()
  list(
    @Query(new ZodValidationPipe(WebinarOpsListQuerySchema)) query: WebinarOpsListQuery,
    @CurrentPrincipal() principal: Principal,
  ): Promise<WebinarOpsListResponse> {
    return this.ops.list(principal, query);
  }

  /** Declared before `webinars/:id`, which would otherwise take the path. */
  @Get('webinars/host-candidates')
  @Authenticated()
  hostCandidates(
    @Query(new ZodValidationPipe(WebinarHostCandidatesQuerySchema)) query: WebinarHostCandidatesQuery,
    @CurrentPrincipal() principal: Principal,
  ): Promise<WebinarHostCandidatesResponse> {
    return this.ops.hostCandidates(principal, query);
  }

  @Get('webinars/:id')
  @Authenticated()
  get(@Param('id') id: string, @CurrentPrincipal() principal: Principal): Promise<WebinarOpsResponse> {
    return this.ops.get(id, principal);
  }

  @Post('webinars')
  @HttpCode(201)
  @Throttle(perMinute(10))
  @Authorize(ACTIONS['event.manage'], webinarOpsCreateResource)
  create(
    @Body(new WebinarFormValidationPipe(WebinarCreateRequestSchema)) body: WebinarCreateRequest,
    @CurrentPrincipal() principal: Principal,
  ): Promise<WebinarOpsResponse> {
    return this.ops.create(body, principal);
  }

  @Patch('webinars/:id')
  @Throttle(perMinute(10))
  @Authorize(ACTIONS['event.manage'], webinarOpsResource)
  update(
    @Param('id') id: string,
    @Body(new WebinarFormValidationPipe(WebinarUpdateRequestSchema)) body: WebinarUpdateRequest,
    @CurrentPrincipal() principal: Principal,
  ): Promise<WebinarOpsResponse> {
    return this.ops.update(id, body, principal);
  }

  @Post('webinars/:id/publish')
  @HttpCode(200)
  @Throttle(perMinute(5))
  @Authorize(ACTIONS['event.manage'], webinarOpsResource)
  publish(@Param('id') id: string, @CurrentPrincipal() principal: Principal): Promise<WebinarStatusResponse> {
    return this.ops.publish(id, principal);
  }

  @Post('webinars/:id/cancel')
  @HttpCode(200)
  @Throttle(perMinute(5))
  @Authorize(ACTIONS['event.manage'], webinarOpsResource)
  cancel(@Param('id') id: string, @CurrentPrincipal() principal: Principal): Promise<WebinarStatusResponse> {
    return this.ops.cancel(id, principal);
  }

  @Get('webinars/:id/attendance')
  @Authenticated()
  attendance(@Param('id') id: string, @CurrentPrincipal() principal: Principal): Promise<WebinarAttendanceResponse> {
    return this.ops.attendance(id, principal);
  }

  @Get('orgs')
  @Authenticated()
  organisations(
    @Query(new ZodValidationPipe(OpsOrganizationsQuerySchema)) query: OpsOrganizationsQuery,
    @CurrentPrincipal() principal: Principal,
  ): Promise<OpsOrganizationsResponse> {
    return this.ops.organisations(principal, query);
  }
}
