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
 *   `webinar.floor.taken`;
 * - `webinar:{webinarId}:hosts` (presenters and moderators, T-CW-2.3):
 *   `webinar.attendance.count`, `webinar.hand.count` and
 *   `webinar.floor.state { active, participantId }`, checked against
 *   `WEBINAR_HOSTS_ROOM_EVENT_PAYLOAD_SCHEMAS` (counts and ids, never names);
 * - `webinar:{webinarId}:moderation`, the T-CW-2.3 addition
 *   `webinar.recording.failed { webinarId, reason }` (CW-R-121), checked
 *   against `WEBINAR_MODERATION_ROOM_ADDED_EVENT_PAYLOAD_SCHEMAS`;
 * - `webinar:{webinarId}`, the canonical additions of T-CW-2.3
 *   (`WEBINAR_ROOM_ADDED_EVENT_NAMES`): `webinar.message.removed` and the
 *   anonymous `webinar.floor.state`, checked against
 *   `WEBINAR_ROOM_ADDED_EVENT_PAYLOAD_SCHEMAS`.
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
  WEBINAR_HOSTS_ROOM_EVENT_PAYLOAD_SCHEMAS,
  WEBINAR_MODERATION_ROOM_ADDED_EVENT_PAYLOAD_SCHEMAS,
  WEBINAR_ROOM_ADDED_EVENT_PAYLOAD_SCHEMAS,
  userRoomName,
  webinarHostsRoomName,
  webinarModerationRoomName,
  webinarRoomName,
  type WebinarEventName,
  type WebinarEventPayloads,
  type WebinarHostsRoomEventName,
  type WebinarHostsRoomEventPayloads,
  type WebinarModerationRoomAddedEventName,
  type WebinarModerationRoomAddedEventPayloads,
  type WebinarModerationRoomEventName,
  type WebinarParticipantEventName,
  type WebinarRoomAddedEventName,
  type WebinarRoomAddedEventPayloads,
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

  /** A canonical addition of the public room `webinar:{webinarId}` (T-CW-2.3): removed messages, the floor flag. */
  toAudienceAdded<E extends WebinarRoomAddedEventName>(
    webinarId: string,
    event: E,
    payload: WebinarRoomAddedEventPayloads[E],
  ): boolean {
    const checked = WEBINAR_ROOM_ADDED_EVENT_PAYLOAD_SCHEMAS[event].safeParse(payload);
    if (!checked.success) {
      this.logger.error({ event }, 'Webinar room event failed its contract schema; not emitted');
      return false;
    }
    return (this.rooms.emit as unknown as UntypedEmit).call(this.rooms, webinarRoomName(webinarId), event, checked.data);
  }

  /** A T-CW-2.3 addition of the moderators' room: `webinar.recording.failed` (CW-R-121). */
  toModerationAdded<E extends WebinarModerationRoomAddedEventName>(
    webinarId: string,
    event: E,
    payload: WebinarModerationRoomAddedEventPayloads[E],
  ): boolean {
    const checked = WEBINAR_MODERATION_ROOM_ADDED_EVENT_PAYLOAD_SCHEMAS[event].safeParse(payload);
    if (!checked.success) {
      this.logger.error({ event }, 'Webinar room event failed its contract schema; not emitted');
      return false;
    }
    return (this.rooms.emit as unknown as UntypedEmit).call(this.rooms, webinarModerationRoomName(webinarId), event, checked.data);
  }

  /** An event of the hosts' room `webinar:{webinarId}:hosts` (T-CW-2.3): counts and the floor holder's id. */
  toHosts<E extends WebinarHostsRoomEventName>(
    webinarId: string,
    event: E,
    payload: WebinarHostsRoomEventPayloads[E],
  ): boolean {
    const checked = WEBINAR_HOSTS_ROOM_EVENT_PAYLOAD_SCHEMAS[event].safeParse(payload);
    if (!checked.success) {
      this.logger.error({ event }, 'Webinar room event failed its contract schema; not emitted');
      return false;
    }
    return (this.rooms.emit as unknown as UntypedEmit).call(this.rooms, webinarHostsRoomName(webinarId), event, checked.data);
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
