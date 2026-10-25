/**
 * WebinarRoomEvents (T-CW-2.1, D-CW-15, D-CW-16, CW-R-34): each event goes
 * to its room, floor events to the attendee's own room only, and a payload
 * that fails the contract (a name on the public room) is never emitted.
 */
import { describe, expect, it, vi } from 'vitest';
import type { RoomEmitter } from '../ws/room-emitter.js';
import { WebinarRoomEvents } from './webinar-room-events.js';

function setup() {
  const emit = vi.fn((_room: string, _event: string, _payload: unknown) => true);
  const events = new WebinarRoomEvents({ emit } as unknown as RoomEmitter);
  return { emit, events };
}

const message = {
  id: 'msg_1',
  webinarId: 'w1',
  kind: 'attendee' as const,
  status: 'published' as const,
  text: 'Thank you',
  authorFirstName: null,
  answerText: null,
  publishedAt: '2026-11-25T16:10:00.000Z',
  createdAt: '2026-11-25T16:05:00.000Z',
};

describe('WebinarRoomEvents', () => {
  it('sends public events to webinar:{id}, moderation events to webinar:{id}:moderation', () => {
    const { emit, events } = setup();
    expect(events.toAudience('w1', 'webinar.state', { webinarId: 'w1', status: 'live' })).toBe(true);
    events.toModeration('w1', 'webinar.attendance.count', { webinarId: 'w1', count: 3 });
    expect(emit.mock.calls).toEqual([
      ['webinar:w1', 'webinar.state', { webinarId: 'w1', status: 'live' }],
      ['webinar:w1:moderation', 'webinar.attendance.count', { webinarId: 'w1', count: 3 }],
    ]);
  });

  it('sends floor events to the attendee’s own room only (CW-R-34)', () => {
    const { emit, events } = setup();
    events.toParticipant('user_jovan', 'webinar.floor.given', {
      participantId: 'part_1',
      capabilities: { audio: 'send_receive', video: 'receive', content: 'receive' },
    });
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0]![0]).toBe('user:user_jovan');
  });

  it('refuses a floor event that would let an attendee send video (D-CW-35)', () => {
    const { emit, events } = setup();
    const sent = events.toParticipant('user_jovan', 'webinar.floor.given', {
      participantId: 'part_1',
      capabilities: { audio: 'send_receive', video: 'send_receive', content: 'receive' },
    } as never);
    expect(sent).toBe(false);
    expect(emit).not.toHaveBeenCalled();
  });

  it('never emits a published message that carries a name or a user id (D-CW-15)', () => {
    const { emit, events } = setup();
    expect(events.toAudience('w1', 'webinar.message.published', message)).toBe(true);
    expect(events.toAudience('w1', 'webinar.message.published', { ...message, authorName: 'Jovan Petrović' } as never)).toBe(
      false,
    );
    expect(events.toAudience('w1', 'webinar.message.published', { ...message, userId: 'user_jovan' } as never)).toBe(false);
    expect(emit).toHaveBeenCalledTimes(1);
  });
});
