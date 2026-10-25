/**
 * The webinar rooms end to end in memory (T-CW-2.3): the real
 * `EventsGateway`, `SubscriptionAuthorizer` (with the `authorize()` engine),
 * `RoomAccessRegistry` with the webinar resolvers, `WebinarAccess`,
 * `RoomEmitter` and `RoomEventRelay` (over the in-memory store's pub/sub),
 * over a mocked Socket.IO server and an in-memory webinar repository. Only
 * the `ContextLoader` is stubbed, with the grants each person holds.
 *
 * Covered: registrants and hosts subscribe to `webinar:{id}`; only the
 * moderator and moderating principals subscribe to `webinar:{id}:moderation`
 * (names, CW-R-36a), presenters are refused there and use
 * `webinar:{id}:hosts` (counts and the floor holder's id, WBN-19); an unknown
 * occurrence, a canceled registration, a principal with no registration and a
 * host row the engine no longer backs are all refused as `not_found`; each
 * webinar event reaches only its room kind; the resolvers register at
 * start-up and a missing webinars module fails the start-up.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import type { AssignmentInput, AuthorizationContext, GrantInput, Principal, Resource } from '@nestself/contracts';
import type { Socket } from 'socket.io';
import type { AuditWriter } from '../audit/audit-writer.js';
import type { ContextLoader } from '../authz/context-loader.js';
import type { DbService } from '../db/db.service.js';
import { MemoryKeyValueStore } from '../redis/memory-key-value-store.js';
import { WebinarAccess } from '../webinars/webinar-access.js';
import type {
  WebinarHostRecord,
  WebinarRecord,
  WebinarRegistrationRecord,
  WebinarsRepository,
} from '../webinars/webinars.repository.js';
import { EventsGateway } from './events.gateway.js';
import { RoomAccessRegistry } from './room-access.registry.js';
import { RoomEmitter } from './room-emitter.js';
import { RoomEventRelay } from './room-event-relay.js';
import { SubscriptionAuthorizer } from './subscription-authorizer.js';
import {
  WebinarRoomResolvers,
  registerWebinarRooms,
  webinarHostsRoomTarget,
  webinarModerationRoomTarget,
  webinarRoomTarget,
} from './webinar-room-access.js';

const ORG = 'org_sample';
const WEBINAR = 'webinar_live';
const ROOM = `webinar:${WEBINAR}`;
const MODERATION = `webinar:${WEBINAR}:moderation`;
const HOSTS = `webinar:${WEBINAR}:hosts`;

const PRESENTER = 'user_milica';
const MODERATOR = 'user_nikola';
const OPERATIONS = 'user_ops';
const REGISTRANT = 'user_jovan';
const CANCELED = 'user_ana';
const NOT_REGISTERED = 'user_ivana';
/** A presenter row whose CASE assignment was removed: the engine no longer backs it. */
const STALE_PRESENTER = 'user_marko';

const AUTH = { method: 'email_otp', time: '2026-11-10T14:00:00.000Z', secondFactor: false, lastStepUpAt: null } as const;

function principalOf(userId: string, kind: 'organization' | 'expert' | 'operations' = 'organization'): Principal {
  return {
    userId,
    displayName: userId,
    initials: 'XX',
    locale: 'sr-Latn',
    memberships:
      kind === 'organization'
        ? [{ membershipId: `mem_${userId}`, orgId: ORG, orgUnitId: 'ou_root', status: 'ACTIVE', startDate: '2024-01-01T00:00:00.000Z', endDate: null }]
        : [],
    staffTemplates: kind === 'operations' ? ['client_operations'] : [],
    expert: kind === 'expert' ? { id: `exp_${userId}`, approvedCategories: ['psychological'] } : null,
    context: kind === 'organization' ? { kind: 'organization', orgId: ORG } : kind === 'expert' ? { kind: 'expert' } : { kind: 'operations' },
    auth: AUTH,
    sessionId: `sid_${userId}`,
    tokenFamily: null,
  } as unknown as Principal;
}

