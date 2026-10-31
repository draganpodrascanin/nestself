/**
 * EventsGateway — Socket.IO gateway with subscribe/unsubscribe handlers.
 *
 * Served rooms and the rule behind each are listed in `ws-messages.ts`; a
 * subscription is authorised from the room name alone (T-CW-1.6).
 *
 * The gateway is marked `@Public()` to bypass the global authentication,
 * CSRF and authorization guards, which are not designed for WebSocket
 * execution contexts. The global `AppThrottlerGuard` still runs on every
 * message and tracks a socket by its id (60 messages a minute per handler
 * and connection). Authentication is enforced in the `NestSelfIoAdapter`
 * handshake middleware (AUTHZ-R-58), and per-subscription authorization is
 * enforced via `SubscriptionAuthorizer` in each handler (AUTHZ-R-59).
 *
 * The default-deny test (AUTHZ-R-62) accepts `@Public()`.
 *
 * @see 4.6.7, AUTHZ-R-58, AUTHZ-R-59, T-1.11, T-CW-1.6
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
import type { Principal } from '@nestself/contracts';

import { Public } from '../authz/public.decorator.js';
import type { RoomTarget } from './room-access.registry.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { SubscriptionAuthorizer } from './subscription-authorizer.js';
import {
  CallSubscribeSchema,
  SubscribeMessageSchema,
  UnsubscribeMessageSchema,
  parseRoom,
  type SubscribeDenialReason,
} from './ws-messages.js';

function denied(room: string | null, reason: SubscribeDenialReason): { event: string; data: unknown } {
  return { event: 'subscribe:denied', data: { room, reason } };
}

@Public()
@WebSocketGateway({ path: '/api/ws' })
export class EventsGateway {
  private readonly logger = new Logger(EventsGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly authorizer: SubscriptionAuthorizer,
  ) {}

  /**
   * `subscribe { room }`. Only the served room names parse (`ws-messages.ts`);
   * the authorisation is derived from the room on the server, whatever
   * `action` and `resource` the client sends (T-CW-1.6).
   */
  @SubscribeMessage('subscribe')
  async handleSubscribe(
    @MessageBody() data: unknown,
    @ConnectedSocket() socket: Socket,
  ): Promise<{ event: string; data: unknown }> {
    const parsed = SubscribeMessageSchema.safeParse(data);
    if (!parsed.success) {
      const roomIssue = parsed.error.issues.some((issue) => issue.path[0] === 'room');
      return denied(null, roomIssue ? 'invalid_room' : 'invalid_payload');
    }

    const { room } = parsed.data;
    const principal = socket.data.principal as Principal | undefined;

    if (!principal) {
      return denied(room, 'unauthenticated');
    }

    const target = parseRoom(room);
    if (!target) return denied(null, 'invalid_room');
    if (target.kind === 'call' && !CallSubscribeSchema.safeParse(data).success) {
      return denied(room, 'invalid_payload');
    }

    const decision = await this.authorizer.authorizeRoom(principal, target);

    if (!decision.allowed) {
      this.logger.debug(
        `subscribe denied: user=${principal.userId} room=${room} reason=${decision.reason}`,
      );
      return denied(room, decision.reason);
    }

    // Join the room and record the subscription with its server-derived target
    await socket.join(room);
    const subscriptions =
      (socket.data.subscriptions as Map<string, RoomTarget> | undefined) ??
      new Map<string, RoomTarget>();
    subscriptions.set(room, decision.target);
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
