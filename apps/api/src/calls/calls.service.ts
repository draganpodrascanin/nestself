/**
 * CallsService: the consultation call session (T-CW-1.1, NS-CALLS-01).
 *
 * - Join (`POST /appointments/:id/join`, D-CW-07, D-CW-08, guidelines 4.1 to
 *   4.3): the caller must be the appointment's expert or employee (404
 *   otherwise, D-CW-30), the appointment `confirmed` (409
 *   `appointment_not_joinable`) and the time inside the window (403
 *   `join_window_closed`). The session row is created PENDING on first use.
 *   The first joiner takes the `call:{sessionId}:create` lock, moves the
 *   session to CREATING, calls `createSession` (meeting plus attendee) and
 *   moves it to ACTIVE; a concurrent joiner polls for the meeting id for up
 *   to 3 seconds and then adds its attendee. Credentials are cached under
 *   `call:{sessionId}:participant:{participantId}` until the room closes, so
 *   a rejoin returns the same ones; after a cache loss on an active session a
 *   new attendee is issued for the same participant. `call.joined` is
 *   audited on every join, `call.session.created` once.
 *   The lock holds a random token and is released only by its holder. When a
 *   holder dies, the lock expires after 30 seconds (CW-R-12) and the next
 *   joiner takes over the stale CREATING row: `creating -> creating`, a
 *   transition CW-R-18 does not list (the guideline is being amended); the
 *   `ClientRequestToken` (the session id) keeps a second `CreateMeeting`
 *   from creating a second meeting.
 *   After a provider-side end (Chime ended an empty meeting, `end_reason`
 *   PROVIDER, T-CW-1.2) a join of a `confirmed` appointment inside the
 *   window starts a new session through the same lock flow, after dropping
 *   the dead meeting's cached credentials; any other ENDED session answers
 *   409.
 * - Location (CALL-34, CW-R-80a): the employee of a psychological
 *   consultation may share a location with the join. It is stored only once
 *   the session is ACTIVE, cleared when the session fails, ends or gets its
 *   outcome, readable by the assigned expert only through
 *   `GET /appointments/:id/location` while the session is live, and never
 *   logged, audited or shown in diagnostics.
 * - End (`POST /appointments/:id/end`, D-CW-09): the expert only; stamps
 *   the EXPERT end reason before deleting the meeting (so a `MeetingEnded`
 *   event that commits first keeps it), closes the session, drops every
 *   cached credential and the location text, emits `call.session.ended`,
 *   audits `call.ended`. When the provider event or a job closed the session
 *   first, that closer announced the end and `call.ended` is still audited
 *   for the expert with `closedBy`.
 * - Outcome (`POST /appointments/:id/outcome`, CALL-23): the expert records
 *   the delivery status with connection metadata on the latest session (a
 *   FAILED one included, so a technical failure stays with the attempt that
 *   failed); the appointment moves out of `confirmed` in the same
 *   transaction. `no_show_employee` schedules `calls.no_show_followup`
 *   (CALL-07).
 * - Feedback (`POST /appointments/:id/feedback`, CALL-15): the employee who
 *   joined, once per session; never readable by the employer or the expert.
 * - Signal (`POST /appointments/:id/signal`, D-CW-27): emitted as
 *   `call.signal` on `call:{sessionId}`, never persisted.
 * - Room (T-CW-1.6, D-CW-16): registers the `call:{sessionId}` resolver
 *   with `RoomAccessRegistry`. A subscription is authorised as
 *   `consultation.join` on the session's appointment, derived here, and only
 *   for the appointment's expert or employee; anyone else reads as an
 *   unknown room. The room carries the `ROOM_EVENTS` call events
 *   (`call.participant.joined`, `call.participant.left`, `call.session.ended`,
 *   `call.signal`, `call.location.shared` and the four follow-up events),
 *   each payload checked against its schema by `RoomEmitter` (CW-R-36).
 * - Client events (`POST /calls/:sessionId/client-events`, D-CW-13).
 * - Diagnostics (`GET /ops/calls/:sessionId/diagnostics`, D-CW-28).
 *
 * - Metrics (D-CW-13): `JoinAttempts`, `JoinFailures`,
 *   `MeetingStartDurationMs` and `MeetingFailed` on `NestSelf/Video`
 *   (`VideoMetrics`).
 *
 * A join token never reaches PostgreSQL, a log line, an audit `details`
 * object or a room event (CW-R-13, CW-R-69). Logs carry the session id,
 * participant id, operation and latency (guidelines 16.1). Reads run in the
 * organization's RLS scope wherever the organization is already known.
 */
