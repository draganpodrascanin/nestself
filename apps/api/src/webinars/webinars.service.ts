/**
 * WebinarsService: discovery, registration and the live session of a
 * webinar (T-CW-2.1, D-CW-14 to D-CW-18, D-CW-34, D-CW-35).
 *
 * - List and detail (`GET /webinars`, `GET /webinars/:id`, WBN-01): only
 *   occurrences whose audience includes the caller, filtered in SQL against
 *   their memberships (CW-R-32); title per locale, presenter display names,
 *   schedule, capacity remaining and the caller's own registration. No
 *   audience policy, organisation, host user id or roster (D-CW-15). The
 *   detail also serves the occurrence's hosts and moderating staff.
 * - Register (WBN-02): `SELECT ... FOR UPDATE` on the occurrence row, then
 *   the status (`webinar_not_open` before publication or after
 *   cancellation, `registration_closed` once live, ended or past its end),
 *   the audience (403 `not_eligible`), a duplicate (409
 *   `already_registered`) and the capacity (409 `webinar_full`), in one
 *   transaction (CW-R-31). Then `webinar.registered`, the reminder jobs and
 *   the confirmation email with the recording notice (WBN-04, WBN-05).
 * - Unregister (WBN-03): only while `published` (409 `registration_closed`
 *   after); the reminder jobs are removed by id (CW-R-37a).
 * - Join (WBN-07, WBN-16, guidelines 4.8): hosts (a presenter with
 *   `event.present`, the moderator with `event.moderate`) from 30 minutes
 *   before the start while `published` or `live`; attendees with an active
 *   registration, still in the audience (D-CW-17), from 15 minutes before
 *   and only once a host has started the webinar and opened the meeting
 *   (409 `webinar_not_open` is the lobby). The room closes 15 minutes after
 *   the end. The first host join creates the meeting under the
 *   `call:{sessionId}:create` lock with `format: 'webinar'` and the
 *   occurrence's capacity; attendees join receive-only on every channel
 *   (D-CW-35, CW-R-75): the adapter's capability mapper refuses anything
 *   else. Credentials are cached until the room closes and answered with
 *   `Cache-Control: no-store` (D-CW-08, CW-R-70).
 * - Start and end (WBN-17, WBN-21, WBN-29, CW-R-31a): a host of the
 *   occurrence; anyone else gets 404. Start moves `published` to `live` and
 *   enqueues `webinar.recording.start` (CW-R-107); end moves `live` to
 *   `ended`, deletes the meeting, lowers every hand and takes back every
 *   floor, and announces `webinar.ended` on both rooms (CW-R-36b). Stopping
 *   the recording pipeline arrives with T-CW-2.5.
 *
 * A join token never reaches PostgreSQL, a log line, an audit `details`
 * object or a room event (CW-R-69).
 */
import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ACTIONS,
  CALL_TICKET_TTL_SECONDS,
  WEBINAR_LIST_DEFAULT_LIMIT,
  WebinarJoinResponseSchema,
  type CallParticipantRole,
  type Principal,
  type WebinarJoinResponse,
  type WebinarListQuery,
  type WebinarListResponse,
  type WebinarRegistrationResponse,
  type WebinarResponse,
  type WebinarStatus,
  type WebinarStatusResponse,
} from '@nestself/contracts';
import { ParticipantForbiddenException } from '../appointments/appointment-non-disclosure.filter.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { AuditWriter, type AuditEventInput } from '../audit/audit-writer.js';
import {
  credentialsTtlSeconds,
  parseCachedCredentials,
  serialiseCredentials,
  type CachedCredentials,
} from '../calls/call-mapper.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { CallsRepository, type CallParticipantRecord, type CallSessionRecord } from '../calls/calls.repository.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { VideoMetrics } from '../calls/video-metrics.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { WebinarJobSchedulerService } from '../jobs/webinar-job-scheduler.service.js';
import { KEY_VALUE_STORE, type KeyValueStore } from '../redis/key-value-store.js';
import { callCreateLockKey, callParticipantCredentialsKey } from '../redis/redis-keys.js';
import {
  VIDEO_PROVIDER,
  capabilitiesForRole,
  videoProviderUnavailable,
  type ProviderSession,
  type VideoProvider,
} from '../video/video-provider.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import {
  WebinarAccess,
  apiError,
  invalidField,
  joinWindowClosed,
  notEligible,
  notFound,
  webinarNotOpen,
  type WebinarHostRole,
} from './webinar-access.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { WebinarMailer } from './webinar-mailer.js';
import {
  attendeeCapabilities,
  decodePageCursor,
  isWithinWebinarWindow,
  paginate,
  toContractCapabilities,
} from './webinar-mapper.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { WebinarRoomEvents } from './webinar-room-events.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { WebinarsRepository, type WebinarRecord, type WebinarRegistrationRecord } from './webinars.repository.js';

