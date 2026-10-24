/**
 * Call mappers and rules (T-CW-1.1): the one place the UPPER_CASE database
 * enums meet the lower-case contract spellings (CW-R-19a), the join window
 * (D-CW-07), the credential cache lifetime (D-CW-08), the outcome to
 * appointment-status mapping (CALL-23) and the diagnostics DTO (D-CW-28).
 */
import {
  CALL_JOIN_WINDOW_AFTER_MINUTES,
  CALL_JOIN_WINDOW_BEFORE_MINUTES,
  CALL_ROOM_CLOSE_AFTER_MINUTES,
  ChimeAttendeeSchema,
  ChimeMeetingSchema,
  DiagnosticsResponseSchema,
  type AppointmentStatus,
  type CallFormat,
  type CallOutcomeStatus,
  type CallParticipantRole,
  type CallSessionStatus,
  type ChimeAttendee,
  type ChimeMeeting,
  type DiagnosticsResponse,
  type VideoProviderName,
} from '@nestself/contracts';
import { z } from 'zod';
import type { callFormat, callOutcomeStatus, callParticipantRole, callSessionStatus } from '../db/schema/index.js';
import type { CallParticipantRecord, CallSessionRecord, ClientEventSummary } from './calls.repository.js';

type DbSessionStatus = (typeof callSessionStatus.enumValues)[number];
type DbParticipantRole = (typeof callParticipantRole.enumValues)[number];
type DbFormat = (typeof callFormat.enumValues)[number];
type DbOutcomeStatus = (typeof callOutcomeStatus.enumValues)[number];

const MINUTE_MS = 60_000;

// ---------------------------------------------------------------------------
// Enum spellings (CW-R-19a)
// ---------------------------------------------------------------------------

/** Lower-case contract spelling to UPPER_CASE database spelling. */
function upper<T extends string>(value: T): Uppercase<T> {
  return value.toUpperCase() as Uppercase<T>;
}

/** UPPER_CASE database spelling to lower-case contract spelling. */
function lower<T extends string>(value: T): Lowercase<T> {
  return value.toLowerCase() as Lowercase<T>;
}

export const toDbSessionStatus = (status: CallSessionStatus): DbSessionStatus => upper(status);
export const fromDbSessionStatus = (status: DbSessionStatus): CallSessionStatus => lower(status);
export const toDbParticipantRole = (role: CallParticipantRole): DbParticipantRole => upper(role);
export const fromDbParticipantRole = (role: DbParticipantRole): CallParticipantRole => lower(role);
export const toDbFormat = (format: CallFormat): DbFormat => upper(format);
export const fromDbFormat = (format: DbFormat): CallFormat => lower(format);
export const toDbOutcomeStatus = (status: CallOutcomeStatus): DbOutcomeStatus => upper(status);
export const fromDbOutcomeStatus = (status: DbOutcomeStatus): CallOutcomeStatus => lower(status);

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/** The Socket.IO room of a call session (decision record section 7). */
export function callRoom(sessionId: string): string {
  return `call:${sessionId}`;
}

/**
 * Consultation join window (D-CW-07, guidelines 4.3): from 15 minutes before
 * the start to 10 minutes after the end, both bounds included.
 */
export function isWithinJoinWindow(window: { startsAt: Date; endsAt: Date }, now: Date): boolean {
  const opens = window.startsAt.getTime() - CALL_JOIN_WINDOW_BEFORE_MINUTES * MINUTE_MS;
  const closes = window.endsAt.getTime() + CALL_JOIN_WINDOW_AFTER_MINUTES * MINUTE_MS;
  return now.getTime() >= opens && now.getTime() <= closes;
}

/** Seconds until the room closes (`endsAt + 15 minutes`), at least 1 (D-CW-08). */
export function credentialsTtlSeconds(endsAt: Date, now: Date): number {
  const closesAt = endsAt.getTime() + CALL_ROOM_CLOSE_AFTER_MINUTES * MINUTE_MS;
  return Math.max(1, Math.ceil((closesAt - now.getTime()) / 1000));
}

/**
 * The appointment status each delivery outcome moves a confirmed appointment
 * to (CALL-23 criterion 6). A technical failure means the consultation did
 * not take place, so the appointment is canceled; the outcome row keeps the
 * reason for the booking and finance epics.
 */
export const APPOINTMENT_STATUS_FOR_OUTCOME: Readonly<Record<CallOutcomeStatus, AppointmentStatus>> = {
  completed: 'completed',
  no_show_employee: 'no_show',
  no_show_expert: 'no_show',
  technical_failure: 'canceled',
  canceled: 'canceled',
};

// ---------------------------------------------------------------------------
// Cached credentials (D-CW-08)
// ---------------------------------------------------------------------------

/** The `{ meeting, attendee }` blob under `call:{sessionId}:participant:{participantId}`. */
export interface CachedCredentials {
  meeting: ChimeMeeting;
  attendee: ChimeAttendee;
}

const CachedCredentialsSchema = z.object({ meeting: ChimeMeetingSchema, attendee: ChimeAttendeeSchema });

/**
 * Serialises credentials for the cache through the contract schemas, so the
 * provider-only fields (`EventIngestionUrl`, `MeetingArn`, `TenantIds`) are
 * never stored or returned (CW-R-48).
 */
export function serialiseCredentials(credentials: { meeting: unknown; attendee: unknown }): CachedCredentials {
  return CachedCredentialsSchema.parse(credentials);
}

/** The cached credentials, or null when the entry is missing or not a valid blob. */
export function parseCachedCredentials(raw: string | null): CachedCredentials | null {
  if (!raw) return null;
  try {
    const parsed = CachedCredentialsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Diagnostics (D-CW-28, auth strategy 4.7.5)
// ---------------------------------------------------------------------------

const iso = (date: Date | null): string | null => (date ? date.toISOString() : null);

/**
 * Exactly the 4.7.5 fields, parsed through the strict contract schema: a
 * field outside the allowlist fails here rather than reaching support staff
 * (CW-R-73, CW-R-86). No user id, participant id, name, category or the
 * location text leaves this function.
 *
 * Per participant: join and leave times from the provider events, the larger
 * of the provider's and the client's reconnect counts, the client's average
 * quality, the provider's error codes followed by the client's, and the
 * client's latest browser and OS.
 */
export function toDiagnosticsResponse(
  session: CallSessionRecord,
  participants: readonly CallParticipantRecord[],
  clientSummaries: ReadonlyMap<string, ClientEventSummary>,
  providerErrorCodes: ReadonlyMap<string, readonly string[]>,
  provider: VideoProviderName,
): DiagnosticsResponse {
  return DiagnosticsResponseSchema.parse({
    sessionId: session.id,
    appointmentId: session.appointmentId,
    webinarId: session.webinarId,
    startedAt: iso(session.startedAt),
    endedAt: iso(session.endedAt),
    status: session.status,
    provider,
    providerMeetingId: session.providerMeetingId,
    participants: participants.map((participant) => {
      const client = clientSummaries.get(participant.id);
      const providerCodes = participant.providerAttendeeId
        ? (providerErrorCodes.get(participant.providerAttendeeId) ?? [])
        : [];
      return {
        role: participant.role,
        joinedAt: iso(participant.firstJoinedAt),
        leftAt: iso(participant.lastLeftAt),
        reconnectCount: Math.max(participant.reconnectCount, client?.reconnectCount ?? 0),
        qualityMetrics: client?.qualityMetrics ?? null,
        errorCodes: [...new Set([...providerCodes, ...(client?.errorCodes ?? [])])],
        browser: client?.browser ?? null,
        os: client?.os ?? null,
      };
    }),
  });
}
