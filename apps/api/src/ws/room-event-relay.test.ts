/**
 * RoomEventRelay (T-CW-1.6): every API task subscribes to the room events
 * channel, validates each message again against `ROOM_EVENTS` and emits it
 * to its own sockets in the room. With the emitter on the same store, an
 * event reaches a socket exactly once, whichever process emitted it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import type { KeyValueStore } from '../redis/key-value-store.js';
import { MemoryKeyValueStore } from '../redis/memory-key-value-store.js';
import { ROOM_EVENTS_CHANNEL } from '../redis/redis-keys.js';
import type { EventsGateway } from './events.gateway.js';
import { RoomEmitter } from './room-emitter.js';
import { RoomEventRelay } from './room-event-relay.js';

interface Delivered {
  room: string;
  event: string;
  payload: unknown;
}

function fakeGateway(): { gateway: { server: unknown }; delivered: Delivered[] } {
  const delivered: Delivered[] = [];
  const server = {
    to: (room: string) => ({
      emit: (event: string, payload: unknown) => {
        delivered.push({ room, event, payload });
        return true;
      },
    }),
  };
  return { gateway: { server }, delivered };
}

describe('RoomEventRelay', () => {
  let store: MemoryKeyValueStore;
  let gateway: { server: unknown };
  let delivered: Delivered[];
  let relay: RoomEventRelay;
  let errors: unknown[][];
  let warnings: unknown[][];

  const publish = (message: unknown): Promise<number> =>
    store.publish(ROOM_EVENTS_CHANNEL, typeof message === 'string' ? message : JSON.stringify(message));

  beforeEach(async () => {
    store = new MemoryKeyValueStore();
    ({ gateway, delivered } = fakeGateway());
    relay = new RoomEventRelay(store, gateway as unknown as EventsGateway);
    errors = [];
    warnings = [];
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args);
    });
    vi.spyOn(Logger.prototype, 'warn').mockImplementation((...args: unknown[]) => {
      warnings.push(args);
    });
    await relay.onModuleInit();
  });

  afterEach(async () => {
    await relay.onModuleDestroy();
    vi.restoreAllMocks();
  });

  it('emits a valid event to the room on this task', async () => {
    await publish({ room: 'call:session_1', event: 'call.location.shared', payload: { sessionId: 'session_1' } });
    expect(delivered).toEqual([
      { room: 'call:session_1', event: 'call.location.shared', payload: { sessionId: 'session_1' } },
    ]);
  });

  it('delivers an emitter’s event exactly once, the emitter itself delivering nothing', () => {
    const emitter = new RoomEmitter(store);
    expect(emitter.emit('call:session_1', 'call.participant.left', { participantId: 'p1', role: 'employee' })).toBe(true);
    expect(delivered).toEqual([
      { room: 'call:session_1', event: 'call.participant.left', payload: { participantId: 'p1', role: 'employee' } },
    ]);
  });

  it('drops a message whose payload fails its schema, logging the event name only', async () => {
    await publish({
      room: 'call:session_1',
      event: 'call.participant.joined',
      payload: { participantId: 'p1', role: 'expert', displayName: 'Milica' },
    });
    expect(delivered).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(JSON.stringify(errors[0])).toContain('call.participant.joined');
    expect(JSON.stringify(errors[0])).not.toMatch(/Milica|session_1/);
  });

  it.each([
    ['an unknown event', { room: 'call:session_1', event: 'call.chat.message', payload: {} }],
    ['a room of another kind', { room: 'webinar:w1', event: 'call.location.shared', payload: { sessionId: 's' } }],
    ['a malformed room', { room: 'call:a:b', event: 'call.location.shared', payload: { sessionId: 's' } }],
    ['a message without a payload', { room: 'call:session_1', event: 'call.location.shared' }],
    ['a message with extra fields', { room: 'call:s', event: 'call.location.shared', payload: { sessionId: 's' }, x: 1 }],
    ['a non-JSON message', 'not json'],
    ['a JSON scalar', '42'],
  ])('drops %s', async (_label, message) => {
    await publish(message);
    expect(delivered).toEqual([]);
    expect(errors).toHaveLength(1);
  });

  it('drops silently in a process without a Socket.IO server (the worker)', async () => {
    gateway.server = undefined;
    await publish({ room: 'call:session_1', event: 'call.location.shared', payload: { sessionId: 'session_1' } });
    expect(delivered).toEqual([]);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('stops relaying after module destroy', async () => {
    await relay.onModuleDestroy();
    await publish({ room: 'call:session_1', event: 'call.location.shared', payload: { sessionId: 'session_1' } });
    expect(delivered).toEqual([]);
  });

  it('logs a failed subscription at warn and does not throw', async () => {
    const failing = { subscribe: vi.fn(async () => Promise.reject(new Error('Redis down'))) };
    const offline = new RoomEventRelay(failing as unknown as KeyValueStore, gateway as unknown as EventsGateway);
    await expect(offline.onModuleInit()).resolves.toBeUndefined();
    expect(warnings).toHaveLength(1);
  });
});
