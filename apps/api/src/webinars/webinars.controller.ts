/**
 * WebinarsController: the employee and live webinar routes (T-CW-2.1,
 * guidelines 7.3, decision record section 7).
 *
 * GET    /webinars                                                event.register  webinarListResource
 * GET    /webinars/:id                                            authenticated   attendee in the audience, registrant, host or moderating staff (service)
 * POST   /webinars/:id/register                         10/60 s   event.register  webinarRegistrantResource
 * DELETE /webinars/:id/register                         10/60 s   event.register  webinarRegistrantResource
 * POST   /webinars/:id/join                             20/60 s   authenticated   host or registered attendee (service), Cache-Control: no-store
 * POST   /webinars/:id/start                             5/60 s   authenticated   a host: event.present or event.moderate (service, CW-R-31a)
 * POST   /webinars/:id/end                               5/60 s   authenticated   a host: event.present or event.moderate (service, CW-R-31a)
 * POST   /webinars/:id/messages                         20/60 s   authenticated   attendee (event.register) or host (service, WBN-37)
 * GET    /webinars/:id/messages                                   authenticated   attendee or presenter: published only; moderating: all (service)
 * POST   /webinars/:id/messages/:messageId/publish      30/60 s   event.moderate  webinarStaffResource
 * POST   /webinars/:id/messages/:messageId/answer       30/60 s   event.moderate  webinarStaffResource
 * POST   /webinars/:id/messages/:messageId/dismiss      30/60 s   event.moderate  webinarStaffResource
 * POST   /webinars/:id/hand                             10/60 s   event.register  webinarRegistrantResource
 * DELETE /webinars/:id/hand                             10/60 s   event.register  webinarRegistrantResource
 * POST   /webinars/:id/participants/:participantId/give-floor  10/60 s  authenticated  a host or moderating (service, WBN-25)
 * POST   /webinars/:id/participants/:participantId/take-floor  10/60 s  authenticated  a host or moderating (service, WBN-25)
 * POST   /webinars/:id/participants/:participantId/mute        10/60 s  authenticated  a host or moderating (service, WBN-26)
 * POST   /webinars/:id/participants/:participantId/unmute-request  10/60 s  authenticated  a host or moderating (service, WBN-26)
 * POST   /webinars/:id/participants/:participantId/unmute      10/60 s  event.register  the attendee, own participant, holding the floor (service, WBN-26)
 * POST   /webinars/:id/polls                            10/60 s   event.moderate  webinarStaffResource
 * POST   /webinars/:id/polls/:pollId/open               10/60 s   event.moderate  webinarStaffResource
 * POST   /webinars/:id/polls/:pollId/close              10/60 s   event.moderate  webinarStaffResource
 * POST   /webinars/:id/polls/:pollId/vote               30/60 s   event.register  webinarRegistrantResource
 * GET    /webinars/:id/polls                                      authenticated   registrants and presenters: opened polls; moderating: all (service)
 * GET    /webinars/:id/polls/:pollId/results                      authenticated   a host or moderating, once closed (service)
 * POST   /webinars/:id/recording/stop                    5/60 s   event.moderate  webinarStaffResource (early stop, T-CW-2.5)
 * GET    /webinars/:id/recording                                  authenticated   a host, moderating staff or event.manage (service, T-CW-2.5)
 *
 * Deviations from the 7.3 table, each because the route serves more than
 * one role: `GET /webinars/:id`, `POST .../messages`, `GET .../messages`,
 * `POST .../join` and the floor routes are `@Authenticated()` and decide in
 * the service with `authorize()`, as 7.3 already does for start and end
 * (WBN-16, WBN-25, WBN-37: hosts hold no `event.register`, attendees no
 * `event.moderate`). The moderation routes resolve the occurrence by `:id`
 * (`webinarStaffResource`): there is no `:orgId` for
 * `orgResourceFromContext`. `GET /webinars/:id/recording` is an addition to
 * the decision record's route list (the hosts' and operations' view of the
 * pipeline, T-CW-2.5); `GET /webinars/:id/certificate` arrives with T-CW-3.3.
 *
 * Every authorization denial answers 404 (D-CW-30,
 * `AppointmentNonDisclosureFilter`); coded errors keep their status. There is
 * no roster route (WBN-08).
 */
