/**
 * WebinarFloorState: the server-side mute state of a floor holder (WBN-26,
 * T-CW-2.1 M2 close review), in Redis under
 * `webinar:{webinarId}:floor:{participantId}` with the room's lifetime
 * (until `endsAt + CALL_ROOM_CLOSE_AFTER_MINUTES`).
 *
 * - `muted`: a host muted the floor holder (`muteFloor`); any pending unmute
 *   request is cleared.
 * - `unmuteRequested`: a host asked the floor holder to unmute
 *   (`requestUnmute`).
 *
 * The attendee may unmute while the floor is theirs, except when a host muted
 * them and has not asked them to unmute since (409 `floor_not_available`);
 * an unmute clears both. Giving and taking the floor and a rejoin clear the
 * state. The floor itself stays in `webinar_registrations.floor_given_at`.
 *
 * Redis rather than columns: the state lives only while the room is open,
 * needs no migration, and a lost key only means an unmuted holder (the host
 * can mute again).
 */
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { credentialsTtlSeconds } from '../calls/call-mapper.js';
import { KEY_VALUE_STORE, type KeyValueStore } from '../redis/key-value-store.js';

/** `webinar:{webinarId}:floor:{participantId}`: the floor holder's mute state. */
export function webinarFloorStateKey(webinarId: string, participantId: string): string {
  return `webinar:${webinarId}:floor:${participantId}`;
}

const FloorStateSchema = z.object({ muted: z.boolean(), unmuteRequested: z.boolean() });
export type FloorMuteState = z.infer<typeof FloorStateSchema>;

const NONE: FloorMuteState = { muted: false, unmuteRequested: false };

@Injectable()
export class WebinarFloorState {
  constructor(@Inject(KEY_VALUE_STORE) private readonly kv: KeyValueStore) {}

  async get(webinarId: string, participantId: string): Promise<FloorMuteState> {
    const raw = await this.kv.get(webinarFloorStateKey(webinarId, participantId));
    if (!raw) return NONE;
    try {
      const parsed = FloorStateSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : NONE;
    } catch {
      return NONE;
    }
  }

  async set(webinar: { id: string; endsAt: Date }, participantId: string, state: FloorMuteState): Promise<void> {
    await this.kv.set(webinarFloorStateKey(webinar.id, participantId), JSON.stringify(state), {
      ttlSeconds: credentialsTtlSeconds(webinar.endsAt, new Date()),
    });
  }

  async clear(webinarId: string, participantId: string): Promise<void> {
    await this.kv.del(webinarFloorStateKey(webinarId, participantId));
  }
}
