import { useEffect, useState } from 'react';
import { joinWindowState, nextJoinWindowChange } from '@nestself/api-client';
import type { AppointmentView, JoinWindowState } from '@nestself/api-client';
import type { Appointment } from '@nestself/contracts';
import { hasJoined } from './joined-sessions';

/** Longest single timer; a far-off window is re-checked at this interval. */
const MAX_TIMER_MS = 60 * 60 * 1000;

export type JoinWindowAppointment = Pick<Appointment, 'id' | 'status' | 'startsAt' | 'endsAt'> & Pick<AppointmentView, 'viewer'>;

/**
 * The join window state, re-rendered when the window opens, the start passes
 * or the window closes. A first join closes 10 minutes after the start; a
 * participant who already joined may rejoin until the room closes (CALL-06,
 * CALL-07). Whether they joined comes from the API (`viewer.hasJoined`) and,
 * before the API says so, from this tab. Someone the API knows never joined
 * gets the closed state, not "Rejoin".
 */
export function useJoinWindow(appointment: JoinWindowAppointment | null): JoinWindowState | null {
  const [now, setNow] = useState(() => Date.now());
  const joined = appointment ? (appointment.viewer?.hasJoined ?? hasJoined(appointment.id)) : false;
  const options = { rejoin: joined };
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