import { Body, Controller, Delete, Get, Header, HttpCode, Param, Post, Query, UseFilters } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import {
  ACTIONS,
  WebinarListQuerySchema,
  WebinarMessageAnswerRequestSchema,
  WebinarMessageCreateRequestSchema,
  WebinarMessageListQuerySchema,
  WebinarMessagePublishRequestSchema,
  WebinarPollCreateRequestSchema,
  WebinarPollVoteRequestSchema,
  type Principal,
  type WebinarFloorMuteResponse,
  type WebinarFloorResponse,
  type WebinarFloorUnmuteResponse,
  type WebinarHandRaiseResponse,
  type WebinarJoinResponse,
  type WebinarListQuery,
  type WebinarListResponse,
  type WebinarMessage,
  type WebinarMessageAnswerRequest,
  type WebinarMessageCreateRequest,
  type WebinarMessageListQuery,
  type WebinarMessageListResponse,
  type WebinarMessagePublishRequest,
  type WebinarModerationMessage,
  type WebinarModerationMessageListResponse,
  type WebinarPoll,
  type WebinarPollCreateRequest,
  type WebinarPollListResponse,
  type WebinarPollResults,
  type WebinarPollVoteRequest,
  type WebinarPollVoteResponse,
  type WebinarRecordingStatusResponse,
  type WebinarRegistrationResponse,
  type WebinarResponse,
  type WebinarStatusResponse,
  type WebinarUnmuteRequestResponse,
} from '@nestself/contracts';
import { AppointmentNonDisclosureFilter } from '../appointments/appointment-non-disclosure.filter.js';
import { CurrentPrincipal } from '../auth/current-principal.decorator.js';
import { Authenticated } from '../authz/authenticated.decorator.js';
import { Authorize } from '../authz/authorize.decorator.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { WebinarRecordingService } from './recording.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { WebinarLiveService } from './webinar-live.service.js';
import { webinarListResource, webinarRegistrantResource, webinarStaffResource } from './webinar.resolver.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { WebinarsService } from './webinars.service.js';

const perMinute = (limit: number) => ({ default: { limit, ttl: 60_000 } });

/** An empty body may arrive as nothing at all (Express 5 leaves `req.body` undefined). */
const emptyBody = z.preprocess((value) => value ?? {}, z.strictObject({}));
const optionalBody = <T extends z.ZodType>(schema: T) => z.preprocess((value) => value ?? {}, schema);

@Controller('webinars')
@UseFilters(AppointmentNonDisclosureFilter)
export class WebinarsController {
  constructor(
    private readonly webinars: WebinarsService,
    private readonly live: WebinarLiveService,
    private readonly recording: WebinarRecordingService,
  ) {}

  // ── Discovery and registration ────────────────────────────────────────────

  @Get()
  @Authorize(ACTIONS['event.register'], webinarListResource)
  list(
    @Query(new ZodValidationPipe(WebinarListQuerySchema)) query: WebinarListQuery,
    @CurrentPrincipal() principal: Principal,
  ): Promise<WebinarListResponse> {
    return this.webinars.list(principal, query);
  }

  @Get(':id')
  @Authenticated()
  get(@Param('id') id: string, @CurrentPrincipal() principal: Principal): Promise<WebinarResponse> {
    return this.webinars.get(id, principal);
  }

