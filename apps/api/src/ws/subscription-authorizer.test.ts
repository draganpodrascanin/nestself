/**
 * Unit tests for SubscriptionAuthorizer.
 *
 * @see T-1.11, T-CW-1.6, AUTHZ-R-59
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import type { GrantInput } from '@nestself/contracts';
import { RoomAccessRegistry, type RoomTarget } from './room-access.registry.js';
import { SubscriptionAuthorizer } from './subscription-authorizer.js';
import { parseRoom, type ParsedRoom } from './ws-messages.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const PRINCIPAL = {
  userId: 'user_jovan',
  displayName: 'Jovan',
  initials: 'JP',
  locale: 'sr-Latn',
  memberships: [
    {
      membershipId: 'mem_1',
      orgId: 'org_sample',
      orgUnitId: 'ou_root',
      status: 'ACTIVE' as const,
      startDate: '2024-01-01T00:00:00.000Z',
      endDate: null,
    },
  ],
  staffTemplates: [],
  expert: null,
  context: { kind: 'organization' as const, orgId: 'org_sample' },
  auth: {
    method: 'email_otp' as const,
    time: '2024-01-01T00:00:00Z',
    secondFactor: false,
    lastStepUpAt: null,
  },
  sessionId: 'sid_1',
  tokenFamily: null,
};

function grant(actions: string[], scopeType: GrantInput['scopeType'] = 'organization'): GrantInput {
  return {
    id: 'grant_1',
    subjectUserId: 'user_jovan',
    templateKey: '',
    actions,
    scopeType,
    scopeOrgId: scopeType === 'organization' ? 'org_sample' : null,
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

function contextLoaderWith(grants: GrantInput[]) {
  return {
    build: vi.fn().mockResolvedValue({
      now: new Date(),
      isDeactivated: false,
      isSuspended: false,
      grants,
      assignments: [],
      ancestorIds: [],
      orgSelfApprovalAllowed: false,
      organizationTimezone: 'UTC',
    }),
  };
}

function room(name: string): ParsedRoom {
  const parsed = parseRoom(name);
  if (!parsed) throw new Error(`not a served room: ${name}`);
  return parsed;
}

const CALL_TARGET: RoomTarget = {
  action: 'consultation.join',
  resource: { type: 'appointment', id: 'appt_1', orgId: 'org_sample', ownerId: 'user_jovan', category: 'psychological' },
};

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SubscriptionAuthorizer', () => {
  it('returns allow when the grant-based engine approves', async () => {
    const authorizer = new SubscriptionAuthorizer(
      contextLoaderWith([grant(['program.overview'])]) as never,
      new RoomAccessRegistry(),
    );
    const decision = await authorizer.authorizeSubscription(PRINCIPAL, 'program.overview', {
      type: 'program',
      orgId: 'org_sample',
    });

    expect(decision.allowed).toBe(true);
  });

  it('returns deny when no matching grant exists', async () => {
    const authorizer = new SubscriptionAuthorizer(contextLoaderWith([]) as never, new RoomAccessRegistry());
    const decision = await authorizer.authorizeSubscription(PRINCIPAL, 'program.overview', {
      type: 'program',
      orgId: 'org_sample',
    });

    expect(decision.allowed).toBe(false);
  });

  describe('authorizeRoom', () => {
    it('derives program.overview on the organization from an org programme room', async () => {
      const loader = contextLoaderWith([grant(['program.overview'])]);
      const authorizer = new SubscriptionAuthorizer(loader as never, new RoomAccessRegistry());

      const decision = await authorizer.authorizeRoom(PRINCIPAL, room('org:org_sample:programme'));

      expect(decision).toEqual({
        allowed: true,
        target: { action: 'program.overview', resource: { type: 'program', orgId: 'org_sample' } },
      });
      expect(loader.build).toHaveBeenCalledWith(PRINCIPAL, { type: 'program', orgId: 'org_sample' }, {
        action: 'program.overview',
      });
    });

    it('denies an org programme room of another organization with the engine reason', async () => {
      const authorizer = new SubscriptionAuthorizer(
        contextLoaderWith([grant(['program.overview'])]) as never,
        new RoomAccessRegistry(),
      );
      const decision = await authorizer.authorizeRoom(PRINCIPAL, room('org:org_other:programme'));
      expect(decision.allowed).toBe(false);
      expect(decision.allowed ? null : decision.reason).toEqual(expect.any(String));
      expect(decision.allowed ? null : decision.reason).not.toBe('not_found');
    });

    it.each(['webinar:w1', 'webinar:w1:moderation', 'call:session_1'])(
      'answers room_not_available for %s while no module serves it',
      async (name) => {
        const loader = contextLoaderWith([grant(['consultation.join', 'event.register', 'event.moderate'], 'platform')]);
        const authorizer = new SubscriptionAuthorizer(loader as never, new RoomAccessRegistry());
        expect(await authorizer.authorizeRoom(PRINCIPAL, room(name))).toEqual({
          allowed: false,
          reason: 'room_not_available',
        });
        expect(loader.build).not.toHaveBeenCalled();
      },
    );

    it('authorizes the target the module derives, with the module given the room id and principal', async () => {
      const registry = new RoomAccessRegistry();
      const resolve = vi.fn().mockResolvedValue(CALL_TARGET);
      registry.register('call', resolve);
      const loader = contextLoaderWith([grant(['consultation.join'], 'own')]);
      const authorizer = new SubscriptionAuthorizer(loader as never, registry);

      expect(await authorizer.authorizeRoom(PRINCIPAL, room('call:session_1'))).toEqual({
        allowed: true,
        target: CALL_TARGET,
      });
      expect(resolve).toHaveBeenCalledWith('session_1', PRINCIPAL);
      expect(loader.build).toHaveBeenCalledWith(PRINCIPAL, CALL_TARGET.resource, { action: 'consultation.join' });
    });

    it('answers not_found when the module finds no room for the principal', async () => {
      const registry = new RoomAccessRegistry();
      registry.register('call', async () => null);
      const loader = contextLoaderWith([grant(['consultation.join'], 'platform')]);
      const authorizer = new SubscriptionAuthorizer(loader as never, registry);

      expect(await authorizer.authorizeRoom(PRINCIPAL, room('call:session_1'))).toEqual({
        allowed: false,
        reason: 'not_found',
      });
      expect(loader.build).not.toHaveBeenCalled();
    });

    it('answers not_found, not the engine reason, when the engine denies a module room', async () => {
      const registry = new RoomAccessRegistry();
      registry.register('call', async () => CALL_TARGET);
      const authorizer = new SubscriptionAuthorizer(contextLoaderWith([]) as never, registry);

      expect(await authorizer.authorizeRoom(PRINCIPAL, room('call:session_1'))).toEqual({
        allowed: false,
        reason: 'not_found',
      });
    });

    it('fails closed with unavailable when the module lookup throws', async () => {
      const errors: unknown[][] = [];
      vi.spyOn(Logger.prototype, 'error').mockImplementation((...args: unknown[]) => {
        errors.push(args);
      });
      const registry = new RoomAccessRegistry();
      registry.register('call', async () => {
        throw new Error('connection refused');
      });
      const authorizer = new SubscriptionAuthorizer(contextLoaderWith([]) as never, registry);

      expect(await authorizer.authorizeRoom(PRINCIPAL, room('call:session_1'))).toEqual({
        allowed: false,
        reason: 'unavailable',
      });
      expect(errors).toHaveLength(1);
    });
  });

  describe('reauthorizeAll', () => {
    function socketWith(subscriptions: Map<string, RoomTarget>) {
      return {
        data: { principal: PRINCIPAL, subscriptions },
        leave: vi.fn(),
        emit: vi.fn(),
      };
    }

    it('revokes rooms that are no longer allowed', async () => {
      const authorizer = new SubscriptionAuthorizer(contextLoaderWith([]) as never, new RoomAccessRegistry());
      const subscriptions = new Map<string, RoomTarget>([
        ['org:org_sample:programme', { action: 'program.overview', resource: { type: 'program', orgId: 'org_sample' } }],
      ]);
      const socket = socketWith(subscriptions);

      const revoked = await authorizer.reauthorizeAll(socket as never);

      expect(revoked).toEqual(['org:org_sample:programme']);
      expect(socket.leave).toHaveBeenCalledWith('org:org_sample:programme');
      expect(socket.emit).toHaveBeenCalledWith('subscription:revoked', {
        room: 'org:org_sample:programme',
      });
      expect(subscriptions.size).toBe(0);
    });

    it('resolves a module room again, so a principal who stopped being a participant loses it', async () => {
      const registry = new RoomAccessRegistry();
      const resolve = vi.fn().mockResolvedValueOnce(null);
      registry.register('call', resolve);
      const authorizer = new SubscriptionAuthorizer(contextLoaderWith([grant(['consultation.join'], 'own')]) as never, registry);
      const subscriptions = new Map<string, RoomTarget>([['call:session_1', CALL_TARGET]]);
      const socket = socketWith(subscriptions);

      expect(await authorizer.reauthorizeAll(socket as never)).toEqual(['call:session_1']);
      expect(resolve).toHaveBeenCalledWith('session_1', PRINCIPAL);
      expect(subscriptions.size).toBe(0);
    });

    it('keeps a module room that is still allowed', async () => {
      const registry = new RoomAccessRegistry();
      registry.register('call', async () => CALL_TARGET);
      const authorizer = new SubscriptionAuthorizer(contextLoaderWith([grant(['consultation.join'], 'own')]) as never, registry);
      const subscriptions = new Map<string, RoomTarget>([['call:session_1', CALL_TARGET]]);
      const socket = socketWith(subscriptions);

      expect(await authorizer.reauthorizeAll(socket as never)).toEqual([]);
      expect(socket.leave).not.toHaveBeenCalled();
      expect(subscriptions.size).toBe(1);
    });
  });
});
