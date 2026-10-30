/**
 * A sample webinar on a `FakeWebinarServer` for Storybook and the apps'
 * sample mode ONLY (sample-data rule); production code never imports it, and
 * the apps reach it only behind `VITE_DATA_SOURCE=sample` with the
 * `SampleDataBanner` on screen. Nothing is sent anywhere.
 *
 * Data-driven: the apps pass `content` (`{ people, messages, polls }`), built
 * from `SAMPLE_WEBINAR_MESSAGES` and `SAMPLE_WEBINAR_POLLS` of
 * `@nestself/sample-data` (the fixtures live there with the `SAMPLE_`
 * prefix). Without `content` the built-in scene below is used, for stories
 * only: its names are placeholders marked "(sample)", nobody is a real person.
 */
import type { WebinarModerationMessage, WebinarPoll } from '@nestself/contracts';
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

export interface SampleWebinarPerson {
  participantId: string;
  /** The registration name (attendees) or the display name (hosts). */
  name: string;
}

/** Who is in the sample webinar; message authors are looked up by `participantId`. */
export interface SampleWebinarPeople {
  moderator: string;
  presenter: string;
  attendees: readonly SampleWebinarPerson[];
  /** Hosts with their participant ids, for the display name on host posts. */
  hosts?: readonly SampleWebinarPerson[];
}

/** A chat message as `SAMPLE_WEBINAR_MESSAGES` holds it (extra fields are ignored). */
export interface SampleWebinarMessageInput {
  id: string;
  kind: WebinarModerationMessage['kind'];
  status: WebinarModerationMessage['status'];
  authorParticipantId: string | null;
  text: string;
  showFirstName: boolean;
  publishedAt: string | null;
  answerText: string | null;
  createdAt: string;
}

/** A poll as `SAMPLE_WEBINAR_POLLS` holds it, with its aggregate counts (extra fields are ignored). */
export interface SampleWebinarPollInput {
  id: string;
  question: string;
  options: readonly WebinarPoll['options'][number][];
  openedAt: string | null;
  closedAt: string | null;
  results?: readonly { optionId: string; count: number }[];
}

export interface SampleWebinarContent {
  people: SampleWebinarPeople;
  messages?: readonly SampleWebinarMessageInput[];
  polls?: readonly SampleWebinarPollInput[];
}

export interface FakeWebinarSampleOptions extends FakeWebinarServerOptions {
  /** The apps' sample data; without it the built-in scene for stories is used. */
  content?: SampleWebinarContent;
  /** Built-in scene: host posts and a published message. */
  chat?: boolean;
  /** Built-in scene: messages waiting for review. */
  pending?: boolean;
  /** Two raised hands (from `content.people.attendees` when given). */
  hands?: boolean;
  /** Built-in scene: the poll's state. */
  poll?: 'none' | 'prepared' | 'open' | 'closed';
  attendance?: number;
  recording?: boolean;
}

function firstName(name: string): string | null {
  return name.trim().split(/\s+/)[0] || null;
}

/** A sample message in the moderator's shape: the registration name, and the first name only where the attendee attached it. */
function toModerationMessage(message: SampleWebinarMessageInput, people: SampleWebinarPeople, webinarId: string): WebinarModerationMessage {
  const host = people.hosts?.find((person) => person.participantId === message.authorParticipantId);
  const attendee = people.attendees.find((person) => person.participantId === message.authorParticipantId);
  const isHost = message.kind === 'host';
  return {
    id: message.id,
    webinarId,
    kind: message.kind,
    status: message.status,
    text: message.text,
    authorFirstName: isHost ? (host?.name ?? null) : message.showFirstName && attendee ? firstName(attendee.name) : null,
    answerText: message.status === 'answered' ? message.answerText : null,
    publishedAt: message.publishedAt,
    createdAt: message.createdAt,
    authorParticipantId: message.authorParticipantId,
    authorName: isHost ? null : (attendee?.name ?? null),
    showFirstName: message.showFirstName,
  };
}

function seedContent(server: FakeWebinarServer, content: SampleWebinarContent, options: FakeWebinarSampleOptions): void {
  for (const message of content.messages ?? []) server.seedMessage(toModerationMessage(message, content.people, server.webinarId));
  for (const poll of content.polls ?? []) {
    const { id, question, options: pollOptions, openedAt, closedAt } = poll;
    server.addPoll({ id, webinarId: server.webinarId, question, options: [...pollOptions], openedAt, closedAt }, poll.results);
  }
  if (options.hands) for (const person of content.people.attendees.slice(0, 2)) server.simulate.handRaised(person.participantId, person.name);
}

/** A `FakeWebinarServer` already holding the sample: the apps' `content`, else the built-in scene for stories. Create the clients after it. */
export function createSampleWebinarServer(options: FakeWebinarSampleOptions = {}): FakeWebinarServer {
  const { content, chat = true, pending = false, hands = false, poll = 'none', attendance = 0, recording = false, ...serverOptions } = options;
  const webinarId = serverOptions.webinarId ?? FAKE_WEBINAR_SAMPLE_POLL.webinarId;
  if (content) {
    const server = new FakeWebinarServer({ ...serverOptions, webinarId });
    if (recording) server.simulate.recording('started');
    if (attendance) server.simulate.attendance(attendance);
    seedContent(server, content, options);
    return server;
  }
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
