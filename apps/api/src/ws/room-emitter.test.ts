/**
 * RoomEmitter (T-CW-1.6, CW-R-36): every payload is validated against its
 * event's schema and room kind, then published on the room events channel
 * for the `RoomEventRelay` of every API task; it never emits locally. A
 * failure is dropped and logged at error level with the event name only; a
 * failed publish is logged at warn and never thrown.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import type { KeyValueStore } from '../redis/key-value-store.js';
import { MemoryKeyValueStore } from '../redis/memory-key-value-store.js';
import { ROOM_EVENTS_CHANNEL } from '../redis/redis-keys.js';
import { RoomEmitter } from './room-emitter.js';

describe('RoomEmitter', () => {
  let store: MemoryKeyValueStore;
  let published: unknown[];
  let emitter: RoomEmitter;
  let errors: unknown[][];
  let warnings: unknown[][];

  beforeEach(async () => {
    store = new MemoryKeyValueStore();
    published = [];
    await store.subscribe(ROOM_EVENTS_CHANNEL, (message) => {
      published.push(JSON.parse(message));
    });
    emitter = new RoomEmitter(store);
    errors = [];
    warnings = [];
    vi.spyOn(Logger.prototype, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args);
    });
    vi.spyOn(Logger.prototype, 'warn').mockImplementation((...args: unknown[]) => {
      warnings.push(args);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('publishes a valid event on the room events channel', () => {
    expect(
      emitter.emit('call:session_1', 'call.participant.joined', { participantId: 'participant_1', role: 'expert' }),
    ).toBe(true);
    expect(published).toEqual([
      {
        room: 'call:session_1',
        event: 'call.participant.joined',
        payload: { participantId: 'participant_1', role: 'expert' },
      },
    ]);
  });

  it('needs no Socket.IO server, so the worker can emit', () => {
    expect(new RoomEmitter(store).emit('call:session_1', 'call.location.shared', { sessionId: 'session_1' })).toBe(true);
    expect(published).toHaveLength(1);
  });

  it('drops a payload carrying a name, and logs the event name only', () => {
    const payload = { participantId: 'participant_1', role: 'expert', displayName: 'Milica' };
    expect(emitter.emit('call:session_1', 'call.participant.joined', payload as never)).toBe(false);
    expect(published).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(JSON.stringify(errors[0])).toContain('call.participant.joined');
    expect(JSON.stringify(errors[0])).not.toMatch(/Milica|participant_1|session_1/);
  });

  it('drops a payload missing a field', () => {
    expect(emitter.emit('call:session_1', 'call.session.ended', { sessionId: 'session_1' } as never)).toBe(false);
    expect(published).toEqual([]);
    expect(errors).toHaveLength(1);
  });

  it('drops an event it has no schema for', () => {
    expect(emitter.emit('call:session_1', 'call.chat.message' as never, {} as never)).toBe(false);
    expect(emitter.emit('call:session_1', 'toString' as never, {} as never)).toBe(false);
    expect(published).toEqual([]);
    expect(errors).toHaveLength(2);
  });

  it.each(['webinar:w1', 'webinar:w1:moderation', 'org:org_sample:programme', 'call:', 'session_1'])(
    'drops a call event addressed to %j',
    (room) => {
      expect(emitter.emit(room, 'call.location.shared', { sessionId: 'session_1' })).toBe(false);
      expect(published).toEqual([]);
      expect(errors).toHaveLength(1);
    },
  );

  it('logs a failed publish at warn by event name and never throws', async () => {
    const failing = { publish: vi.fn(async () => Promise.reject(new Error('Redis down'))) };
    const offline = new RoomEmitter(failing as unknown as KeyValueStore);

    expect(offline.emit('call:session_1', 'call.location.shared', { sessionId: 'session_1' })).toBe(true);
    await vi.waitFor(() => expect(warnings).toHaveLength(1));
    expect(JSON.stringify(warnings[0])).toContain('call.location.shared');
    expect(JSON.stringify(warnings[0])).not.toContain('session_1');
    expect(errors).toEqual([]);
  });

  it('logs a publish that throws synchronously the same way', async () => {
    const throwing = {
      publish: vi.fn(() => {
        throw new Error('not connected');
      }),
    };
    const offline = new RoomEmitter(throwing as unknown as KeyValueStore);

    expect(() => offline.emit('call:session_1', 'call.location.shared', { sessionId: 'session_1' })).not.toThrow();
    await vi.waitFor(() => expect(warnings).toHaveLength(1));
  });
});
