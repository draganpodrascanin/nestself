/**
 * The `call:{sessionId}` room end to end in memory (T-CW-1.6): the real
 * `EventsGateway`, `SubscriptionAuthorizer` (with the `authorize()` engine),
 * `RoomAccessRegistry`, `RoomEmitter` and `CallsService`, over a mocked
 * Socket.IO server and in-memory repositories. Only the `ContextLoader` is
 * stubbed, with the grants each person holds.
 *
 * Covered: a participant subscribes and receives the room's events (join,
 * location shared, signal, end, leave, the four follow-up events); a signed-in
 * non-participant is refused exactly as an unknown room is, even when the
 * engine alone would allow them; the client-supplied action and resource are
 * not what is authorised; a malformed room and the not-yet-served webinar
 * rooms are refused; a payload failing its schema is never emitted; a
 * replaced participant loses the room on re-authorisation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import type {
  AssignmentInput,
  AuthorizationContext,
  CallParticipantRole,
  GrantInput,
  Principal,
  Resource,
} from '@nestself/contracts';
import type { Socket } from 'socket.io';
import { appointmentResourceOf } from '../appointments/appointment-mapper.js';
import type { AppointmentRecord, AppointmentsRepository } from '../appointments/appointments.repository.js';
import type { AuditWriter } from '../audit/audit-writer.js';
import type { ContextLoader } from '../authz/context-loader.js';
import type { DbService } from '../db/db.service.js';
import { MemoryKeyValueStore } from '../redis/memory-key-value-store.js';
import { FakeVideoProvider } from '../video/fake-video-provider.js';
import { EventsGateway } from '../ws/events.gateway.js';
import { RoomAccessRegistry } from '../ws/room-access.registry.js';
import { RoomEmitter } from '../ws/room-emitter.js';
import { SubscriptionAuthorizer } from '../ws/subscription-authorizer.js';
import type { CallParticipantRecord, CallSessionRecord, CallsRepository } from './calls.repository.js';
import { CallsService } from './calls.service.js';

const NOW = new Date('2026-11-10T15:00:00.000Z');
const MINUTE = 60_000;
const ORG = 'org_sample';
const APPOINTMENT_ID = 'appt_1';
const EXPERT = 'user_milica';
const EMPLOYEE = 'user_jovan';
/** An employee of the same organization, not in this appointment. */
const COLLEAGUE = 'user_ana';
/** An expert with a stale CASE assignment on the appointment, which now belongs to another expert. */
const OTHER_EXPERT = 'user_nikola';

// ---------------------------------------------------------------------------
// Principals and their grants
// ---------------------------------------------------------------------------

const AUTH = { method: 'email_otp', time: '2026-11-10T14:00:00.000Z', secondFactor: false, lastStepUpAt: null } as const;

function member(userId: string): Principal {
  return {
    userId,
    displayName: userId,
    initials: 'XX',
    locale: 'sr-Latn',
    memberships: [
      {
        membershipId: `mem_${userId}`,
        orgId: ORG,
        orgUnitId: 'ou_root',
        status: 'ACTIVE',
        startDate: '2024-01-01T00:00:00.000Z',
        endDate: null,
      },
    ],
    staffTemplates: [],
    expert: null,
    context: { kind: 'organization', orgId: ORG },
    auth: AUTH,
    sessionId: `sid_${userId}`,
    tokenFamily: null,
  } as unknown as Principal;
}

function expert(userId: string): Principal {
  return {
    userId,
    displayName: userId,
    initials: 'XX',
    locale: 'sr-Latn',
    memberships: [],
    staffTemplates: [],
    expert: { id: `exp_${userId}`, approvedCategories: ['psychological'] },
    context: { kind: 'expert' },
    auth: AUTH,
    sessionId: `sid_${userId}`,
    tokenFamily: null,
  } as unknown as Principal;
}