/** CW-R-12: the creation lock lives as long as a call ticket, 30 seconds. */
const CREATE_LOCK_TTL_SECONDS = CALL_TICKET_TTL_SECONDS;

/** Statuses an employee may see; the default list shows the upcoming and the live ones (WBN-01). */
const EMPLOYEE_VISIBLE_STATUSES: readonly WebinarStatus[] = ['published', 'live', 'ended'];
const EMPLOYEE_DEFAULT_STATUSES: readonly WebinarStatus[] = ['published', 'live'];

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function errorName(error: unknown): string {
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') return error.code;
  return error instanceof Error ? error.name : 'UnknownError';
}

/** Who is joining, and as which call participant role. */
type Joiner = { kind: 'host'; role: WebinarHostRole } | { kind: 'attendee'; registration: WebinarRegistrationRecord };

@Injectable()
export class WebinarsService {
  private readonly logger = new Logger(WebinarsService.name);

  /** Interval and limit of an attendee's wait for a meeting a host is creating. Tests shorten them. */
  pollIntervalMs = 200;
  pollTimeoutMs = 3_000;

  constructor(
    private readonly repo: WebinarsRepository,
    private readonly access: WebinarAccess,
    private readonly calls: CallsRepository,
    @Inject(VIDEO_PROVIDER) private readonly video: VideoProvider,
    @Inject(KEY_VALUE_STORE) private readonly kv: KeyValueStore,
    private readonly events: WebinarRoomEvents,
    private readonly audit: AuditWriter,
    private readonly scheduler: WebinarJobSchedulerService,
    private readonly mail: WebinarMailer,
    private readonly metrics: VideoMetrics,
  ) {}

  // ── Discovery (WBN-01) ────────────────────────────────────────────────────

  async list(principal: Principal, query: WebinarListQuery): Promise<WebinarListResponse> {
    const after = query.cursor ? decodePageCursor(query.cursor) : undefined;
    if (after === null) throw invalidField('cursor', 'The cursor is not valid');
    const limit = query.limit ?? WEBINAR_LIST_DEFAULT_LIMIT;
    const statuses = query.status
      ? EMPLOYEE_VISIBLE_STATUSES.filter((status) => status === query.status)
      : EMPLOYEE_DEFAULT_STATUSES;
    const facts = (await this.repo.membershipFacts(principal.userId, new Date())).filter(
      (fact) => !query.orgId || fact.orgId === query.orgId,
    );
    const rows =
      statuses.length === 0
        ? []
        : await this.repo.list({
            statuses,
            from: query.from ? new Date(query.from) : undefined,
            to: query.to ? new Date(query.to) : undefined,
            audience: facts,
            after,
            limit: limit + 1,
          });
    const page = paginate(rows, limit, (webinar) => ({ at: webinar.startsAt, id: webinar.id }));
    return { items: await this.toResponses(page.items, principal.userId), nextCursor: page.nextCursor };
  }

  /** WBN-01 for one occurrence: an attendee in the audience, a registrant, a host or moderating staff. */
  async get(webinarId: string, principal: Principal): Promise<WebinarResponse> {
    const webinar = await this.access.load(webinarId);
    if ((await this.access.host(webinar, principal)) || (await this.access.canModerate(webinar, principal))) {
      return (await this.toResponses([webinar], principal.userId))[0]!;
    }
    if (!(await this.access.canRegister(webinar, principal))) return this.access.deny(principal, ACTIONS['event.register'], webinar);
    const registration = await this.repo.findRegistration(webinar.id, principal.userId);
    const visible =
      (registration !== null && webinar.status !== 'draft') ||
      (EMPLOYEE_VISIBLE_STATUSES.includes(webinar.status) && (await this.access.eligibleOrg(webinar, principal)) !== null);
    if (!visible) throw notFound();
    return (await this.toResponses([webinar], principal.userId))[0]!;
  }

