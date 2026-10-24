/**
 * Zod schemas for WebSocket messages (T-1.11, T-CW-1.6).
 *
 * Rooms: the gateway serves exactly these names, and the room alone decides
 * what a subscription is authorised against (the server derives the action
 * and the resource, `SubscriptionAuthorizer.authorizeRoom`):
 *
 *   call:{sessionId}                  consultation.join on the session's appointment, participants only
 *   webinar:{webinarId}               event.register (served from T-CW-2.3)
 *   webinar:{webinarId}:moderation    event.moderate (served from T-CW-2.3)
 *   org:{orgId}:programme             program.overview on the organization (T-1.11)
 *
 * Events: every server-side emit is checked against `ROOM_EVENTS` (its room
 * kind and payload schema, from `@nestself/contracts`) before it leaves
 * (CW-R-36).
 *
 * @see 4.6.7, AUTHZ-R-58, AUTHZ-R-59, D-CW-16, CW-R-36
 */
import { z } from 'zod';
import {
  CALL_ROOM_EVENT_PAYLOAD_SCHEMAS,
  type CallRoomEventName,
  type CallRoomEventPayloads,
} from '@nestself/contracts';

// ---------------------------------------------------------------------------
// Room names
// ---------------------------------------------------------------------------

/**
 * One id segment: the repository's ids (`gen_random_uuid()::text`) and the
 * seed's slugs (`call_session_sample_consultation`). Never a colon, a dot,
 * a slash or whitespace, so a room name has one reading.
 */
const ROOM_ID = '[A-Za-z0-9][A-Za-z0-9_-]{0,127}';

export const ROOM_KINDS = ['call', 'webinar', 'webinar_moderation', 'org_programme'] as const;
export type RoomKind = (typeof ROOM_KINDS)[number];

/** Room kinds whose rooms a feature module resolves (`RoomAccessRegistry`). */
export type ModuleRoomKind = Exclude<RoomKind, 'org_programme'>;

export interface ParsedRoom {
  kind: RoomKind;
  /** The full room name. */
  room: string;
  /** The session, webinar or organization id inside the name. */
  id: string;
}

const ROOM_PATTERNS: readonly (readonly [RoomKind, RegExp])[] = [
  ['call', new RegExp(`^call:(${ROOM_ID})$`)],
  ['webinar', new RegExp(`^webinar:(${ROOM_ID})$`)],
  ['webinar_moderation', new RegExp(`^webinar:(${ROOM_ID}):moderation$`)],
  ['org_programme', new RegExp(`^org:(${ROOM_ID}):programme$`)],
];

/** The served room behind a name, or null for any other name. */
export function parseRoom(room: string): ParsedRoom | null {
  for (const [kind, pattern] of ROOM_PATTERNS) {
    const id = pattern.exec(room)?.[1];
    if (id) return { kind, room, id };
  }
  return null;
}

export const RoomNameSchema = z
  .string()
  .min(1)
  .max(256)
  .refine((room) => parseRoom(room) !== null, { message: 'Not a served room' });

// ---------------------------------------------------------------------------
// subscribe / unsubscribe
// ---------------------------------------------------------------------------

const SubscribeResourceSchema = z.object({
  type: z.string().min(1).max(64),
  id: z.string().max(256).optional(),
  orgId: z.string().max(256).optional(),
  orgUnitId: z.string().max(256).optional(),
  queueId: z.string().max(256).optional(),
  practiceGroupId: z.string().max(256).optional(),
  collectionId: z.string().max(256).optional(),
  ownerId: z.string().max(256).optional(),
  amountMinor: z.number().int().nonnegative().optional(),
  currency: z.string().length(3).optional(),
  category: z.string().max(256).optional(),
  isConfidential: z.boolean().optional(),
});

/**
 * `subscribe`. `action` and `resource` are optional and never authorised:
 * T-1.11 clients send them, and the server derives both from the room.
 */
export const SubscribeMessageSchema = z.object({
  room: RoomNameSchema,
  action: z.string().min(1).max(128).optional(),
  resource: SubscribeResourceSchema.optional(),
});

export type SubscribePayload = z.infer<typeof SubscribeMessageSchema>;

/**
 * `subscribe` to `call:{sessionId}`. A client that names the action and the
 * resource must name `consultation.join` on that `call_session`; the server
 * still ignores both and authorises the session's appointment itself.
 */
export const CallSubscribeSchema = SubscribeMessageSchema.extend({
  room: RoomNameSchema.refine((room) => parseRoom(room)?.kind === 'call', { message: 'Not a call room' }),
  action: z.literal('consultation.join').optional(),
  resource: SubscribeResourceSchema.extend({ type: z.literal('call_session') }).optional(),
}).refine((message) => message.resource?.id === undefined || message.resource.id === parseRoom(message.room)?.id, {
  path: ['resource', 'id'],
  message: 'The resource is not the room’s session',
});

export type CallSubscribePayload = z.infer<typeof CallSubscribeSchema>;

export const UnsubscribeMessageSchema = z.object({
  room: z.string().min(1).max(256),
});

export type UnsubscribePayload = z.infer<typeof UnsubscribeMessageSchema>;

/**
 * Why a subscription was refused. `not_found` covers an unknown room, a
 * principal who is not a participant and an engine denial alike, so a
 * refusal never tells whether the room exists (D-CW-30). The org programme
 * room keeps the engine's own reason (T-1.11).
 */
export type SubscribeDenialReason =
  | 'invalid_payload'
  | 'invalid_room'
  | 'unauthenticated'
  | 'not_found'
  | 'room_not_available'
  | 'unavailable'
  | (string & {});

// ---------------------------------------------------------------------------
// Server-side room events (CW-R-36)
// ---------------------------------------------------------------------------

export type RoomEventName = CallRoomEventName;
export type RoomEventPayload<E extends RoomEventName> = CallRoomEventPayloads[E];

export interface RoomEventSpec {
  /** The only room kind the event may be emitted to. */
  roomKind: RoomKind;
  schema: z.ZodType;
}

function callRoomEvent(event: CallRoomEventName): RoomEventSpec {
  return { roomKind: 'call', schema: CALL_ROOM_EVENT_PAYLOAD_SCHEMAS[event] };
}

/**
 * Each event the API emits, with its room kind and payload schema. The
 * mapped type makes a missing event a compile error. Webinar events join
 * with T-CW-2.3.
 */
export const ROOM_EVENTS: { readonly [E in RoomEventName]: RoomEventSpec } = {
  'call.participant.joined': callRoomEvent('call.participant.joined'),
  'call.participant.left': callRoomEvent('call.participant.left'),
  'call.session.ended': callRoomEvent('call.session.ended'),
  'call.signal': callRoomEvent('call.signal'),
  'call.location.shared': callRoomEvent('call.location.shared'),
  'appointment.follow_up.proposed': callRoomEvent('appointment.follow_up.proposed'),
  'appointment.follow_up.confirmed': callRoomEvent('appointment.follow_up.confirmed'),
  'appointment.follow_up.declined': callRoomEvent('appointment.follow_up.declined'),
  'appointment.times_suggested': callRoomEvent('appointment.times_suggested'),
};
