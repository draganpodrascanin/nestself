/**
 * SubscriptionAuthorizer — per-subscription authorization check using
 * the ContextLoader + authorize() engine.
 *
 * @see AUTHZ-R-59, T-1.11
 */
import { Inject, Injectable, forwardRef } from '@nestjs/common';

import { ContextLoader } from '../authz/context-loader.js';
import { authorize } from '../authz/authorize.js';
import type {
  Principal,
  Action,
  Resource,
  Decision,
} from '@nestself/contracts';
import type { Socket } from 'socket.io';

@Injectable()
export class SubscriptionAuthorizer {
  constructor(
    @Inject(forwardRef(() => ContextLoader))
    private readonly contextLoader: ContextLoader,
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

  /**
   * Re-evaluate every recorded subscription on a socket.
   * Returns the list of rooms that were revoked.
   */
  async reauthorizeAll(
    socket: Socket,
  ): Promise<string[]> {
    const principal = socket.data.principal as Principal | undefined;
    if (!principal) return [];

    const subscriptions =
      (socket.data.subscriptions as Map<string, { action: Action; resource: Resource }>) ??
      new Map();
    const revoked: string[] = [];

    for (const [room, { action, resource }] of subscriptions) {
      const decision = await this.authorizeSubscription(
        principal,
        action,
        resource,
      );
      if (!decision.allowed) {
        socket.leave(room);
        subscriptions.delete(room);
        socket.emit('subscription:revoked', { room });
        revoked.push(room);
      }
    }

    return revoked;
  }
}
