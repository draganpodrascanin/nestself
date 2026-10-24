/**
 * AppointmentsController: the appointment spine routes (T-CW-0.6, D-CW-02,
 * guidelines 7.1).
 *
 * GET  /appointments                 list: `@Authenticated()`, authorized in the service (see below)
 * GET  /appointments/:id             consultation.join   appointmentResource
 * POST /orgs/:orgId/appointments     appointment.propose orgResourceFromContext('appointment')   10/60 s
 * POST /appointments/:id/cancel      appointment.cancel  appointmentResource                     10/60 s
 *
 * The list has no `:id`, so `appointmentResource` cannot resolve it, and the
 * rows it returns span organizations: the service authorizes every row with
 * `consultation.join` (participants) or the organization with
 * `bookings.coordinate` (operations), the same pattern as the professional
 * routes.
 *
 * Every authorization denial on these routes answers 404 (CALL-17, D-CW-30;
 * `AppointmentNonDisclosureFilter`).
 */
import { Body, Controller, Get, HttpCode, Param, Post, Query, UseFilters } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ACTIONS,
  AppointmentCreateRequestSchema,
  type AppointmentCreateRequest,
  type AppointmentListResponse,
  type AppointmentResponse,
  type Principal,
} from '@nestself/contracts';
import { Authorize } from '../authz/authorize.decorator.js';
import { Authenticated } from '../authz/authenticated.decorator.js';
import { orgResourceFromContext } from '../authz/resolvers.js';
import { WRITE_THROTTLE } from '../authz/throttles.js';
import { CurrentPrincipal } from '../auth/current-principal.decorator.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { appointmentResource } from './appointment.resolver.js';
import { AppointmentNonDisclosureFilter } from './appointment-non-disclosure.filter.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import {
  AppointmentListQuerySchema,
  AppointmentsService,
  type AppointmentListQuery,
} from './appointments.service.js';

@Controller()
@UseFilters(AppointmentNonDisclosureFilter)
export class AppointmentsController {
  constructor(private readonly appointments: AppointmentsService) {}

  @Get('appointments')
  @Authenticated()
  list(
    @Query(new ZodValidationPipe(AppointmentListQuerySchema)) query: AppointmentListQuery,
    @CurrentPrincipal() principal: Principal,
  ): Promise<AppointmentListResponse> {
    return this.appointments.list(principal, query);
  }

  @Get('appointments/:id')
  @Authorize(ACTIONS['consultation.join'], appointmentResource)
  get(@Param('id') id: string): Promise<AppointmentResponse> {
    return this.appointments.get(id);
  }

  @Post('orgs/:orgId/appointments')
  @HttpCode(201)
  @Throttle(WRITE_THROTTLE)
  @Authorize(ACTIONS['appointment.propose'], orgResourceFromContext('appointment'))
  create(
    @Param('orgId') orgId: string,
    @Body(new ZodValidationPipe(AppointmentCreateRequestSchema)) body: AppointmentCreateRequest,
    @CurrentPrincipal() principal: Principal,
  ): Promise<AppointmentResponse> {
    return this.appointments.create(orgId, body, principal);
  }

  @Post('appointments/:id/cancel')
  @HttpCode(200)
  @Throttle(WRITE_THROTTLE)
  @Authorize(ACTIONS['appointment.cancel'], appointmentResource)
  cancel(@Param('id') id: string, @CurrentPrincipal() principal: Principal): Promise<AppointmentResponse> {
    return this.appointments.cancel(id, principal);
  }
}
