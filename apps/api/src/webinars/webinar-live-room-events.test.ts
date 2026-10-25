/**
 * The two public-room additions of T-CW-2.3 phase 2, emitted by the live
 * service (WBN-24.2, WBN-25.8):
 *
 * - `webinar.message.removed { messageId }` when a host dismisses a message
 *   the audience has already seen (published); a pending message never
 *   reached the audience, so its dismissal stays in the moderation room.
 * - `webinar.floor.state { active }` on give-floor (true) and take-floor
 *   (false, unless another attendee still holds the floor). Anonymous: a flag,
 *   never a participant id or a name (D-CW-15).
 */
import { describe, expect, it, vi } from 'vitest';
import type { Principal } from '@nestself/contracts';
import type { AuditWriter } from '../audit/audit-writer.js';
import type { CallsRepository } from '../calls/calls.repository.js';
import { FakeVideoProvider } from '../video/fake-video-provider.js';
import type { WebinarAccess } from './webinar-access.js';
import { WebinarLiveService } from './webinar-live.service.js';
import type { WebinarRoomEvents } from './webinar-room-events.js';
import type { WebinarMessageRecord, WebinarRegistrationRecord, WebinarsRepository } from './webinars.repository.js';

const webinar = { id: 'w1', orgId: 'org_sample', status: 'live' };
const moderator = { userId: 'user_nikola' } as Principal;

function message(status: WebinarMessageRecord['status']): WebinarMessageRecord {
  return {
    id: 'msg_1',
    webinarId: 'w1',
    orgId: 'org_sample',
    sessionId: 'session_1',
    authorParticipantId: 'part_attendee',
    authorUserId: 'user_jovan',
    kind: 'attendee',
    status,
    text: 'A question',
    originalText: null,
    showFirstName: false,
    authorFirstName: null,
    publishedAt: status === 'published' ? new Date() : null,
    answerText: null,
    createdAt: new Date(),
  };
}

function registration(id: string, floorGivenAt: Date | null): WebinarRegistrationRecord {
  return {
    id,
    webinarId: 'w1',
    orgId: 'org_sample',
    userId: id === 'reg_1' ? 'user_jovan' : 'user_ana',
    registeredAt: new Date(),
    canceledAt: null,
    handRaisedAt: null,
    floorGivenAt,
    votedPollIds: [],
  };
}

async function setup(options: { message?: WebinarMessageRecord; othersWithFloor?: number } = {}) {
  const video = new FakeVideoProvider();
  const session = await video.createSession({
    sessionId: 'session_1',
    format: 'webinar',
    capacity: 250,
    orgId: 'org_sample',
    webinarId: 'w1',
    participant: { participantId: 'part_presenter', role: 'presenter' },
  });
  const attendee = await video.createParticipant({
    providerMeetingId: session.providerMeetingId,
    participantId: 'part_attendee',
    role: 'attendee',
  });

  const floors = new Map<string, Date | null>([['reg_1', null]]);
  for (let i = 0; i < (options.othersWithFloor ?? 0); i += 1) floors.set(`reg_other_${i}`, new Date());
  const current = options.message ?? message('published');

  const access = {
    load: async () => webinar,
    host: async () => ({ role: 'moderator' }),
    canModerate: async () => true,
    scoped: async (_orgId: string | null, fn: (tx: undefined) => Promise<unknown>) => fn(undefined),
  } as unknown as WebinarAccess;
  const repo = {
    findMessage: async () => current,
    updateMessage: async (_id: string, from: string[], patch: { status: WebinarMessageRecord['status'] }) =>
      from.includes(current.status) ? { ...current, ...patch } : null,
    displayNames: async () => new Map([['user_jovan', 'Jovan Petrović']]),
    findParticipantOfWebinar: async () => ({
      id: 'part_attendee',
      sessionId: 'session_1',
      userId: 'user_jovan',
      role: 'ATTENDEE',
      providerAttendeeId: attendee.providerAttendeeId,
    }),
    findRegistration: async () => registration('reg_1', floors.get('reg_1') ?? null),
    setFloor: async (id: string, at: Date | null) => {
      floors.set(id, at);
    },
    listActiveRegistrations: async () => [...floors.entries()].map(([id, at]) => registration(id, at)),
  } as unknown as WebinarsRepository;
  const calls = {
    findSessionById: async () => ({ id: 'session_1', status: 'active', providerMeetingId: session.providerMeetingId }),
  } as unknown as CallsRepository;
  const toAudienceAdded = vi.fn(() => true);
  const events = { toParticipant: vi.fn(), toModeration: vi.fn(), toAudience: vi.fn(), toAudienceAdded };
  const audit = { record: vi.fn(async () => undefined) } as unknown as AuditWriter;
  const service = new WebinarLiveService(repo, access, calls, video, events as unknown as WebinarRoomEvents, audit);
  return { service, toAudienceAdded };
}

describe('webinar.message.removed (WBN-24.2)', () => {
  it('is emitted on webinar:{id} when a host dismisses a published message, with the id only', async () => {
    const { service, toAudienceAdded } = await setup({ message: message('published') });
    const dismissed = await service.dismissMessage('w1', 'msg_1', moderator);
    expect(dismissed.status).toBe('dismissed');
    expect(toAudienceAdded).toHaveBeenCalledTimes(1);
    expect(toAudienceAdded).toHaveBeenCalledWith('w1', 'webinar.message.removed', { messageId: 'msg_1' });
  });

  it('is not emitted for a pending message the audience never saw', async () => {
    const { service, toAudienceAdded } = await setup({ message: message('pending') });
    await service.dismissMessage('w1', 'msg_1', moderator);
    expect(toAudienceAdded).not.toHaveBeenCalled();
  });
});

describe('webinar.floor.state (WBN-25.8)', () => {
  it('is active on give-floor and inactive on take-floor, as an anonymous flag', async () => {
    const { service, toAudienceAdded } = await setup();
    await service.giveFloor('w1', 'part_attendee', moderator);
    await service.takeFloor('w1', 'part_attendee', moderator);
    expect(toAudienceAdded.mock.calls).toEqual([
      ['w1', 'webinar.floor.state', { active: true }],
      ['w1', 'webinar.floor.state', { active: false }],
    ]);
  });

  it('stays active after take-floor while another attendee still holds the floor', async () => {
    const { service, toAudienceAdded } = await setup({ othersWithFloor: 1 });
    await service.takeFloor('w1', 'part_attendee', moderator);
    expect(toAudienceAdded).toHaveBeenCalledWith('w1', 'webinar.floor.state', { active: true });
  });
});
