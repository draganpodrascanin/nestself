/**
 * FollowUpNotifier (T-CW-1.9, T-CW-1.5): the expert hears a decline live on
 * their own room as well as on the finished consultation's call room.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { IdentityRepository } from '../db/repositories/identity.repository.js';
import type { Mailer } from '../mailer/mailer.js';
import type { RoomEmitter } from '../ws/room-emitter.js';
import type { AppointmentRecord } from './appointments.repository.js';
import type { FollowUpCallRoom } from './follow-up-call-room.js';
import { FollowUpNotifier } from './follow-up-notifier.js';

const followUp: AppointmentRecord = {
  id: 'appt_follow_up',
  orgId: 'org_sample',
  expertUserId: 'user_milica',
  employeeUserId: 'user_jovan',
  startsAt: new Date('2026-11-24T15:00:00.000Z'),
  endsAt: new Date('2026-11-24T15:50:00.000Z'),
  status: 'declined',
  serviceCategory: 'psychological',
  timeZone: 'Europe/Belgrade',
  fundingRef: null,
  followUpOf: 'appt_done',
  createdAt: new Date('2026-11-10T15:00:00.000Z'),
  updatedAt: new Date('2026-11-10T15:00:00.000Z'),
} as AppointmentRecord;

describe('FollowUpNotifier.declined', () => {
  let rooms: { emitToUser: ReturnType<typeof vi.fn> };
  let callRoom: { latestSessionId: ReturnType<typeof vi.fn>; emitDeclined: ReturnType<typeof vi.fn> };
  let mailer: { send: ReturnType<typeof vi.fn> };
  let notifier: FollowUpNotifier;

  beforeEach(() => {
    rooms = { emitToUser: vi.fn(() => true) };
    callRoom = { latestSessionId: vi.fn(async () => 'session_1'), emitDeclined: vi.fn(() => true) };
    mailer = { send: vi.fn(async () => undefined) };
    const identities = {
      findUserById: vi.fn(async () => ({ email: 'user_milica@example.com', locale: 'sr-Latn', suspendedAt: null, deactivatedAt: null })),
    };
    notifier = new FollowUpNotifier(
      callRoom as unknown as FollowUpCallRoom,
      rooms as unknown as RoomEmitter,
      mailer as unknown as Mailer,
      identities as unknown as IdentityRepository,
      { get: () => undefined } as unknown as ConfigService,
    );
  });

  it('tells the expert on their own room and on the call room, and emails them', async () => {
    await notifier.declined(followUp);

    const payload = { appointmentId: 'appt_done', followUpId: 'appt_follow_up' };
    expect(rooms.emitToUser).toHaveBeenCalledTimes(1);
    expect(rooms.emitToUser).toHaveBeenCalledWith('user_milica', 'appointment.follow_up.declined', payload);
    expect(callRoom.emitDeclined).toHaveBeenCalledWith('session_1', payload);
    expect(mailer.send).toHaveBeenCalledWith(expect.objectContaining({ template: 'appointment.follow_up.declined' }));
  });

  it('still tells the expert live when the consultation had no call session', async () => {
    callRoom.latestSessionId.mockResolvedValueOnce(null);
    await notifier.declined(followUp);
    expect(callRoom.emitDeclined).not.toHaveBeenCalled();
    expect(rooms.emitToUser).toHaveBeenCalledWith('user_milica', 'appointment.follow_up.declined', {
      appointmentId: 'appt_done',
      followUpId: 'appt_follow_up',
    });
  });
});

describe('FollowUpNotifier.canceled (CALL-27)', () => {
  it('emails the employee and the expert, each in their locale, with their own appointment page', async () => {
    const mailer = { send: vi.fn(async (_input: unknown) => undefined) };
    const users: Record<string, { email: string; locale: string; suspendedAt: null; deactivatedAt: null }> = {
      user_jovan: { email: 'user_jovan@example.com', locale: 'hu', suspendedAt: null, deactivatedAt: null },
      user_milica: { email: 'user_milica@example.com', locale: 'sr-Latn', suspendedAt: null, deactivatedAt: null },
    };
    const notifier = new FollowUpNotifier(
      { latestSessionId: vi.fn(), emitDeclined: vi.fn() } as unknown as FollowUpCallRoom,
      { emitToUser: vi.fn() } as unknown as RoomEmitter,
      mailer as unknown as Mailer,
      { findUserById: vi.fn(async (id: string) => users[id] ?? null) } as unknown as IdentityRepository,
      { get: (key: string) => (key === 'WORKSPACE_URL' ? 'https://app.test' : key === 'ADMIN_URL' ? 'https://admin.test' : undefined) } as unknown as ConfigService,
    );

    await notifier.canceled({ ...followUp, status: 'canceled' });

    const window = { id: followUp.id, startsAt: followUp.startsAt.toISOString(), endsAt: followUp.endsAt.toISOString(), timeZone: 'Europe/Belgrade' };
    expect(mailer.send.mock.calls.map((call) => call[0])).toEqual([
      {
        to: 'user_jovan@example.com',
        locale: 'hu',
        template: 'appointment.canceled',
        data: { appointment: window, appointmentUrl: 'https://app.test/appointments/appt_follow_up' },
      },
      {
        to: 'user_milica@example.com',
        locale: 'sr-Latn',
        template: 'appointment.canceled',
        data: { appointment: window, appointmentUrl: 'https://admin.test/consultations/appt_follow_up' },
      },
    ]);
  });
});