  @Post(':id/register')
  @HttpCode(200)
  @Throttle(perMinute(10))
  @Authorize(ACTIONS['event.register'], webinarRegistrantResource)
  register(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(emptyBody)) _body: Record<string, never>,
    @CurrentPrincipal() principal: Principal,
  ): Promise<WebinarRegistrationResponse> {
    return this.webinars.register(id, principal);
  }

  @Delete(':id/register')
  @HttpCode(200)
  @Throttle(perMinute(10))
  @Authorize(ACTIONS['event.register'], webinarRegistrantResource)
  unregister(@Param('id') id: string, @CurrentPrincipal() principal: Principal): Promise<WebinarRegistrationResponse> {
    return this.webinars.unregister(id, principal);
  }

  // ── Live session ──────────────────────────────────────────────────────────

  @Post(':id/join')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Throttle(perMinute(20))
  @Authenticated()
  join(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(emptyBody)) _body: Record<string, never>,
    @CurrentPrincipal() principal: Principal,
  ): Promise<WebinarJoinResponse> {
    return this.webinars.join(id, principal);
  }

  @Post(':id/start')
  @HttpCode(200)
  @Throttle(perMinute(5))
  @Authenticated()
  start(@Param('id') id: string, @CurrentPrincipal() principal: Principal): Promise<WebinarStatusResponse> {
    return this.webinars.start(id, principal);
  }

  @Post(':id/end')
  @HttpCode(200)
  @Throttle(perMinute(5))
  @Authenticated()
  end(@Param('id') id: string, @CurrentPrincipal() principal: Principal): Promise<WebinarStatusResponse> {
    return this.webinars.end(id, principal);
  }

  // ── Chat (D-CW-35) ────────────────────────────────────────────────────────

  @Post(':id/messages')
  @HttpCode(201)
  @Throttle(perMinute(20))
  @Authenticated()
  createMessage(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(WebinarMessageCreateRequestSchema)) body: WebinarMessageCreateRequest,
    @CurrentPrincipal() principal: Principal,
  ): Promise<WebinarMessage | WebinarModerationMessage> {
    return this.live.createMessage(id, principal, body);
  }

  @Get(':id/messages')
  @Authenticated()
  listMessages(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(WebinarMessageListQuerySchema)) query: WebinarMessageListQuery,
    @CurrentPrincipal() principal: Principal,
  ): Promise<WebinarMessageListResponse | WebinarModerationMessageListResponse> {
    return this.live.listMessages(id, principal, query);
  }

  @Post(':id/messages/:messageId/publish')
  @HttpCode(200)
  @Throttle(perMinute(30))
  @Authorize(ACTIONS['event.moderate'], webinarStaffResource)
  publishMessage(
    @Param('id') id: string,
    @Param('messageId') messageId: string,
    @Body(new ZodValidationPipe(optionalBody(WebinarMessagePublishRequestSchema))) body: WebinarMessagePublishRequest,
    @CurrentPrincipal() principal: Principal,
  ): Promise<WebinarModerationMessage> {
    return this.live.publishMessage(id, messageId, principal, body);
  }

  @Post(':id/messages/:messageId/answer')
  @HttpCode(200)
  @Throttle(perMinute(30))
  @Authorize(ACTIONS['event.moderate'], webinarStaffResource)
  answerMessage(
    @Param('id') id: string,
    @Param('messageId') messageId: string,
    @Body(new ZodValidationPipe(WebinarMessageAnswerRequestSchema)) body: WebinarMessageAnswerRequest,
    @CurrentPrincipal() principal: Principal,
  ): Promise<WebinarModerationMessage> {
    return this.live.answerMessage(id, messageId, principal, body);
  }

  @Post(':id/messages/:messageId/dismiss')
  @HttpCode(200)
  @Throttle(perMinute(30))
  @Authorize(ACTIONS['event.moderate'], webinarStaffResource)
  dismissMessage(
    @Param('id') id: string,
    @Param('messageId') messageId: string,
    @Body(new ZodValidationPipe(emptyBody)) _body: Record<string, never>,
    @CurrentPrincipal() principal: Principal,
  ): Promise<WebinarModerationMessage> {
    return this.live.dismissMessage(id, messageId, principal);
  }

  // ── Hand-raise and floor (D-CW-15, D-CW-35) ───────────────────────────────

  @Post(':id/hand')
  @HttpCode(200)
  @Throttle(perMinute(10))
  @Authorize(ACTIONS['event.register'], webinarRegistrantResource)
  raiseHand(@Param('id') id: string, @CurrentPrincipal() principal: Principal): Promise<WebinarHandRaiseResponse> {
    return this.live.raiseHand(id, principal);
  }

  @Delete(':id/hand')
  @HttpCode(200)
  @Throttle(perMinute(10))
  @Authorize(ACTIONS['event.register'], webinarRegistrantResource)
  lowerHand(@Param('id') id: string, @CurrentPrincipal() principal: Principal): Promise<WebinarHandRaiseResponse> {
    return this.live.lowerHand(id, principal);
  }

  @Post(':id/participants/:participantId/give-floor')
  @HttpCode(200)
  @Throttle(perMinute(10))
  @Authenticated()
  giveFloor(
    @Param('id') id: string,
    @Param('participantId') participantId: string,
    @CurrentPrincipal() principal: Principal,
  ): Promise<WebinarFloorResponse> {
    return this.live.giveFloor(id, participantId, principal);
  }

  @Post(':id/participants/:participantId/take-floor')
  @HttpCode(200)
  @Throttle(perMinute(10))
  @Authenticated()
  takeFloor(
    @Param('id') id: string,
    @Param('participantId') participantId: string,
    @CurrentPrincipal() principal: Principal,
  ): Promise<WebinarFloorResponse> {
    return this.live.takeFloor(id, participantId, principal);
  }

  /** WBN-26: a host mutes the floor holder; the floor stays theirs (canonical addition, T-CW-2.1). */
  @Post(':id/participants/:participantId/mute')
  @HttpCode(200)
  @Throttle(perMinute(10))
  @Authenticated()
  muteFloor(
    @Param('id') id: string,
    @Param('participantId') participantId: string,
    @CurrentPrincipal() principal: Principal,
  ): Promise<WebinarFloorMuteResponse> {
    return this.live.muteFloor(id, participantId, principal);
  }

  /** WBN-26: a host asks the floor holder to unmute; only the attendee can (canonical addition, T-CW-2.1). */
  @Post(':id/participants/:participantId/unmute-request')
  @HttpCode(200)
  @Throttle(perMinute(10))
  @Authenticated()
  requestUnmute(
    @Param('id') id: string,
    @Param('participantId') participantId: string,
    @CurrentPrincipal() principal: Principal,
  ): Promise<WebinarUnmuteRequestResponse> {
    return this.live.requestUnmute(id, participantId, principal);
  }

  /** WBN-26: the attendee unmutes themselves while they hold the floor (canonical addition, T-CW-2.1). */
  @Post(':id/participants/:participantId/unmute')
  @HttpCode(200)
  @Throttle(perMinute(10))
  @Authorize(ACTIONS['event.register'], webinarRegistrantResource)
  unmuteFloor(
    @Param('id') id: string,
    @Param('participantId') participantId: string,
    @CurrentPrincipal() principal: Principal,
  ): Promise<WebinarFloorUnmuteResponse> {
    return this.live.unmuteFloor(id, participantId, principal);
  }

  // ── Polls (D-CW-16) ───────────────────────────────────────────────────────

  @Post(':id/polls')
  @HttpCode(201)
  @Throttle(perMinute(10))
  @Authorize(ACTIONS['event.moderate'], webinarStaffResource)
  createPoll(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(WebinarPollCreateRequestSchema)) body: WebinarPollCreateRequest,
    @CurrentPrincipal() principal: Principal,
  ): Promise<WebinarPoll> {
    return this.live.createPoll(id, principal, body);
  }

  @Post(':id/polls/:pollId/open')
  @HttpCode(200)
  @Throttle(perMinute(10))
  @Authorize(ACTIONS['event.moderate'], webinarStaffResource)
  openPoll(
    @Param('id') id: string,
    @Param('pollId') pollId: string,
    @CurrentPrincipal() principal: Principal,
  ): Promise<WebinarPoll> {
    return this.live.openPoll(id, pollId, principal);
  }

  @Post(':id/polls/:pollId/close')
  @HttpCode(200)
  @Throttle(perMinute(10))
  @Authorize(ACTIONS['event.moderate'], webinarStaffResource)
  closePoll(
    @Param('id') id: string,
    @Param('pollId') pollId: string,
    @CurrentPrincipal() principal: Principal,
  ): Promise<WebinarPollResults> {
    return this.live.closePoll(id, pollId, principal);
  }

  /** Poll state for late joiners and reloaded consoles (canonical addition, T-CW-2.1). */
  @Get(':id/polls')
  @Authenticated()
  listPolls(@Param('id') id: string, @CurrentPrincipal() principal: Principal): Promise<WebinarPollListResponse> {
    return this.live.listPolls(id, principal);
  }

  /** The hosts' results after the close (canonical addition, T-CW-2.1). */
  @Get(':id/polls/:pollId/results')
  @Authenticated()
  pollResults(
    @Param('id') id: string,
    @Param('pollId') pollId: string,
    @CurrentPrincipal() principal: Principal,
  ): Promise<WebinarPollResults> {
    return this.live.pollResults(id, pollId, principal);
  }

  @Post(':id/polls/:pollId/vote')
  @HttpCode(200)
  @Throttle(perMinute(30))
  @Authorize(ACTIONS['event.register'], webinarRegistrantResource)
  vote(
    @Param('id') id: string,
    @Param('pollId') pollId: string,
    @Body(new ZodValidationPipe(WebinarPollVoteRequestSchema)) body: WebinarPollVoteRequest,
    @CurrentPrincipal() principal: Principal,
  ): Promise<WebinarPollVoteResponse> {
    return this.live.vote(id, pollId, principal, body);
  }

  // ── Recording (D-CW-18, D-CW-34, WBN-28) ──────────────────────────────────

  /** The moderator's early stop; the start is automatic and there is no restart. */
  @Post(':id/recording/stop')
  @HttpCode(200)
  @Throttle(perMinute(5))
  @Authorize(ACTIONS['event.moderate'], webinarStaffResource)
  stopRecording(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(emptyBody)) _body: Record<string, never>,
    @CurrentPrincipal() principal: Principal,
  ): Promise<WebinarRecordingStatusResponse> {
    return this.recording.stopByModerator(id, principal);
  }

  @Get(':id/recording')
  @Authenticated()
  recordingStatus(@Param('id') id: string, @CurrentPrincipal() principal: Principal): Promise<WebinarRecordingStatusResponse> {
    return this.recording.status(id, principal);
  }
}
