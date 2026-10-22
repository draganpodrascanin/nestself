/**
 * Neutral timing helper -- prevents user-enumeration timing oracles (SESS-R-21).
 *
 * Pads the response time to a fixed floor so success and failure paths take
 * the same wall-clock time from the caller's perspective.
 */
import { setTimeout as delay } from 'node:timers/promises';

export const NEUTRAL_DELAY_MS = 200;

export async function neutralDelay(startMs: number): Promise<void> {
  const elapsed = Date.now() - startMs;
  const remaining = NEUTRAL_DELAY_MS - elapsed;
  if (remaining > 0) await delay(remaining);
}