function grant(userId: string, scopeType: GrantInput['scopeType']): GrantInput {
  return {
    id: `grant_${userId}`,
    subjectUserId: userId,
    templateKey: scopeType === 'own' ? 'employee' : 'expert',
    actions: ['consultation.join'],
    scopeType,
    scopeOrgId: null,
    scopeOrgUnitId: null,
    includeDescendants: false,
    scopeRefKind: null,
    scopeRefId: null,
    conditions: [],
    validFrom: null,
    validUntil: null,
    delegationEnvelope: null,
    parentGrantId: null,
    revokedAt: null,
  };
}

function caseAssignment(userId: string): AssignmentInput {
  return {
    id: `assignment_${userId}`,
    userId,
    kind: 'CASE',
    targetId: APPOINTMENT_ID,
    startAt: new Date('2026-01-01T00:00:00.000Z'),
    endAt: null,
  };
}

/** The grants of the employee template (`own`) and the expert template (CASE assignment). */
function contextFor(principal: Principal): AuthorizationContext {
  const isExpert = principal.expert !== null;
  return {
    now: new Date(),
    isDeactivated: false,
    isSuspended: false,
    grants: [grant(principal.userId, isExpert ? 'assigned_cases' : 'own')],
    assignments: isExpert ? [caseAssignment(principal.userId)] : [],
    ancestorIds: [],
    orgSelfApprovalAllowed: false,
    organizationTimezone: 'Europe/Belgrade',
  };
}

// ---------------------------------------------------------------------------
// In-memory repositories
// ---------------------------------------------------------------------------

