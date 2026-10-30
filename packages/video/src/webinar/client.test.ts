import { describe, expect, it, vi } from 'vitest';
import { WEBINAR_REPLICATED_CAPACITY } from '@nestself/contracts';
import type { WebinarPoll } from '@nestself/contracts';
import { t } from '../test/i18n';
import { FakeCallSessionController } from '../testing/fake-controller';
import { FakeWebinarClient, FakeWebinarServer } from '../testing/fake-webinar';
import { WebinarClient } from './client';
import { WebinarActionError, toWebinarActionError, webinarErrorMessage } from './errors';
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
  it('joins the public room for an attendee, adds the hosts room for a presenter and all three for a moderator, once per webinar', () => {
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

    const presenter = recordingTransport();
    new WebinarClient({ webinarId: 'w1', role: 'presenter', transport: presenter.transport }).connect();
    expect([...presenter.rooms.keys()]).toEqual(['webinar:w1', 'webinar:w1:hosts']);

    const moderator = recordingTransport();
    new WebinarClient({ webinarId: 'w1', role: 'moderator', transport: moderator.transport }).connect();
    expect([...moderator.rooms.keys()]).toEqual(['webinar:w1', 'webinar:w1:hosts', 'webinar:w1:moderation']);
  });

  it('applies validated events only, from the right room and webinar', () => {
    const { transport, rooms } = recordingTransport();
    const client = new WebinarClient({ webinarId: 'w1', role: 'moderator', transport });
    client.connect();
    const publicRoom = rooms.get('webinar:w1')!;
    const moderationRoom = rooms.get('webinar:w1:moderation')!;

    expect(client.getSnapshot().recording.status).toBeNull();
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
    const presenter = new WebinarClient({ webinarId: 'w1', role: 'presenter', transport: presenterRooms.transport, moderationRoom: true });
    presenter.connect();
    // Even when told to, a presenter's client drops what a moderation room would carry.
    presenterRooms.rooms.get('webinar:w1:moderation')!('webinar.hand.raised', { participantId: 'p2', participantName: 'Ana Kovač', raisedAt: '2026-10-25T10:00:00.000Z' });
    const hosts = presenterRooms.rooms.get('webinar:w1:hosts')!;
    hosts('webinar.hand.raised', { participantId: 'p2', participantName: 'Ana Kovač', raisedAt: '2026-10-25T10:00:00.000Z' });
    hosts('webinar.hand.count', { count: 1 });
    hosts('webinar.floor.state', { active: true, participantId: 'p2', participantName: 'Ana Kovač' });
    expect(presenter.getSnapshot().speakers).toEqual([]);
    hosts('webinar.floor.state', { active: true, participantId: 'p2' });
    expect(presenter.getSnapshot()).toMatchObject({ hands: [], handCount: 1, speakers: [{ participantId: 'p2', name: null }], floorActive: true });
    expect(presenter.getSnapshot().moderationMessages).toEqual([]);
    expect(JSON.stringify(presenter.getSnapshot())).not.toContain('Ana');
  });

  it("gives a presenter the hosts room's raised hands by participant id, never a name, so a presenter can give the floor (WBN-25.1)", () => {
    const { transport, rooms } = recordingTransport();
    const presenter = new WebinarClient({
      webinarId: 'w1',
      role: 'presenter',
      transport,
      // Names in a hydration are dropped for a presenter too.
      initial: { hands: [{ participantId: 'p1', name: 'Jovan Petrović', raisedAt: '2026-10-25T09:59:00.000Z' }] },
    });
    presenter.connect();
    expect(presenter.getSnapshot().hands).toEqual([{ participantId: 'p1', name: null, raisedAt: '2026-10-25T09:59:00.000Z' }]);
    const hosts = rooms.get('webinar:w1:hosts')!;
    // A hand carrying a name is refused whole.
    hosts('webinar.hand.count', { count: 1, hands: [{ participantId: 'p2', participantName: 'Ana Kovač', raisedAt: '2026-10-25T10:00:00.000Z' }] });
    expect(presenter.getSnapshot().handCount).toBeNull();
    hosts('webinar.hand.count', { count: 2, hands: [{ participantId: 'p2', raisedAt: '2026-10-25T10:00:00.000Z' }, { participantId: 'p3', raisedAt: '2026-10-25T10:01:00.000Z' }] });
    expect(presenter.getSnapshot()).toMatchObject({
      handCount: 2,
      hands: [
        { participantId: 'p2', name: null, raisedAt: '2026-10-25T10:00:00.000Z' },
        { participantId: 'p3', name: null, raisedAt: '2026-10-25T10:01:00.000Z' },
      ],
    });
    // An API that sends the count alone leaves the list as it was.
    hosts('webinar.hand.count', { count: 3 });
    expect(presenter.getSnapshot()).toMatchObject({ handCount: 3, hands: [{ participantId: 'p2' }, { participantId: 'p3' }] });
    expect(JSON.stringify(presenter.getSnapshot())).not.toContain('Ana');
    expect(JSON.stringify(presenter.getSnapshot())).not.toContain('Jovan');

    // The moderator's list keeps its names: the hosts room's ids do not replace it.
    const moderatorRooms = recordingTransport();
    const moderator = new WebinarClient({ webinarId: 'w1', role: 'moderator', transport: moderatorRooms.transport });
    moderator.connect();
    moderatorRooms.rooms.get('webinar:w1:moderation')!('webinar.hand.raised', { participantId: 'p2', participantName: 'Ana Kovač', raisedAt: '2026-10-25T10:00:00.000Z' });
    moderatorRooms.rooms.get('webinar:w1:hosts')!('webinar.hand.count', { count: 1, hands: [{ participantId: 'p2', raisedAt: '2026-10-25T10:00:00.000Z' }] });
    expect(moderator.getSnapshot().hands).toEqual([{ participantId: 'p2', name: 'Ana Kovač', raisedAt: '2026-10-25T10:00:00.000Z' }]);
  });

  it('gives every host the floor holder from the hosts room, so any moderator can take the floor back after a reload (WBN-25)', () => {
    const { transport, rooms } = recordingTransport();
    const moderator = new WebinarClient({
      webinarId: 'w1',
      role: 'moderator',
      transport,
      initial: { hands: [{ participantId: 'p2', name: 'Ana Kovač (sample)', raisedAt: '2026-10-25T10:00:00.000Z' }] },
    });
    moderator.connect();
    const hosts = rooms.get('webinar:w1:hosts')!;
    rooms.get('webinar:w1:moderation')!('webinar.hand.lowered', { participantId: 'p2' });
    hosts('webinar.floor.state', { active: true, participantId: 'p2' });
    expect(moderator.getSnapshot().speakers).toEqual([{ participantId: 'p2', name: 'Ana Kovač (sample)', muted: false, unmuteRequested: false }]);
    hosts('webinar.floor.state', { active: false, participantId: 'p2' });
    expect(moderator.getSnapshot()).toMatchObject({ speakers: [], floorActive: false });
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
    expect(server.emitted.slice(-2)).toEqual([
      expect.objectContaining({ room: 'webinar:sample-webinar:moderation', event: 'webinar.hand.raised' }),
      expect.objectContaining({
        room: 'webinar:sample-webinar:hosts',
        event: 'webinar.hand.count',
        payload: { count: 1, hands: [{ participantId: attendee.getSnapshot().participantId, raisedAt: expect.any(String) }] },
      }),
    ]);
    expect(moderator.getSnapshot().hands).toEqual([expect.objectContaining({ participantId: attendee.getSnapshot().participantId, name: 'Ana Kovač (sample)' })]);

    await moderator.giveFloor(attendee.getSnapshot().participantId!);
    await vi.waitFor(() => expect(audio.setAudioCapability).toHaveBeenCalledWith(true));
    expect(attendee.getSnapshot().myFloor).toMatchObject({ status: 'given', acknowledged: false });
    expect(moderator.getSnapshot().speakers).toEqual([expect.objectContaining({ name: 'Ana Kovač (sample)' })]);
    expect(moderator.getSnapshot().hands).toEqual([]);
    expect(server.emitted.find((entry) => entry.event === 'webinar.floor.given')).toMatchObject({
      to: attendee.getSnapshot().participantId,
      payload: { capabilities: { video: 'receive' } },
    });
    expect(attendee.getSnapshot().floorActive).toBe(true);

    attendee.acknowledgeFloor();
    expect(attendee.getSnapshot().myFloor).toMatchObject({ status: 'given', acknowledged: true });
    // The API lowers the hand with the floor; acknowledging sends nothing more.
    expect(attendee.getSnapshot().myHand.raised).toBe(false);
    expect(server.requests.some((request) => request.action === 'hand.lower')).toBe(false);

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

describe('WebinarClient floor in a replica meeting (T-CW-3.2, D-CW-14, D-CW-35)', () => {
  function promotionSpy() {
    return {
      setAudioCapability: vi.fn(async () => undefined),
      setMuted: vi.fn(),
      promoteToPrimaryMeeting: vi.fn(async () => undefined),
      demoteFromPrimaryMeeting: vi.fn(async () => undefined),
    };
  }

  it('promotes onto the primary meeting with the primaryAttendee credentials instead of changing the capability', async () => {
    const server = new FakeWebinarServer({ status: 'live', replicated: true });
    const audio = promotionSpy();
    const attendee = new FakeWebinarClient({ server, role: 'attendee', audio });
    const moderator = new FakeWebinarClient({ server, role: 'moderator' });
    attendee.connect();
    moderator.connect();
    const participantId = attendee.getSnapshot().participantId!;

    await moderator.giveFloor(participantId);
    await vi.waitFor(() => expect(audio.promoteToPrimaryMeeting).toHaveBeenCalledOnce());
    const [credentials] = audio.promoteToPrimaryMeeting.mock.calls[0] as unknown as [Record<string, string>];
    expect(credentials).toEqual({ AttendeeId: expect.any(String), ExternalUserId: participantId, JoinToken: expect.any(String) });
    expect(audio.setAudioCapability).not.toHaveBeenCalled();
    expect(attendee.getSnapshot().myFloor).toMatchObject({ status: 'given', acknowledged: false });
    // The token is handed to the controller and never kept in the state.
    expect(JSON.stringify(attendee.getSnapshot())).not.toContain(credentials['JoinToken']!);
  });

  it('demotes and mutes when the floor is taken back after a promotion', async () => {
    const server = new FakeWebinarServer({ status: 'live', replicated: true });
    const audio = promotionSpy();
    const attendee = new FakeWebinarClient({ server, role: 'attendee', audio });
    attendee.connect();
    const participantId = attendee.getSnapshot().participantId!;
    server.simulate.floorGiven(participantId);
    await vi.waitFor(() => expect(audio.promoteToPrimaryMeeting).toHaveBeenCalledOnce());

    server.simulate.floorTaken(participantId);
    await vi.waitFor(() => expect(audio.demoteFromPrimaryMeeting).toHaveBeenCalledOnce());
    expect(audio.setMuted).toHaveBeenCalledWith(true);
    expect(audio.setAudioCapability).not.toHaveBeenCalled();
    expect(attendee.getSnapshot().myFloor.status).toBe('taken');
  });

  it('keeps the single-meeting path without primaryAttendee: capability on and off, no promotion', async () => {
    const server = new FakeWebinarServer({ status: 'live' });
    const audio = promotionSpy();
    const attendee = new FakeWebinarClient({ server, role: 'attendee', audio });
    attendee.connect();
    const participantId = attendee.getSnapshot().participantId!;
    server.simulate.floorGiven(participantId);
    await vi.waitFor(() => expect(audio.setAudioCapability).toHaveBeenCalledWith(true));
    server.simulate.floorTaken(participantId);
    await vi.waitFor(() => expect(audio.setAudioCapability).toHaveBeenLastCalledWith(false));
    expect(audio.promoteToPrimaryMeeting).not.toHaveBeenCalled();
    expect(audio.demoteFromPrimaryMeeting).not.toHaveBeenCalled();
    expect(server.emitted.find((entry) => entry.event === 'webinar.floor.given')?.payload).not.toHaveProperty('primaryAttendee');
  });

  it('shows a floor error when the promotion fails, on the fake controller too', async () => {
    const server = new FakeWebinarServer({ status: 'live', replicated: true });
    const controller = new FakeCallSessionController({ role: 'attendee', format: 'webinar' });
    await controller.join();
    controller.simulate.failNextPromotion();
    const attendee = new FakeWebinarClient({ server, role: 'attendee', audio: controller });
    attendee.connect();
    server.simulate.floorGiven(attendee.getSnapshot().participantId!);
    await vi.waitFor(() => expect(attendee.getSnapshot().errors.floor).toMatchObject({ code: 'unknown', action: 'floor.audio' }));
    expect(controller.getSnapshot().devices.canSendAudio).toBe(false);
    expect(controller.promotedAs).toBeNull();
  });

  it('promotes the fake controller audio only, and demotes it', async () => {
    const server = new FakeWebinarServer({ status: 'live', replicated: true });
    const controller = new FakeCallSessionController({ role: 'attendee', format: 'webinar' });
    await controller.join();
    const attendee = new FakeWebinarClient({ server, role: 'attendee', audio: controller });
    attendee.connect();
    const participantId = attendee.getSnapshot().participantId!;
    server.simulate.floorGiven(participantId);
    await vi.waitFor(() => expect(controller.promotedAs).toMatch(/^sample-primary-attendee-/));
    expect(controller.getSnapshot().devices).toMatchObject({ canSendAudio: true, canSendVideo: false });
    expect(controller.getSnapshot().media).toMatchObject({ muted: true, cameraOn: false });
    server.simulate.floorTaken(participantId);
    await vi.waitFor(() => expect(controller.promotedAs).toBeNull());
    expect(controller.getSnapshot().devices.canSendAudio).toBe(false);
  });
});

describe('WebinarClient mute and unmute consent (WBN-26)', () => {
  function audioSpies() {
    return {
      setAudioCapability: vi.fn(async () => undefined),
      setMuted: vi.fn(),
      promoteToPrimaryMeeting: vi.fn(async () => undefined),
      demoteFromPrimaryMeeting: vi.fn(async () => undefined),
    };
  }

  async function withFloor(replicated = false) {
    const server = new FakeWebinarServer({ status: 'live', replicated });
    const audio = audioSpies();
    const attendee = new FakeWebinarClient({ server, role: 'attendee', name: 'Ana (sample)', audio });
    const moderator = new FakeWebinarClient({ server, role: 'moderator' });
    const presenter = new FakeWebinarClient({ server, role: 'presenter' });
    for (const client of [attendee, moderator, presenter]) client.connect();
    const participantId = attendee.getSnapshot().participantId!;
    await moderator.giveFloor(participantId);
    await vi.waitFor(() => expect(attendee.getSnapshot().myFloor.status).toBe('given'));
    return { server, audio, attendee, moderator, presenter, participantId };
  }

  it('a host mutes: the attendee is muted locally and told so, every host sees the row muted', async () => {
    const { server, audio, attendee, moderator, presenter, participantId } = await withFloor();
    await presenter.muteSpeaker(participantId);
    expect(server.requests.at(-1)).toMatchObject({ action: 'floor.mute', input: { participantId, body: {} } });
    expect(server.emitted.filter((entry) => entry.event === 'webinar.floor.muted').map(({ room, payload, to }) => ({ room, payload, to }))).toEqual([
      { room: 'webinar:sample-webinar', payload: {}, to: participantId },
      { room: 'webinar:sample-webinar:hosts', payload: { participantId }, to: undefined },
    ]);
    expect(audio.setMuted).toHaveBeenLastCalledWith(true);
    expect(attendee.getSnapshot().myFloor).toMatchObject({ status: 'given', mutedByHost: true, unmuteRequested: false });
    expect(moderator.getSnapshot().speakers).toEqual([expect.objectContaining({ participantId, muted: true })]);
    expect(presenter.getSnapshot().speakers).toEqual([expect.objectContaining({ participantId, muted: true })]);
  });

  it('only the attendee unmutes, after a host asks and they consent; declining sends nothing', async () => {
    const { server, audio, attendee, moderator, participantId } = await withFloor();
    await moderator.muteSpeaker(participantId);
    await moderator.requestUnmute(participantId);
    expect(moderator.getSnapshot().speakers[0]).toMatchObject({ muted: true, unmuteRequested: true });
    expect(attendee.getSnapshot().myFloor.unmuteRequested).toBe(true);

    attendee.declineUnmute();
    expect(attendee.getSnapshot().myFloor).toMatchObject({ mutedByHost: true, unmuteRequested: false });
    expect(server.requests.some((request) => request.action === 'floor.unmute')).toBe(false);

    await moderator.requestUnmute(participantId);
    await attendee.consentToUnmute();
    expect(server.requests.at(-1)).toMatchObject({ action: 'floor.unmute', input: { participantId, body: {} }, from: { role: 'attendee' } });
    expect(audio.setMuted).toHaveBeenLastCalledWith(false);
    expect(attendee.getSnapshot().myFloor).toMatchObject({ mutedByHost: false, unmuteRequested: false });
    expect(moderator.getSnapshot().speakers[0]).toMatchObject({ muted: false, unmuteRequested: false });
    await expect(moderator.consentToUnmute()).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('a replica attendee leaves the primary meeting when muted and is promoted again with fresh credentials on consent', async () => {
    const { audio, attendee, moderator, participantId } = await withFloor(true);
    await vi.waitFor(() => expect(audio.promoteToPrimaryMeeting).toHaveBeenCalledOnce());
    await moderator.muteSpeaker(participantId);
    await vi.waitFor(() => expect(audio.demoteFromPrimaryMeeting).toHaveBeenCalledOnce());
    await moderator.requestUnmute(participantId);
    await attendee.consentToUnmute();
    expect(audio.promoteToPrimaryMeeting).toHaveBeenCalledTimes(2);
    const [first] = audio.promoteToPrimaryMeeting.mock.calls[0] as unknown as [{ JoinToken: string }];
    const [second] = audio.promoteToPrimaryMeeting.mock.calls[1] as unknown as [{ JoinToken: string }];
    expect(second.JoinToken).not.toBe(first.JoinToken);
    expect(audio.setMuted).toHaveBeenLastCalledWith(false);
    expect(JSON.stringify(attendee.getSnapshot())).not.toContain(second.JoinToken);
  });

  it('ignores consent events with another shape or for an attendee without the floor', () => {
    const { transport, rooms } = recordingTransport();
    const attendee = new WebinarClient({ webinarId: 'w1', role: 'attendee', participantId: 'p1', transport });
    attendee.connect();
    rooms.get('webinar:w1')!('webinar.floor.unmute_requested', {});
    rooms.get('webinar:w1')!('webinar.floor.muted', { participantId: 'p1' });
    expect(attendee.getSnapshot().myFloor).toMatchObject({ status: 'none', mutedByHost: false, unmuteRequested: false });
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

describe('WebinarClient canonical additions (T-CW-2.3)', () => {
  const published = {
    id: 'm1',
    webinarId: 'w1',
    kind: 'attendee' as const,
    status: 'published' as const,
    text: 'Off topic',
    authorFirstName: null,
    answerText: null,
    publishedAt: '2026-10-25T10:01:00.000Z',
    createdAt: '2026-10-25T10:00:00.000Z',
  };

  it('removes a dismissed published message from the public chat (webinar.message.removed)', () => {
    const moderatorRooms = recordingTransport();
    const { transport, rooms } = recordingTransport();
    const moderator = new WebinarClient({
      webinarId: 'w1',
      role: 'moderator',
      transport: moderatorRooms.transport,
      initial: { moderationMessages: [{ ...published, authorParticipantId: 'p1', authorName: 'Ana (sample)', showFirstName: false }] },
    });
    const attendee = new WebinarClient({ webinarId: 'w1', role: 'attendee', participantId: 'p2', transport, initial: { publicMessages: [published] } });
    moderator.connect();
    attendee.connect();
    expect(attendee.getSnapshot().publicMessages).toHaveLength(1);

    for (const room of [rooms, moderatorRooms.rooms]) room.get('webinar:w1')!('webinar.message.removed', { messageId: 'm1' });
    expect(attendee.getSnapshot().publicMessages).toEqual([]);
    expect(moderator.getSnapshot().publicMessages).toEqual([]);
    expect(moderator.getSnapshot().moderationMessages[0]).toMatchObject({ id: 'm1', status: 'dismissed' });

    // A payload with anything but the id fails the strict schema and is ignored.
    const before = attendee.getSnapshot();
    rooms.get('webinar:w1')!('webinar.message.removed', { messageId: 'm1', text: 'x' });
    expect(attendee.getSnapshot()).toBe(before);
  });

  it('tracks the anonymous floor flag (webinar.floor.state, WBN-25.8) and clears it when the webinar ends', () => {
    const { transport, rooms } = recordingTransport();
    const attendee = new WebinarClient({ webinarId: 'w1', role: 'attendee', participantId: 'p2', transport });
    attendee.connect();
    expect(attendee.getSnapshot().floorActive).toBe(false);
    rooms.get('webinar:w1')!('webinar.floor.state', { active: true });
    expect(attendee.getSnapshot().floorActive).toBe(true);
    rooms.get('webinar:w1')!('webinar.floor.state', { active: false, participantId: 'p1' });
    expect(attendee.getSnapshot().floorActive).toBe(true);
    rooms.get('webinar:w1')!('webinar.ended', { webinarId: 'w1', endedAt: '2026-10-25T11:00:00.000Z' });
    expect(attendee.getSnapshot().floorActive).toBe(false);
  });
});

describe('WebinarClient recording outcome (CW-R-121)', () => {
  it('follows ready and failed, and takes the moderators-only failure event', () => {
    const attendeeRooms = recordingTransport();
    const attendee = new WebinarClient({ webinarId: 'w1', role: 'attendee', participantId: 'p1', transport: attendeeRooms.transport });
    attendee.connect();
    const publicRoom = attendeeRooms.rooms.get('webinar:w1')!;
    publicRoom('webinar.recording', { webinarId: 'w1', status: 'ready' });
    expect(attendee.getSnapshot().recording.status).toBe('ready');
    publicRoom('webinar.recording', { webinarId: 'w1', status: 'failed' });
    expect(attendee.getSnapshot().recording.status).toBe('failed');

    const moderatorRooms = recordingTransport();
    const moderator = new WebinarClient({ webinarId: 'w1', role: 'moderator', transport: moderatorRooms.transport, initial: { recordingStatus: 'recording' } });
    moderator.connect();
    moderatorRooms.rooms.get('webinar:w1:moderation')!('webinar.recording.failed', { webinarId: 'w1', reason: 'MediaCapturePipelineFailed' });
    expect(moderator.getSnapshot().recording.status).toBe('failed');
    expect(JSON.stringify(moderator.getSnapshot())).not.toContain('MediaCapturePipelineFailed');
  });
});

describe('webinarErrorMessage (error visibility rule)', () => {
  it('maps contract codes and generic codes to copy, and unknown codes to errors.unknown', () => {
    expect(webinarErrorMessage('floor_not_available', t)).toBe(t('errors.floorNotAvailable'));
    expect(webinarErrorMessage(new WebinarActionError('message.send', 'network'), t)).toBe(t('errors.network'));
    expect(webinarErrorMessage('something_new', t)).toBe(t('errors.unknown'));
    expect(webinarErrorMessage('not_editable', t)).toBe(t('webinar.errors.notEditable'));
    expect(webinarErrorMessage('conflict', t)).toBe(t('errors.conflict'));
    // The capacity copy names the server's limit, else the replicated ceiling (D-CW-36).
    expect(webinarErrorMessage('capacity_above_limit', t)).toBe(t('webinar.capacityAboveLimit', { limit: WEBINAR_REPLICATED_CAPACITY }));
    expect(webinarErrorMessage(toWebinarActionError('message.send', { code: 'capacity_above_limit', details: { limit: 250 } }), t)).toBe(
      t('webinar.capacityAboveLimit', { limit: 250 }),
    );
    expect(webinarErrorMessage(null, t)).toBeNull();
  });
});