function grant(userId: string, actions: string[], scopeType: GrantInput['scopeType']): GrantInput {
  return {
    id: `grant_${userId}_${scopeType}`,
    subjectUserId: userId,
    templateKey: '',
    actions,
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

function assignment(userId: string, kind: AssignmentInput['kind'], targetId: string): AssignmentInput {
  return { id: `assignment_${userId}_${kind}`, userId, kind, targetId, startAt: new Date('2026-01-01T00:00:00.000Z'), endAt: null };
}

/** The grants each person holds: expert (CASE), client operations (CLIENT), platform moderation, employees (own). */
function contextFor(principal: Principal): AuthorizationContext {
  const base = { now: new Date(), isDeactivated: false, isSuspended: false, ancestorIds: [], orgSelfApprovalAllowed: false, organizationTimezone: 'Europe/Belgrade' };
  switch (principal.userId) {
    case PRESENTER:
      return { ...base, grants: [grant(PRESENTER, ['event.present'], 'assigned_cases')], assignments: [assignment(PRESENTER, 'CASE', WEBINAR)] };
    case STALE_PRESENTER:
      return { ...base, grants: [grant(STALE_PRESENTER, ['event.present'], 'assigned_cases')], assignments: [] };
    case MODERATOR:
      return { ...base, grants: [grant(MODERATOR, ['event.moderate', 'event.manage'], 'assigned_clients')], assignments: [assignment(MODERATOR, 'CLIENT', ORG)] };
    case OPERATIONS:
      return { ...base, grants: [grant(OPERATIONS, ['event.moderate'], 'platform')], assignments: [] };
    default:
      return { ...base, grants: [grant(principal.userId, ['event.register', 'consultation.join'], 'own')], assignments: [] };
  }
}

// ---------------------------------------------------------------------------
// In-memory webinar repository
// ---------------------------------------------------------------------------

const NOW = new Date('2026-11-10T15:00:00.000Z');

function webinar(): WebinarRecord {
  return {
    id: WEBINAR,
    orgId: ORG,
    title: { en: 'Short breaks that work (sample)' },
    description: null,
    audiencePolicy: { type: 'organization', orgIds: [ORG] },
    capacity: 250,
    startsAt: NOW,
    endsAt: new Date(NOW.getTime() + 60 * 60_000),
    timeZone: 'Europe/Belgrade',
    status: 'live',
    recordingStatus: 'recording',
    chatPolicy: 'moderated',
    createdByUserId: MODERATOR,
    startedAt: NOW,
    endedAt: null,
  };
}

function host(userId: string, role: WebinarHostRecord['role']): WebinarHostRecord {
  return { id: `host_${userId}`, webinarId: WEBINAR, orgId: ORG, userId, role, displayName: userId };
}

function registration(userId: string, canceled = false): WebinarRegistrationRecord {
  return {
    id: `registration_${userId}`,
    webinarId: WEBINAR,
    orgId: ORG,
    userId,
    registeredAt: NOW,
    canceledAt: canceled ? NOW : null,
    handRaisedAt: null,
    floorGivenAt: null,
    votedPollIds: [],
  };
}

class InMemoryWebinars {
  readonly webinars = new Map<string, WebinarRecord>([[WEBINAR, webinar()]]);
  readonly hosts = [host(PRESENTER, 'presenter'), host(MODERATOR, 'moderator'), host(STALE_PRESENTER, 'presenter')];
  readonly registrations = [registration(REGISTRANT), registration(CANCELED, true)];

  async findById(id: string): Promise<WebinarRecord | null> {
    return this.webinars.get(id) ?? null;
  }

  async findHost(webinarId: string, userId: string): Promise<WebinarHostRecord | null> {
    return this.hosts.find((h) => h.webinarId === webinarId && h.userId === userId) ?? null;
  }

  /** Active registrations only, as the repository's. */
  async findRegistration(webinarId: string, userId: string): Promise<WebinarRegistrationRecord | null> {
    return this.registrations.find((r) => r.webinarId === webinarId && r.userId === userId && !r.canceledAt) ?? null;
  }
}

// ---------------------------------------------------------------------------
// Mocked Socket.IO server
// ---------------------------------------------------------------------------

class FakeServer {
  readonly members = new Map<string, Set<FakeSocket>>();

  to(room: string) {
    return {
      emit: (event: string, payload: unknown): boolean => {
        for (const socket of this.members.get(room) ?? []) socket.received.push({ room, event, payload });
        return true;
      },
    };
  }
}

class FakeSocket {
  readonly received: Array<{ room: string; event: string; payload: unknown }> = [];
  readonly data: { principal?: Principal; subscriptions: Map<string, unknown> };

  constructor(
    private readonly server: FakeServer,
    principal: Principal,
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

  emit(): boolean {
    return true;
  }

  events(event: string): unknown[] {
    return this.received.filter((r) => r.event === event).map((r) => r.payload);
  }
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('webinar rooms: Socket.IO subscription and events (T-CW-2.3)', () => {
  let repo: InMemoryWebinars;
  let server: FakeServer;
  let registry: RoomAccessRegistry;
  let gateway: EventsGateway;
  let rooms: RoomEmitter;
  let relay: RoomEventRelay;
  let access: WebinarAccess;
  let unregister: () => void;
  let errors: unknown[][];

  const registrant = principalOf(REGISTRANT);
  const presenter = principalOf(PRESENTER, 'expert');
  const moderator = principalOf(MODERATOR, 'operations');

  function socketOf(principal: Principal): FakeSocket {
    return new FakeSocket(server, principal);
  }

  async function subscribe(socket: FakeSocket, room: string): Promise<{ event: string; data: unknown }> {
    return gateway.handleSubscribe({ room }, socket as unknown as Socket);
  }

  async function subscribed(principal: Principal, ...names: string[]): Promise<FakeSocket> {
    const socket = socketOf(principal);
    for (const room of names) expect(await subscribe(socket, room)).toEqual({ event: 'subscribe:ok', data: { room } });
    return socket;
  }

  /** The relay delivers published envelopes asynchronously. */
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  beforeEach(async () => {
    errors = [];
    for (const level of ['log', 'warn', 'debug', 'verbose'] as const) {
      vi.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
    }
    vi.spyOn(Logger.prototype, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args);
    });

    repo = new InMemoryWebinars();
    server = new FakeServer();
    registry = new RoomAccessRegistry();
    const contextLoader = { build: vi.fn(async (principal: Principal, _resource: Resource) => contextFor(principal)) };
    const authorizer = new SubscriptionAuthorizer(contextLoader as unknown as ContextLoader, registry);
    gateway = new EventsGateway(authorizer);
    gateway.server = server as never;
    const store = new MemoryKeyValueStore();
    rooms = new RoomEmitter(store);
    relay = new RoomEventRelay(store, gateway);
    await relay.onModuleInit();

    access = new WebinarAccess(
      repo as unknown as WebinarsRepository,
      { withOrgScope: (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn(undefined) } as unknown as DbService,
      contextLoader as unknown as ContextLoader,
      { record: vi.fn(async () => undefined) } as unknown as AuditWriter,
    );
    unregister = registerWebinarRooms(registry, { repo: repo as unknown as WebinarsRepository, access });
  });

  afterEach(async () => {
    unregister();
    await relay.onModuleDestroy();
    vi.restoreAllMocks();
  });

  describe('subscription', () => {
    it('registers the three webinar room kinds, once', () => {
      expect(registry.resolverFor('webinar')).toBeTypeOf('function');
      expect(registry.resolverFor('webinar_moderation')).toBeTypeOf('function');
      expect(registry.resolverFor('webinar_hosts')).toBeTypeOf('function');
      expect(() => registerWebinarRooms(registry, { repo: repo as unknown as WebinarsRepository, access })).toThrow(/already registered/);
    });

    it('lets an active registrant into the public room only', async () => {
      const socket = await subscribed(registrant, ROOM);
      for (const room of [MODERATION, HOSTS]) {
        expect(await subscribe(socket, room)).toEqual({ event: 'subscribe:denied', data: { room, reason: 'not_found' } });
      }
    });

    it('lets presenters into the public and hosts rooms but never the moderation room, which carries names (CW-R-36a)', async () => {
      const socket = await subscribed(presenter, ROOM, HOSTS);
      expect(await subscribe(socket, MODERATION)).toEqual({ event: 'subscribe:denied', data: { room: MODERATION, reason: 'not_found' } });
    });

    it('lets the moderator and a moderating principal without a host row into all three rooms', async () => {
      await subscribed(moderator, ROOM, MODERATION, HOSTS);
      await subscribed(principalOf(OPERATIONS, 'operations'), ROOM, MODERATION, HOSTS);
    });

    it.each([
      ['a canceled registration', CANCELED, ROOM],
      ['no registration, though the engine alone would allow the own scope', NOT_REGISTERED, ROOM],
      ['a host row the engine no longer backs', STALE_PRESENTER, HOSTS],
    ])('refuses %s as not_found', async (_label, userId, room) => {
      const principal = principalOf(userId, userId === STALE_PRESENTER ? 'expert' : 'organization');
      expect(await subscribe(socketOf(principal), room)).toEqual({ event: 'subscribe:denied', data: { room, reason: 'not_found' } });
    });

    it('answers an unknown occurrence exactly as a refusal', async () => {
      for (const room of ['webinar:no_such_webinar', 'webinar:no_such_webinar:moderation', 'webinar:no_such_webinar:hosts']) {
        expect(await subscribe(socketOf(moderator), room)).toEqual({ event: 'subscribe:denied', data: { room, reason: 'not_found' } });
      }
    });

    it('derives the target on the server: event.register on the own registration, staff actions on the occurrence', async () => {
      const source = { repo: repo as unknown as WebinarsRepository, access };
      expect(await webinarRoomTarget(source, WEBINAR, registrant)).toEqual({
        action: 'event.register',
        resource: { type: 'webinar', id: WEBINAR, orgId: ORG, ownerId: REGISTRANT },
      });
      expect(await webinarModerationRoomTarget(source, WEBINAR, presenter)).toBeNull();
      expect(await webinarHostsRoomTarget(source, WEBINAR, presenter)).toEqual({
        action: 'event.present',
        resource: { type: 'webinar', id: WEBINAR, orgId: ORG },
      });
      expect(await webinarModerationRoomTarget(source, WEBINAR, moderator)).toEqual({
        action: 'event.moderate',
        resource: { type: 'webinar', id: WEBINAR, orgId: ORG },
      });
      expect(await webinarModerationRoomTarget(source, WEBINAR, registrant)).toBeNull();
      expect(await webinarHostsRoomTarget(source, WEBINAR, registrant)).toBeNull();
    });

    it('answers unavailable when the lookup fails (fail closed)', async () => {
      vi.spyOn(repo, 'findById').mockRejectedValueOnce(new Error('db down'));
      expect(await subscribe(socketOf(registrant), ROOM)).toEqual({ event: 'subscribe:denied', data: { room: ROOM, reason: 'unavailable' } });
    });
  });

  describe('events', () => {
    it('delivers public events to everyone, names to the moderator only, counts and the floor holder to all hosts', async () => {
      const attendee = await subscribed(registrant, ROOM);
      const host = await subscribed(presenter, ROOM, HOSTS);
      const mod = await subscribed(moderator, ROOM, MODERATION, HOSTS);

      expect(rooms.emit(ROOM, 'webinar.state', { webinarId: WEBINAR, status: 'live' })).toBe(true);
      expect(rooms.emit(MODERATION, 'webinar.hand.raised', { participantId: 'p1', participantName: 'Jovan', raisedAt: NOW.toISOString() })).toBe(true);
      expect(rooms.emit(HOSTS, 'webinar.hand.count', { count: 1 })).toBe(true);
      expect(rooms.emit(HOSTS, 'webinar.attendance.count', { webinarId: WEBINAR, count: 12 })).toBe(true);
      expect(rooms.emit(HOSTS, 'webinar.floor.state', { active: true, participantId: 'p1' })).toBe(true);
      expect(rooms.emit(ROOM, 'webinar.floor.state', { active: true })).toBe(true);
      await flush();

      expect(attendee.received.map((r) => r.event)).toEqual(['webinar.state', 'webinar.floor.state']);
      expect(attendee.events('webinar.floor.state')).toEqual([{ active: true }]);
      expect(host.events('webinar.hand.raised')).toEqual([]);
      expect(host.events('webinar.hand.count')).toEqual([{ count: 1 }]);
      expect(host.events('webinar.attendance.count')).toEqual([{ webinarId: WEBINAR, count: 12 }]);
      expect(host.events('webinar.floor.state')).toEqual([{ active: true, participantId: 'p1' }, { active: true }]);
      expect(mod.events('webinar.hand.raised')).toHaveLength(1);
      for (const socket of [attendee, host]) expect(JSON.stringify(socket.received)).not.toContain('Jovan');
    });

    it('refuses moderation events, names and counts on the public room (D-CW-15)', async () => {
      expect(rooms.emit(ROOM, 'webinar.hand.raised', { participantId: 'p1', participantName: 'Jovan', raisedAt: NOW.toISOString() })).toBe(false);
      expect(rooms.emit(ROOM, 'webinar.attendance.count', { webinarId: WEBINAR, count: 12 })).toBe(false);
      expect(rooms.emit(ROOM, 'webinar.message.submitted' as never, {} as never)).toBe(false);
      expect(rooms.emit(MODERATION, 'webinar.poll.opened' as never, {} as never)).toBe(false);
      expect(errors).toHaveLength(4);
    });

    it("sends the floor events to the attendee's own room only (CW-R-34)", async () => {
      const own = await subscribed(registrant, ROOM, `user:${REGISTRANT}`);
      const capabilities = { audio: 'send_receive', video: 'receive', content: 'receive' } as const;
      expect(rooms.emit(ROOM, 'webinar.floor.given', { participantId: 'p1', capabilities })).toBe(false);
      expect(rooms.emit(`user:${REGISTRANT}`, 'webinar.floor.given', { participantId: 'p1', capabilities })).toBe(true);
      expect(rooms.emit(`user:${REGISTRANT}`, 'webinar.floor.given', { participantId: 'p1', capabilities: { ...capabilities, video: 'send_receive' } } as never)).toBe(false);
      await flush();
      expect(own.events('webinar.floor.given')).toEqual([{ participantId: 'p1', capabilities }]);
    });

    it('emits the WBN-26 events through the emitter to the attendee and the hosts only', async () => {
      const own = await subscribed(registrant, ROOM, `user:${REGISTRANT}`);
      const host = await subscribed(presenter, ROOM, HOSTS);
      const publish = vi.spyOn(rooms, 'emit');
      expect(rooms.emit(`user:${REGISTRANT}`, 'webinar.floor.muted', {})).toBe(true);
      expect(rooms.emit(`user:${REGISTRANT}`, 'webinar.floor.unmute_requested', {})).toBe(true);
      expect(rooms.emit(HOSTS, 'webinar.floor.muted', { participantId: 'p1' })).toBe(true);
      expect(rooms.emit(HOSTS, 'webinar.floor.unmuted', { participantId: 'p1' })).toBe(true);
      expect(rooms.emit(ROOM, 'webinar.floor.muted', {})).toBe(false);
      expect(rooms.emit(`user:${REGISTRANT}`, 'webinar.floor.muted', { participantId: 'p1' })).toBe(false);
      expect(publish).toHaveBeenCalledTimes(6);
      await flush();
      expect(own.events('webinar.floor.muted')).toEqual([{}]);
      expect(own.events('webinar.floor.unmute_requested')).toEqual([{}]);
      expect(host.events('webinar.floor.muted')).toEqual([{ participantId: 'p1' }]);
      expect(host.events('webinar.floor.unmuted')).toEqual([{ participantId: 'p1' }]);
      expect(own.events('webinar.floor.unmuted')).toEqual([]);
      expect(errors).toHaveLength(2);
    });

    it('sends webinar.ended to both rooms', async () => {
      const attendee = await subscribed(registrant, ROOM);
      const host = await subscribed(moderator, MODERATION);
      const ended = { webinarId: WEBINAR, endedAt: NOW.toISOString() };
      expect(rooms.emit(ROOM, 'webinar.ended', ended)).toBe(true);
      expect(rooms.emit(MODERATION, 'webinar.ended', ended)).toBe(true);
      await flush();
      expect(attendee.events('webinar.ended')).toEqual([ended]);
      expect(host.events('webinar.ended')).toEqual([ended]);
    });

    it('carries the canonical additions on the public room, anonymous', async () => {
      const attendee = await subscribed(registrant, ROOM);
      expect(rooms.emit(ROOM, 'webinar.message.removed', { messageId: 'm1' })).toBe(true);
      expect(rooms.emit(ROOM, 'webinar.floor.state', { active: true })).toBe(true);
      expect(rooms.emit(ROOM, 'webinar.floor.state', { active: true, participantId: 'p1' } as never)).toBe(false);
      expect(rooms.emit(MODERATION, 'webinar.floor.state', { active: false })).toBe(false);
      await flush();
      expect(attendee.events('webinar.message.removed')).toEqual([{ messageId: 'm1' }]);
      expect(attendee.events('webinar.floor.state')).toEqual([{ active: true }]);
    });
  });

  describe('start-up', () => {
    function moduleRefWith(get: (token: unknown) => unknown) {
      return { get: vi.fn(get) } as never;
    }

    it('registers the three resolvers at application bootstrap and removes them on shutdown', () => {
      const fresh = new RoomAccessRegistry();
      const resolvers = new WebinarRoomResolvers(fresh, moduleRefWith((token) => (token === WebinarAccess ? access : repo)));
      resolvers.onApplicationBootstrap();
      expect(['webinar', 'webinar_moderation', 'webinar_hosts'].map((kind) => typeof fresh.resolverFor(kind as never))).toEqual([
        'function',
        'function',
        'function',
      ]);
      resolvers.onModuleDestroy();
      expect(fresh.resolverFor('webinar')).toBeUndefined();
    });

    it('fails the start-up loudly when the webinars module cannot be found', () => {
      const resolvers = new WebinarRoomResolvers(
        new RoomAccessRegistry(),
        moduleRefWith(() => {
          throw new Error('Nest could not find WebinarsRepository element');
        }),
      );
      expect(() => resolvers.onApplicationBootstrap()).toThrow(/webinars module is not loaded/);
    });
  });
});
