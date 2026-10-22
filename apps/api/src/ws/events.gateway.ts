/**
 * EventsGateway — Socket.IO gateway with generic subscribe/unsubscribe handlers.
 *
 * The gateway is marked `@Public()` to bypass the global HTTP guards
 * (AuthenticationGuard, CsrfGuard, AuthorizationGuard, ThrottlerGuard)
 * which are not designed for WebSocket execution contexts.
 * Authentication is enforced in the `NestSelfIoAdapter` handshake middleware
 * (AUTHZ-R-58), and per-subscription authorization is enforced via
 * `SubscriptionAuthorizer` in each handler (AUTHZ-R-59).
 *
 * The default-deny test (AUTHZ-R-62) accepts `@Public()`.
 *
 * @see 4.6.7, AUTHZ-R-58, AUTHZ-R-59, T-1.11
 */
import {
  WebSocketGateway,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import type { Server, Socket } from 'socket.io';
import type { Action, Resource } from '@nestself/contracts';

import { Public } from '../authz/public.decorator.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { SubscriptionAuthorizer } from './subscription-authorizer.js';
import {
  SubscribeMessageSchema,
  UnsubscribeMessageSchema,
} from './ws-messages.js';

@Public()
@WebSocketGateway({ path: '/api/ws' })
export class EventsGateway {
  private readonly logger = new Logger(EventsGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly authorizer: SubscriptionAuthorizer,
  ) {}

  @SubscribeMessage('subscribe')
  async handleSubscribe(
    @MessageBody() data: unknown,
    @ConnectedSocket() socket: Socket,
  ): Promise<{ event: string; data: unknown }> {
    const parsed = SubscribeMessageSchema.safeParse(data);
    if (!parsed.success) {
      return {
        event: 'subscribe:denied',
        data: { room: null, reason: 'invalid_payload' },
      };
    }

    const { room, action, resource } = parsed.data;
    const principal = socket.data.principal;

    if (!principal) {
      return {
        event: 'subscribe:denied',
        data: { room, reason: 'unauthenticated' },
      };
    }

    const decision = await this.authorizer.authorizeSubscription(
      principal,
      action as Action,
      resource as Resource,
    );

    if (!decision.allowed) {
      this.logger.debug(
        `subscribe denied: user=${principal.userId} room=${room} reason=${decision.denialReason}`,
      );
      return {
        event: 'subscribe:denied',
        data: { room, reason: decision.denialReason ?? 'denied' },
      };
    }

    // Join the room and record the subscription
    await socket.join(room);
    const subscriptions =
      (socket.data.subscriptions as Map<
        string,
        { action: Action; resource: Resource }
      >) ?? new Map();
    subscriptions.set(room, {
      action: action as Action,
      resource: resource as Resource,
    });
    socket.data.subscriptions = subscriptions;

    this.logger.debug(
      `subscribe allowed: user=${principal.userId} room=${room}`,
    );
    return {
      event: 'subscribe:ok',
      data: { room },
    };
  }

  @SubscribeMessage('unsubscribe')
  async handleUnsubscribe(
    @MessageBody() data: unknown,
    @ConnectedSocket() socket: Socket,
  ): Promise<{ event: string; data: unknown }> {
    const parsed = UnsubscribeMessageSchema.safeParse(data);
    if (!parsed.success) {
      return {
        event: 'unsubscribe:error',
        data: { reason: 'invalid_payload' },
      };
    }

    const { room } = parsed.data;
    socket.leave(room);

    const subscriptions = socket.data.subscriptions as
      | Map<string, unknown>
      | undefined;
    subscriptions?.delete(room);

    return {
      event: 'unsubscribe:ok',
      data: { room },
    };
  }
}