function appointment(): AppointmentRecord {
  return {
    id: APPOINTMENT_ID,
    orgId: ORG,
    expertUserId: EXPERT,
    employeeUserId: EMPLOYEE,
    startsAt: new Date(NOW.getTime() + 5 * MINUTE),
    endsAt: new Date(NOW.getTime() + 55 * MINUTE),
    status: 'confirmed',
    serviceCategory: 'psychological',
    timeZone: 'Europe/Belgrade',
    fundingRef: null,
    followUpOf: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

/** The repository surface the join, signal and end paths and the room resolver use. */
class InMemoryCallsRepository {
  readonly sessions = new Map<string, CallSessionRecord>();
  readonly participants = new Map<string, CallParticipantRecord>();
  private seq = 0;

  async findSessionById(id: string): Promise<CallSessionRecord | null> {
    const session = this.sessions.get(id);
    return session ? { ...session } : null;
  }

  async findLiveSessionByAppointment(appointmentId: string): Promise<CallSessionRecord | null> {
    for (const session of this.sessions.values()) {
      if (session.appointmentId === appointmentId && session.status !== 'failed') return { ...session };
    }
    return null;
  }

  async createSessionForAppointment(record: AppointmentRecord): Promise<CallSessionRecord> {
    const live = await this.findLiveSessionByAppointment(record.id);
    if (live) return live;
    const session: CallSessionRecord = {
      id: `session_${++this.seq}`,
      appointmentId: record.id,
      webinarId: null,
      orgId: record.orgId,
      format: 'consultation',
      providerMeetingId: null,
      status: 'pending',
      startsAt: record.startsAt,
      endsAt: record.endsAt,
      startedAt: null,
      endedAt: null,
      locationText: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.sessions.set(session.id, session);
    return { ...session };
  }

  async transitionSession(
    id: string,
    from: CallSessionRecord['status'][],
    to: CallSessionRecord['status'],
    set: Partial<CallSessionRecord> = {},
  ): Promise<CallSessionRecord | null> {
    const session = this.sessions.get(id);
    if (!session || !from.includes(session.status)) return null;
    Object.assign(session, set, { status: to });
    return { ...session };
  }

  async setLocationTextIfActive(id: string, locationText: string): Promise<boolean> {
    const session = this.sessions.get(id);
    if (session?.status !== 'active') return false;
    session.locationText = locationText;
    return true;
  }

  async findParticipant(sessionId: string, userId: string): Promise<CallParticipantRecord | null> {
    const found = [...this.participants.values()].find((p) => p.sessionId === sessionId && p.userId === userId);
    return found ? { ...found } : null;
  }

  async ensureParticipant(input: {
    sessionId: string;
    orgId: string | null;
    userId: string;
    role: CallParticipantRole;
  }): Promise<CallParticipantRecord> {
    const existing = await this.findParticipant(input.sessionId, input.userId);
    if (existing) return existing;
    const participant: CallParticipantRecord = {
      id: `participant_${++this.seq}`,
      ...input,
      providerAttendeeId: null,
      firstJoinedAt: null,
      lastLeftAt: null,
      reconnectCount: 0,
      createdAt: new Date(),
    };
    this.participants.set(participant.id, participant);
    return { ...participant };
  }

  async setProviderAttendee(participantId: string, providerAttendeeId: string): Promise<void> {
    const participant = this.participants.get(participantId);
    if (participant) participant.providerAttendeeId = providerAttendeeId;
  }

  async listParticipants(sessionId: string): Promise<CallParticipantRecord[]> {
    return [...this.participants.values()].filter((p) => p.sessionId === sessionId).map((p) => ({ ...p }));
  }
}

class InMemoryAppointments {
  readonly rows = new Map<string, AppointmentRecord>();

  async findById(id: string): Promise<AppointmentRecord | null> {
    const row = this.rows.get(id);
    return row ? { ...row } : null;
  }
}

// ---------------------------------------------------------------------------
// Mocked Socket.IO server
// ---------------------------------------------------------------------------

interface Received {
  event: string;
  payload: unknown;
}

class FakeServer {
  readonly members = new Map<string, Set<FakeSocket>>();

  to(room: string) {
    return {
      emit: (event: string, payload: unknown): boolean => {
        for (const socket of this.members.get(room) ?? []) socket.received.push({ event, payload });
        return true;
      },
    };
  }
}

class FakeSocket {
  readonly received: Received[] = [];
  readonly data: { principal?: Principal; subscriptions: Map<string, unknown> };

  constructor(
    private readonly server: FakeServer,
    principal?: Principal,
  ) {
    this.data = { principal, subscriptions: new Map() };
  }

  join(room: string): void {
    const members = this.server.members.get(room) ?? new Set<FakeSocket>();
    members.add(this);
    this.server.members.set(room, members);
  }

  leave(room: string): void {
    this.server.members.get(room)?.delete(this);
  }

  emit(event: string, payload: unknown): boolean {
    this.received.push({ event, payload });
    return true;
  }

  events(event: string): unknown[] {
    return this.received.filter((r) => r.event === event).map((r) => r.payload);
  }
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('call room: Socket.IO subscription and events (T-CW-1.6)', () => {
  let repo: InMemoryCallsRepository;
  let appointments: InMemoryAppointments;
  let server: FakeServer;
  let registry: RoomAccessRegistry;
  let authorizer: SubscriptionAuthorizer;
  let gateway: EventsGateway;
  let rooms: RoomEmitter;
  let service: CallsService;
  let errors: unknown[][];

  const employee = member(EMPLOYEE);
  const colleague = member(COLLEAGUE);
  const theExpert = expert(EXPERT);
  const otherExpert = expert(OTHER_EXPERT);

  function socketOf(principal?: Principal): FakeSocket {
    return new FakeSocket(server, principal);
  }

  function subscribe(socket: FakeSocket, message: unknown): Promise<{ event: string; data: unknown }> {
    return gateway.handleSubscribe(message, socket as unknown as Socket);
  }

  /** The employee joins first: the session exists and is ACTIVE afterwards. */
  async function startSession(): Promise<string> {
    const joined = await service.join(APPOINTMENT_ID, employee, {});
    return joined.sessionId;
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    errors = [];
    for (const level of ['log', 'warn', 'debug', 'verbose'] as const) {
      vi.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
    }
    vi.spyOn(Logger.prototype, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args);
    });

    repo = new InMemoryCallsRepository();
    appointments = new InMemoryAppointments();
    appointments.rows.set(APPOINTMENT_ID, appointment());

    server = new FakeServer();
    registry = new RoomAccessRegistry();
    const contextLoader = {
      build: vi.fn(async (principal: Principal, _resource: Resource) => contextFor(principal)),
    };
    authorizer = new SubscriptionAuthorizer(contextLoader as unknown as ContextLoader, registry);
    gateway = new EventsGateway(authorizer);
    gateway.server = server as never;
    rooms = new RoomEmitter(gateway);

    const dbs = { withOrgScope: (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn(undefined) };
    service = new CallsService(
      repo as unknown as CallsRepository,
      appointments as unknown as AppointmentsRepository,
      dbs as unknown as DbService,
      new FakeVideoProvider(),
      new MemoryKeyValueStore(),
      rooms,
      { record: vi.fn(async () => undefined) } as unknown as AuditWriter,
      { get: () => 'none' } as never,
      registry,
    );
    service.pollIntervalMs = 5;
    service.onModuleInit();
  });

  afterEach(() => {
    service.onModuleDestroy();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('participants', () => {
    it('registers the call room resolver, and only once', () => {
      expect(registry.resolverFor('call')).toBeTypeOf('function');
      expect(registry.resolverFor('webinar')).toBeUndefined();
    });

    it('the employee subscribes and receives call.participant.joined when the expert joins', async () => {
      const sessionId = await startSession();
      const socket = socketOf(employee);

      expect(await subscribe(socket, { room: `call:${sessionId}` })).toEqual({
        event: 'subscribe:ok',
        data: { room: `call:${sessionId}` },
      });

      const joined = await service.join(APPOINTMENT_ID, theExpert, {});
      expect(socket.events('call.participant.joined')).toEqual([{ participantId: joined.participantId, role: 'expert' }]);
    });

    it('accepts the T-1.11 message shape when it names consultation.join on this call session', async () => {
      const sessionId = await startSession();
      expect(
        await subscribe(socketOf(employee), {
          room: `call:${sessionId}`,
          action: 'consultation.join',
          resource: { type: 'call_session', id: sessionId },
        }),
      ).toEqual({ event: 'subscribe:ok', data: { room: `call:${sessionId}` } });
    });

    it('the expert receives a content-free call.location.shared when the employee shares a location', async () => {
      const expertJoin = await service.join(APPOINTMENT_ID, theExpert, {});
      const socket = socketOf(theExpert);
      expect((await subscribe(socket, { room: `call:${expertJoin.sessionId}` })).event).toBe('subscribe:ok');

      await service.join(APPOINTMENT_ID, employee, { locationText: 'Home office, Novi Sad' });

      expect(socket.events('call.location.shared')).toEqual([{ sessionId: expertJoin.sessionId }]);
      expect(JSON.stringify(socket.received)).not.toContain('Novi Sad');
      expect(JSON.stringify(socket.received)).not.toMatch(/JoinToken|user_jovan|user_milica/);
    });

    it('emits no call.location.shared when nothing was shared', async () => {
      const expertJoin = await service.join(APPOINTMENT_ID, theExpert, {});
      const socket = socketOf(theExpert);
      await subscribe(socket, { room: `call:${expertJoin.sessionId}` });

      await service.join(APPOINTMENT_ID, employee, {});

      expect(socket.events('call.location.shared')).toEqual([]);
      expect(socket.events('call.participant.joined')).toHaveLength(1);
    });

    it('carries a signal and the end of the session to the other party', async () => {
      const sessionId = await startSession();
      await service.join(APPOINTMENT_ID, theExpert, {});
      const employeeSocket = socketOf(employee);
      const expertSocket = socketOf(theExpert);
      await subscribe(employeeSocket, { room: `call:${sessionId}` });
      await subscribe(expertSocket, { room: `call:${sessionId}` });

      await service.signal(APPOINTMENT_ID, employee, { type: 'cannot_hear' });
      expect(expertSocket.events('call.signal')).toEqual([{ type: 'cannot_hear', fromRole: 'employee' }]);

      await service.end(APPOINTMENT_ID, theExpert);
      expect(employeeSocket.events('call.session.ended')).toEqual([{ sessionId, endedAt: NOW.toISOString() }]);
    });

    it('carries call.participant.left from the event applier', async () => {
      const sessionId = await startSession();
      const expertJoin = await service.join(APPOINTMENT_ID, theExpert, {});
      const socket = socketOf(employee);
      await subscribe(socket, { room: `call:${sessionId}` });

      service.notifyParticipantLeft(sessionId, { id: expertJoin.participantId, role: 'expert' });

      expect(socket.events('call.participant.left')).toEqual([{ participantId: expertJoin.participantId, role: 'expert' }]);
    });
  });

  describe('refusals', () => {
    it('refuses a signed-in non-participant exactly as an unknown room', async () => {
      const sessionId = await startSession();
      const socket = socketOf(colleague);

      const refused = await subscribe(socket, { room: `call:${sessionId}` });
      const unknown = await subscribe(socket, { room: 'call:no_such_session' });

      expect(refused).toEqual({ event: 'subscribe:denied', data: { room: `call:${sessionId}`, reason: 'not_found' } });
      expect(unknown).toEqual({ event: 'subscribe:denied', data: { room: 'call:no_such_session', reason: 'not_found' } });

      await service.join(APPOINTMENT_ID, theExpert, {});
      expect(socket.received).toEqual([]);
    });

    it('refuses an expert the engine alone would allow, because they are not the session’s expert', async () => {
      const sessionId = await startSession();
      const engine = await authorizer.authorizeSubscription(
        otherExpert,
        'consultation.join',
        appointmentResourceOf(appointment()),
      );
      expect(engine.allowed).toBe(true);

      expect(await subscribe(socketOf(otherExpert), { room: `call:${sessionId}` })).toEqual({
        event: 'subscribe:denied',
        data: { room: `call:${sessionId}`, reason: 'not_found' },
      });
    });

    it('does not authorise the client-supplied action and resource', async () => {
      const sessionId = await startSession();
      const room = `call:${sessionId}`;

      // The T-1.11 weakness: an action the colleague does hold, on a resource of their own choosing.
      expect(
        await subscribe(socketOf(colleague), {
          room,
          action: 'program.overview',
          resource: { type: 'program', orgId: ORG },
        }),
      ).toEqual({ event: 'subscribe:denied', data: { room, reason: 'invalid_payload' } });
      expect(
        await subscribe(socketOf(colleague), {
          room,
          action: 'consultation.join',
          resource: { type: 'call_session', id: sessionId, ownerId: COLLEAGUE },
        }),
      ).toEqual({ event: 'subscribe:denied', data: { room, reason: 'not_found' } });
      expect(
        await subscribe(socketOf(employee), { room, resource: { type: 'call_session', id: 'session_other' } }),
      ).toEqual({ event: 'subscribe:denied', data: { room, reason: 'invalid_payload' } });
    });

    it.each(['call:', 'call:a:b', 'call:../session_1', 'call:session 1', 'presence:session_1', 'session_1'])(
      'refuses the malformed room %j',
      async (room) => {
        const socket = socketOf(employee);
        expect(await subscribe(socket, { room })).toEqual({
          event: 'subscribe:denied',
          data: { room: null, reason: 'invalid_room' },
        });
        expect(server.members.size).toBe(0);
      },
    );

    it('refuses a message that is not a subscription', async () => {
      expect(await subscribe(socketOf(employee), 'call:session_1')).toEqual({
        event: 'subscribe:denied',
        data: { room: null, reason: 'invalid_payload' },
      });
    });

    it.each(['webinar:webinar_sample_upcoming', 'webinar:webinar_sample_upcoming:moderation'])(
      'refuses %s with room_not_available until T-CW-2.3 serves webinar rooms',
      async (room) => {
        expect(await subscribe(socketOf(employee), { room })).toEqual({
          event: 'subscribe:denied',
          data: { room, reason: 'room_not_available' },
        });
      },
    );

    it('refuses an unauthenticated socket', async () => {
      expect(await subscribe(socketOf(undefined), { room: 'call:session_1' })).toEqual({
        event: 'subscribe:denied',
        data: { room: 'call:session_1', reason: 'unauthenticated' },
      });
    });

    it('revokes the room of an expert who was replaced on the appointment', async () => {
      const sessionId = await startSession();
      const socket = socketOf(theExpert);
      await subscribe(socket, { room: `call:${sessionId}` });

      appointments.rows.set(APPOINTMENT_ID, { ...appointment(), expertUserId: OTHER_EXPERT });

      expect(await authorizer.reauthorizeAll(socket as unknown as Socket)).toEqual([`call:${sessionId}`]);
      expect(socket.events('subscription:revoked')).toEqual([{ room: `call:${sessionId}` }]);
      service.notifyParticipantLeft(sessionId, { id: 'participant_1', role: 'employee' });
      expect(socket.events('call.participant.left')).toEqual([]);
    });
  });

  describe('payload validation (CW-R-36)', () => {
    it('never emits a payload that fails its schema', async () => {
      const sessionId = await startSession();
      const socket = socketOf(employee);
      await subscribe(socket, { room: `call:${sessionId}` });

      service.notifyParticipantLeft(sessionId, { id: '', role: 'expert' });
      expect(
        rooms.emit(`call:${sessionId}`, 'call.participant.left', {
          participantId: 'participant_9',
          role: 'expert',
          displayName: 'Milica',
        } as never),
      ).toBe(false);

      expect(socket.received).toEqual([]);
      expect(errors).toHaveLength(2);
      expect(JSON.stringify(errors)).not.toContain('Milica');
    });
  });

  describe('follow-up events (D-CW-37)', () => {
    const PROPOSED = {
      appointmentId: APPOINTMENT_ID,
      followUpId: 'appt_follow_up',
      startsAt: '2026-11-24T15:00:00.000Z',
      durationMinutes: 50,
    };

    async function endedSessionWithBothSubscribed(): Promise<{
      sessionId: string;
      employeeSocket: FakeSocket;
      expertSocket: FakeSocket;
    }> {
      const sessionId = await startSession();
      await service.join(APPOINTMENT_ID, theExpert, {});
      await service.end(APPOINTMENT_ID, theExpert);
      // The post-call screens subscribe after the end: the room stays open to the participants.
      const employeeSocket = socketOf(employee);
      const expertSocket = socketOf(theExpert);
      expect((await subscribe(employeeSocket, { room: `call:${sessionId}` })).event).toBe('subscribe:ok');
      expect((await subscribe(expertSocket, { room: `call:${sessionId}` })).event).toBe('subscribe:ok');
      return { sessionId, employeeSocket, expertSocket };
    }

    it('delivers the proposal, the confirmation, the decline and the suggested times', async () => {
      const { sessionId, employeeSocket, expertSocket } = await endedSessionWithBothSubscribed();
      const ids = { appointmentId: APPOINTMENT_ID, followUpId: 'appt_follow_up' };
      const windows = [{ startsAt: '2026-11-25T15:00:00.000Z', endsAt: '2026-11-25T15:50:00.000Z' }];

      expect(service.emitFollowUpProposed(sessionId, PROPOSED)).toBe(true);
      expect(service.emitFollowUpConfirmed(sessionId, { ...ids, status: 'awaiting_approval' })).toBe(true);
      expect(service.emitFollowUpDeclined(sessionId, ids)).toBe(true);
      expect(service.emitTimesSuggested(sessionId, { ...ids, windows })).toBe(true);

      expect(employeeSocket.events('appointment.follow_up.proposed')).toEqual([PROPOSED]);
      expect(expertSocket.events('appointment.follow_up.confirmed')).toEqual([{ ...ids, status: 'awaiting_approval' }]);
      expect(expertSocket.events('appointment.follow_up.declined')).toEqual([ids]);
      expect(expertSocket.events('appointment.times_suggested')).toEqual([{ ...ids, windows }]);
    });

    it('drops a follow-up payload that fails its schema', async () => {
      const { sessionId, employeeSocket } = await endedSessionWithBothSubscribed();

      expect(service.emitFollowUpProposed(sessionId, { ...PROPOSED, durationMinutes: 0 })).toBe(false);
      expect(service.emitFollowUpProposed(sessionId, { ...PROPOSED, note: 'Bring your notes' } as never)).toBe(false);
      expect(
        service.emitTimesSuggested(sessionId, { appointmentId: APPOINTMENT_ID, followUpId: 'appt_follow_up', windows: [] }),
      ).toBe(false);

      expect(employeeSocket.events('appointment.follow_up.proposed')).toEqual([]);
      expect(employeeSocket.events('appointment.times_suggested')).toEqual([]);
    });
  });
});