import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ConfigService } from '@nestjs/config';
import {
  ACTIONS,
  CALL_TICKET_TTL_SECONDS,
  CallJoinResponseSchema,
  CallLocationResponseSchema,
  CallSignalPayloadSchema,
  SupportAreaSchema,
  VideoProviderNameSchema,
  canTransitionAppointment,
  type ApiErrorCode,
  type AppointmentResponse,
  type CallFeedbackRequest,
  type CallJoinRequest,
  type CallJoinResponse,
  type CallLocationResponse,
  type CallOutcomeRequest,
  type CallParticipantRole,
  type CallSignalRequest,
  type ClientEventBatchRequest,
  type DiagnosticsResponse,
  type FollowUpConfirmedPayload,
  type FollowUpDeclinedPayload,
  type FollowUpProposedPayload,
  type Principal,
  type TimesSuggestedPayload,
} from '@nestself/contracts';
import { ApiHttpException } from '../common/api-error.js';
import { ParticipantForbiddenException } from '../appointments/appointment-non-disclosure.filter.js';
import { appointmentResourceOf, toAppointmentResponse } from '../appointments/appointment-mapper.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { AppointmentsRepository, type AppointmentRecord } from '../appointments/appointments.repository.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { AuditWriter, type AuditEventInput } from '../audit/audit-writer.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { DbService, type DbExecutor } from '../db/db.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { CallsJobSchedulerService } from '../jobs/calls-job-scheduler.service.js';
import { KEY_VALUE_STORE, type KeyValueStore } from '../redis/key-value-store.js';
import { callCreateLockKey, callParticipantCredentialsKey } from '../redis/redis-keys.js';
import {
  VIDEO_PROVIDER,
  videoProviderUnavailable,
  type ProviderSession,
  type VideoProvider,
} from '../video/video-provider.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { RoomAccessRegistry, type RoomTarget } from '../ws/room-access.registry.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { RoomEmitter } from '../ws/room-emitter.js';
import {
  APPOINTMENT_STATUS_FOR_OUTCOME,
  callRoom,
  credentialsTtlSeconds,
  isWithinJoinWindow,
  parseCachedCredentials,
  serialiseCredentials,
  toDiagnosticsResponse,
  type CachedCredentials,
} from './call-mapper.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import {
  CallsRepository,
  type CallParticipantRecord,
  type CallSessionEndReason,
  type CallSessionRecord,
} from './calls.repository.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { VideoMetrics } from './video-metrics.js';
import { appointmentOfCallSession } from './call-session.resolver.js';

/** A consultation is one expert and one employee (D-CW-02). */
const CONSULTATION_CAPACITY = 2;
/** The category whose employee may share a location before joining (CALL-34). */
const PSYCHOLOGICAL_CATEGORY = SupportAreaSchema.enum.psychological;
/** CW-R-12: the creation lock lives as long as a call ticket, 30 seconds. */
const CREATE_LOCK_TTL_SECONDS = CALL_TICKET_TTL_SECONDS;

type ConsultationRole = Extract<CallParticipantRole, 'expert' | 'employee'>;

interface Participation {
  appointment: AppointmentRecord;
  role: ConsultationRole;
}

function apiError(
  status: number,
  code: ApiErrorCode,
  message: string,
  details?: Record<string, unknown>,
): ApiHttpException {
  return new ApiHttpException({ status, code, message, details });
}

function notFound(): ApiHttpException {
  return apiError(404, 'not_found', 'Resource not found');
}

function notJoinable(): ApiHttpException {
  return apiError(409, 'appointment_not_joinable', 'The appointment does not allow this in its current status');
}

function windowClosed(): ApiHttpException {
  return apiError(403, 'join_window_closed', 'The join window for this session is not open');
}

