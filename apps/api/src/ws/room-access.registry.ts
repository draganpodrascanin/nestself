/**
 * RoomAccessRegistry (T-CW-1.6): who may subscribe to a feature module's
 * rooms is decided by that module, on the server.
 *
 * The module that owns a room kind registers one resolver at start-up
 * (`CallsService` registers `call`; T-CW-2.3 registers `webinar` and
 * `webinar_moderation`). Given the id inside the room name and the
 * subscriber, the resolver loads the record and returns the action and the
 * resource `authorize()` must allow, or null when the room does not exist or
 * the subscriber has no place in it (not a participant, not registered).
 * `SubscriptionAuthorizer` then runs the engine. A kind without a resolver is
 * not served yet and every subscription to it is refused.
 *
 * The registry lives in `WsModule` so feature modules can import it without
 * `WsModule` importing them back.
 *
 * The user room (`user:{userId}`, T-CW-1.9) has no resolver: only that user
 * may subscribe, an identity check `SubscriptionAuthorizer` makes itself
 * before any lookup; {@link userRoomTarget} is what it records.
 */
import { Injectable } from '@nestjs/common';
import { ACTIONS, type Action, type Principal, type Resource } from '@nestself/contracts';
import type { ModuleRoomKind } from './ws-messages.js';

/** What a room subscription is authorised against, derived on the server. */
export interface RoomTarget {
  action: Action;
  resource: Resource;
}

/**
 * What a `user:{userId}` subscription records: the subscriber's own user
 * record. Never evaluated by the engine; the room is allowed to that user
 * and to nobody else, whatever their grants.
 */
export function userRoomTarget(userId: string): RoomTarget {
  return { action: ACTIONS['preferences.manage'], resource: { type: 'user', id: userId, ownerId: userId } };
}

/** Null when the room does not exist or the principal has no place in it; both read as `not_found`. */
export type RoomTargetResolver = (id: string, principal: Principal) => Promise<RoomTarget | null>;

@Injectable()
export class RoomAccessRegistry {
  private readonly resolvers = new Map<ModuleRoomKind, RoomTargetResolver>();

  register(kind: ModuleRoomKind, resolver: RoomTargetResolver): void {
    if (this.resolvers.has(kind)) throw new Error(`RoomAccessRegistry: a resolver for "${kind}" rooms is already registered`);
    this.resolvers.set(kind, resolver);
  }

  unregister(kind: ModuleRoomKind): void {
    this.resolvers.delete(kind);
  }

  resolverFor(kind: ModuleRoomKind): RoomTargetResolver | undefined {
    return this.resolvers.get(kind);
  }
}
