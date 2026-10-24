import { describe, expect, it, vi } from 'vitest';
import type { WebinarPoll } from '@nestself/contracts';
import { t } from '../test/i18n';
import { FakeWebinarClient, FakeWebinarServer } from '../testing/fake-webinar';
import { WebinarClient } from './client';
import { WebinarActionError, webinarErrorMessage } from './errors';
import type { WebinarRoomHandler, WebinarTransport } from './types';

const POLL: WebinarPoll = {
  id: 'poll-1',
  webinarId: 'sample-webinar',
  question: 'Which break would you like to try this week?',
  options: [
    { id: 'opt-walk', label: 'A short walk', position: 0 },
    { id: 'opt-stretch', label: 'Stretching at the desk', position: 1 },
  ],
  openedAt: null,
  closedAt: null,
};

function recordingTransport() {
  const rooms = new Map<string, WebinarRoomHandler>();
  const transport: WebinarTransport = {
    subscribe: vi.fn((room: string, handler: WebinarRoomHandler) => {
      rooms.set(room, handler);
      return () => rooms.delete(room);
    }),
    post: vi.fn(async () => undefined),
  };
  return { transport, rooms };
}

function audioSpy() {
  return { setAudioCapability: vi.fn(async () => undefined), setMuted: vi.fn() };
}

describe('WebinarClient rooms (D-CW-16, guidelines 8)', () => {
  it('joins the public room for an attendee and both rooms for a moderator, once per webinar', () => {
    const attendee = recordingTransport();
    const client = new WebinarClient({ webinarId: 'w1', role: 'attendee', participantId: 'p1', transport: attendee.transport });
    const release = client.connect();
    const releaseAgain = client.connect();
    expect([...attendee.rooms.keys()]).toEqual(['webinar:w1']);
    expect(client.getSnapshot().connected).toBe(true);
    release();
    expect(attendee.rooms.size).toBe(1);
    releaseAgain();
    expect(attendee.rooms.size).toBe(0);
    expect(client.getSnapshot().connected).toBe(false);

    const moderator = recordingTransport();
    new WebinarClient({ webinarId: 'w1', role: 'moderator', transport: moderator.transport }).connect();
    expect([...moderator.rooms.keys()]).toEqual(['webinar:w1', 'webinar:w1:moderation']);
  });

  it('applies validated events only, from the right room and webinar', () => {
    const { transport, rooms } = recordingTransport();
    const client = new WebinarClient({ webinarId: 'w1', role: 'moderator', transport });
    client.connect();
    const publicRoom = rooms.get('webinar:w1')!;
    const moderationRoom = rooms.get('webinar:w1:moderation')!;

    publicRoom('webinar.state', { webinarId: 'w1', status: 'live' });
    expect(client.getSnapshot().status).toBe('live');
    publicRoom('webinar.state', { webinarId: 'other', status: 'ended' });
    publicRoom('webinar.state', { webinarId: 'w1', status: 'not-a-status' });
    expect(client.getSnapshot().status).toBe('live');

    // A moderation event on the public room is not accepted.
    publicRoom('webinar.attendance.count', { webinarId: 'w1', count: 9 });
    expect(client.getSnapshot().attendanceCount).toBeNull();
    moderationRoom('webinar.attendance.count', { webinarId: 'w1', count: 12 });
    expect(client.getSnapshot().attendanceCount).toBe(12);

    publicRoom('webinar.recording', { webinarId: 'w1', status: 'started' });
    expect(client.getSnapshot().recording.status).toBe('recording');
    publicRoom('webinar.recording', { webinarId: 'w1', status: 'stopped' });
    expect(client.getSnapshot().recording.status).toBe('processing');

    moderationRoom('webinar.ended', { webinarId: 'w1', endedAt: '2026-10-25T10:00:00.000Z' });
    expect(client.getSnapshot()).toMatchObject({ status: 'ended', endedAt: '2026-10-25T10:00:00.000Z' });
  });

  it('keeps names away from attendees and presenters (WBN-08, WBN-10)', () => {
    const attendeeRooms = recordingTransport();
    const attendee = new WebinarClient({ webinarId: 'w1', role: 'attendee', participantId: 'p1', transport: attendeeRooms.transport, moderationRoom: true });
    attendee.connect();
    expect(attendeeRooms.rooms.has('webinar:w1:moderation')).toBe(false);
    attendeeRooms.rooms.get('webinar:w1')!('webinar.hand.raised', { participantId: 'p2', participantName: 'Ana Kovač', raisedAt: '2026-10-25T10:00:00.000Z' });
    expect(attendee.getSnapshot().hands).toEqual([]);
    expect(JSON.stringify(attendee.getSnapshot())).not.toContain('Ana');

    const presenterRooms = recordingTransport();
    const presenter = new WebinarClient({ webinarId: 'w1', role: 'presenter', transport: presenterRooms.transport });
    presenter.connect();
    const moderation = presenterRooms.rooms.get('webinar:w1:moderation')!;
    moderation('webinar.hand.raised', { participantId: 'p2', participantName: 'Ana Kovač', raisedAt: '2026-10-25T10:00:00.000Z' });
    moderation('webinar.message.submitted', {
      id: 'm1',
      webinarId: 'w1',
      kind: 'question',
      status: 'pending',
      text: 'A question',
      authorFirstName: null,
      answerText: null,
      publishedAt: null,
      createdAt: '2026-10-25T10:00:00.000Z',
      authorParticipantId: 'p2',
      authorName: 'Ana Kovač',
      showFirstName: false,
    });
    expect(presenter.getSnapshot().hands).toEqual([{ participantId: 'p2', name: null, raisedAt: '2026-10-25T10:00:00.000Z' }]);
    expect(presenter.getSnapshot().moderationMessages).toEqual([]);
    expect(JSON.stringify(presenter.getSnapshot())).not.toContain('Ana');
  });
});

