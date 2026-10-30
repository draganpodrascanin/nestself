/**
 * AppointmentsController: the appointment spine routes (T-CW-0.6, D-CW-02,
 * guidelines 7.1).
 *
 * GET  /appointments                 list: `@Authenticated()`, authorized in the service (see below)
 * GET  /appointments/:id             `@Authenticated()`; participants (consultation.join) or operations
 *                                    (bookings.coordinate on the organization), checked in the service
 * GET  /ops/appointment-experts       `@Authenticated()`; bookings.coordinate somewhere, checked in the service:
 *                                    the experts who may take a category (T-CW-1.5)
 * POST /orgs/:orgId/appointments     bookings.coordinate  operationsOrgResource('appointment')   10/60 s
 * POST /appointments/:id/cancel      `@Authenticated()`; the employee (appointment.cancel) or operations
 *                                    (bookings.coordinate on the organization), checked in the service   10/60 s
 *
 * Follow-ups (T-CW-1.9, D-CW-37, `FollowUpService`), each answering the
 * appointment it changed or created:
 *
 * POST /appointments/:id/follow-up     appointment.propose  appointmentResource  10/60 s  expert proposes (201)
 * POST /appointments/:id/confirm       consultation.join    appointmentResource  10/60 s  employee confirms
 * POST /appointments/:id/suggest-times consultation.join    appointmentResource  10/60 s  employee suggests 1 to 3 windows
 * POST /appointments/:id/schedule      appointment.propose  appointmentResource  10/60 s  expert picks a suggested window
 * POST /appointments/:id/decline       consultation.join    appointmentResource  10/60 s  employee declines
 *
 * Creation belongs to NestSelf operations in the operations context
 * (`client_operations` through its CLIENT assignment): no template reaches
 * `appointment.propose` on an organization resource from an organization
 * context. Experts propose follow-ups through the follow-up route.
 *
 * The list has no `:id`, so `appointmentResource` cannot resolve it, and the
 * rows it returns span organizations: the service authorizes every row with
 * `consultation.join` (participants) or the organization with
 * `bookings.coordinate` (operations), the same pattern as the professional
 * routes. It is paged on `(startsAt, id)`, and `?followUpOf=<id>` narrows it
 * to one consultation's follow-ups (T-CW-1.9).
 *
 * Every authorization denial and context mismatch on these routes answers
 * 404 (CALL-17, D-CW-30; `AppointmentNonDisclosureFilter`).
 */
import { Body, Controller, Get, HttpCode, Param, Post, Query, UseFilters } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ACTIONS,
  AppointmentCreateRequestSchema,
  AppointmentFollowUpRequestSchema,
  AppointmentListQuerySchema,
  AppointmentExpertCandidatesQuerySchema,
  AppointmentSuggestTimesRequestSchema,
  FollowUpConfirmRequestSchema,
  FollowUpDeclineRequestSchema,
  FollowUpScheduleRequestSchema,
  type AppointmentCreateRequest,
  type AppointmentFollowUpRequest,
  type AppointmentListQuery,
  type AppointmentExpertCandidatesQuery,
  type AppointmentExpertCandidatesResponse,
  type AppointmentListResponse,
  type AppointmentResponse,
  type AppointmentSuggestTimesRequest,
  type FollowUpScheduleRequest,
  type Principal,
} from '@nestself/contracts';
import { Authorize } from '../authz/authorize.decorator.js';
import { Authenticated } from '../authz/authenticated.decorator.js';
import { operationsOrgResource } from '../authz/resolvers.js';
import { WRITE_THROTTLE } from '../authz/throttles.js';
import { CurrentPrincipal } from '../auth/current-principal.decorator.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { appointmentResource } from './appointment.resolver.js';
import { AppointmentNonDisclosureFilter } from './appointment-non-disclosure.filter.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { AppointmentsService } from './appointments.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { FollowUpService } from './follow-up.service.js';

@Controller()
@UseFilters(AppointmentNonDisclosureFilter)
export class AppointmentsController {
  constructor(
    private readonly appointments: AppointmentsService,
    private readonly followUps: FollowUpService,
  ) {}

