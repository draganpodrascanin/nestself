/**
 * RoomEmitter: server-side emits to a Socket.IO room through the
 * `EventsGateway` server, for services that publish real-time events (the
 * calls module emits the `call:{sessionId}` events of `ROOM_EVENTS`).
 *
 * Every payload is checked before it leaves (CW-R-36): the event must be one
 * `ROOM_EVENTS` lists, the room must be of the event's kind, and the payload
 * must pass the event's strict schema (ids, roles, statuses and times only;
 * never a name, an email, a location text or a token). A failure is dropped
 * and logged at error level with the event name only: fail closed.
 *
 * Emitting is best effort: before the gateway's server exists (a process
 * without the Socket.IO adapter) a valid event is dropped and logged, never
 * thrown, because the HTTP request that caused it has already succeeded.
 *
 * Who may join a room is decided at subscription time (`EventsGateway`,
 * `SubscriptionAuthorizer`, `RoomAccessRegistry`).
 */
import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'socket.io';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { EventsGateway } from './events.gateway.js';
import { ROOM_EVENTS, parseRoom, type RoomEventName, type RoomEventPayload } from './ws-messages.js';

@Injectable()
export class RoomEmitter {
  private readonly logger = new Logger(RoomEmitter.name);

  constructor(private readonly gateway: EventsGateway) {}

  /**
   * Emits `event` to every socket in `room`. False when the event, the room
   * or the payload fails its check, or when no Socket.IO server is running.
   */
  emit<E extends RoomEventName>(room: string, event: E, payload: RoomEventPayload<E>): boolean {
    const spec = Object.hasOwn(ROOM_EVENTS, event) ? ROOM_EVENTS[event] : undefined;
    const parsed = spec?.schema.safeParse(payload);
    if (!spec || parseRoom(room)?.kind !== spec.roomKind || !parsed?.success) {
      this.logger.error({ event }, 'Room event failed its schema; not emitted');
      return false;
    }

    const server = this.gateway.server as Server | undefined;
    if (!server) {
      this.logger.warn({ room, event }, 'No Socket.IO server; room event dropped');
      return false;
    }
    server.to(room).emit(event, parsed.data);
    return true;
  }
}
