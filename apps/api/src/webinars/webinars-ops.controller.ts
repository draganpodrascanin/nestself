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
 * GET   /ops/orgs                                       authenticated  event.manage or bookings.coordinate, operations context (service):
 *                                                                      the audience picker and the booking form (T-CW-1.5)
 * GET   /ops/orgs/:orgId/units                          event.manage   operationsOrgResource('webinar'): the units of an org_unit audience
 *
 * `GET /ops/webinars` (with `mine`), `GET /ops/webinars/:id`,
 * `GET /ops/webinars/host-candidates`, `GET /ops/orgs` and
 * `GET /ops/orgs/:orgId/units` are additions to
 * the decision record's route list (the admin index, the presenter's list and
 * the occurrence form). Every denial, and a call from outside the operations
 * context (`context_mismatch`), answers 404: an employer-scoped principal
 * learns nothing about an occurrence's registrations or attendance (D-CW-30).
 * A capacity above 1,000 answers 400 `capacity_above_limit` (D-CW-14); an edit
 * the status no longer allows 409 `not_editable`.
 */
import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, UseFilters } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ModuleRef } from '@nestjs/core';
import { Throttle } from '@nestjs/throttler';
import {
  ACTIONS,
  OpsOrganizationsQuerySchema,
  WebinarCreateRequestSchema,
  WebinarHostCandidatesQuerySchema,
  WebinarOpsListQuerySchema,
  WebinarUpdateRequestSchema,
  type OpsOrgUnitsResponse,
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
import { AppointmentsService } from '../appointments/appointments.service.js';
import { ApiHttpException } from '../common/api-error.js';
import { CurrentPrincipal } from '../auth/current-principal.decorator.js';
import { Authenticated } from '../authz/authenticated.decorator.js';
import { Authorize } from '../authz/authorize.decorator.js';
import { operationsOrgResource } from '../authz/resolvers.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { WebinarOpsService } from './webinar-ops.service.js';
import { WebinarFormValidationPipe } from './webinar-validation.pipe.js';
import { webinarOpsCreateResource, webinarOpsResource } from './webinar.resolver.js';

const perMinute = (limit: number) => ({ default: { limit, ttl: 60_000 } });

/** Most organisations `GET /ops/orgs` lists (the webinar service's own lookup limit). */
const ORGANISATION_LOOKUP_LIMIT = 50;

@Controller('ops')
@UseFilters(AppointmentNonDisclosureFilter)
export class WebinarsOpsController {
  constructor(
    private readonly ops: WebinarOpsService,
    private readonly moduleRef: ModuleRef,
  ) {}

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

  /**
   * The organisations the caller may manage occurrences of (`event.manage`)
   * or coordinate bookings for (`bookings.coordinate`, T-CW-1.5), by name.
   * Without either, the webinar service's audited 404 stands.
   */
  @Get('orgs')
  @Authenticated()
  async organisations(
    @Query(new ZodValidationPipe(OpsOrganizationsQuerySchema)) query: OpsOrganizationsQuery,
    @CurrentPrincipal() principal: Principal,
  ): Promise<OpsOrganizationsResponse> {
    const bookable = await this.appointments().bookableOrganisations(principal, query.q);
    if (!bookable) return this.ops.organisations(principal, query);

    let managed: OpsOrganizationsResponse['items'] = [];
    try {
      managed = (await this.ops.organisations(principal, query)).items;
    } catch (error) {
      // A booking coordinator who manages no occurrences still gets the organisations they book for.
      if (!(error instanceof ApiHttpException) || ![403, 404].includes(error.getStatus())) throw error;
    }
    const byId = new Map([...managed, ...bookable].map((org) => [org.id, { id: org.id, name: org.name }]));
    const items = [...byId.values()]
      .sort((a, b) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1))
      .slice(0, ORGANISATION_LOOKUP_LIMIT);
    return { items };
  }

  @Get('orgs/:orgId/units')
  @Authorize(ACTIONS['event.manage'], operationsOrgResource('webinar'))
  units(@Param('orgId') orgId: string): Promise<OpsOrgUnitsResponse> {
    return this.ops.units(orgId);
  }

  /**
   * The appointments module's service. `WebinarsModule` does not import
   * `AppointmentsModule` (it reaches it through `CallsModule` only), so the
   * lookup is resolved at request time.
   */
  private appointments(): AppointmentsService {
    return this.moduleRef.get(AppointmentsService, { strict: false });
  }
}
