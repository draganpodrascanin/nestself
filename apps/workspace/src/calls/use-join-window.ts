import { useEffect, useState } from 'react';
import { joinWindowState, nextJoinWindowChange } from '@nestself/api-client';
import type { JoinWindowState } from '@nestself/api-client';
import type { Appointment } from '@nestself/contracts';
import { hasJoined } from './joined-sessions';

/** Longest single timer; a far-off window is re-checked at this interval. */
const MAX_TIMER_MS = 60 * 60 * 1000;

/**
 * The join window state, re-rendered when the window opens, the start passes
 * or the window closes. A first join closes 10 minutes after the start; once
 * this tab joined, the window lasts until the room closes (CALL-06, CALL-07).
 */
export function useJoinWindow(appointment: Pick<Appointment, 'id' | 'status' | 'startsAt' | 'endsAt'> | null): JoinWindowState | null {
  const [now, setNow] = useState(() => Date.now());
  const options = { rejoin: appointment ? hasJoined(appointment.id) : false };
  const next = appointment ? nextJoinWindowChange(appointment, now, options) : null;
  useEffect(() => {
    if (next === null) return undefined;
    const id = setTimeout(() => setNow(Date.now()), Math.min(next + 1, MAX_TIMER_MS));
    return () => clearTimeout(id);
  }, [next]);
  return appointment ? joinWindowState(appointment, now, options) : null;
}
