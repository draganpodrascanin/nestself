/**
 * SubscriptionAuthorizer — per-subscription authorization check using
 * the ContextLoader + authorize() engine.
 *
 * `authorizeRoom` decides a subscription from the room name alone: the
 * action and the resource are derived on the server (T-CW-1.6), never taken
 * from the client.
 *
 * - `org:{orgId}:programme`: `program.overview` on the organization; a denial
 *   carries the engine's reason (T-1.11).
 * - `user:{userId}`: that user only, by identity, with no lookup and no
 *   engine decision; anyone else gets `not_found` (T-CW-1.9, CALL-42).
 * - `call:`, `webinar:`, `webinar:...:moderation`: the module that owns the
 *   kind resolves the room (`RoomAccessRegistry`); no resolver answers
 *   `room_not_available`, a missing room, a principal with no place in it and
 *   an engine denial all answer `not_found` (no existence leak, D-CW-30), and
 *   a failing lookup answers `unavailable` (fail closed).
 *
 * @see AUTHZ-R-59, T-1.11, T-CW-1.6
 */
import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';

import { ContextLoader } from '../authz/context-loader.js';
import { authorize } from '../authz/authorize.js';
import type {
  Principal,
  Action,
  Resource,
  Decision,
} from '@nestself/contracts';
import type { Socket } from 'socket.io';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { RoomAccessRegistry, userRoomTarget, type RoomTarget } from './room-access.registry.js';
import { parseRoom, type ParsedRoom, type SubscribeDenialReason } from './ws-messages.js';

export type RoomDecision =
  | { allowed: true; target: RoomTarget }
  | { allowed: false; reason: SubscribeDenialReason };

const NOT_FOUND: RoomDecision = { allowed: false, reason: 'not_found' };

@Injectable()
export class SubscriptionAuthorizer {
  private readonly logger = new Logger(SubscriptionAuthorizer.name);

  constructor(
    @Inject(forwardRef(() => ContextLoader))
    private readonly contextLoader: ContextLoader,
    private readonly rooms: RoomAccessRegistry,
  ) {}

  /**
   * Check whether the principal is allowed to perform `action` on `resource`.
   */
  async authorizeSubscription(
    principal: Principal,
    action: Action,
    resource: Resource,
  ): Promise<Decision> {
    const ctx = await this.contextLoader.build(principal, resource, { action });
    return authorize(principal, action, resource, ctx);
  }

  /** Whether the principal may subscribe to `room`, against a target derived on the server. */
  async authorizeRoom(principal: Principal, room: ParsedRoom): Promise<RoomDecision> {
    if (room.kind === 'org_programme') {
      const target: RoomTarget = { action: 'program.overview', resource: { type: 'program', orgId: room.id } };
      const decision = await this.authorizeSubscription(principal, target.action, target.resource);
      return decision.allowed ? { allowed: true, target } : { allowed: false, reason: decision.denialReason ?? 'denied' };
    }

    if (room.kind === 'user') {
      return room.id === principal.userId ? { allowed: true, target: userRoomTarget(room.id) } : NOT_FOUND;
    }

    const resolve = this.rooms.resolverFor(room.kind);
    if (!resolve) return { allowed: false, reason: 'room_not_available' };
    try {
      const target = await resolve(room.id, principal);
      if (!target) return NOT_FOUND;
      const decision = await this.authorizeSubscription(principal, target.action, target.resource);
      return decision.allowed ? { allowed: true, target } : NOT_FOUND;
    } catch (error) {
      this.logger.error(
        { roomKind: room.kind, error: error instanceof Error ? error.name : 'UnknownError' },
        'Room subscription lookup failed',
      );
      return { allowed: false, reason: 'unavailable' };
    }
  }

  /**
   * Re-evaluate every recorded subscription on a socket, resolving each room
   * again (a participant may have been replaced).
   * Returns the list of rooms that were revoked.
   */
  async reauthorizeAll(
    socket: Socket,
  ): Promise<string[]> {
    const principal = socket.data.principal as Principal | undefined;
    if (!principal) return [];

    const subscriptions =
      (socket.data.subscriptions as Map<string, RoomTarget> | undefined) ??
      new Map<string, RoomTarget>();
    const revoked: string[] = [];

    for (const room of [...subscriptions.keys()]) {
      const parsed = parseRoom(room);
      const decision = parsed ? await this.authorizeRoom(principal, parsed) : NOT_FOUND;
      if (!decision.allowed) {
        void socket.leave(room);
        subscriptions.delete(room);
        socket.emit('subscription:revoked', { room });
        revoked.push(room);
      }
    }

    return revoked;
  }
}