  @Get('appointments')
  @Authenticated()
  list(
    @Query(new ZodValidationPipe(AppointmentListQuerySchema)) query: AppointmentListQuery,
    @CurrentPrincipal() principal: Principal,
  ): Promise<AppointmentListResponse> {
    return this.appointments.list(principal, query);
  }

  /** Participants or operations; authorized in the service (`get`). */
  @Get('appointments/:id')
  @Authenticated()
  get(@Param('id') id: string, @CurrentPrincipal() principal: Principal): Promise<AppointmentResponse> {
    return this.appointments.get(id, principal);
  }

  /** The booking form's expert picker (T-CW-1.5); authorized in the service (`expertCandidates`). */
  @Get('ops/appointment-experts')
  @Authenticated()
  expertCandidates(
    @Query(new ZodValidationPipe(AppointmentExpertCandidatesQuerySchema)) query: AppointmentExpertCandidatesQuery,
    @CurrentPrincipal() principal: Principal,
  ): Promise<AppointmentExpertCandidatesResponse> {
    return this.appointments.expertCandidates(principal, query);
  }

  @Post('orgs/:orgId/appointments')
  @HttpCode(201)
  @Throttle(WRITE_THROTTLE)
  @Authorize(ACTIONS['bookings.coordinate'], operationsOrgResource('appointment'))
  create(
    @Param('orgId') orgId: string,
    @Body(new ZodValidationPipe(AppointmentCreateRequestSchema)) body: AppointmentCreateRequest,
    @CurrentPrincipal() principal: Principal,
  ): Promise<AppointmentResponse> {
    return this.appointments.create(orgId, body, principal);
  }

  /** The employee or operations; authorized in the service (`authorizeCancel`). */
  @Post('appointments/:id/cancel')
  @HttpCode(200)
  @Throttle(WRITE_THROTTLE)
  @Authenticated()
  cancel(@Param('id') id: string, @CurrentPrincipal() principal: Principal): Promise<AppointmentResponse> {
    return this.appointments.cancelAs(id, principal);
  }

  // ── Follow-ups (T-CW-1.9, D-CW-37) ──────────────────────────────────────

  @Post('appointments/:id/follow-up')
  @HttpCode(201)
  @Throttle(WRITE_THROTTLE)
  @Authorize(ACTIONS['appointment.propose'], appointmentResource)
  proposeFollowUp(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AppointmentFollowUpRequestSchema)) body: AppointmentFollowUpRequest,
    @CurrentPrincipal() principal: Principal,
  ): Promise<AppointmentResponse> {
    return this.followUps.propose(id, body, principal);
  }

  @Post('appointments/:id/confirm')
  @HttpCode(200)
  @Throttle(WRITE_THROTTLE)
  @Authorize(ACTIONS['consultation.join'], appointmentResource)
  confirmFollowUp(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(FollowUpConfirmRequestSchema)) _body: unknown,
    @CurrentPrincipal() principal: Principal,
  ): Promise<AppointmentResponse> {
    return this.followUps.confirm(id, principal);
  }

  @Post('appointments/:id/suggest-times')
  @HttpCode(200)
  @Throttle(WRITE_THROTTLE)
  @Authorize(ACTIONS['consultation.join'], appointmentResource)
  suggestTimes(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AppointmentSuggestTimesRequestSchema)) body: AppointmentSuggestTimesRequest,
    @CurrentPrincipal() principal: Principal,
  ): Promise<AppointmentResponse> {
    return this.followUps.suggestTimes(id, body, principal);
  }

  @Post('appointments/:id/schedule')
  @HttpCode(200)
  @Throttle(WRITE_THROTTLE)
  @Authorize(ACTIONS['appointment.propose'], appointmentResource)
  scheduleFollowUp(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(FollowUpScheduleRequestSchema)) body: FollowUpScheduleRequest,
    @CurrentPrincipal() principal: Principal,
  ): Promise<AppointmentResponse> {
    return this.followUps.schedule(id, body, principal);
  }

  @Post('appointments/:id/decline')
  @HttpCode(200)
  @Throttle(WRITE_THROTTLE)
  @Authorize(ACTIONS['consultation.join'], appointmentResource)
  declineFollowUp(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(FollowUpDeclineRequestSchema)) _body: unknown,
    @CurrentPrincipal() principal: Principal,
  ): Promise<AppointmentResponse> {
    return this.followUps.decline(id, principal);
  }
}
