/**
 * RoomEmitter (T-CW-1.6, CW-R-36): every payload is validated against its
 * event's schema and room kind before it reaches the room; a failure is
 * dropped and logged at error level with the event name only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import type { EventsGateway } from './events.gateway.js';
import { RoomEmitter } from './room-emitter.js';

function fakeServer() {
  const emitted: { room: string; event: string; payload: unknown }[] = [];
  const server = {
    to: (room: string) => ({
      emit: (event: string, payload: unknown) => {
        emitted.push({ room, event, payload });
        return true;
      },
    }),
  };
  return { server, emitted };
}

describe('RoomEmitter', () => {
  let emitted: { room: string; event: string; payload: unknown }[];
  let gateway: { server: unknown };
  let emitter: RoomEmitter;
  let errors: unknown[][];
  let warnings: unknown[][];

  beforeEach(() => {
    const fake = fakeServer();
    emitted = fake.emitted;
    gateway = { server: fake.server };
    emitter = new RoomEmitter(gateway as unknown as EventsGateway);
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

  it('emits a valid payload to the room', () => {
    expect(
      emitter.emit('call:session_1', 'call.participant.joined', { participantId: 'participant_1', role: 'expert' }),
    ).toBe(true);
    expect(emitted).toEqual([
      {
        room: 'call:session_1',
        event: 'call.participant.joined',
        payload: { participantId: 'participant_1', role: 'expert' },
      },
    ]);
  });

  it('drops a payload carrying a name, and logs the event name only', () => {
    const payload = { participantId: 'participant_1', role: 'expert', displayName: 'Milica' };
    expect(emitter.emit('call:session_1', 'call.participant.joined', payload as never)).toBe(false);
    expect(emitted).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(JSON.stringify(errors[0])).toContain('call.participant.joined');
    expect(JSON.stringify(errors[0])).not.toMatch(/Milica|participant_1|session_1/);
  });

  it('drops a payload missing a field', () => {
    expect(emitter.emit('call:session_1', 'call.session.ended', { sessionId: 'session_1' } as never)).toBe(false);
    expect(emitted).toEqual([]);
    expect(errors).toHaveLength(1);
  });

  it('drops an event it has no schema for', () => {
    expect(emitter.emit('call:session_1', 'call.chat.message' as never, {} as never)).toBe(false);
    expect(emitted).toEqual([]);
    expect(errors).toHaveLength(1);
  });

  it.each(['webinar:w1', 'webinar:w1:moderation', 'org:org_sample:programme', 'call:', 'session_1'])(
    'drops a call event addressed to %j',
    (room) => {
      expect(emitter.emit(room, 'call.location.shared', { sessionId: 'session_1' })).toBe(false);
      expect(emitted).toEqual([]);
      expect(errors).toHaveLength(1);
    },
  );

  it('validates before it looks for a server, and drops a valid event when there is none', () => {
    gateway.server = undefined;
    expect(emitter.emit('call:session_1', 'call.location.shared', { sessionId: 'session_1' })).toBe(false);
    expect(warnings).toHaveLength(1);
    expect(errors).toHaveLength(0);
    expect(emitter.emit('call:session_1', 'call.location.shared', { sessionId: '' })).toBe(false);
    expect(errors).toHaveLength(1);
  });
});
