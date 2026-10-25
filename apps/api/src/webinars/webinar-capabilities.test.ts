/**
 * Attendees never send video (D-CW-35, CW-R-108, WBN-07 criterion 5, WBN-08
 * criterion 6, global constraint 14): no code path of the webinar module
 * asks the provider for `Video: SendReceive` (or `Send`) for an attendee.
 *
 * - Every provider call the floor routes make is recorded: give-floor sets
 *   audio to `SendReceive` with video and content `Receive`; take-floor goes
 *   back to receive-only.
 * - The module's sources hold no capability literal at all: attendee
 *   capabilities come from `attendeeCapabilities()`, which only the adapter's
 *   `capabilitiesForRole('attendee')` backs, and the adapter refuses an
 *   attendee capability that sends video or content.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { Principal } from '@nestself/contracts';
import type { AuditWriter } from '../audit/audit-writer.js';
import type { CallsRepository } from '../calls/calls.repository.js';
import { FakeVideoProvider } from '../video/fake-video-provider.js';
import { VideoCapabilityError, type UpdateCapabilitiesInput } from '../video/video-provider.js';
import type { WebinarAccess } from './webinar-access.js';
import { WebinarLiveService } from './webinar-live.service.js';
import type { WebinarRoomEvents } from './webinar-room-events.js';
import type { WebinarsRepository } from './webinars.repository.js';

const here = dirname(fileURLToPath(import.meta.url));

const webinar = {
  id: 'w1',
  orgId: 'org_sample',
  status: 'live',
  startsAt: new Date(),
  endsAt: new Date(Date.now() + 3_600_000),
};
const registration = { id: 'reg_1', userId: 'user_jovan', orgId: 'org_sample', handRaisedAt: null, floorGivenAt: null };

async function setup() {
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
  const updates: UpdateCapabilitiesInput[] = [];
  const realUpdate = video.updateParticipantCapabilities.bind(video);
  vi.spyOn(video, 'updateParticipantCapabilities').mockImplementation(async (input) => {
    updates.push(structuredClone(input));
    return realUpdate(input);
  });

  const access = {
    load: async () => webinar,
    host: async () => ({ role: 'moderator' }),
    canModerate: async () => true,
    scoped: async (_orgId: string | null, fn: (tx: undefined) => Promise<unknown>) => fn(undefined),
  } as unknown as WebinarAccess;
  const repo = {
    findParticipantOfWebinar: async () => ({
      id: 'part_attendee',
      sessionId: 'session_1',
      userId: 'user_jovan',
      role: 'ATTENDEE',
      providerAttendeeId: attendee.providerAttendeeId,
    }),
    findRegistration: async () => registration,
    setFloor: async () => undefined,
    listActiveRegistrations: async () => [registration],
  } as unknown as WebinarsRepository;
  const calls = {
    findSessionById: async () => ({ id: 'session_1', status: 'active', providerMeetingId: session.providerMeetingId }),
  } as unknown as CallsRepository;
  const events = { toParticipant: vi.fn(), toModeration: vi.fn(), toAudienceAdded: vi.fn() } as unknown as WebinarRoomEvents;
  const audit = { record: vi.fn(async () => undefined) } as unknown as AuditWriter;
  const service = new WebinarLiveService(repo, access, calls, video, events, audit);
  return { service, video, updates, attendee, session };
}

const moderator = { userId: 'user_nikola' } as Principal;

describe('the floor is audio only (D-CW-35)', () => {
  it('give-floor asks for audio SendReceive with video and content Receive; take-floor reverts to receive-only', async () => {
    const { service, updates } = await setup();

    const given = await service.giveFloor('w1', 'part_attendee', moderator);
    expect(given).toEqual({
      participantId: 'part_attendee',
      hasFloor: true,
      capabilities: { audio: 'send_receive', video: 'receive', content: 'receive' },
    });
    const taken = await service.takeFloor('w1', 'part_attendee', moderator);
    expect(taken.capabilities).toEqual({ audio: 'receive', video: 'receive', content: 'receive' });

    expect(updates.map((u) => [u.role, u.capabilities])).toEqual([
      ['attendee', { Audio: 'SendReceive', Video: 'Receive', Content: 'Receive' }],
      ['attendee', { Audio: 'Receive', Video: 'Receive', Content: 'Receive' }],
    ]);
  });

  it('no provider call of the floor routes ever lets an attendee send video or content', async () => {
    const { service, updates } = await setup();
    for (let i = 0; i < 3; i += 1) {
      await service.giveFloor('w1', 'part_attendee', moderator);
      await service.takeFloor('w1', 'part_attendee', moderator);
    }
    expect(updates).toHaveLength(6);
    for (const update of updates) {
      expect(update.role).toBe('attendee');
      expect(update.capabilities.Video).toBe('Receive');
      expect(update.capabilities.Content).toBe('Receive');
    }
  });

  it('the adapter refuses an attendee update that would send video, whoever asks', async () => {
    const { video, session, attendee } = await setup();
    await expect(
      video.updateParticipantCapabilities({
        providerMeetingId: session.providerMeetingId,
        providerAttendeeId: attendee.providerAttendeeId,
        role: 'attendee',
        capabilities: { Audio: 'SendReceive', Video: 'SendReceive', Content: 'Receive' },
      }),
    ).rejects.toBeInstanceOf(VideoCapabilityError);
  });
});

describe('the webinar module holds no capability literal (CW-R-108)', () => {
  it('no source file names SendReceive or Send: attendee capabilities come from attendeeCapabilities()', () => {
    const sources = readdirSync(here).filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'));
    expect(sources.length).toBeGreaterThan(5);
    for (const name of sources) {
      const text = readFileSync(join(here, name), 'utf8');
      expect(text, name).not.toMatch(/['"](SendReceive|Send)['"]/);
    }
  });

  it('every provider call that creates or updates an attendee goes through attendeeCapabilities()', () => {
    const sources = readdirSync(here).filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'));
    for (const name of sources) {
      const text = readFileSync(join(here, name), 'utf8');
      for (const call of text.matchAll(/updateParticipantCapabilities\(\{[\s\S]*?\}\)/g)) {
        expect(call[0], name).toMatch(/role: 'attendee'[\s\S]*capabilities: attendeeCapabilities\((true|false)\)/);
      }
      for (const call of text.matchAll(/createParticipant\(\{[\s\S]*?\}\)/g)) {
        expect(call[0], name).toMatch(/attendeeCapabilities\(false\)/);
      }
    }
  });
});
