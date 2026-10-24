/**
 * Test appointments for the consultation journeys, written straight into the
 * journeys' own database (`servers.mjs`), with `psql`: the e2e directory has
 * no PostgreSQL driver and must not install one. The rows match what
 * `AppointmentsService.create` writes: a CONFIRMED appointment plus the
 * expert's CASE assignment, after which the expert's cached principal is
 * invalidated the way the service does it (Redis keys plus the
 * `invalidate` channel), so the expert reaches the new appointment at once.
 *
 * Every row this module creates has an id starting with `appt_e2e_`;
 * `removeJourneyAppointments` deletes them with everything the calls left
 * behind. The seeded sample appointments are never touched (the seed run by
 * `start-api.mjs` restores them).
 */
import { execFileSync } from 'node:child_process';
import { DATABASE_URL, REDIS_URL } from './servers.mjs';

export const ORG_ID = 'org_sample';
/** Sample people (fictional): the employee signs in to the workspace, the expert to the admin app. */
export const EMPLOYEE = { userId: 'user_jovan', email: 'user_jovan@example.com', firstName: 'Jovan' } as const;
export const EXPERT = { userId: 'user_milica', email: 'user_milica@example.com', firstName: 'Milica' } as const;

const MINUTE = 60_000;
const PREFIX = 'appt_e2e_';

function sql(statement: string): string {
  return execFileSync('psql', [DATABASE_URL, '-v', 'ON_ERROR_STOP=1', '-Atqc', statement], { encoding: 'utf8' }).trim();
}

const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;

function redis(...args: string[]): void {
  const url = new URL(REDIS_URL);
  const db = url.pathname.slice(1) || '0';
  execFileSync('redis-cli', ['-h', url.hostname, '-p', url.port || '6379', '-n', db, ...args], { stdio: 'ignore' });
}

/** What `PrincipalLoader.invalidateUser` does: drop the cached principal and assignments, tell every API process. */
export function invalidatePrincipal(userId: string): void {
  const keys = [`principal:${userId}`, `assignments:${userId}`];
  redis('DEL', ...keys);
  redis('PUBLISH', 'invalidate', JSON.stringify({ keys, reason: 'invalidation', userId }));
}

export interface JourneyAppointment {
  id: string;
  startsAt: string;
  endsAt: string;
}

export interface AppointmentTimes {
  /** Minutes from now to the scheduled start (negative: already started). */
  startsInMinutes: number;
  durationMinutes?: number;
  serviceCategory?: string;
  /** CONFIRMED (default), or PROPOSED for a follow-up the expert proposed (D-CW-37). */
  status?: 'CONFIRMED' | 'PROPOSED';
  /** The appointment a proposed follow-up follows. */
  followUpOf?: string;
}

/** A confirmed consultation between the sample employee and the sample expert. */
export function createAppointment(
  name: string,
  { startsInMinutes, durationMinutes = 45, serviceCategory = 'psychological', status = 'CONFIRMED', followUpOf }: AppointmentTimes,
): JourneyAppointment {
  const id = `${PREFIX}${name}_${Date.now().toString(36)}`;
  // Whole minutes keep the "HH:MM" copy on screen stable.
  const start = Math.floor((Date.now() + startsInMinutes * MINUTE) / MINUTE) * MINUTE;
  const startsAt = new Date(start).toISOString();
  const endsAt = new Date(start + durationMinutes * MINUTE).toISOString();
  sql(`
    INSERT INTO appointments (id, org_id, expert_user_id, employee_user_id, starts_at, ends_at, status, service_category, time_zone, follow_up_of, proposed_at)
    VALUES (${quote(id)}, ${quote(ORG_ID)}, ${quote(EXPERT.userId)}, ${quote(EMPLOYEE.userId)}, ${quote(startsAt)}, ${quote(endsAt)}, ${quote(status)}, ${quote(serviceCategory)}, 'Europe/Belgrade',
      ${followUpOf ? quote(followUpOf) : 'NULL'}, ${status === 'PROPOSED' ? 'now()' : 'NULL'});
    INSERT INTO assignments (id, user_id, kind, target_id, assigned_by_user_id, start_at, reason)
    VALUES (${quote(`assignment_${EXPERT.userId}_case_${id}`)}, ${quote(EXPERT.userId)}, 'CASE', ${quote(id)}, ${quote(EXPERT.userId)}, now() - interval '1 day', 'appointment_expert');
  `);
  invalidatePrincipal(EXPERT.userId);
  invalidatePrincipal(EMPLOYEE.userId);
  return { id, startsAt, endsAt };
}

/** Moves an appointment's whole window into the past, so the API refuses a join with `join_window_closed`. */
export function closeJoinWindow(appointmentId: string): void {
  sql(`UPDATE appointments SET starts_at = now() - interval '3 hours', ends_at = now() - interval '2 hours 15 minutes' WHERE id = ${quote(appointmentId)}`);
}

/** The appointment's status column (UPPER_CASE, as stored). */
export function appointmentStatus(appointmentId: string): string {
  return sql(`SELECT status FROM appointments WHERE id = ${quote(appointmentId)}`);
}

/** The call session of an appointment: its status and why it ended. */
export function callSession(appointmentId: string): { status: string; endReason: string } | null {
  const row = sql(`SELECT status || '|' || coalesce(end_reason::text, '') FROM call_sessions WHERE appointment_id = ${quote(appointmentId)} ORDER BY created_at DESC LIMIT 1`);
  if (!row) return null;
  const [status = '', endReason = ''] = row.split('|');
  return { status, endReason };
}

/** Deletes every journey appointment and what its calls left (sessions, participants, events, outcome, feedback). */
export function removeJourneyAppointments(): void {
  const sessions = `SELECT id FROM call_sessions WHERE appointment_id LIKE '${PREFIX}%'`;
  sql(`
    BEGIN;
    DELETE FROM call_client_events WHERE session_id IN (${sessions});
    DELETE FROM call_consents WHERE session_id IN (${sessions});
    DELETE FROM call_events WHERE session_id IN (${sessions});
    DELETE FROM call_feedback WHERE session_id IN (${sessions});
    DELETE FROM call_outcomes WHERE session_id IN (${sessions});
    DELETE FROM call_participants WHERE session_id IN (${sessions});
    DELETE FROM call_sessions WHERE appointment_id LIKE '${PREFIX}%';
    -- Follow-ups an expert proposed from a journey appointment (T-CW-1.9) go with it.
    DELETE FROM assignments WHERE target_id IN (SELECT id FROM appointments WHERE follow_up_of LIKE '${PREFIX}%');
    DELETE FROM appointments WHERE follow_up_of LIKE '${PREFIX}%';
    DELETE FROM appointments WHERE id LIKE '${PREFIX}%';
    DELETE FROM assignments WHERE target_id LIKE '${PREFIX}%';
    COMMIT;
  `);
  invalidatePrincipal(EXPERT.userId);
}
