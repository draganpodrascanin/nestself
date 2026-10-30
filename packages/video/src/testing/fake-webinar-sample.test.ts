/**
 * The sample server is data-driven for the apps (`{ people, messages, polls }`
 * from `@nestself/sample-data`), and keeps its built-in scene for stories.
 */
import { describe, expect, it } from 'vitest';
import { FakeWebinarClient } from './fake-webinar';
import { createSampleWebinarServer } from './fake-webinar-sample';
import type { SampleWebinarContent } from './fake-webinar-sample';

const CONTENT: SampleWebinarContent = {
  people: {
    moderator: 'Nikola',
    presenter: 'Milica',
    hosts: [{ participantId: 'host-moderator', name: 'Nikola' }],
    attendees: [
      { participantId: 'att-jovan', name: 'Jovan Petrović' },
      { participantId: 'att-ana', name: 'Ana Kovač' },
    ],
  },
  messages: [
    { id: 'm1', kind: 'host', status: 'published', authorParticipantId: 'host-moderator', text: 'Welcome.', showFirstName: false, publishedAt: '2026-10-15T15:01:00.000Z', answerText: null, createdAt: '2026-10-15T15:01:00.000Z' },
    { id: 'm2', kind: 'attendee', status: 'published', authorParticipantId: 'att-jovan', text: 'Clear, thanks.', showFirstName: true, publishedAt: '2026-10-15T15:06:00.000Z', answerText: null, createdAt: '2026-10-15T15:05:00.000Z' },
    { id: 'm3', kind: 'question', status: 'answered', authorParticipantId: 'att-ana', text: 'How long?', showFirstName: false, publishedAt: '2026-10-15T15:45:00.000Z', answerText: 'A few minutes.', createdAt: '2026-10-15T15:25:00.000Z' },
    { id: 'm4', kind: 'attendee', status: 'pending', authorParticipantId: 'att-ana', text: 'Once more?', showFirstName: false, publishedAt: null, answerText: null, createdAt: '2026-10-15T15:32:00.000Z' },
  ],
  polls: [
    {
      id: 'p1',
      question: 'Which break?',
      options: [
        { id: 'o1', label: 'A walk', position: 0 },
        { id: 'o2', label: 'Stretching', position: 1 },
      ],
      openedAt: '2026-10-15T15:35:00.000Z',
      closedAt: '2026-10-15T15:40:00.000Z',
      results: [
        { optionId: 'o1', count: 2 },
        { optionId: 'o2', count: 1 },
      ],
    },
  ],
};

describe('createSampleWebinarServer', () => {
  it('seeds the apps\' messages and polls: names only where attached, the registration name for the moderator', () => {
    const server = createSampleWebinarServer({ webinarId: 'webinar_sample_ended', status: 'live', content: CONTENT, hands: true });
    const attendee = new FakeWebinarClient({ server, role: 'attendee' });
    const moderator = new FakeWebinarClient({ server, role: 'moderator' });

    expect(attendee.getSnapshot().publicMessages.map((m) => [m.id, m.authorFirstName])).toEqual([
      ['m1', 'Nikola'],
      ['m2', 'Jovan'],
      ['m3', null],
    ]);
    expect(attendee.getSnapshot().publicMessages[2]).toMatchObject({ status: 'answered', answerText: 'A few minutes.', webinarId: 'webinar_sample_ended' });
    expect(JSON.stringify(attendee.getSnapshot())).not.toContain('Ana Kovač');
    expect(moderator.getSnapshot().moderationMessages.find((m) => m.id === 'm4')).toMatchObject({ status: 'pending', authorName: 'Ana Kovač' });
    expect(moderator.getSnapshot().hands.map((h) => h.name)).toEqual(['Jovan Petrović', 'Ana Kovač']);
    expect(attendee.getSnapshot().polls.results['p1']).toEqual({ pollId: 'p1', totalVotes: 3, results: [{ optionId: 'o1', count: 2 }, { optionId: 'o2', count: 1 }] });
  });

  it('keeps the built-in scene for stories when no content is given', () => {
    const server = createSampleWebinarServer({ status: 'live', poll: 'open' });
    const attendee = new FakeWebinarClient({ server, role: 'attendee' });
    expect(attendee.getSnapshot().publicMessages.length).toBeGreaterThan(0);
    expect(attendee.getSnapshot().polls.list).toHaveLength(1);
  });
});
