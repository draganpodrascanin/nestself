import { useEffect, useState } from 'react';
import { joinWindowState, nextJoinWindowChange } from '@nestself/api-client';
import type { AppointmentView, JoinWindowState } from '@nestself/api-client';
import type { Appointment } from '@nestself/contracts';

/** Longest single timer; a far-off window is re-checked at this interval. */
const MAX_TIMER_MS = 60 * 60 * 1000;

/**
 * The join window state, re-rendered when the window opens, the start passes
 * or the window closes. With `viewer.hasJoined` from the API, an expert who
 * joined may rejoin until the room closes and one who never joined sees the
 * closed state, not "Rejoin" (CALL-06, CALL-07).
 */
export function useJoinWindow(
  appointment: (Pick<Appointment, 'status' | 'startsAt' | 'endsAt'> & Pick<AppointmentView, 'viewer'>) | null,
): JoinWindowState | null {
  const [now, setNow] = useState(() => Date.now());
  const options = { rejoin: appointment?.viewer?.hasJoined === true };
  const next = appointment ? nextJoinWindowChange(appointment, now, options) : null;
  useEffect(() => {
    if (next === null) return undefined;
    const id = setTimeout(() => setNow(Date.now()), Math.min(next + 1, MAX_TIMER_MS));
    return () => clearTimeout(id);
  }, [next]);
  if (!appointment) return null;
  const state = joinWindowState(appointment, now, options);
  if (state.kind === 'closed' && appointment.viewer?.hasJoined === false) return { ...state, rejoinable: false };
  return state;
}
