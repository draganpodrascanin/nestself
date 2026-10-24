/**
 * The `user:{userId}` Socket.IO room as the web apps see it (T-CW-1.9,
 * CALL-42, CALL-01 criterion 5): only that user may subscribe, and it
 * carries what must reach them on any page, a follow-up proposal made after
 * they left the post-call screen and the in-app reminder.
 *
 * Like the call room client, it takes a socket factory, so the api-client
 * does not depend on `socket.io-client`. Payloads carry ids and times only;
 * anything that fails to parse is dropped.
 */
import { z } from 'zod';
import { AppointmentRemindPayloadSchema, FollowUpProposedPayloadSchema, userRoomName } from '@nestself/contracts';
import type { AppointmentRemindPayload } from '@nestself/contracts';
import type { FollowUpProposedEvent, RoomSocket } from './call-room';

export interface UserRoomHandlers {
  onFollowUpProposed?: (event: FollowUpProposedEvent) => void;
  /** A reminder fired while the user is online (D-CW-26): the apps show a toast. */
  onReminder?: (event: AppointmentRemindPayload) => void;
  /** The subscription was refused or the socket could not connect. */
  onUnavailable?: (reason: string) => void;
}

export interface UserRoomClient {
  /** Joins `user:{userId}`; the returned function leaves it and closes the socket. */
  subscribe(userId: string, handlers: UserRoomHandlers): () => void;
}

/** Sample mode and tests: no socket, no events. */
export const noopUserRoomClient: UserRoomClient = {
  subscribe: () => () => undefined,
};

export const USER_ROOM_EVENTS = {
  followUpProposed: 'appointment.follow_up.proposed',
  remind: 'appointment.remind',
} as const;

/** The `subscribe` message for a user room: the server allows it to that user only. */
export function userRoomSubscribeMessage(userId: string) {
  return { room: userRoomName(userId) } as const;
}

const DeniedSchema = z.object({ room: z.string().nullable().optional(), reason: z.string().optional() });

export function createUserRoomClient(connect: () => RoomSocket): UserRoomClient {
  return {
    subscribe(userId, handlers) {
      const room = userRoomName(userId);
      const socket = connect();
      let active = true;

      const on = <T>(event: string, schema: z.ZodType<T>, handle: ((payload: T) => void) | undefined) => {
        if (!handle) return;
        socket.on(event, ((payload: unknown) => {
          const parsed = schema.safeParse(payload);
          if (active && parsed.success) handle(parsed.data);
        }) as (...args: never[]) => void);
      };

      socket.on('connect', () => {
        if (active) socket.emit('subscribe', userRoomSubscribeMessage(userId));
      });
      socket.on('connect_error', () => {
        if (active) handlers.onUnavailable?.('connect_error');
      });
      on('subscribe:denied', DeniedSchema, (denied) => {
        if (denied.room === room) handlers.onUnavailable?.(denied.reason ?? 'denied');
      });
      on(USER_ROOM_EVENTS.followUpProposed, FollowUpProposedPayloadSchema, handlers.onFollowUpProposed);
      on(USER_ROOM_EVENTS.remind, AppointmentRemindPayloadSchema, handlers.onReminder);

      return () => {
        if (!active) return;
        active = false;
        socket.emit('unsubscribe', { room });
        socket.disconnect();
      };
    },
  };
}
