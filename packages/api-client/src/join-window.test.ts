/**
 * The consultation join window as the apps show it (CALL-02, CALL-06,
 * CALL-07), mirroring the server: opens 15 minutes before the start; a first
 * join closes 10 minutes after the start; a participant who already joined
 * may rejoin until the room closes, 15 minutes after the end. After the
 * first-join close the `closed` state says whether a rejoin is still possible.
 */
import { describe, expect, it } from 'vitest';
import { joinWindowBounds, joinWindowState, nextJoinWindowChange } from './join-window';

const MINUTE = 60_000;
const STARTS = Date.parse('2030-01-15T09:00:00.000Z');
const ENDS = STARTS + 50 * MINUTE;
const APPOINTMENT = {
  status: 'confirmed' as const,
  startsAt: new Date(STARTS).toISOString(),
  endsAt: new Date(ENDS).toISOString(),
};
const REJOIN = { rejoin: true };

describe('joinWindowBounds', () => {
  it('opens 15 minutes before the start and closes a first join 10 minutes after it', () => {
    expect(joinWindowBounds(APPOINTMENT)).toEqual({ opensAt: new Date(STARTS - 15 * MINUTE), closesAt: new Date(STARTS + 10 * MINUTE) });
  });

  it('keeps a rejoin open until the room closes, 15 minutes after the end', () => {
    expect(joinWindowBounds(APPOINTMENT, REJOIN)).toEqual({ opensAt: new Date(STARTS - 15 * MINUTE), closesAt: new Date(ENDS + 15 * MINUTE) });
  });
});

describe('joinWindowState', () => {
  it('is not joinable unless confirmed', () => {
    for (const status of ['proposed', 'awaiting_approval', 'completed', 'canceled'] as const) {
      expect(joinWindowState({ ...APPOINTMENT, status }, STARTS).kind).toBe('not_joinable');
    }
  });

  it.each([
    ['without rejoin', {}],
    ['with rejoin', REJOIN],
  ])('opens at start - 15 minutes, both bounds included (%s)', (_label, options) => {
    expect(joinWindowState(APPOINTMENT, STARTS - 15 * MINUTE - 1, options)).toEqual({ kind: 'before', opensAt: new Date(STARTS - 15 * MINUTE) });
    expect(joinWindowState(APPOINTMENT, STARTS - 15 * MINUTE, options)).toMatchObject({ kind: 'open', late: false });
  });

  it('a first join is late after the start and closes at start + 10 minutes, then offers a rejoin', () => {
    expect(joinWindowState(APPOINTMENT, STARTS + MINUTE)).toMatchObject({ kind: 'open', late: true });
    expect(joinWindowState(APPOINTMENT, STARTS + 10 * MINUTE)).toMatchObject({ kind: 'open', closesAt: new Date(STARTS + 10 * MINUTE) });
    expect(joinWindowState(APPOINTMENT, STARTS + 10 * MINUTE + 1)).toEqual({
      kind: 'closed',
      closedAt: new Date(STARTS + 10 * MINUTE),
      rejoinable: true,
    });
    expect(joinWindowState(APPOINTMENT, STARTS + 11 * MINUTE)).toMatchObject({ kind: 'closed', rejoinable: true });
  });

  it('the rejoin offer lasts until end + 15 minutes', () => {
    expect(joinWindowState(APPOINTMENT, ENDS + 15 * MINUTE)).toMatchObject({ kind: 'closed', rejoinable: true });
    expect(joinWindowState(APPOINTMENT, ENDS + 15 * MINUTE + 1)).toEqual({
      kind: 'closed',
      closedAt: new Date(STARTS + 10 * MINUTE),
      rejoinable: false,
    });
  });

  it('with rejoin the window stays open until end + 15 minutes, then closes for good', () => {
    expect(joinWindowState(APPOINTMENT, STARTS + 11 * MINUTE, REJOIN)).toMatchObject({ kind: 'open', late: true });
    expect(joinWindowState(APPOINTMENT, ENDS + 15 * MINUTE, REJOIN)).toMatchObject({ kind: 'open' });
    expect(joinWindowState(APPOINTMENT, ENDS + 15 * MINUTE + 1, REJOIN)).toEqual({
      kind: 'closed',
      closedAt: new Date(ENDS + 15 * MINUTE),
      rejoinable: false,
    });
  });
});

describe('nextJoinWindowChange', () => {
  it('reports the next change: opening, the start, the first-join close, the room close', () => {
    expect(nextJoinWindowChange(APPOINTMENT, STARTS - 20 * MINUTE)).toBe(5 * MINUTE);
    expect(nextJoinWindowChange(APPOINTMENT, STARTS - MINUTE)).toBe(MINUTE);
    expect(nextJoinWindowChange(APPOINTMENT, STARTS + MINUTE)).toBe(9 * MINUTE);
    // Closed for a first join, still rejoinable: the room's close is the next change.
    expect(nextJoinWindowChange(APPOINTMENT, STARTS + 11 * MINUTE)).toBe(54 * MINUTE);
    expect(nextJoinWindowChange(APPOINTMENT, ENDS + 16 * MINUTE)).toBeNull();
    expect(nextJoinWindowChange(APPOINTMENT, STARTS + 11 * MINUTE, REJOIN)).toBe(54 * MINUTE);
    expect(nextJoinWindowChange({ ...APPOINTMENT, status: 'proposed' }, STARTS)).toBeNull();
  });
});
