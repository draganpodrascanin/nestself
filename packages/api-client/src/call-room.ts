/**
 * The `call:{sessionId}` Socket.IO room as the web apps see it (decision
 * record section 7, D-CW-16, T-CW-1.6).
 *
 * The api-client does not depend on `socket.io-client`: the app passes a
 * factory that opens a socket (same origin, session cookie, path `/api/ws`),
 * and this module owns everything else, so the subscribe message and the
 * event names live in one place. The server derives the authorisation from
 * the room; the action and resource sent here are what the gateway accepts
 * today and are ignored once T-CW-1.6 derives them (`callRoomSubscribeMessage`
 * is the single place to change).
 *
 * Payloads carry ids, roles, statuses and times only: never a name, the
 * location text or a token. Anything that fails to parse is dropped.
 */
import { z } from 'zod';
import { CallParticipantRoleSchema, CallSignalPayloadSchema } from '@nestself/contracts';
import type { CallParticipantRole, CallSignalPayload } from '@nestself/contracts';

/** The part of a Socket.IO client socket this module uses. */
export interface RoomSocket {
  on(event: string, listener: (...args: never[]) => void): unknown;
  emit(event: string, ...args: unknown[]): unknown;
  disconnect(): unknown;
}

export interface CallRoomParticipantEvent {
  participantId: string;
  role: CallParticipantRole;
}

export interface FollowUpProposedEvent {
  /** The finished appointment. */
  appointmentId: string;
  /** The new `proposed` appointment. */
  followUpId: string;
  startsAt: string;
  durationMinutes: number;
}

export interface CallRoomHandlers {
  onSignal?: (signal: CallSignalPayload) => void;
  onParticipantJoined?: (event: CallRoomParticipantEvent) => void;
  onParticipantLeft?: (event: CallRoomParticipantEvent) => void;
  /** The expert ended the session for everyone. */
  onSessionEnded?: () => void;
  /** The employee shared a location; read it with `GET /appointments/:id/location`. */
  onLocationShared?: () => void;
  onFollowUpProposed?: (event: FollowUpProposedEvent) => void;
  onFollowUpChanged?: (event: { appointmentId: string; followUpId: string; change: 'confirmed' | 'declined' | 'times_suggested' }) => void;
  /** The subscription was refused or the socket could not connect; the call itself is unaffected. */
  onUnavailable?: (reason: string) => void;
}

export interface CallRoomClient {
  /** Joins `call:{sessionId}`; the returned function leaves it and closes the socket. */
  subscribe(sessionId: string, handlers: CallRoomHandlers): () => void;
}

/** Sample mode and tests: no socket, no events. */
export const noopCallRoomClient: CallRoomClient = {
  subscribe: () => () => undefined,
};

export const CALL_ROOM_EVENTS = {
  signal: 'call.signal',
  participantJoined: 'call.participant.joined',
  participantLeft: 'call.participant.left',
  sessionEnded: 'call.session.ended',
  locationShared: 'call.location.shared',
  followUpProposed: 'appointment.follow_up.proposed',
  followUpConfirmed: 'appointment.follow_up.confirmed',
  followUpDeclined: 'appointment.follow_up.declined',
  timesSuggested: 'appointment.times_suggested',
} as const;

export function callRoomName(sessionId: string): string {
  return `call:${sessionId}`;
}

/** The `subscribe` message for a call room. */
export function callRoomSubscribeMessage(sessionId: string) {
  return {
    room: callRoomName(sessionId),
    action: 'consultation.join',
    resource: { type: 'call_session', id: sessionId },
  } as const;
}

const ParticipantEventSchema = z.object({ participantId: z.string().min(1), role: CallParticipantRoleSchema });
const FollowUpProposedSchema = z.object({
  appointmentId: z.string().min(1),
  followUpId: z.string().min(1),
  startsAt: z.string().datetime(),
  durationMinutes: z.number().int().positive(),
});
const FollowUpRefSchema = z.object({ appointmentId: z.string().min(1), followUpId: z.string().min(1) });
const DeniedSchema = z.object({ room: z.string().nullable().optional(), reason: z.string().optional() });

export function createCallRoomClient(connect: () => RoomSocket): CallRoomClient {
  return {
    subscribe(sessionId, handlers) {
      const room = callRoomName(sessionId);
      const socket = connect();
      let active = true;

      const on = <T>(event: string, schema: z.ZodType<T>, handle: ((payload: T) => void) | undefined) => {
        if (!handle) return;
        socket.on(event, ((payload: unknown) => {
          const parsed = schema.safeParse(payload);
          if (active && parsed.success) handle(parsed.data);
        }) as (...args: never[]) => void);
      };

      // Room membership does not survive a reconnect: subscribe on every connect.
      socket.on('connect', () => {
        if (active) socket.emit('subscribe', callRoomSubscribeMessage(sessionId));
      });
      socket.on('connect_error', () => {
        if (active) handlers.onUnavailable?.('connect_error');
      });
      on('subscribe:denied', DeniedSchema, (denied) => {
        if (!denied.room || denied.room === room) handlers.onUnavailable?.(denied.reason ?? 'denied');
      });

      on(CALL_ROOM_EVENTS.signal, CallSignalPayloadSchema, handlers.onSignal);
      on(CALL_ROOM_EVENTS.participantJoined, ParticipantEventSchema, handlers.onParticipantJoined);
      on(CALL_ROOM_EVENTS.participantLeft, ParticipantEventSchema, handlers.onParticipantLeft);
      on(CALL_ROOM_EVENTS.sessionEnded, z.unknown(), handlers.onSessionEnded && (() => handlers.onSessionEnded?.()));
      on(CALL_ROOM_EVENTS.locationShared, z.unknown(), handlers.onLocationShared && (() => handlers.onLocationShared?.()));
      on(CALL_ROOM_EVENTS.followUpProposed, FollowUpProposedSchema, handlers.onFollowUpProposed);
      const changed = handlers.onFollowUpChanged;
      if (changed) {
        on(CALL_ROOM_EVENTS.followUpConfirmed, FollowUpRefSchema, (ref) => changed({ ...ref, change: 'confirmed' }));
        on(CALL_ROOM_EVENTS.followUpDeclined, FollowUpRefSchema, (ref) => changed({ ...ref, change: 'declined' }));
        on(CALL_ROOM_EVENTS.timesSuggested, FollowUpRefSchema, (ref) => changed({ ...ref, change: 'times_suggested' }));
      }

      return () => {
        if (!active) return;
        active = false;
        socket.emit('unsubscribe', { room });
        socket.disconnect();
      };
    },
  };
}
