/**
 * RoomEmitter: server-side emits to a Socket.IO room, for services that
 * publish real-time events (the calls module emits the `call:{sessionId}`
 * events of `ROOM_EVENTS`), from the API and from the worker alike.
 *
 * Every payload is checked before it leaves (CW-R-36): the event must be one
 * `ROOM_EVENTS` lists, the room must be of the event's kind, and the payload
 * must pass the event's strict schema (ids, roles, statuses and times only;
 * never a name, an email, a location text or a token). A failure is dropped
 * and logged at error level with the event name only: fail closed.
 *
 * A checked event is published as `{ room, event, payload }` on the room
 * events channel (`ROOM_EVENTS_CHANNEL`) and never emitted locally: the
 * `RoomEventRelay` of every API task, this one included, emits it to its own
 * sockets, so a socket on any task receives it exactly once and the worker,
 * which has no Socket.IO server, can emit too. The emitter depends on the
 * store only.
 *
 * Emitting is best effort: a failed publish is logged at warn with the event
 * name and never thrown, because the request or job that caused it has
 * already succeeded.
 *
 * Who may join a room is decided at subscription time (`EventsGateway`,
 * `SubscriptionAuthorizer`, `RoomAccessRegistry`).
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { KEY_VALUE_STORE, type KeyValueStore } from '../redis/key-value-store.js';
import { ROOM_EVENTS_CHANNEL } from '../redis/redis-keys.js';
import { checkRoomEvent, type RoomEventEnvelope, type RoomEventName, type RoomEventPayload } from './ws-messages.js';

@Injectable()
export class RoomEmitter {
  private readonly logger = new Logger(RoomEmitter.name);

  constructor(@Inject(KEY_VALUE_STORE) private readonly store: KeyValueStore) {}

  /**
   * Publishes `event` for every socket in `room`. False when the event, the
   * room or the payload fails its check; true once the publish has started.
   */
  emit<E extends RoomEventName>(room: string, event: E, payload: RoomEventPayload<E>): boolean {
    const checked = checkRoomEvent(room, event, payload);
    if (!checked) {
      this.logger.error({ event }, 'Room event failed its schema; not emitted');
      return false;
    }

    const envelope: RoomEventEnvelope = { room, event, payload: checked };
    const failed = (error: unknown): void => {
      this.logger.warn(
        { event, error: error instanceof Error ? error.name : 'UnknownError' },
        'Room event publish failed; event dropped',
      );
    };
    try {
      this.store.publish(ROOM_EVENTS_CHANNEL, JSON.stringify(envelope)).catch(failed);
    } catch (error) {
      failed(error);
    }
    return true;
  }
}
