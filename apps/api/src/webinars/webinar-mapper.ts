/**
 * Webinar mappers and rules (T-CW-2.1): the one place the UPPER_CASE
 * database enums meet the lower-case contract spellings (CW-R-19a), the join
 * windows (D-CW-17), the media capabilities in contract spelling (D-CW-35),
 * the audience eligibility rule (D-CW-17, CW-R-32), the paging cursors and
 * the attendance arithmetic (WBN-33).
 *
 * Everything here is pure.
 */
import {
  CALL_JOIN_WINDOW_BEFORE_MINUTES,
  CALL_ROOM_CLOSE_AFTER_MINUTES,
  CHIME_CAPABILITY_BY_MEDIA_CAPABILITY,
  WEBINAR_HOST_JOIN_BEFORE_MINUTES,
  type RecordingStatus,
  type WebinarAudiencePolicy,
  type WebinarCapabilities,
  type WebinarHostRole,
  type WebinarMediaCapability,
  type WebinarMessageKind,
  type WebinarMessageStatus,
  type WebinarStatus,
} from '@nestself/contracts';
import type {
  recordingStatus,
  webinarMessageKind,
  webinarMessageStatus,
  webinarStatus,
} from '../db/schema/index.js';
import { capabilitiesForRole, type ParticipantCapabilities } from '../video/video-provider.js';

type DbWebinarStatus = (typeof webinarStatus.enumValues)[number];
type DbMessageKind = (typeof webinarMessageKind.enumValues)[number];
type DbMessageStatus = (typeof webinarMessageStatus.enumValues)[number];
type DbRecordingStatus = (typeof recordingStatus.enumValues)[number];
type DbHostRole = 'PRESENTER' | 'MODERATOR';

const MINUTE_MS = 60_000;

// ---------------------------------------------------------------------------
// Enum spellings (CW-R-19a)
// ---------------------------------------------------------------------------

function upper<T extends string>(value: T): Uppercase<T> {
  return value.toUpperCase() as Uppercase<T>;
}

function lower<T extends string>(value: T): Lowercase<T> {
  return value.toLowerCase() as Lowercase<T>;
}

export const toDbWebinarStatus = (status: WebinarStatus): DbWebinarStatus => upper(status);
export const fromDbWebinarStatus = (status: DbWebinarStatus): WebinarStatus => lower(status);
export const toDbMessageKind = (kind: WebinarMessageKind): DbMessageKind => upper(kind);
export const fromDbMessageKind = (kind: DbMessageKind): WebinarMessageKind => lower(kind);
export const toDbMessageStatus = (status: WebinarMessageStatus): DbMessageStatus => upper(status);
export const fromDbMessageStatus = (status: DbMessageStatus): WebinarMessageStatus => lower(status);
export const toDbRecordingStatus = (status: RecordingStatus): DbRecordingStatus => upper(status);
export const fromDbRecordingStatus = (status: DbRecordingStatus): RecordingStatus => lower(status);
export const toDbHostRole = (role: WebinarHostRole): DbHostRole => upper(role);
export const fromDbHostRole = (role: string): WebinarHostRole => (role === 'MODERATOR' ? 'moderator' : 'presenter');

// ---------------------------------------------------------------------------
// Windows (D-CW-17, WBN-06, WBN-16)
// ---------------------------------------------------------------------------

/** Who is joining: a host (presenter or moderator) or an attendee. */
export type WebinarJoinerKind = 'host' | 'attendee';

/**
 * The join window, both bounds included: hosts from
 * `WEBINAR_HOST_JOIN_BEFORE_MINUTES` (30) before the start for the device
 * check and the dry run, attendees from `CALL_JOIN_WINDOW_BEFORE_MINUTES`
 * (15) before; the room closes `CALL_ROOM_CLOSE_AFTER_MINUTES` (15) after
 * the scheduled end unless a host ends it earlier.
 */
export function isWithinWebinarWindow(
  window: { startsAt: Date; endsAt: Date },
  now: Date,
  kind: WebinarJoinerKind,
): boolean {
  const before = kind === 'host' ? WEBINAR_HOST_JOIN_BEFORE_MINUTES : CALL_JOIN_WINDOW_BEFORE_MINUTES;
  const opens = window.startsAt.getTime() - before * MINUTE_MS;
  const closes = window.endsAt.getTime() + CALL_ROOM_CLOSE_AFTER_MINUTES * MINUTE_MS;
  return now.getTime() >= opens && now.getTime() <= closes;
}

// ---------------------------------------------------------------------------
// Capabilities (D-CW-10, D-CW-35)
// ---------------------------------------------------------------------------

const MEDIA_CAPABILITY_BY_CHIME: Readonly<Record<string, WebinarMediaCapability>> = Object.fromEntries(
  Object.entries(CHIME_CAPABILITY_BY_MEDIA_CAPABILITY).map(([contract, chime]) => [chime, contract]),
) as Record<string, WebinarMediaCapability>;

/**
 * An attendee's capabilities (D-CW-35, CW-R-108): receive on every channel;
 * with the floor, audio `SendReceive` while video and content stay
 * `Receive`. The one place the webinar module asks for attendee
 * capabilities; the adapter refuses anything that sends video or content.
 */
export function attendeeCapabilities(floor: boolean): ParticipantCapabilities {
  return capabilitiesForRole('attendee', { floor });
}

