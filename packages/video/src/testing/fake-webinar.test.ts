/**
 * The fake webinar emits what the API emits (T-CW-2.3 review): the rooms each
 * role may join, the hand count and floor holder on the hosts' room, the
 * hand lowered on giving the floor, the public floor flag and the removal of
 * a dismissed published message.
 */
import { describe, expect, it } from 'vitest';
import { FakeWebinarClient, FakeWebinarServer } from './fake-webinar';

const ROOM = 'webinar:sample-webinar';
const MODERATION = `${ROOM}:moderation`;
const HOSTS = `${ROOM}:hosts`;

function setup() {
  const server = new FakeWebinarServer({ status: 'live' });
  const attendee = new FakeWebinarClient({ server, role: 'attendee', name: 'Ana Kovač (sample)' });
  const presenter = new FakeWebinarClient({ server, role: 'presenter', name: 'Marko' });
  const moderator = new FakeWebinarClient({ server, role: 'moderator', name: 'Mila' });
  for (const client of [attendee, presenter, moderator]) client.connect();
  return { server, attendee, presenter, moderator, participantId: attendee.getSnapshot().participantId! };
}

describe('FakeWebinarServer', () => {
  it('lowers the hand, then sends the floor to the attendee, the flag to everyone and the holder to the hosts', async () => {
    const { server, attendee, presenter, moderator, participantId } = setup();
    await attendee.raiseHand();
    const before = server.emitted.length;
    await moderator.giveFloor(participantId);
    expect(server.emitted.slice(before).map(({ room, event, payload }) => ({ room, event, payload }))).toEqual([
      { room: MODERATION, event: 'webinar.hand.lowered', payload: { participantId } },
      { room: HOSTS, event: 'webinar.hand.count', payload: { count: 0, hands: [] } },
      { room: ROOM, event: 'webinar.floor.given', payload: expect.objectContaining({ participantId }) },
      { room: ROOM, event: 'webinar.floor.state', payload: { active: true } },
      { room: HOSTS, event: 'webinar.floor.state', payload: { active: true, participantId } },
    ]);
    expect(presenter.getSnapshot()).toMatchObject({ handCount: 0, floorActive: true, speakers: [{ participantId, name: null }] });
    expect(attendee.getSnapshot().floorActive).toBe(true);

    await presenter.takeFloor(participantId);
    expect(server.emitted.at(-2)).toMatchObject({ room: ROOM, event: 'webinar.floor.state', payload: { active: false } });
    expect(moderator.getSnapshot()).toMatchObject({ speakers: [], floorActive: false });
  });

  it('removes a dismissed published message from the public chat', async () => {
    const { server, attendee, moderator } = setup();
    const message = server.simulate.attendeeMessage({ participantId: 'p9', name: 'Jovan (sample)' }, 'Off topic');
    await moderator.publish(message.id);
    expect(attendee.getSnapshot().publicMessages).toHaveLength(1);
    await moderator.dismiss(message.id);
    expect(server.emitted.at(-1)).toMatchObject({ room: ROOM, event: 'webinar.message.removed', payload: { messageId: message.id } });
    expect(attendee.getSnapshot().publicMessages).toEqual([]);
  });

  it('keeps presenters out of the moderation room and attendees out of the hosts room', async () => {
    const { server, attendee, presenter, moderator } = setup();
    server.simulate.handRaised('p9', 'Jovan (sample)');
    server.simulate.attendance(3);
    expect(moderator.getSnapshot()).toMatchObject({ hands: [expect.objectContaining({ name: 'Jovan (sample)' })], attendanceCount: 3, handCount: 1 });
    // The presenter learns the hand from the hosts room: a participant id to give the floor by, never the name (WBN-25.1).
    expect(presenter.getSnapshot()).toMatchObject({ hands: [{ participantId: 'p9', name: null }], attendanceCount: 3, handCount: 1 });
    expect(attendee.getSnapshot()).toMatchObject({ hands: [], attendanceCount: null, handCount: null });
    expect(JSON.stringify(presenter.getSnapshot())).not.toContain('Jovan');
  });
});