  /** Employee view: no audience, organisation, host user ids or roster (D-CW-15). */
  private async toResponses(webinars: WebinarRecord[], userId: string): Promise<WebinarResponse[]> {
    const ids = webinars.map((webinar) => webinar.id);
    const [hosts, counts, registered] = await Promise.all([
      this.repo.listHostsFor(ids),
      this.repo.countActiveRegistrationsFor(ids),
      this.repo.registeredWebinarIds(ids, userId),
    ]);
    return webinars.map((webinar) => ({
      id: webinar.id,
      title: webinar.title,
      description: webinar.description,
      startsAt: webinar.startsAt.toISOString(),
      endsAt: webinar.endsAt.toISOString(),
      timeZone: webinar.timeZone,
      status: webinar.status,
      capacity: webinar.capacity,
      capacityRemaining: Math.max(0, webinar.capacity - (counts.get(webinar.id) ?? 0)),
      presenters: (hosts.get(webinar.id) ?? [])
        .filter((host) => host.role === 'presenter')
        .map((host) => ({ displayName: host.displayName })),
      registered: registered.has(webinar.id),
    }));
  }

  // ── Registration (WBN-02, WBN-03) ─────────────────────────────────────────

  async register(webinarId: string, principal: Principal): Promise<WebinarRegistrationResponse> {
    const now = new Date();
    const current = await this.access.load(webinarId);
    this.assertRegistrationOpen(current, now);
    const orgId = await this.access.eligibleOrg(current, principal, now);
    if (!orgId) throw notEligible();

    // Capacity under the occurrence row lock (CW-R-31). An occurrence of several organisations
    // runs in the system context, so the count sees every organisation's registrations.
    const { webinar, registration } = await this.access.transaction(current.orgId, async (tx) => {
      const locked = await this.repo.lockById(webinarId, tx);
      if (!locked) throw notFound();
      this.assertRegistrationOpen(locked, now);
      if (await this.repo.findRegistration(webinarId, principal.userId, tx)) {
        throw apiError(409, 'already_registered', 'You are already registered for this webinar');
      }
      if ((await this.repo.countActiveRegistrations(webinarId, tx)) >= locked.capacity) {
        throw apiError(409, 'webinar_full', 'The webinar is full');
      }
      const created = await this.repo.register({ webinarId, orgId, userId: principal.userId, registeredAt: now }, tx);
      return { webinar: locked, registration: created };
    });

    await this.record(principal.userId, webinar, 'webinar.registered', { webinarId, userId: principal.userId });
    try {
      await this.scheduler.scheduleReminders(registration, webinar.startsAt, now);
    } catch (error) {
      this.logger.error({ webinarId, operation: 'scheduleReminders', error: errorName(error) }, 'Webinar reminders not scheduled');
    }
    await this.mail.registered(principal.userId, registration.id, webinar);
    return { webinarId, registered: true, registeredAt: registration.registeredAt.toISOString() };
  }

  async unregister(webinarId: string, principal: Principal): Promise<WebinarRegistrationResponse> {
    const webinar = await this.access.load(webinarId);
    if (webinar.status !== 'published') {
      throw apiError(409, 'registration_closed', 'Registration for this webinar is closed');
    }
    const canceled = await this.access.scoped(webinar.orgId, (tx) =>
      this.repo.cancelRegistration(webinarId, principal.userId, new Date(), tx),
    );
    if (!canceled) throw notFound();

    try {
      await this.scheduler.cancelReminders(canceled.id);
    } catch (error) {
      // A reminder that still fires re-reads the registration and skips a canceled one (CW-R-37).
      this.logger.warn({ webinarId, operation: 'cancelReminders', error: errorName(error) }, 'Webinar reminders not removed');
    }
    await this.record(principal.userId, webinar, 'webinar.unregistered', { webinarId, userId: principal.userId });
    return { webinarId, registered: false, registeredAt: null };
  }

  /** WBN-02 criteria 4 and WBN-32: open while `published` and before the end. */
  private assertRegistrationOpen(webinar: WebinarRecord, now: Date): void {
    if (webinar.status === 'draft' || webinar.status === 'canceled') throw webinarNotOpen();
    if (webinar.status !== 'published' || now.getTime() >= webinar.endsAt.getTime()) {
      throw apiError(409, 'registration_closed', 'Registration for this webinar is closed');
    }
  }