/** The provider's capabilities in contract spelling (`SendReceive` to `send_receive`). */
export function toContractCapabilities(capabilities: ParticipantCapabilities): WebinarCapabilities {
  return {
    audio: MEDIA_CAPABILITY_BY_CHIME[capabilities.Audio] ?? 'none',
    video: MEDIA_CAPABILITY_BY_CHIME[capabilities.Video] ?? 'none',
    content: MEDIA_CAPABILITY_BY_CHIME[capabilities.Content] ?? 'none',
  };
}

// ---------------------------------------------------------------------------
// Audience (D-CW-17, CW-R-32)
// ---------------------------------------------------------------------------

/**
 * One active, date-current membership of the person in an active client
 * organisation, with the ancestor-or-self ids of its organisational unit
 * (empty without a unit).
 */
export interface MembershipFact {
  orgId: string;
  orgUnitAncestorIds: readonly string[];
}

function membershipMatches(policy: WebinarAudiencePolicy, membership: MembershipFact): boolean {
  switch (policy.type) {
    case 'all_eligible':
      return true;
    case 'organization':
      return policy.orgIds.includes(membership.orgId);
    case 'org_unit':
      return (
        membership.orgId === policy.orgId &&
        membership.orgUnitAncestorIds.some((unitId) => policy.orgUnitIds.includes(unitId))
      );
  }
}

/**
 * The organisation through which the person belongs to the audience, or
 * null when they do not. `all_eligible` takes every member of an active
 * client organisation; an organisation policy its members; a unit policy
 * the members of a listed unit or of a unit below it. The preferred
 * organisation (the caller's active context) wins when it qualifies.
 */
export function eligibleOrgId(
  policy: WebinarAudiencePolicy,
  memberships: readonly MembershipFact[],
  preferredOrgId?: string | null,
): string | null {
  const matching = memberships.filter((membership) => membershipMatches(policy, membership));
  if (matching.length === 0) return null;
  return matching.find((membership) => membership.orgId === preferredOrgId)?.orgId ?? matching[0]!.orgId;
}

/**
 * The organisation an occurrence belongs to (CW-R-23): the one organisation
 * of an organisation policy with a single entry or of a unit policy; null for
 * `all_eligible` and for several organisations.
 */
export function occurrenceOrgId(policy: WebinarAudiencePolicy): string | null {
  switch (policy.type) {
    case 'all_eligible':
      return null;
    case 'organization':
      return policy.orgIds.length === 1 ? policy.orgIds[0]! : null;
    case 'org_unit':
      return policy.orgId;
  }
}

// ---------------------------------------------------------------------------
// Cursors
// ---------------------------------------------------------------------------

/** A page key: the sort time and the id. */
export interface PageKey {
  at: Date;
  id: string;
}

/** The opaque `nextCursor`: base64url JSON of the page's last key. */
export function encodePageCursor(key: PageKey): string {
  return Buffer.from(JSON.stringify([key.at.toISOString(), key.id])).toString('base64url');
}

/** The key inside a cursor, or null when it is not one this API issued. */
export function decodePageCursor(cursor: string): PageKey | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!Array.isArray(value) || value.length !== 2) return null;
    const [at, id] = value as unknown[];
    if (typeof at !== 'string' || typeof id !== 'string' || id.length === 0) return null;
    const date = new Date(at);
    if (Number.isNaN(date.getTime()) || date.toISOString() !== at) return null;
    return { at: date, id };
  } catch {
    return null;
  }
}

/** Splits `limit + 1` rows into the page and the cursor of the next page. */
export function paginate<T>(rows: T[], limit: number, keyOf: (row: T) => PageKey): { items: T[]; nextCursor: string | null } {
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return { items, nextCursor: rows.length > limit && last ? encodePageCursor(keyOf(last)) : null };
}

// ---------------------------------------------------------------------------
// Attendance (WBN-33)
// ---------------------------------------------------------------------------

/** One registrant's presence: the first join and the last leave over the webinar's sessions. */
export interface PresenceInterval {
  joinedAt: Date | null;
  leftAt: Date | null;
}

/** Whole minutes between the first join and the last leave, or `until` while still present. */
export function attendedMinutes(presence: PresenceInterval, until: Date): number | null {
  if (!presence.joinedAt) return null;
  const end = presence.leftAt && presence.leftAt > presence.joinedAt ? presence.leftAt : until;
  return Math.max(0, Math.round((end.getTime() - presence.joinedAt.getTime()) / MINUTE_MS));
}

/** Attended minutes as a share of the webinar's length, 0 to 100, one decimal. */
export function completionPercent(minutes: number | null, lengthMinutes: number): number | null {
  if (minutes === null) return null;
  if (lengthMinutes <= 0) return 100;
  return Math.min(100, Math.round((minutes / lengthMinutes) * 1000) / 10);
}

/** The most registrants present at the same time; an open interval runs to `until`. */
export function peakConcurrent(intervals: readonly PresenceInterval[], until: Date): number {
  const points: [number, number][] = [];
  for (const { joinedAt, leftAt } of intervals) {
    if (!joinedAt) continue;
    const end = leftAt && leftAt > joinedAt ? leftAt : until;
    points.push([joinedAt.getTime(), 1], [Math.max(end.getTime(), joinedAt.getTime()), -1]);
  }
  // A leave and a join at the same instant do not overlap.
  points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let current = 0;
  let peak = 0;
  for (const [, delta] of points) {
    current += delta;
    peak = Math.max(peak, current);
  }
  return peak;
}
