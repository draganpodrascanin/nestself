/**
 * A scripted sample webinar for Storybook and the apps' sample mode ONLY
 * (sample-data rule): host posts, a published message, a pending message,
 * raised hands and a poll on a `FakeWebinarServer`. Production code never
 * imports it; the apps reach it only behind `VITE_DATA_SOURCE=sample`, with
 * the `SampleDataBanner` on screen. Every name is a placeholder marked
 * "(sample)", nobody here is a real person, and nothing is sent anywhere.
 *
 * The people and the poll stay here rather than in `packages/sample-data`
 * because `@nestself/video` does not depend on that package and adding the
 * dependency needs an install; move them there (with the `SAMPLE_` prefix)
 * when the dependency is added.
 */
import type { WebinarPoll } from '@nestself/contracts';
import { FakeWebinarServer } from './fake-webinar';
import type { FakeWebinarServerOptions } from './fake-webinar';

export const FAKE_WEBINAR_SAMPLE_POLL: WebinarPoll = {
  id: 'sample-poll-breaks',
  webinarId: 'sample-webinar',
  question: 'Which break would you like to try this week?',
  options: [
    { id: 'sample-option-walk', label: 'A short walk', position: 0 },
    { id: 'sample-option-stretch', label: 'Stretching at the desk', position: 1 },
    { id: 'sample-option-tea', label: 'A cup of tea away from the screen', position: 2 },
  ],
  openedAt: null,
  closedAt: null,
};

export const FAKE_WEBINAR_SAMPLE_PEOPLE = {
  moderator: 'Mila (sample)',
  presenter: 'Marko (sample)',
  attendees: [
    { participantId: 'sample-participant-ana', name: 'Ana Kovač (sample)' },
    { participantId: 'sample-participant-jovan', name: 'Jovan Petrović (sample)' },
  ],
} as const;

export interface FakeWebinarSampleOptions extends FakeWebinarServerOptions {
  /** Host posts, a published message and an answered question. */
  chat?: boolean;
  /** A message waiting for review. */
  pending?: boolean;
  /** Two raised hands. */
  hands?: boolean;
  poll?: 'none' | 'prepared' | 'open' | 'closed';
  attendance?: number;
  recording?: boolean;
}

/** A `FakeWebinarServer` already holding the sample scene; create the clients after it. */
export function createSampleWebinarServer(options: FakeWebinarSampleOptions = {}): FakeWebinarServer {
  const { chat = true, pending = false, hands = false, poll = 'none', attendance = 0, recording = false, ...serverOptions } = options;
  const webinarId = serverOptions.webinarId ?? FAKE_WEBINAR_SAMPLE_POLL.webinarId;
  const samplePoll = { ...FAKE_WEBINAR_SAMPLE_POLL, webinarId };
  const server = new FakeWebinarServer({ ...serverOptions, webinarId, polls: poll === 'none' ? [] : [samplePoll] });
  const [ana, jovan] = FAKE_WEBINAR_SAMPLE_PEOPLE.attendees;
  if (recording) server.simulate.recording('started');
  if (attendance) server.simulate.attendance(attendance);
  if (chat) {
    server.simulate.hostMessage(FAKE_WEBINAR_SAMPLE_PEOPLE.moderator, 'Welcome, everyone. We are starting now.');
    const thanks = server.simulate.attendeeMessage(jovan, 'Thank you, the sound and the slides are clear.', { showFirstName: true });
    server.simulate.publish(thanks.id);
    server.simulate.hostMessage(FAKE_WEBINAR_SAMPLE_PEOPLE.presenter, 'Questions are welcome in the chat. We will take them at the end.');
  }
  if (pending) {
    server.simulate.attendeeMessage(ana, 'Could you show the stretching example once more?', { kind: 'question' });
    server.simulate.attendeeMessage(jovan, 'Is there a short summary after the webinar?');
  }
  if (hands) {
    server.simulate.handRaised(ana.participantId, ana.name);
    server.simulate.handRaised(jovan.participantId, jovan.name);
  }
  if (poll === 'open' || poll === 'closed') {
    server.simulate.openPoll(FAKE_WEBINAR_SAMPLE_POLL.id);
    server.simulate.vote(FAKE_WEBINAR_SAMPLE_POLL.id, 'sample-option-walk');
    server.simulate.vote(FAKE_WEBINAR_SAMPLE_POLL.id, 'sample-option-walk');
    server.simulate.vote(FAKE_WEBINAR_SAMPLE_POLL.id, 'sample-option-stretch');
  }
  if (poll === 'closed') server.simulate.closePoll(FAKE_WEBINAR_SAMPLE_POLL.id);
  return server;
}
