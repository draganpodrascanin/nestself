import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientEventRequest } from '@nestself/contracts';
import { callRoomSubscribeMessage, createCallRoomClient } from './call-room';
import type { RoomSocket } from './call-room';
import { startClientEventPoster } from './client-events';
import { joinWindowState, nextJoinWindowChange } from './join-window';

const MINUTE = 60_000;
const STARTS = Date.parse('2030-01-15T09:00:00.000Z');
const APPOINTMENT = {
  status: 'confirmed' as const,
  startsAt: new Date(STARTS).toISOString(),
  endsAt: new Date(STARTS + 50 * MINUTE).toISOString(),
};

describe('joinWindowState', () => {
  it('is not joinable unless confirmed', () => {
    expect(joinWindowState({ ...APPOINTMENT, status: 'proposed' }, STARTS).kind).toBe('not_joinable');
    expect(joinWindowState({ ...APPOINTMENT, status: 'completed' }, STARTS).kind).toBe('not_joinable');
  });

  it('opens 15 minutes before the start', () => {
    expect(joinWindowState(APPOINTMENT, STARTS - 15 * MINUTE - 1)).toEqual({ kind: 'before', opensAt: new Date(STARTS - 15 * MINUTE) });
    expect(joinWindowState(APPOINTMENT, STARTS - 15 * MINUTE)).toMatchObject({ kind: 'open', late: false });
  });

  it('is a late join after the start and closes 10 minutes after the end', () => {
    expect(joinWindowState(APPOINTMENT, STARTS + MINUTE)).toMatchObject({ kind: 'open', late: true });
    expect(joinWindowState(APPOINTMENT, STARTS + 60 * MINUTE)).toMatchObject({ kind: 'open', late: true });
    expect(joinWindowState(APPOINTMENT, STARTS + 60 * MINUTE + 1)).toEqual({ kind: 'closed', closedAt: new Date(STARTS + 60 * MINUTE) });
  });

  it('reports when the state changes next', () => {
    expect(nextJoinWindowChange(APPOINTMENT, STARTS - 20 * MINUTE)).toBe(5 * MINUTE);
    expect(nextJoinWindowChange(APPOINTMENT, STARTS - MINUTE)).toBe(MINUTE);
    expect(nextJoinWindowChange(APPOINTMENT, STARTS + 61 * MINUTE)).toBeNull();
  });
});

class FakeSocket implements RoomSocket {
  readonly listeners = new Map<string, ((...args: unknown[]) => void)[]>();
  readonly emitted: [string, unknown][] = [];
  disconnected = false;

  on(event: string, listener: (...args: never[]) => void) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener as (...args: unknown[]) => void]);
    return this;
  }
  emit(event: string, payload?: unknown) {
    this.emitted.push([event, payload]);
    return this;
  }
  disconnect() {
    this.disconnected = true;
    return this;
  }
  fire(event: string, payload?: unknown) {
    for (const listener of this.listeners.get(event) ?? []) listener(payload);
  }
}

describe('call room client', () => {
  it('subscribes to call:{sessionId} on every connect', () => {
    const socket = new FakeSocket();
    createCallRoomClient(() => socket).subscribe('sess_1', {});
    socket.fire('connect');
    socket.fire('connect');
    expect(socket.emitted).toEqual([
      ['subscribe', callRoomSubscribeMessage('sess_1')],
      ['subscribe', callRoomSubscribeMessage('sess_1')],
    ]);
    expect(callRoomSubscribeMessage('sess_1')).toEqual({
      room: 'call:sess_1',
      action: 'consultation.join',
      resource: { type: 'call_session', id: 'sess_1' },
    });
  });

  it('delivers parsed events and drops malformed ones', () => {
    const socket = new FakeSocket();
    const onSignal = vi.fn();
    const onParticipantJoined = vi.fn();
    const onSessionEnded = vi.fn();
    const onFollowUpChanged = vi.fn();
    createCallRoomClient(() => socket).subscribe('sess_1', { onSignal, onParticipantJoined, onSessionEnded, onFollowUpChanged });

    socket.fire('call.signal', { type: 'running_late', etaMinutes: 5, fromRole: 'expert' });
    socket.fire('call.signal', { type: 'running_late', fromRole: 'expert', name: 'Ana' });
    socket.fire('call.participant.joined', { participantId: 'p1', role: 'expert' });
    socket.fire('call.session.ended', { sessionId: 'sess_1', endedAt: '2030-01-15T09:40:00.000Z' });
    socket.fire('appointment.follow_up.declined', { appointmentId: 'a1', followUpId: 'a2' });

    expect(onSignal).toHaveBeenCalledTimes(1);
    expect(onSignal).toHaveBeenCalledWith({ type: 'running_late', etaMinutes: 5, fromRole: 'expert' });
    expect(onParticipantJoined).toHaveBeenCalledWith({ participantId: 'p1', role: 'expert' });
    expect(onSessionEnded).toHaveBeenCalledTimes(1);
    expect(onFollowUpChanged).toHaveBeenCalledWith({ appointmentId: 'a1', followUpId: 'a2', change: 'declined' });
  });

  it('reports a refused subscription or a failed connection', () => {
    const socket = new FakeSocket();
    const onUnavailable = vi.fn();
    createCallRoomClient(() => socket).subscribe('sess_1', { onUnavailable });
    socket.fire('subscribe:denied', { room: 'call:other', reason: 'not_found' });
    socket.fire('subscribe:denied', { room: 'call:sess_1', reason: 'not_found' });
    socket.fire('connect_error', new Error('offline'));
    expect(onUnavailable.mock.calls).toEqual([['not_found'], ['connect_error']]);
  });

  it('leaves the room, closes the socket and ignores later events', () => {
    const socket = new FakeSocket();
    const onSignal = vi.fn();
    const leave = createCallRoomClient(() => socket).subscribe('sess_1', { onSignal });
    leave();
    leave();
    socket.fire('call.signal', { type: 'cannot_hear', fromRole: 'expert' });
    expect(socket.emitted).toEqual([['unsubscribe', { room: 'call:sess_1' }]]);
    expect(socket.disconnected).toBe(true);
    expect(onSignal).not.toHaveBeenCalled();
  });
});

describe('client event poster', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const event = (eventName: ClientEventRequest['eventName']): ClientEventRequest => ({ eventName });

  it('posts the drained log every interval and once more on stop', async () => {
    let buffer: ClientEventRequest[] = [event('meetingStartSucceeded')];
    const post = vi.fn(async () => undefined);
    const poster = startClientEventPoster({ drain: () => buffer.splice(0), post, intervalMs: 30_000 });

    await vi.advanceTimersByTimeAsync(30_000);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenLastCalledWith([event('meetingStartSucceeded')]);

    // Nothing buffered: no empty post.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(post).toHaveBeenCalledTimes(1);

    buffer = [event('connectionStats')];
    await poster.stop();
    expect(post).toHaveBeenCalledTimes(2);
    expect(post).toHaveBeenLastCalledWith([event('connectionStats')]);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('hands a failed post to onError and keeps going', async () => {
    const buffer: ClientEventRequest[] = [event('meetingFailed')];
    const onError = vi.fn();
    const post = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const poster = startClientEventPoster({ drain: () => buffer.splice(0), post, onError });
    await poster.flush();
    expect(onError).toHaveBeenCalledTimes(1);
    buffer.push(event('meetingReconnected'));
    await poster.stop();
    expect(post).toHaveBeenCalledTimes(2);
  });
});
