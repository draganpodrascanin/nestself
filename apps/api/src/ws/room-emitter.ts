/**
 * RoomEmitter: server-side emits to a Socket.IO room through the
 * `EventsGateway` server, for services that publish real-time events (the
 * calls module emits `call.signal`, `call.participant.joined`,
 * `call.participant.left` and `call.session.ended` to `call:{sessionId}`).
 *
 * Emitting is best effort: before the gateway's server exists (a process
 * without the Socket.IO adapter) the event is dropped and logged, never
 * thrown, because the HTTP request that caused it has already succeeded.
 * Payloads carry ids, roles and types only, never names or credentials.
 *
 * Who may join a room is decided at subscription time (`EventsGateway`,
 * `SubscriptionAuthorizer`); the `call:` room pattern and its subscription
 * rule arrive with T-CW-1.6.
 */
import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'socket.io';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { EventsGateway } from './events.gateway.js';

@Injectable()
export class RoomEmitter {
  private readonly logger = new Logger(RoomEmitter.name);

  constructor(private readonly gateway: EventsGateway) {}

  /** Emits `event` to every socket in `room`. False when no Socket.IO server is running. */
  emit(room: string, event: string, payload: Record<string, unknown>): boolean {
    const server = this.gateway.server as Server | undefined;
    if (!server) {
      this.logger.warn({ room, event }, 'No Socket.IO server; room event dropped');
      return false;
    }
    server.to(room).emit(event, payload);
    return true;
  }
}
