/**
 * Mute and unmute consent for an attendee who has the floor (WBN-26,
 * D-CW-15): a host mutes; to speak again a host asks and the attendee
 * consents, so no host can unmute anyone. The events and responses are the
 * contract's (`WEBINAR_FLOOR_MUTE_*`, `WebinarFloorUnmuteResponseSchema`):
 *
 * - `webinar.floor.muted {}` and `webinar.floor.unmute_requested {}` on the
 *   attendee's own room `user:{userId}`;
 * - `webinar.floor.muted { participantId }` and `webinar.floor.unmuted
 *   { participantId }` on the hosts' room;
 * - `POST .../participants/:participantId/unmute` answers with fresh
 *   `primaryAttendee` credentials for an attendee in a replica (T-CW-3.2).
 */
import {
  WEBINAR_FLOOR_MUTE_HOSTS_EVENT_NAMES,
  WEBINAR_FLOOR_MUTE_HOSTS_EVENT_PAYLOAD_SCHEMAS,
  WEBINAR_FLOOR_MUTE_PARTICIPANT_EVENT_NAMES,
  WEBINAR_FLOOR_MUTE_PARTICIPANT_EVENT_PAYLOAD_SCHEMAS,
  WebinarFloorUnmuteResponseSchema,
} from '@nestself/contracts';
import type { WebinarFloorMuteHostsEventName, WebinarFloorMuteParticipantEventName, WebinarPrimaryAttendee } from '@nestself/contracts';

export type WebinarFloorConsentEventName = WebinarFloorMuteHostsEventName | WebinarFloorMuteParticipantEventName;

const PARTICIPANT_EVENTS: ReadonlySet<string> = new Set(WEBINAR_FLOOR_MUTE_PARTICIPANT_EVENT_NAMES);
const HOSTS_EVENTS: ReadonlySet<string> = new Set(WEBINAR_FLOOR_MUTE_HOSTS_EVENT_NAMES);

export function isFloorConsentEvent(event: string): event is WebinarFloorConsentEventName {
  return PARTICIPANT_EVENTS.has(event) || HOSTS_EVENTS.has(event);
}

/** An attendee's own-room event (`{}`) that passes its contract schema. */
export function isParticipantConsentEvent(event: string, payload: unknown): event is WebinarFloorMuteParticipantEventName {
  return PARTICIPANT_EVENTS.has(event) && WEBINAR_FLOOR_MUTE_PARTICIPANT_EVENT_PAYLOAD_SCHEMAS[event as WebinarFloorMuteParticipantEventName].safeParse(payload).success;
}

/** The hosts' room payload `{ participantId }` when it passes its contract schema, else null. */
export function hostsConsentPayload(event: string, payload: unknown): { participantId: string } | null {
  if (!HOSTS_EVENTS.has(event)) return null;
  const parsed = WEBINAR_FLOOR_MUTE_HOSTS_EVENT_PAYLOAD_SCHEMAS[event as WebinarFloorMuteHostsEventName].safeParse(payload);
  return parsed.success ? parsed.data : null;
}

/** Fresh primary credentials in the unmute response (a replica attendee), else null. Never logged or kept. */
export function unmutePrimaryAttendee(response: unknown): WebinarPrimaryAttendee | null {
  return WebinarFloorUnmuteResponseSchema.safeParse(response).data?.primaryAttendee ?? null;
}