  // ── Join (WBN-07, WBN-16, D-CW-35) ────────────────────────────────────────

  async join(webinarId: string, principal: Principal): Promise<WebinarJoinResponse> {
    const started = Date.now();
    const webinar = await this.access.load(webinarId);
    const joiner = await this.joiner(webinar, principal);
    const now = new Date();
    if (webinar.status !== 'published' && webinar.status !== 'live') throw webinarNotOpen();
    if (joiner.kind === 'attendee' && webinar.status !== 'live') throw webinarNotOpen();
    if (!isWithinWebinarWindow(webinar, now, joiner.kind)) throw joinWindowClosed();

    this.metrics.joinAttempt();
    try {
      return await this.joinSession(webinar, joiner, principal, started);
    } catch (error) {
      this.metrics.joinFailure();
      throw error;
    }
  }

  /** The caller as a host, or as an attendee with an active registration who is still in the audience; 404 otherwise. */
  private async joiner(webinar: WebinarRecord, principal: Principal): Promise<Joiner> {
    const host = await this.access.host(webinar, principal);
    if (host) return { kind: 'host', role: host.role };
    if (!(await this.access.canRegister(webinar, principal))) {
      return this.access.deny(principal, ACTIONS['event.register'], webinar);
    }
    const registration = await this.repo.findRegistration(webinar.id, principal.userId);
    if (!registration) throw new ParticipantForbiddenException('Register for the webinar before joining');
    // Eligibility is evaluated again at join (D-CW-17).
    if (!(await this.access.eligibleOrg(webinar, principal))) throw notEligible();
    return { kind: 'attendee', registration };
  }

  private async joinSession(
    webinar: WebinarRecord,
    joiner: Joiner,
    principal: Principal,
    started: number,
  ): Promise<WebinarJoinResponse> {
    const role: CallParticipantRole = joiner.kind === 'host' ? joiner.role : 'attendee';
    const session = joiner.kind === 'host' ? await this.hostSession(webinar) : await this.attendeeSession(webinar);
    const participant = await this.access.scoped(webinar.orgId, (tx) =>
      this.calls.ensureParticipant({ sessionId: session.id, orgId: webinar.orgId, userId: principal.userId, role }, tx),
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
        credentials = await this.addAttendee(session, participant, webinar);
      }
    } else if (joiner.kind === 'host') {
      ({ path, credentials } = await this.createOrWait(session, participant, webinar));
    } else {
      path = 'attendee';
      credentials = await this.addAttendee(await this.waitForMeeting(session), participant, webinar);
    }

    if (joiner.kind === 'attendee' && joiner.registration.floorGivenAt) {
      // A rejoining attendee starts receive-only again (D-CW-35): the floor does not survive a reconnect.
      // A new attendee is receive-only already; the cached one still holds the floor's audio.
      if (path === 'cached' && session.providerMeetingId && participant.providerAttendeeId) {
        await this.video.updateParticipantCapabilities({
          providerMeetingId: session.providerMeetingId,
          providerAttendeeId: participant.providerAttendeeId,
          role: 'attendee',
          capabilities: attendeeCapabilities(false),
        });
      }
      const active = await this.access.scoped(webinar.orgId, async (tx) => {
        await this.repo.setFloor(joiner.registration.id, null, tx);
        return (await this.repo.listActiveRegistrations(webinar.id, tx)).some((r) => r.floorGivenAt !== null);
      });
      // The audience's "a participant is speaking" follows the floor (WBN-25.8).
      this.events.toAudienceAdded(webinar.id, 'webinar.floor.state', { active });
    }

    await this.record(principal.userId, webinar, 'webinar.joined', { webinarId: webinar.id, participantId: participant.id });
    if (joiner.kind === 'attendee') {
      const count = await this.access.scoped(webinar.orgId, (tx) => this.repo.countAttendees(session.id, tx));
      this.events.toModeration(webinar.id, 'webinar.attendance.count', { webinarId: webinar.id, count });
    }
    this.logger.log(
      { webinarId: webinar.id, sessionId: session.id, participantId: participant.id, operation: 'join', path, latencyMs: Date.now() - started },
      'Webinar joined',
    );

