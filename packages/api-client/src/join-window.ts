/**
 * The consultation join window as the client shows it, mirroring the
 * server's rule in `apps/api/src/calls/call-mapper.ts` (`isWithinJoinWindow`,
 * CALL-06, CALL-07): a confirmed appointment can be joined from
 * `CALL_JOIN_WINDOW_BEFORE_MINUTES` before `startsAt`; a first join closes
 * `CALL_JOIN_WINDOW_AFTER_MINUTES` after `startsAt`, and a participant who
 * already joined (`rejoin`) may come back until the room closes,
 * `CALL_ROOM_CLOSE_AFTER_MINUTES` after `endsAt`. Joining after `startsAt`
 * is a late join. The server stays the authority: it answers 403
 * `join_window_closed` and 409 `appointment_not_joinable` whatever the
 * client computed.
 */
import {
  CALL_JOIN_WINDOW_AFTER_MINUTES,
  CALL_JOIN_WINDOW_BEFORE_MINUTES,
  CALL_ROOM_CLOSE_AFTER_MINUTES,
} from '@nestself/contracts';
import type { Appointment } from '@nestself/contracts';

const MINUTE_MS = 60_000;

export type JoinWindowState =
  /** The appointment is not `confirmed` (proposed, awaiting approval, finished). */
  | { kind: 'not_joinable' }
  /** Too early: joining opens at `opensAt`. */
  | { kind: 'before'; opensAt: Date }
  /** Joinable now; `late` once the scheduled start has passed. */
  | { kind: 'open'; late: boolean; startsAt: Date; closesAt: Date }
  /** Too late: joining closed at `closedAt`. */
  | { kind: 'closed'; closedAt: Date };

export interface JoinWindowOptions {
  /** The participant already joined this session: the window lasts until the room closes. */
  rejoin?: boolean;
}

export function joinWindowBounds(
  appointment: Pick<Appointment, 'startsAt' | 'endsAt'>,
  options: JoinWindowOptions = {},
): { opensAt: Date; closesAt: Date } {
  return {
    opensAt: new Date(Date.parse(appointment.startsAt) - CALL_JOIN_WINDOW_BEFORE_MINUTES * MINUTE_MS),
    closesAt: options.rejoin
      ? new Date(Date.parse(appointment.endsAt) + CALL_ROOM_CLOSE_AFTER_MINUTES * MINUTE_MS)
      : new Date(Date.parse(appointment.startsAt) + CALL_JOIN_WINDOW_AFTER_MINUTES * MINUTE_MS),
  };
}

export function joinWindowState(
  appointment: Pick<Appointment, 'status' | 'startsAt' | 'endsAt'>,
  now: number = Date.now(),
  options: JoinWindowOptions = {},
): JoinWindowState {
  if (appointment.status !== 'confirmed') return { kind: 'not_joinable' };
  const { opensAt, closesAt } = joinWindowBounds(appointment, options);
  if (now < opensAt.getTime()) return { kind: 'before', opensAt };
  if (now > closesAt.getTime()) return { kind: 'closed', closedAt: closesAt };
  const startsAt = new Date(appointment.startsAt);
  return { kind: 'open', late: now > startsAt.getTime(), startsAt, closesAt };
}

/** Milliseconds until the state can next change (window opens, start passes, window closes), or null when it cannot. */
export function nextJoinWindowChange(
  appointment: Pick<Appointment, 'status' | 'startsAt' | 'endsAt'>,
  now: number = Date.now(),
  options: JoinWindowOptions = {},
): number | null {
  if (appointment.status !== 'confirmed') return null;
  const { opensAt, closesAt } = joinWindowBounds(appointment, options);
  const next = [opensAt.getTime(), Date.parse(appointment.startsAt), closesAt.getTime()].find((at) => at > now);
  return next === undefined ? null : next - now;
}
