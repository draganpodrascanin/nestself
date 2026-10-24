/**
 * CallsController: the consultation call routes (T-CW-1.1, guidelines 7.1
 * and 7.2, decision record section 7).
 *
 * POST /appointments/:id/join              consultation.join  appointmentResource    20/60 s  Cache-Control: no-store
 * POST /appointments/:id/end               consultation.join  appointmentResource    10/60 s  expert only (service)
 * POST /appointments/:id/outcome           delivery.record    appointmentResource    10/60 s
 * POST /appointments/:id/feedback          consultation.join  appointmentResource     5/60 s  employee only (service)
 * POST /appointments/:id/signal            consultation.join  appointmentResource    30/60 s
 * GET  /appointments/:id/location          consultation.join  appointmentResource             expert only (service), Cache-Control: no-store
 * POST /calls/:sessionId/client-events     consultation.join  callSessionResource    60/60 s
 * GET  /ops/calls/:sessionId/diagnostics   diagnostic.read    operationsResource('call')
 *
 * Every authorization denial and context mismatch answers 404, as on the
 * appointment routes (CALL-17, D-CW-30, `AppointmentNonDisclosureFilter`):
 * an employer-scoped principal learns nothing about a consultation, its
 * participants, its outcome or its feedback. The coded 403s a service raises
 * to a known participant (`join_window_closed`, or `forbidden` for a step
 * reserved to the other participant) stay 403. Consultations are not
 * recorded: there is no recording route (D-CW-34, CW-R-79a).
 */
import { Body, Controller, Get, Header, HttpCode, Param, Post, UseFilters } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import {
  ACTIONS,
  CallFeedbackRequestSchema,
  CallJoinRequestSchema,
  CallOutcomeRequestSchema,
  CallSignalRequestSchema,
  ClientEventBatchRequestSchema,
  type AppointmentResponse,
  type CallFeedbackRequest,
  type CallJoinRequest,
  type CallJoinResponse,
  type CallLocationResponse,
  type CallOutcomeRequest,
  type CallSignalRequest,
  type ClientEventBatchRequest,
  type DiagnosticsResponse,
  type Principal,
} from '@nestself/contracts';
import { Authorize } from '../authz/authorize.decorator.js';
import { operationsResource } from '../authz/resolvers.js';
import { CurrentPrincipal } from '../auth/current-principal.decorator.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { appointmentResource } from '../appointments/appointment.resolver.js';
import { AppointmentNonDisclosureFilter } from '../appointments/appointment-non-disclosure.filter.js';
import { callSessionResource } from './call-session.resolver.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { CallsService } from './calls.service.js';

const perMinute = (limit: number) => ({ default: { limit, ttl: 60_000 } });

/** A join without a body is a join without a location (Express 5 leaves `req.body` undefined). */
const JoinBodySchema = z.preprocess((value) => value ?? {}, CallJoinRequestSchema);

const sessionIdOf = (req: Record<string, unknown>): string | undefined =>
  (req['params'] as Record<string, string | undefined> | undefined)?.['sessionId'];

@Controller()
@UseFilters(AppointmentNonDisclosureFilter)
export class CallsController {
  constructor(private readonly calls: CallsService) {}

  @Post('appointments/:id/join')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Throttle(perMinute(20))
  @Authorize(ACTIONS['consultation.join'], appointmentResource)
  join(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(JoinBodySchema)) body: CallJoinRequest,
    @CurrentPrincipal() principal: Principal,
  ): Promise<CallJoinResponse> {
    return this.calls.join(id, principal, body);
  }

  @Post('appointments/:id/end')
  @HttpCode(204)
  @Throttle(perMinute(10))
  @Authorize(ACTIONS['consultation.join'], appointmentResource)
  end(@Param('id') id: string, @CurrentPrincipal() principal: Principal): Promise<void> {
    return this.calls.end(id, principal);
  }

  @Post('appointments/:id/outcome')
  @HttpCode(200)
  @Throttle(perMinute(10))
  @Authorize(ACTIONS['delivery.record'], appointmentResource)
  outcome(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CallOutcomeRequestSchema)) body: CallOutcomeRequest,
    @CurrentPrincipal() principal: Principal,
  ): Promise<AppointmentResponse> {
    return this.calls.recordOutcome(id, principal, body);
  }

  @Post('appointments/:id/feedback')
  @HttpCode(204)
  @Throttle(perMinute(5))
  @Authorize(ACTIONS['consultation.join'], appointmentResource)
  feedback(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CallFeedbackRequestSchema)) body: CallFeedbackRequest,
    @CurrentPrincipal() principal: Principal,
  ): Promise<void> {
    return this.calls.submitFeedback(id, principal, body);
  }

  @Post('appointments/:id/signal')
  @HttpCode(204)
  @Throttle(perMinute(30))
  @Authorize(ACTIONS['consultation.join'], appointmentResource)
  signal(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CallSignalRequestSchema)) body: CallSignalRequest,
    @CurrentPrincipal() principal: Principal,
  ): Promise<void> {
    return this.calls.signal(id, principal, body);
  }

  /** CALL-34 criterion 3: the location the employee shared, for the assigned expert while the session is live. */
  @Get('appointments/:id/location')
  @Header('Cache-Control', 'no-store')
  @Authorize(ACTIONS['consultation.join'], appointmentResource)
  location(@Param('id') id: string, @CurrentPrincipal() principal: Principal): Promise<CallLocationResponse> {
    return this.calls.location(id, principal);
  }

  @Post('calls/:sessionId/client-events')
  @HttpCode(204)
  @Throttle(perMinute(60))
  @Authorize(ACTIONS['consultation.join'], callSessionResource)
  clientEvents(
    @Param('sessionId') sessionId: string,
    @Body(new ZodValidationPipe(ClientEventBatchRequestSchema)) body: ClientEventBatchRequest,
    @CurrentPrincipal() principal: Principal,
  ): Promise<void> {
    return this.calls.recordClientEvents(sessionId, principal, body);
  }

  @Get('ops/calls/:sessionId/diagnostics')
  @Authorize(ACTIONS['diagnostic.read'], operationsResource('call', sessionIdOf))
  diagnostics(@Param('sessionId') sessionId: string, @CurrentPrincipal() principal: Principal): Promise<DiagnosticsResponse> {
    return this.calls.diagnostics(sessionId, principal);
  }
}
