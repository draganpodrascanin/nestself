/**
 * Which appointments this browser tab already joined (CALL-06, CALL-07): the
 * server lets a participant who joined rejoin until the room closes, while a
 * first join closes 10 minutes after the start. The join window shown on the
 * appointment and call pages follows the same split, so after a first join
 * it offers "Join" again instead of "closed".
 *
 * Kept in `sessionStorage` (a per-tab convenience; the server decides).
 * Every access is guarded: storage can be missing or throw.
 */
const KEY = 'nestself.calls.joined';

function read(): string[] {
  try {
    const raw = globalThis.sessionStorage?.getItem(KEY);
    const value: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export function markJoined(appointmentId: string): void {
  try {
    const ids = read();
    if (!ids.includes(appointmentId)) globalThis.sessionStorage?.setItem(KEY, JSON.stringify([...ids, appointmentId].slice(-50)));
  } catch {
    // Without storage the page shows the first-join window; the server still allows the rejoin.
  }
}

export function hasJoined(appointmentId: string): boolean {
  return read().includes(appointmentId);
}
