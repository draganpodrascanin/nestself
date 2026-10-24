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
 *   user:{userId}                     that user only, by identity, no engine decision (T-CW-1.9)
 *
 * Events: every server-side emit is checked against `ROOM_EVENTS` (its room
 * kinds and payload schema, from `@nestself/contracts`) by `RoomEmitter`
 * before it is published, and again by `RoomEventRelay` before it reaches a
 * socket (`checkRoomEvent`, CW-R-36).
 *
 * @see 4.6.7, AUTHZ-R-58, AUTHZ-R-59, D-CW-16, CW-R-36
 */
import { z } from 'zod';
import {
  AppointmentRemindPayloadSchema,
  CALL_ROOM_EVENT_PAYLOAD_SCHEMAS,
  type AppointmentRemindPayload,
  type CallRoomEventName,
  type CallRoomEventPayloads,
  type UserRoomEventName,
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

export const ROOM_KINDS = ['call', 'webinar', 'webinar_moderation', 'org_programme', 'user'] as const;
export type RoomKind = (typeof ROOM_KINDS)[number];

/**
 * Room kinds whose rooms a feature module resolves (`RoomAccessRegistry`).
 * The org programme room is the engine's (T-1.11) and the user room is
 * decided by identity (`SubscriptionAuthorizer`).
 */
export type ModuleRoomKind = Exclude<RoomKind, 'org_programme' | 'user'>;

export interface ParsedRoom {
  kind: RoomKind;
  /** The full room name. */
  room: string;
  /** The session, webinar, organization or user id inside the name. */
  id: string;
}

const ROOM_PATTERNS: readonly (readonly [RoomKind, RegExp])[] = [
  ['call', new RegExp(`^call:(${ROOM_ID})$`)],
  ['webinar', new RegExp(`^webinar:(${ROOM_ID})$`)],
  ['webinar_moderation', new RegExp(`^webinar:(${ROOM_ID}):moderation$`)],
  ['org_programme', new RegExp(`^org:(${ROOM_ID}):programme$`)],
  ['user', new RegExp(`^user:(${ROOM_ID})$`)],
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

export type RoomEventName = CallRoomEventName | UserRoomEventName;
export type RoomEventPayloads = CallRoomEventPayloads & { 'appointment.remind': AppointmentRemindPayload };
export type RoomEventPayload<E extends RoomEventName> = RoomEventPayloads[E];

export interface RoomEventSpec {
  /** The only room kinds the event may be emitted to. */
  roomKinds: readonly RoomKind[];
  schema: z.ZodType;
}

function callRoomEvent(event: CallRoomEventName): RoomEventSpec {
  return { roomKinds: ['call'], schema: CALL_ROOM_EVENT_PAYLOAD_SCHEMAS[event] };
}

/**
 * Each event the API emits, with its room kinds and payload schema. The
 * mapped type makes a missing event a compile error. Webinar events join
 * with T-CW-2.3.
 *
 * The user room (`user:{userId}`, T-CW-1.9) carries the follow-up proposal,
 * with the call room's payload, so an employee who left the post-call screen
 * still sees it (CALL-42), and the in-app reminder (`appointment.remind`,
 * CALL-01 criterion 5). No other call event reaches it.
 */
export const ROOM_EVENTS: { readonly [E in RoomEventName]: RoomEventSpec } = {
  'call.participant.joined': callRoomEvent('call.participant.joined'),
  'call.participant.left': callRoomEvent('call.participant.left'),
  'call.session.ended': callRoomEvent('call.session.ended'),
  'call.signal': callRoomEvent('call.signal'),
  'call.location.shared': callRoomEvent('call.location.shared'),
  'appointment.follow_up.proposed': {
    roomKinds: ['call', 'user'],
    schema: CALL_ROOM_EVENT_PAYLOAD_SCHEMAS['appointment.follow_up.proposed'],
  },
  'appointment.follow_up.confirmed': callRoomEvent('appointment.follow_up.confirmed'),
  'appointment.follow_up.declined': callRoomEvent('appointment.follow_up.declined'),
  'appointment.times_suggested': callRoomEvent('appointment.times_suggested'),
  'appointment.remind': { roomKinds: ['user'], schema: AppointmentRemindPayloadSchema },
};

/**
 * The checked payload of `event` on `room`, or null when the event is not one
 * `ROOM_EVENTS` lists, the room is not of one of the event's kinds or the payload
 * fails the event's strict schema. Run by `RoomEmitter` before it publishes
 * and by `RoomEventRelay` before it emits.
 */
export function checkRoomEvent(room: string, event: string, payload: unknown): Record<string, unknown> | null {
  if (!Object.hasOwn(ROOM_EVENTS, event)) return null;
  const spec = ROOM_EVENTS[event as RoomEventName];
  const kind = parseRoom(room)?.kind;
  if (!kind || !spec.roomKinds.includes(kind)) return null;
  const parsed = spec.schema.safeParse(payload);
  return parsed.success ? (parsed.data as Record<string, unknown>) : null;
}

/** One message on the room events channel (`ROOM_EVENTS_CHANNEL`). */
export const RoomEventEnvelopeSchema = z.strictObject({
  room: z.string().min(1).max(256),
  event: z.string().min(1).max(128),
  payload: z.record(z.string(), z.unknown()),
});
export type RoomEventEnvelope = z.infer<typeof RoomEventEnvelopeSchema>;