describe('WebinarClient chat (WBN-09, WBN-23, WBN-24)', () => {
  it('sends an anonymous attendee message, the moderator sees the registration name and publishes it to everyone', async () => {
    const server = new FakeWebinarServer({ status: 'live' });
    const attendee = new FakeWebinarClient({ server, role: 'attendee', name: 'Ana Kovač (sample)' });
    const moderator = new FakeWebinarClient({ server, role: 'moderator', name: 'Mila' });
    attendee.connect();
    moderator.connect();

    await attendee.sendMessage({ kind: 'attendee', text: 'Could you repeat the last slide?', showFirstName: false });
    expect(server.requests.at(-1)).toMatchObject({ action: 'message.send', input: { body: { kind: 'attendee', text: 'Could you repeat the last slide?', showFirstName: false } } });
    const [pending] = moderator.getSnapshot().moderationMessages;
    expect(pending).toMatchObject({ status: 'pending', authorName: 'Ana Kovač (sample)', authorFirstName: null });
    expect(attendee.getSnapshot().publicMessages).toEqual([]);
    expect(attendee.getSnapshot().ownMessageIds).toEqual([pending!.id]);

    await moderator.publish(pending!.id);
    expect(moderator.getSnapshot().moderationMessages[0]).toMatchObject({ status: 'published' });
    for (const client of [attendee, moderator]) {
      expect(client.getSnapshot().publicMessages).toEqual([expect.objectContaining({ id: pending!.id, status: 'published', authorFirstName: null })]);
      expect(client.getSnapshot().publicMessages[0]).not.toHaveProperty('authorName');
    }
  });

  it('attaches the first name only when asked, answers and dismisses', async () => {
    const server = new FakeWebinarServer({ status: 'live' });
    const attendee = new FakeWebinarClient({ server, role: 'attendee', name: 'Jovan Petrović (sample)' });
    const moderator = new FakeWebinarClient({ server, role: 'moderator' });
    attendee.connect();
    moderator.connect();

    await attendee.sendMessage({ kind: 'question', text: 'How long should a break be?', showFirstName: true });
    await attendee.sendMessage({ kind: 'attendee', text: 'Off topic', showFirstName: false });
    const [question, offTopic] = moderator.getSnapshot().moderationMessages;
    expect(question).toMatchObject({ kind: 'question', authorFirstName: 'Jovan' });

    await moderator.answer(question!.id, 'Start with a few minutes away from the screen.');
    expect(attendee.getSnapshot().publicMessages).toEqual([
      expect.objectContaining({ id: question!.id, status: 'answered', answerText: 'Start with a few minutes away from the screen.', authorFirstName: 'Jovan' }),
    ]);
    await moderator.dismiss(offTopic!.id);
    expect(moderator.getSnapshot().moderationMessages[1]).toMatchObject({ status: 'dismissed' });
    expect(attendee.getSnapshot().publicMessages).toHaveLength(1);
  });

  it('refuses host-only actions for an attendee without calling the API, and a host kind from an attendee', async () => {
    const server = new FakeWebinarServer();
    const attendee = new FakeWebinarClient({ server, role: 'attendee' });
    await expect(attendee.publish('m1')).rejects.toMatchObject({ code: 'forbidden' });
    await expect(attendee.sendMessage({ kind: 'host', text: 'Hi' })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(attendee.sendMessage({ kind: 'attendee', text: '   ', showFirstName: false })).rejects.toMatchObject({ code: 'validation' });
    expect(server.requests).toEqual([]);
    expect(attendee.getSnapshot().errors.chat).toMatchObject({ code: 'validation' });
  });

  it('stores a coded error for the screen and rethrows it; the next attempt clears it', async () => {
    const server = new FakeWebinarServer({ status: 'live' });
    const attendee = new FakeWebinarClient({ server, role: 'attendee' });
    server.simulate.failNext('message.send', 'webinar_not_open');
    const failure = attendee.sendMessage({ kind: 'attendee', text: 'Hello', showFirstName: false });
    await expect(failure).rejects.toBeInstanceOf(WebinarActionError);
    expect(attendee.getSnapshot().errors.chat).toMatchObject({ code: 'webinar_not_open', action: 'message.send' });
    expect(attendee.getSnapshot().pending).toEqual([]);
    await attendee.sendMessage({ kind: 'attendee', text: 'Hello', showFirstName: false });
    expect(attendee.getSnapshot().errors.chat).toBeUndefined();
  });
});

describe('WebinarClient hand and floor (WBN-10, WBN-25, D-CW-35)', () => {
  it('raises the hand to the moderation room; the floor is audio only and waits for the acknowledgement', async () => {
    const server = new FakeWebinarServer({ status: 'live' });
    const audio = audioSpy();
    const attendee = new FakeWebinarClient({ server, role: 'attendee', name: 'Ana Kovač (sample)', audio });
    const moderator = new FakeWebinarClient({ server, role: 'moderator' });
    attendee.connect();
    moderator.connect();

    await attendee.raiseHand();
    expect(attendee.getSnapshot().myHand.raised).toBe(true);
    expect(server.emitted.at(-1)).toMatchObject({ room: 'webinar:sample-webinar:moderation', event: 'webinar.hand.raised' });
    expect(moderator.getSnapshot().hands).toEqual([expect.objectContaining({ participantId: attendee.getSnapshot().participantId, name: 'Ana Kovač (sample)' })]);

    await moderator.giveFloor(attendee.getSnapshot().participantId!);
    await vi.waitFor(() => expect(audio.setAudioCapability).toHaveBeenCalledWith(true));
    expect(attendee.getSnapshot().myFloor).toEqual({ status: 'given', acknowledged: false });
    expect(moderator.getSnapshot().speakers).toEqual([expect.objectContaining({ name: 'Ana Kovač (sample)' })]);
    expect(moderator.getSnapshot().hands).toEqual([]);
    expect(server.emitted.at(-1)).toMatchObject({ event: 'webinar.floor.given', to: attendee.getSnapshot().participantId, payload: { capabilities: { video: 'receive' } } });

    attendee.acknowledgeFloor();
    expect(attendee.getSnapshot().myFloor).toEqual({ status: 'given', acknowledged: true });
    // Acknowledging does not lower the hand.
    expect(attendee.getSnapshot().myHand.raised).toBe(true);

    await moderator.takeFloor(attendee.getSnapshot().participantId!);
    await vi.waitFor(() => expect(audio.setAudioCapability).toHaveBeenLastCalledWith(false));
    expect(audio.setMuted).toHaveBeenCalledWith(true);
    expect(attendee.getSnapshot().myFloor.status).toBe('taken');
    expect(moderator.getSnapshot().speakers).toEqual([]);
    attendee.dismissFloorNotice();
    expect(attendee.getSnapshot().myFloor.status).toBe('none');
  });

  it("ignores another participant's floor events", () => {
    const server = new FakeWebinarServer({ status: 'live' });
    const audio = audioSpy();
    const attendee = new FakeWebinarClient({ server, role: 'attendee', participantId: 'p-mine', audio });
    attendee.connect();
    server.simulate.floorGiven('p-someone-else');
    expect(attendee.getSnapshot().myFloor.status).toBe('none');
    expect(audio.setAudioCapability).not.toHaveBeenCalled();
  });

  it('shows a microphone error when the audio capability cannot be turned on', async () => {
    const server = new FakeWebinarServer({ status: 'live' });
    const audio = { setAudioCapability: vi.fn(async () => Promise.reject(new Error('NotAllowedError'))), setMuted: vi.fn() };
    const attendee = new FakeWebinarClient({ server, role: 'attendee', audio });
    attendee.connect();
    server.simulate.floorGiven(attendee.getSnapshot().participantId!);
    await vi.waitFor(() => expect(attendee.getSnapshot().errors.floor).toMatchObject({ code: 'microphone_unavailable' }));
    expect(webinarErrorMessage(attendee.getSnapshot().errors.floor, t)).toBe(t('webinar.errors.microphoneUnavailable'));
  });
});

describe('WebinarClient polls and recording (WBN-11, WBN-27, WBN-28)', () => {
  it('votes with the option only, and shows the aggregate after the close', async () => {
    const server = new FakeWebinarServer({ status: 'live', polls: [POLL] });
    const attendee = new FakeWebinarClient({ server, role: 'attendee' });
    const moderator = new FakeWebinarClient({ server, role: 'moderator' });
    attendee.connect();
    moderator.connect();
    expect(attendee.getSnapshot().polls.list).toEqual([]);
    expect(moderator.getSnapshot().polls.list).toHaveLength(1);

    await moderator.openPoll('poll-1');
    expect(attendee.getSnapshot().polls.list[0]).toMatchObject({ id: 'poll-1', closedAt: null });
    await attendee.vote('poll-1', 'opt-stretch');
    expect(server.requests.at(-1)).toEqual({ action: 'poll.vote', input: { pollId: 'poll-1', body: { optionId: 'opt-stretch' } }, from: expect.anything() });
    await attendee.vote('poll-1', 'opt-walk');
    expect(server.requests.filter((request) => request.action === 'poll.vote')).toHaveLength(1);
    server.simulate.vote('poll-1', 'opt-walk');

    await moderator.closePoll('poll-1');
    expect(attendee.getSnapshot().polls.results['poll-1']).toEqual({
      pollId: 'poll-1',
      totalVotes: 2,
      results: [
        { optionId: 'opt-walk', count: 1 },
        { optionId: 'opt-stretch', count: 1 },
      ],
    });
    expect(JSON.stringify(attendee.getSnapshot().polls)).not.toMatch(/voter|participant|user/i);
  });

  it('starts recording with the webinar and lets the moderator stop it early', async () => {
    const server = new FakeWebinarServer();
    const moderator = new FakeWebinarClient({ server, role: 'moderator' });
    const presenter = new FakeWebinarClient({ server, role: 'presenter' });
    moderator.connect();
    presenter.connect();
    expect(moderator.getSnapshot().recording.status).toBe('scheduled');
    server.simulate.start();
    expect(moderator.getSnapshot()).toMatchObject({ status: 'live', recording: { status: 'recording' } });
    await expect(presenter.stopRecording()).rejects.toMatchObject({ code: 'forbidden' });
    await moderator.stopRecording();
    expect(presenter.getSnapshot().recording.status).toBe('processing');
  });
});

describe('webinarErrorMessage (error visibility rule)', () => {
  it('maps contract codes and generic codes to copy, and unknown codes to errors.unknown', () => {
    expect(webinarErrorMessage('floor_not_available', t)).toBe(t('errors.floorNotAvailable'));
    expect(webinarErrorMessage(new WebinarActionError('message.send', 'network'), t)).toBe(t('errors.network'));
    expect(webinarErrorMessage('something_new', t)).toBe(t('errors.unknown'));
    expect(webinarErrorMessage(null, t)).toBeNull();
  });
});