function errorName(error: unknown): string {
  if (error instanceof ApiHttpException) return error.code;
  return error instanceof Error ? error.name : 'UnknownError';
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

@Injectable()
export class CallsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CallsService.name);

  /** Interval and limit of the lock loser's wait for the meeting id (guidelines 4.1). Tests shorten them. */
  pollIntervalMs = 200;
  pollTimeoutMs = 3_000;

  constructor(
    private readonly repo: CallsRepository,
    private readonly appointments: AppointmentsRepository,
    private readonly dbs: DbService,
    @Inject(VIDEO_PROVIDER) private readonly video: VideoProvider,
    @Inject(KEY_VALUE_STORE) private readonly kv: KeyValueStore,
    private readonly rooms: RoomEmitter,
    private readonly audit: AuditWriter,
    private readonly config: ConfigService,
    private readonly roomAccess: RoomAccessRegistry,
    private readonly scheduler: CallsJobSchedulerService,
    private readonly metrics: VideoMetrics,
  ) {}

  onModuleInit(): void {
    this.roomAccess.register('call', (sessionId, principal) => this.callRoomTarget(sessionId, principal));
  }

  onModuleDestroy(): void {
    this.roomAccess.unregister('call');
  }

  // ── Join ──────────────────────────────────────────────────────────────────

  async join(appointmentId: string, principal: Principal, body: CallJoinRequest): Promise<CallJoinResponse> {
    const started = Date.now();
    const { appointment, role } = await this.participation(appointmentId, principal);
    this.assertJoinable(appointment);
    if (body.locationText !== undefined && !(role === 'employee' && appointment.serviceCategory === PSYCHOLOGICAL_CATEGORY)) {
      throw apiError(400, 'validation', 'Only the employee of a psychological consultation can share a location', {
        field: 'locationText',
      });
    }

    // A join attempt from here on: the caller asks for media credentials (D-CW-13).
    this.metrics.joinAttempt();
    try {
      return await this.joinSession(appointment, role, principal, body, started);
    } catch (error) {
      this.metrics.joinFailure();
      throw error;
    }
  }

  private async joinSession(
    appointment: AppointmentRecord,
    role: ConsultationRole,
    principal: Principal,
    body: CallJoinRequest,
    started: number,
  ): Promise<CallJoinResponse> {
    const session = await this.joinableSession(appointment);
    const participant = await this.scoped(appointment.orgId, (tx) =>
      this.repo.ensureParticipant({ sessionId: session.id, orgId: appointment.orgId, userId: principal.userId, role }, tx),
    );

    let path: 'cached' | 'attendee' | 'meeting';
    let credentials: CachedCredentials;
    if (session.status === 'active') {
      const cached = parseCachedCredentials(await this.kv.get(callParticipantCredentialsKey(session.id, participant.id)));
      if (cached) {
        path = 'cached';
        credentials = cached;
      } else {
        path = 'attendee';
        credentials = await this.addAttendee(session, participant);
      }
    } else {
      ({ path, credentials } = await this.createOrWait(session, participant, appointment));
    }

    // Only now is the session ACTIVE: a location never lands on a row that fails or never starts (CW-R-80a).
    if (body.locationText !== undefined) {
      const locationText = body.locationText;
      const stored = await this.scoped(appointment.orgId, (tx) =>
        this.repo.setLocationTextIfActive(session.id, locationText, tx),
      );
      // Content free: the expert's client reads GET /appointments/:id/location (CALL-34).
      if (stored) this.rooms.emit(callRoom(session.id), 'call.location.shared', { sessionId: session.id });
    }

    await this.record(principal.userId, appointment.orgId, session.id, 'call.joined', {
      sessionId: session.id,
      participantId: participant.id,
      role,
    });
    this.rooms.emit(callRoom(session.id), 'call.participant.joined', { participantId: participant.id, role });
    this.logger.log(
      { sessionId: session.id, participantId: participant.id, operation: 'join', path, latencyMs: Date.now() - started },
      'Call joined',
    );

    return CallJoinResponseSchema.parse({
      sessionId: session.id,
      participantId: participant.id,
      role,
      format: session.format,
      startsAt: session.startsAt.toISOString(),
      endsAt: session.endsAt.toISOString(),
      meeting: credentials.meeting,
      attendee: credentials.attendee,
    });
  }

  /**
   * The session a join enters: the live one, or a new PENDING one when the
   * provider ended the last meeting on its own inside the window (T-CW-1.2).
   * The caller has already checked that the appointment is `confirmed` and
   * the window open. Any other ENDED session answers 409.
   */
  private async joinableSession(appointment: AppointmentRecord): Promise<CallSessionRecord> {
    const session = await this.ensureSession(appointment);
    if (session.status !== 'ended') return session;
    if (session.endReason !== 'provider') throw notJoinable();

    // The dead meeting's credentials must never be handed out again (D-CW-08); the applier may not have dropped them.
    await this.dropCredentials(session);
    const next = await this.dbs.withOrgScope(appointment.orgId, (tx) =>
      this.repo.createSessionForAppointment(appointment, tx),
    );
    if (next.status === 'ended') throw notJoinable();
    this.logger.log(
      { sessionId: next.id, operation: 'reopen', previousSessionId: session.id },
      'Call session reopened after a provider end',
    );
    return next;
  }

  /**
   * First-join creation under the `call:{sessionId}:create` lock (D-CW-07). The
   * winner creates the meeting; a loser waits for the winner's meeting id and
   * adds its attendee. The winner re-reads the session first, because a
   * previous winner may have finished between this caller's read and its lock.
   */
  private async createOrWait(
    session: CallSessionRecord,
    participant: CallParticipantRecord,
    appointment: AppointmentRecord,
  ): Promise<{ path: 'attendee' | 'meeting'; credentials: CachedCredentials }> {
    const lockKey = callCreateLockKey(session.id);
    const lockToken = randomUUID();
    const won = await this.kv.set(lockKey, lockToken, { onlyIfAbsent: true, ttlSeconds: CREATE_LOCK_TTL_SECONDS });
    if (!won) {
      const active = await this.waitForMeeting(session);
      return { path: 'attendee', credentials: await this.addAttendee(active, participant) };
    }
    try {
      const current = await this.scoped(session.orgId, (tx) => this.repo.findSessionById(session.id, tx));
      if (current?.status === 'active') {
        return { path: 'attendee', credentials: await this.addAttendee(current, participant) };
      }
      if (!current || current.status === 'ended') throw notJoinable();
      if (current.status === 'failed') throw videoProviderUnavailable();
      return { path: 'meeting', credentials: await this.createMeeting(current, participant, appointment) };
    } finally {
      await this.releaseLock(lockKey, lockToken);
    }
  }

  /**
   * Deletes the lock only while it still holds this caller's token: after a
   * slow provider call the lock may have expired and been taken by another
   * joiner. The store has no compare-and-delete, so a takeover in the gap
   * between the read and the delete is still possible; the lock then simply
   * ends early, and the meeting id is already the signal for waiters. A
   * failure here is left to the TTL.
   */
  private async releaseLock(lockKey: string, lockToken: string): Promise<void> {
    try {
      if ((await this.kv.get(lockKey)) === lockToken) await this.kv.del(lockKey);
    } catch {
      // The lock expires on its own (CW-R-12).
    }
  }

  /** PENDING or a stale CREATING to CREATING, `createSession`, then ACTIVE with the meeting id. */
  private async createMeeting(
    session: CallSessionRecord,
    participant: CallParticipantRecord,
    appointment: AppointmentRecord,
  ): Promise<CachedCredentials> {
    const orgId = appointment.orgId;
    const creating = await this.scoped(orgId, (tx) =>
      this.repo.transitionSession(session.id, ['pending', 'creating'], 'creating', {}, tx),
    );
    if (!creating) throw videoProviderUnavailable();

    const started = Date.now();
    let created: ProviderSession;
    try {
      created = await this.video.createSession({
        sessionId: session.id,
        format: 'consultation',
        capacity: CONSULTATION_CAPACITY,
        orgId,
        webinarId: null,
        participant: { participantId: participant.id, role: participant.role },
      });
    } catch (error) {
      this.metrics.meetingFailed();
      await this.scoped(orgId, (tx) =>
        this.repo.transitionSession(session.id, ['creating'], 'failed', { locationText: null }, tx),
      );
      this.logger.error(
        {
          sessionId: session.id,
          participantId: participant.id,
          operation: 'createSession',
          latencyMs: Date.now() - started,
          error: errorName(error),
        },
        'Call session creation failed',
      );
      throw error;
    }
    this.metrics.meetingStartDuration(Date.now() - started);

    const active = await this.scoped(orgId, async (tx) => {
      const moved = await this.repo.transitionSession(
        session.id,
        ['creating'],
        'active',
        { providerMeetingId: created.providerMeetingId, startedAt: new Date() },
        tx,
      );
      if (moved) await this.repo.setProviderAttendee(participant.id, created.participant.providerAttendeeId, tx);
      return moved;
    });
    if (!active) {
      // The lock expired while the provider was slow and another joiner finished first (CW-R-12).
      const current = await this.scoped(orgId, (tx) => this.repo.findSessionById(session.id, tx));
      if (current?.status !== 'active' || !current.providerMeetingId) throw videoProviderUnavailable();
      if (current.providerMeetingId !== created.providerMeetingId) {
        await this.video.endSession({ providerMeetingId: created.providerMeetingId });
      }
      return this.addAttendee(current, participant);
    }

    // The first joiner's request created it.
    await this.record(participant.userId, orgId, session.id, 'call.session.created', {
      sessionId: session.id,
      appointmentId: appointment.id,
      format: active.format,
    });
    const credentials = serialiseCredentials({ meeting: created.meeting, attendee: created.participant.attendee });
    await this.cacheCredentials(active, participant, credentials);
    return credentials;
  }

  /** The lock loser's wait: the session's meeting id, polled for up to `pollTimeoutMs` (guidelines 4.1). */
  private async waitForMeeting(session: CallSessionRecord): Promise<CallSessionRecord> {
    const sessionId = session.id;
    const attempts = Math.max(1, Math.ceil(this.pollTimeoutMs / this.pollIntervalMs));
    for (let attempt = 0; attempt <= attempts; attempt += 1) {
      const current = await this.scoped(session.orgId, (tx) => this.repo.findSessionById(sessionId, tx));
      if (current?.status === 'active' && current.providerMeetingId) return current;
      if (!current || current.status === 'failed') throw videoProviderUnavailable();
      if (current.status === 'ended') throw notJoinable();
      if (attempt < attempts) await sleep(this.pollIntervalMs);
    }
    this.logger.warn({ sessionId, operation: 'waitForMeeting', latencyMs: this.pollTimeoutMs }, 'No meeting in time');
    throw videoProviderUnavailable();
  }

  /** A new attendee in the session's meeting for this participant, cached (`CreateAttendee`). */
  private async addAttendee(session: CallSessionRecord, participant: CallParticipantRecord): Promise<CachedCredentials> {
    const providerMeetingId = session.providerMeetingId;
    if (!providerMeetingId) throw videoProviderUnavailable();
    const info = await this.video.describeSession({ providerMeetingId });
    if (!info) throw notJoinable();
    const added = await this.video.createParticipant({
      providerMeetingId,
      participantId: participant.id,
      role: participant.role,
    });
    await this.scoped(session.orgId, (tx) =>
      this.repo.setProviderAttendee(participant.id, added.providerAttendeeId, tx),
    );
    const credentials = serialiseCredentials({ meeting: info.meeting, attendee: added.attendee });
    await this.cacheCredentials(session, participant, credentials);
    return credentials;
  }

  private async cacheCredentials(
    session: CallSessionRecord,
    participant: CallParticipantRecord,
    credentials: CachedCredentials,
  ): Promise<void> {
    await this.kv.set(callParticipantCredentialsKey(session.id, participant.id), JSON.stringify(credentials), {
      ttlSeconds: credentialsTtlSeconds(session.endsAt, new Date()),
    });
  }

  // ── End (D-CW-09) ─────────────────────────────────────────────────────────

  async end(appointmentId: string, principal: Principal): Promise<void> {
    const { appointment, role } = await this.participation(appointmentId, principal);
    if (role !== 'expert') throw new ParticipantForbiddenException('Only the expert can end the session for everyone');

    const session = await this.scoped(appointment.orgId, (tx) =>
      this.repo.findLiveSessionByAppointment(appointment.id, tx),
    );
    if (session?.status === 'ended') return;
    if (session?.status !== 'active' || !session.providerMeetingId) throw notJoinable();

    const started = Date.now();
    // Stamped before the provider call, so the MeetingEnded event that DeleteMeeting raises, if it
    // commits first, records the end as the expert's and never as a provider-side end (T-CW-1.2).
    const stamped = await this.scoped(appointment.orgId, (tx) => this.repo.stampEndReason(session.id, 'expert', tx));
    await this.video.endSession({ providerMeetingId: session.providerMeetingId });
    const ended = await this.scoped(appointment.orgId, (tx) =>
      this.repo.closeSession(session.id, { endedAt: new Date(), reason: 'expert' }, tx),
    );

    if (!ended) {
      // The provider event (or a job) closed it first and announced the end; the expert's action is still audited.
      const current = await this.scoped(appointment.orgId, (tx) => this.repo.findSessionById(session.id, tx));
      const closedBy: CallSessionEndReason = stamped ? 'provider' : (current?.endReason ?? 'provider');
      await this.record(principal.userId, appointment.orgId, session.id, 'call.ended', {
        sessionId: session.id,
        endedByUserId: principal.userId,
        closedBy,
      });
      this.logger.log({ sessionId: session.id, operation: 'end', closedBy, latencyMs: Date.now() - started }, 'Call ended');
      return;
    }

    await this.dropCredentials(ended);
    this.rooms.emit(callRoom(session.id), 'call.session.ended', {
      sessionId: session.id,
      endedAt: (ended.endedAt ?? new Date()).toISOString(),
    });
    await this.record(principal.userId, appointment.orgId, session.id, 'call.ended', {
      sessionId: session.id,
      endedByUserId: principal.userId,
    });
    this.logger.log({ sessionId: session.id, operation: 'end', latencyMs: Date.now() - started }, 'Call ended');
  }

  /** Deletes every participant's cached credentials of the session (D-CW-08). */
  private async dropCredentials(session: Pick<CallSessionRecord, 'id' | 'orgId'>): Promise<void> {
    const participants = await this.scoped(session.orgId, (tx) => this.repo.listParticipants(session.id, tx));
    if (participants.length > 0) {
      await this.kv.del(...participants.map((p) => callParticipantCredentialsKey(session.id, p.id)));
    }
  }

  /**
   * Tells the call room a participant left. The provider's `AttendeeLeft`
   * and `AttendeeDropped` events reach it through the event applier
   * (T-CW-1.2); there is no leave route.
   */
  notifyParticipantLeft(sessionId: string, participant: Pick<CallParticipantRecord, 'id' | 'role'>): void {
    this.rooms.emit(callRoom(sessionId), 'call.participant.left', {
      participantId: participant.id,
      role: participant.role,
    });
  }

  // ── Outcome (CALL-23, CALL-24) ────────────────────────────────────────────

  async recordOutcome(appointmentId: string, principal: Principal, body: CallOutcomeRequest): Promise<AppointmentResponse> {
    const { appointment, role } = await this.participation(appointmentId, principal);
    if (role !== 'expert') throw new ParticipantForbiddenException('Only the expert records the outcome');
    const target = APPOINTMENT_STATUS_FOR_OUTCOME[body.status];
    if (!canTransitionAppointment(appointment.status, target)) throw notJoinable();

    // The latest session, a FAILED one included (a technical failure stays with the attempt that
    // failed); a new PENDING row only when nobody ever joined (a no-show).
    const latest = await this.scoped(appointment.orgId, (tx) =>
      this.repo.findLatestSessionByAppointment(appointment.id, tx),
    );
    const session = latest ?? (await this.ensureSession(appointment));
    const connectionMetrics = await this.scoped(appointment.orgId, (tx) =>
      this.repo.connectionMetrics(session, new Date(), tx),
    );
    const updated = await this.dbs.withOrgScope(appointment.orgId, async (tx) => {
      const moved = await this.appointments.transitionStatus(appointment.id, target, tx);
      if (!moved) return null;
      // The location lives no longer than the session's use (CW-R-80a), even without an explicit end.
      await this.repo.setLocationText(session.id, null, tx);
      await this.repo.insertOutcome(
        {
          sessionId: session.id,
          orgId: appointment.orgId,
          status: body.status,
          recordedByUserId: principal.userId,
          connectionMetrics,
        },
        tx,
      );
      return moved;
    });
    // Another request moved the appointment first.
    if (!updated) throw notJoinable();

    await this.record(principal.userId, appointment.orgId, session.id, 'call.outcome.recorded', {
      sessionId: session.id,
      outcomeStatus: body.status,
    });
    await this.recordAppointmentTransition(principal, updated, body);
    if (body.status === 'no_show_employee') await this.scheduleNoShowFollowUp(appointment.id);
    return toAppointmentResponse(updated);
  }

  /** `calls.no_show_followup` (CALL-07): best effort after the commit; the outcome stands either way. */
  private async scheduleNoShowFollowUp(appointmentId: string): Promise<void> {
    try {
      const scheduled = await this.scheduler.scheduleNoShowFollowUp(appointmentId);
      if (!scheduled) this.logger.warn({ appointmentId, operation: 'scheduleNoShowFollowUp' }, 'No-show follow-up not scheduled');
    } catch (error) {
      this.logger.error(
        { appointmentId, operation: 'scheduleNoShowFollowUp', error: errorName(error) },
        'No-show follow-up not scheduled',
      );
    }
  }

  private async recordAppointmentTransition(
    principal: Principal,
    appointment: AppointmentRecord,
    body: CallOutcomeRequest,
  ): Promise<void> {
    const base = {
      actorUserId: principal.userId,
      actorKind: 'USER',
      orgId: appointment.orgId,
      recordType: 'appointment',
      recordId: appointment.id,
      result: 'ALLOWED',
    } as const;
    switch (appointment.status) {
      case 'completed':
        await this.audit.record({ ...base, action: 'appointment.completed', details: { appointmentId: appointment.id } });
        return;
      case 'no_show':
        await this.audit.record({
          ...base,
          action: 'appointment.no_show',
          details: { appointmentId: appointment.id, status: body.status },
        });
        return;
      case 'canceled':
        await this.audit.record({
          ...base,
          action: 'appointment.canceled',
          details: { appointmentId: appointment.id, canceledByUserId: principal.userId },
        });
        return;
      default:
        return;
    }
  }

  // ── Location (CALL-34 criterion 3) ────────────────────────────────────────

  /**
   * The location the employee shared, for the assigned expert only, while the
   * session is live: null before it is shared, 409 once the session ended.
   * Never logged. `join` pushes a content-free `call.location.shared` event
   * on `call:{sessionId}` when it stores one, so the expert client refetches
   * this route.
   */
  async location(appointmentId: string, principal: Principal): Promise<CallLocationResponse> {
    const { appointment, role } = await this.participation(appointmentId, principal);
    if (role !== 'expert') throw new ParticipantForbiddenException('Only the expert reads the shared location');
    const session = await this.scoped(appointment.orgId, (tx) =>
      this.repo.findLiveSessionByAppointment(appointment.id, tx),
    );
    if (session?.status === 'ended') throw notJoinable();
    return CallLocationResponseSchema.parse({ locationText: session?.locationText ?? null });
  }

  // ── Feedback (CALL-15) ────────────────────────────────────────────────────

  async submitFeedback(appointmentId: string, principal: Principal, body: CallFeedbackRequest): Promise<void> {
    const { appointment, role } = await this.participation(appointmentId, principal);
    if (role !== 'employee') throw new ParticipantForbiddenException('Only the employee gives feedback');

    const { session, participant } = await this.scoped(appointment.orgId, async (tx) => {
      const live = await this.repo.findLiveSessionByAppointment(appointment.id, tx);
      return { session: live, participant: live ? await this.repo.findParticipant(live.id, principal.userId, tx) : null };
    });
    // Nothing to give feedback on before the employee has joined.
    if (!session || !participant) throw notJoinable();

    const comment = body.comment ? body.comment : null;
    const inserted = await this.scoped(appointment.orgId, (tx) =>
      this.repo.insertFeedback(
        { sessionId: session.id, orgId: appointment.orgId, userId: principal.userId, score: body.score, comment },
        tx,
      ),
    );
    if (!inserted) throw apiError(409, 'conflict', 'Feedback for this session was already submitted');

    await this.record(principal.userId, appointment.orgId, session.id, 'call.feedback.submitted', {
      sessionId: session.id,
    });
  }

  // ── Signal (D-CW-27, CW-R-35) ─────────────────────────────────────────────

  async signal(appointmentId: string, principal: Principal, body: CallSignalRequest): Promise<void> {
    const { appointment, role } = await this.participation(appointmentId, principal);
    if (body.type === 'running_late' && role !== 'expert') {
      throw new ParticipantForbiddenException('Only the expert sends a running-late signal');
    }
    this.assertJoinable(appointment);

    // The room is the session's: a running-late signal can precede every join.
    const session = await this.ensureSession(appointment);
    if (session.status === 'ended') throw notJoinable();
    const payload = CallSignalPayloadSchema.parse({ type: body.type, etaMinutes: body.etaMinutes, fromRole: role });
    this.rooms.emit(callRoom(session.id), 'call.signal', payload);
    this.logger.log({ sessionId: session.id, operation: 'signal', signal: body.type }, 'Call signal sent');
  }

  // ── Room (T-CW-1.6, D-CW-16, D-CW-37) ────────────────────────────────────

  /**
   * The `call:{sessionId}` subscription target: `consultation.join` on the
   * session's appointment, derived here from the database, never from the
   * client, through the same lookup as `callSessionResource`. Null (read as
   * `not_found`) for an unknown session, one without an appointment, and
   * anyone who is not the appointment's expert or employee, whatever their
   * grants. Not bound to the session status: the post-call screens subscribe
   * after the end for the follow-up events (D-CW-37).
   *
   * Membership is checked at subscription and on every re-authorisation,
   * which `invalidate { userId }` triggers. Whatever reassigns an
   * appointment's expert (the booking epic) must therefore publish
   * `invalidate { userId: <old expert> }`, or the old expert keeps the room
   * until they resubscribe.
   */
  private async callRoomTarget(sessionId: string, principal: Principal): Promise<RoomTarget | null> {
    const appointment = await appointmentOfCallSession(
      {
        findSessionById: (id) => this.repo.findSessionById(id),
        findAppointmentById: (id) => this.appointments.findById(id),
      },
      sessionId,
    );
    if (!appointment) return null;
    if (principal.userId !== appointment.expertUserId && principal.userId !== appointment.employeeUserId) return null;
    return { action: ACTIONS['consultation.join'], resource: appointmentResourceOf(appointment) };
  }

  /**
   * Follow-up events on `call:{sessionId}` (D-CW-37), for the follow-up
   * routes of T-CW-1.9. `appointmentId` is the finished appointment and
   * `followUpId` the proposed one. Ids, statuses and times only; false when
   * the payload fails its schema or no Socket.IO server runs.
   */
  emitFollowUpProposed(sessionId: string, payload: FollowUpProposedPayload): boolean {
    return this.rooms.emit(callRoom(sessionId), 'appointment.follow_up.proposed', payload);
  }

  emitFollowUpConfirmed(sessionId: string, payload: FollowUpConfirmedPayload): boolean {
    return this.rooms.emit(callRoom(sessionId), 'appointment.follow_up.confirmed', payload);
  }

  emitFollowUpDeclined(sessionId: string, payload: FollowUpDeclinedPayload): boolean {
    return this.rooms.emit(callRoom(sessionId), 'appointment.follow_up.declined', payload);
  }

  emitTimesSuggested(sessionId: string, payload: TimesSuggestedPayload): boolean {
    return this.rooms.emit(callRoom(sessionId), 'appointment.times_suggested', payload);
  }

  // ── Client events (D-CW-13) ───────────────────────────────────────────────

  async recordClientEvents(sessionId: string, principal: Principal, body: ClientEventBatchRequest): Promise<void> {
    const session = await this.repo.findSessionById(sessionId);
    if (!session) throw notFound();
    const participant = await this.scoped(session.orgId, (tx) =>
      this.repo.findParticipant(session.id, principal.userId, tx),
    );
    if (!participant) throw notFound();

    const rows = body.events.map((event) => ({
      sessionId: session.id,
      orgId: session.orgId,
      participantId: participant.id,
      eventName: event.eventName,
      durationMs: event.durationMs ?? null,
      metrics: event.metrics ?? null,
      deviceError: event.deviceError ?? null,
      browser: event.browser ?? null,
      os: event.os ?? null,
    }));
    await this.scoped(session.orgId, (tx) => this.repo.insertClientEvents(rows, tx));
  }

  // ── Diagnostics (D-CW-28) ─────────────────────────────────────────────────

  async diagnostics(sessionId: string, principal: Principal): Promise<DiagnosticsResponse> {
    const session = await this.repo.findSessionById(sessionId);
    if (!session) throw notFound();
    const { participants, clientSummaries, providerCodes } = await this.scoped(session.orgId, async (tx) => ({
      participants: await this.repo.listParticipants(session.id, tx),
      clientSummaries: await this.repo.clientEventSummaries(session.id, tx),
      providerCodes: await this.repo.providerErrorCodes(session.id, tx),
    }));
    const provider = VideoProviderNameSchema.catch('none').parse(this.config.get('VIDEO_PROVIDER'));
    const response = toDiagnosticsResponse(session, participants, clientSummaries, providerCodes, provider);

    await this.record(principal.userId, session.orgId, session.id, 'call.diagnostics.viewed', {
      sessionId: session.id,
      viewedByUserId: principal.userId,
    });
    return response;
  }

  // ── Shared ────────────────────────────────────────────────────────────────

  /** The caller's role on the appointment; 404 for anyone else, as for a missing appointment (D-CW-30). */
  private async participation(appointmentId: string, principal: Principal): Promise<Participation> {
    const appointment = await this.appointments.findById(appointmentId);
    if (!appointment) throw notFound();
    if (appointment.expertUserId === principal.userId) return { appointment, role: 'expert' };
    if (appointment.employeeUserId === principal.userId) return { appointment, role: 'employee' };
    throw notFound();
  }

  /** 409 unless `confirmed` (CALL-20), then 403 outside the window (CALL-07). */
  private assertJoinable(appointment: AppointmentRecord): void {
    if (appointment.status !== 'confirmed') throw notJoinable();
    if (!isWithinJoinWindow(appointment, new Date())) throw windowClosed();
  }

  /** The appointment's live session, created PENDING on first use. */
  private async ensureSession(appointment: AppointmentRecord): Promise<CallSessionRecord> {
    return this.dbs.withOrgScope(appointment.orgId, async (tx) => {
      const existing = await this.repo.findLiveSessionByAppointment(appointment.id, tx);
      return existing ?? this.repo.createSessionForAppointment(appointment, tx);
    });
  }

  /** A read or write in the organization's RLS scope; system context for a session without one (webinars open to all). */
  private scoped<T>(orgId: string | null, fn: (tx: DbExecutor | undefined) => Promise<T>): Promise<T> {
    return orgId ? this.dbs.withOrgScope(orgId, fn) : fn(undefined);
  }

  /** A call audit event; `details` carries identifiers only (CW-R-33a). */
  private record(
    actorUserId: string,
    orgId: string | null,
    sessionId: string,
    action: AuditEventInput['action'],
    details: Record<string, unknown>,
  ): Promise<void> {
    return this.audit.record({
      action,
      actorUserId,
      actorKind: 'USER',
      orgId,
      recordType: 'call_session',
      recordId: sessionId,
      result: 'ALLOWED',
      details,
    });
  }
}
