/**
 * WebinarRoomEvents: the webinar module's side of the real-time layer
 * (T-CW-2.1, D-CW-16, guidelines 8). Every event goes through `RoomEmitter`,
 * which publishes it on the room events channel for every API task:
 *
 * - `webinar:{webinarId}` (everyone): `webinar.state`,
 *   `webinar.message.published`, `webinar.message.answered`,
 *   `webinar.poll.opened`, `webinar.poll.closed`, `webinar.poll.results`,
 *   `webinar.recording`, `webinar.ended`;
 * - `webinar:{webinarId}:moderation` (hosts): `webinar.message.submitted`,
 *   `webinar.hand.raised`, `webinar.hand.lowered`,
 *   `webinar.attendance.count`, and `webinar.ended`;
 * - `user:{userId}` (one attendee, CW-R-34): `webinar.floor.given` and
 *   `webinar.floor.taken`.
 *
 * Each payload is checked here against the contract's
 * `WEBINAR_EVENT_PAYLOAD_SCHEMAS` first (strict objects: no name reaches the
 * public room, D-CW-15) and dropped with an error log on failure. The
 * emitter's own event table (`ROOM_EVENTS` in `ws/ws-messages.ts`) gains the
 * webinar events with T-CW-2.3; until then it refuses them as well, which
 * fails closed and never breaks the request that emitted.
 */
import { Injectable, Logger } from '@nestjs/common';
import {
  WEBINAR_EVENT_PAYLOAD_SCHEMAS,
  userRoomName,
  webinarModerationRoomName,
  webinarRoomName,
  type WebinarEventName,
  type WebinarEventPayloads,
  type WebinarModerationRoomEventName,
  type WebinarParticipantEventName,
  type WebinarRoomEventName,
} from '@nestself/contracts';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { RoomEmitter } from '../ws/room-emitter.js';

/** `RoomEmitter.emit` without its event-name typing, which lists the webinar events from T-CW-2.3 on. */
type UntypedEmit = (room: string, event: string, payload: unknown) => boolean;

@Injectable()
export class WebinarRoomEvents {
  private readonly logger = new Logger(WebinarRoomEvents.name);

  constructor(private readonly rooms: RoomEmitter) {}

  /** An event of the public room `webinar:{webinarId}`. */
  toAudience<E extends WebinarRoomEventName>(webinarId: string, event: E, payload: WebinarEventPayloads[E]): boolean {
    return this.send(webinarRoomName(webinarId), event, payload);
  }

  /** An event of the hosts' room `webinar:{webinarId}:moderation`. */
  toModeration<E extends WebinarModerationRoomEventName | 'webinar.ended'>(
    webinarId: string,
    event: E,
    payload: WebinarEventPayloads[E],
  ): boolean {
    return this.send(webinarModerationRoomName(webinarId), event, payload);
  }

  /** A floor event to one attendee's own room only (CW-R-34). */
  toParticipant<E extends WebinarParticipantEventName>(userId: string, event: E, payload: WebinarEventPayloads[E]): boolean {
    return this.send(userRoomName(userId), event, payload);
  }

  private send(room: string, event: WebinarEventName, payload: unknown): boolean {
    const checked = WEBINAR_EVENT_PAYLOAD_SCHEMAS[event].safeParse(payload);
    if (!checked.success) {
      this.logger.error({ event }, 'Webinar room event failed its contract schema; not emitted');
      return false;
    }
    return (this.rooms.emit as unknown as UntypedEmit).call(this.rooms, room, event, checked.data);
  }
}