    const capabilities =
      joiner.kind === 'attendee'
        ? { audio: 'receive', video: 'receive', content: 'receive' }
        : toContractCapabilities(capabilitiesForRole(joiner.role));
    return WebinarJoinResponseSchema.parse({
      webinarId: webinar.id,
      sessionId: session.id,
      participantId: participant.id,
      format: 'webinar',
      startsAt: webinar.startsAt.toISOString(),
      endsAt: webinar.endsAt.toISOString(),
      meeting: credentials.meeting,
      attendee: credentials.attendee,
      role,
      capabilities,
    });
  }

  /** The occurrence's open session, created PENDING on a host's first join under the occurrence row lock. */
  private hostSession(webinar: WebinarRecord): Promise<CallSessionRecord> {
    return this.access.transaction(webinar.orgId, async (tx) => {
      await this.repo.lockById(webinar.id, tx);
      return (await this.repo.findOpenSession(webinar.id, tx)) ?? this.repo.createSession(webinar, tx);
    });
  }

  /** An attendee joins a meeting a host opened; before that the lobby waits (409 `webinar_not_open`). */
  private async attendeeSession(webinar: WebinarRecord): Promise<CallSessionRecord> {
    const session = await this.access.scoped(webinar.orgId, (tx) => this.repo.findOpenSession(webinar.id, tx));
    if (!session || session.status === 'pending') throw webinarNotOpen();
    return session;
  }

  /**
   * First host join (guidelines 4.1 and 4.8): the `call:{sessionId}:create`
   * lock winner creates the meeting with its attendee; a loser waits for the
   * winner's meeting id and adds its own attendee.
   */
  private async createOrWait(
    session: CallSessionRecord,
    participant: CallParticipantRecord,
    webinar: WebinarRecord,
  ): Promise<{ path: 'attendee' | 'meeting'; credentials: CachedCredentials }> {
    const lockKey = callCreateLockKey(session.id);
    const lockToken = randomUUID();
    const won = await this.kv.set(lockKey, lockToken, { onlyIfAbsent: true, ttlSeconds: CREATE_LOCK_TTL_SECONDS });
    if (!won) {
      const active = await this.waitForMeeting(session);
      return { path: 'attendee', credentials: await this.addAttendee(active, participant, webinar) };
    }
    try {
      const current = await this.access.scoped(webinar.orgId, (tx) => this.calls.findSessionById(session.id, tx));
      if (current?.status === 'active') {
        return { path: 'attendee', credentials: await this.addAttendee(current, participant, webinar) };
      }
      if (!current || current.status === 'ended') throw webinarNotOpen();
      if (current.status === 'failed') throw videoProviderUnavailable();
      return { path: 'meeting', credentials: await this.createMeeting(current, participant, webinar) };
    } finally {
      try {
        if ((await this.kv.get(lockKey)) === lockToken) await this.kv.del(lockKey);
      } catch {
        // The lock expires on its own (CW-R-12).
      }
    }
  }

  /** PENDING (or a stale CREATING) to CREATING, `createSession` with the webinar format and capacity, then ACTIVE. */
  private async createMeeting(
    session: CallSessionRecord,
    participant: CallParticipantRecord,
    webinar: WebinarRecord,
  ): Promise<CachedCredentials> {
    const creating = await this.access.scoped(webinar.orgId, (tx) =>
      this.calls.transitionSession(session.id, ['pending', 'creating'], 'creating', {}, tx),
    );
    if (!creating) throw videoProviderUnavailable();

    const started = Date.now();
    let created: ProviderSession;
    try {
      created = await this.video.createSession({
        sessionId: session.id,
        format: 'webinar',
        capacity: webinar.capacity,
        orgId: webinar.orgId,
        webinarId: webinar.id,
        participant: { participantId: participant.id, role: participant.role },
      });
    } catch (error) {
      this.metrics.meetingFailed();
      await this.access.scoped(webinar.orgId, (tx) =>
        this.calls.transitionSession(session.id, ['creating'], 'failed', {}, tx),
      );
      this.logger.error(
        { webinarId: webinar.id, sessionId: session.id, operation: 'createSession', error: errorName(error) },
        'Webinar session creation failed',
      );
      throw error;
    }
    this.metrics.meetingStartDuration(Date.now() - started);

    const active = await this.access.scoped(webinar.orgId, async (tx) => {
      const moved = await this.calls.transitionSession(
        session.id,
        ['creating'],
        'active',
        { providerMeetingId: created.providerMeetingId, startedAt: new Date() },
        tx,
      );
      if (moved) await this.calls.setProviderAttendee(participant.id, created.participant.providerAttendeeId, tx);
      return moved;
    });
    if (!active) {
      // The webinar ended, or the lock expired and another host finished first (CW-R-12).
      const current = await this.access.scoped(webinar.orgId, (tx) => this.calls.findSessionById(session.id, tx));
      if (current?.providerMeetingId !== created.providerMeetingId) {
        await this.video.endSession({ providerMeetingId: created.providerMeetingId });
      }
      if (current?.status !== 'active' || !current.providerMeetingId) throw webinarNotOpen();
      return this.addAttendee(current, participant, webinar);
    }

    await this.audit.record({
      action: 'call.session.created',
      actorUserId: participant.userId,
      actorKind: 'USER',
      orgId: webinar.orgId,
      recordType: 'call_session',
      recordId: session.id,
      result: 'ALLOWED',
      details: { sessionId: session.id, webinarId: webinar.id, format: 'webinar' },
    });
    const credentials = serialiseCredentials({ meeting: created.meeting, attendee: created.participant.attendee });
    await this.cacheCredentials(active, participant, webinar, credentials);
    return credentials;
  }

  /** An attendee waiting for the meeting a host is creating, for up to `pollTimeoutMs`. */
  private async waitForMeeting(session: CallSessionRecord): Promise<CallSessionRecord> {
    const attempts = Math.max(1, Math.ceil(this.pollTimeoutMs / this.pollIntervalMs));
    for (let attempt = 0; attempt <= attempts; attempt += 1) {
      const current = await this.access.scoped(session.orgId, (tx) => this.calls.findSessionById(session.id, tx));
      if (current?.status === 'active' && current.providerMeetingId) return current;
      if (!current || current.status === 'failed') throw videoProviderUnavailable();
      if (current.status === 'ended') throw webinarNotOpen();
      if (attempt < attempts) await sleep(this.pollIntervalMs);
    }
    throw videoProviderUnavailable();
  }

  /** A new attendee in the meeting (`CreateAttendee`); an attendee is receive-only (D-CW-35). */
  private async addAttendee(
    session: CallSessionRecord,
    participant: CallParticipantRecord,
    webinar: WebinarRecord,
  ): Promise<CachedCredentials> {
    const providerMeetingId = session.providerMeetingId;
    if (!providerMeetingId) throw videoProviderUnavailable();
    const info = await this.video.describeSession({ providerMeetingId });
    if (!info) throw webinarNotOpen();
    const added = await this.video.createParticipant({
      providerMeetingId,
      participantId: participant.id,
      role: participant.role,
      ...(participant.role === 'attendee' ? { capabilities: attendeeCapabilities(false) } : {}),
    });
    await this.access.scoped(webinar.orgId, (tx) => this.calls.setProviderAttendee(participant.id, added.providerAttendeeId, tx));
    const credentials = serialiseCredentials({ meeting: info.meeting, attendee: added.attendee });
    await this.cacheCredentials(session, participant, webinar, credentials);
    return credentials;
  }

  private async cacheCredentials(
    session: CallSessionRecord,
    participant: CallParticipantRecord,
    webinar: WebinarRecord,
    credentials: CachedCredentials,
  ): Promise<void> {
    await this.kv.set(callParticipantCredentialsKey(session.id, participant.id), JSON.stringify(credentials), {
      ttlSeconds: credentialsTtlSeconds(webinar.endsAt, new Date()),
    });
  }

  // ── Start and end (WBN-17, WBN-21, WBN-29, CW-R-31a) ──────────────────────

  async start(webinarId: string, principal: Principal): Promise<WebinarStatusResponse> {
    const webinar = await this.hostOnly(webinarId, principal);
    if (webinar.status === 'live') return { webinarId, status: 'live' };
    if (webinar.status !== 'published') throw webinarNotOpen();
    if (!isWithinWebinarWindow(webinar, new Date(), 'host')) throw joinWindowClosed();

    const live = await this.access.scoped(webinar.orgId, (tx) =>
      this.repo.transitionStatus(webinarId, ['published'], 'live', { startedAt: new Date() }, tx),
    );
    if (!live) {
      const current = await this.access.load(webinarId);
      if (current.status === 'live') return { webinarId, status: 'live' };
      throw webinarNotOpen();
    }

    const session = await this.access.scoped(webinar.orgId, (tx) => this.repo.findOpenSession(webinarId, tx));
    try {
      // CW-R-107: the recording starts in a job, so the start never waits on the media pipeline.
      await this.scheduler.enqueueRecordingStart(webinarId, session?.id ?? null);
    } catch (error) {
      this.logger.error({ webinarId, operation: 'enqueueRecordingStart', error: errorName(error) }, 'Recording start not enqueued');
    }
    await this.record(principal.userId, webinar, 'webinar.started', { webinarId, sessionId: session?.id ?? null });
    this.events.toAudience(webinarId, 'webinar.state', { webinarId, status: 'live' });
    return { webinarId, status: 'live' };
  }

  async end(webinarId: string, principal: Principal): Promise<WebinarStatusResponse> {
    const webinar = await this.hostOnly(webinarId, principal);
    if (webinar.status === 'ended') return { webinarId, status: 'ended' };
    if (webinar.status !== 'live') throw webinarNotOpen();

    const endedAt = new Date();
    const ended = await this.access.scoped(webinar.orgId, (tx) =>
      this.repo.transitionStatus(webinarId, ['live'], 'ended', { endedAt }, tx),
    );
    if (!ended) return { webinarId, status: (await this.access.load(webinarId)).status };

    const session = await this.closeSession(webinar, endedAt);
    await this.access.scoped(webinar.orgId, (tx) => this.repo.clearHandsAndFloors(webinarId, tx));
    await this.record(principal.userId, webinar, 'webinar.ended', { webinarId, sessionId: session?.id ?? null });
    const payload = { webinarId, endedAt: endedAt.toISOString() };
    this.events.toAudience(webinarId, 'webinar.state', { webinarId, status: 'ended' });
    this.events.toAudience(webinarId, 'webinar.ended', payload);
    this.events.toModeration(webinarId, 'webinar.ended', payload);
    return { webinarId, status: 'ended' };
  }

  /** Deletes the meeting and closes the open session; drops every cached credential (D-CW-08). */
  private async closeSession(webinar: WebinarRecord, endedAt: Date): Promise<CallSessionRecord | null> {
    const session = await this.access.scoped(webinar.orgId, (tx) => this.repo.findOpenSession(webinar.id, tx));
    if (!session) return null;
    if (session.status === 'active' && session.providerMeetingId) {
      await this.access.scoped(webinar.orgId, (tx) => this.calls.stampEndReason(session.id, 'expert', tx));
      await this.video.endSession({ providerMeetingId: session.providerMeetingId });
      await this.access.scoped(webinar.orgId, (tx) => this.calls.closeSession(session.id, { endedAt, reason: 'expert' }, tx));
    } else {
      // No meeting yet (PENDING) or one being created: a creator that finishes now finds the session ended.
      await this.access.scoped(webinar.orgId, (tx) =>
        this.calls.transitionSession(session.id, ['pending', 'creating'], 'ended', { endedAt }, tx),
      );
    }
    const participants = await this.access.scoped(webinar.orgId, (tx) => this.calls.listParticipants(session.id, tx));
    if (participants.length > 0) {
      await this.kv.del(...participants.map((p) => callParticipantCredentialsKey(session.id, p.id)));
    }
    return session;
  }

  /** The occurrence when the caller is one of its hosts (CW-R-31a); 404 for anyone else. */
  private async hostOnly(webinarId: string, principal: Principal): Promise<WebinarRecord> {
    const webinar = await this.access.load(webinarId);
    if (!(await this.access.host(webinar, principal))) {
      return this.access.deny(principal, ACTIONS['event.present'], webinar);
    }
    return webinar;
  }

  // ── Shared ────────────────────────────────────────────────────────────────

  /** A webinar audit event; `details` carries identifiers only (CW-R-33a). */
  private record(
    actorUserId: string,
    webinar: Pick<WebinarRecord, 'id' | 'orgId'>,
    action: AuditEventInput['action'],
    details: Record<string, unknown>,
  ): Promise<void> {
    return this.audit.record({
      action,
      actorUserId,
      actorKind: 'USER',
      orgId: webinar.orgId,
      recordType: 'webinar',
      recordId: webinar.id,
      result: 'ALLOWED',
      details,
    });
  }
}
