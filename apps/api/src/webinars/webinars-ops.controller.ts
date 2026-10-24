/**
 * WebinarsOpsController: the occurrence form and the operations views
 * (T-CW-2.1, guidelines 7.3, WBN-30 to WBN-33).
 *
 * GET   /ops/webinars                          authenticated  manage or moderate, operations context (service)
 * POST  /ops/webinars                 10/60 s  event.manage   webinarOpsCreateResource
 * PATCH /ops/webinars/:id             10/60 s  event.manage   webinarOpsResource
 * POST  /ops/webinars/:id/publish      5/60 s  event.manage   webinarOpsResource
 * POST  /ops/webinars/:id/cancel       5/60 s  event.manage   webinarOpsResource
 * GET   /ops/webinars/:id/attendance           authenticated  event.manage or event.moderate, operations context (service, WBN-33)
 *
 * `GET /ops/webinars` is an addition to the decision record's route list
 * (the admin index). Every denial, and a call from outside the operations
 * context (`context_mismatch`), answers 404: an employer-scoped principal
 * learns nothing about an occurrence's registrations or attendance (D-CW-30).
 * A capacity above 250 answers 400 `capacity_above_limit` (D-CW-36).
 */
import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, UseFilters } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ACTIONS,
  WebinarCreateRequestSchema,
  WebinarOpsListQuerySchema,
  WebinarUpdateRequestSchema,
  type Principal,
  type WebinarAttendanceResponse,
  type WebinarCreateRequest,
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

@Controller('ops/webinars')
@UseFilters(AppointmentNonDisclosureFilter)
export class WebinarsOpsController {
  constructor(private readonly ops: WebinarOpsService) {}

  @Get()
  @Authenticated()
  list(
    @Query(new ZodValidationPipe(WebinarOpsListQuerySchema)) query: WebinarOpsListQuery,
    @CurrentPrincipal() principal: Principal,
  ): Promise<WebinarOpsListResponse> {
    return this.ops.list(principal, query);
  }

  @Post()
  @HttpCode(201)
  @Throttle(perMinute(10))
  @Authorize(ACTIONS['event.manage'], webinarOpsCreateResource)
  create(
    @Body(new WebinarFormValidationPipe(WebinarCreateRequestSchema)) body: WebinarCreateRequest,
    @CurrentPrincipal() principal: Principal,
  ): Promise<WebinarOpsResponse> {
    return this.ops.create(body, principal);
  }

  @Patch(':id')
  @Throttle(perMinute(10))
  @Authorize(ACTIONS['event.manage'], webinarOpsResource)
  update(
    @Param('id') id: string,
    @Body(new WebinarFormValidationPipe(WebinarUpdateRequestSchema)) body: WebinarUpdateRequest,
    @CurrentPrincipal() principal: Principal,
  ): Promise<WebinarOpsResponse> {
    return this.ops.update(id, body, principal);
  }

  @Post(':id/publish')
  @HttpCode(200)
  @Throttle(perMinute(5))
  @Authorize(ACTIONS['event.manage'], webinarOpsResource)
  publish(@Param('id') id: string, @CurrentPrincipal() principal: Principal): Promise<WebinarStatusResponse> {
    return this.ops.publish(id, principal);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Throttle(perMinute(5))
  @Authorize(ACTIONS['event.manage'], webinarOpsResource)
  cancel(@Param('id') id: string, @CurrentPrincipal() principal: Principal): Promise<WebinarStatusResponse> {
    return this.ops.cancel(id, principal);
  }

  @Get(':id/attendance')
  @Authenticated()
  attendance(@Param('id') id: string, @CurrentPrincipal() principal: Principal): Promise<WebinarAttendanceResponse> {
    return this.ops.attendance(id, principal);
  }
}
