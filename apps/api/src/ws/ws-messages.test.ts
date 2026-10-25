/**
 * Room names and subscribe messages (T-CW-1.6, CW-R-36): only the served
 * room patterns parse, and a call room subscription cannot carry another
 * action or resource.
 */
import { describe, expect, it } from 'vitest';
import {
  AppointmentRemindPayloadSchema,
  CALL_ROOM_EVENT_NAMES,
  CALL_ROOM_EVENT_PAYLOAD_SCHEMAS,
  USER_ROOM_EVENT_NAMES,
  WEBINAR_EVENT_NAMES,
  WEBINAR_EVENT_PAYLOAD_SCHEMAS,
  WEBINAR_HOSTS_ROOM_EVENT_NAMES,
  WEBINAR_HOSTS_ROOM_EVENT_PAYLOAD_SCHEMAS,
  WEBINAR_MODERATION_ROOM_ADDED_EVENT_NAMES,
  WEBINAR_MODERATION_ROOM_ADDED_EVENT_PAYLOAD_SCHEMAS,
  WEBINAR_MODERATION_ROOM_EVENT_NAMES,
  WEBINAR_PARTICIPANT_EVENT_NAMES,
  WEBINAR_ROOM_ADDED_EVENT_NAMES,
  WEBINAR_ROOM_ADDED_EVENT_PAYLOAD_SCHEMAS,
  WEBINAR_ROOM_EVENT_NAMES,
  userRoomName,
} from '@nestself/contracts';
import { CallSubscribeSchema, ROOM_EVENTS, SubscribeMessageSchema, checkRoomEvent, parseRoom } from './ws-messages.js';

const UUID = '3f2b8c1e-9d4a-4f6b-8e2a-1c5d7e9f0a3b';

describe('parseRoom', () => {
  it.each([
    [`call:${UUID}`, 'call', UUID],
    ['call:call_session_sample_consultation', 'call', 'call_session_sample_consultation'],
    [`webinar:${UUID}`, 'webinar', UUID],
    ['webinar:webinar_sample_upcoming:moderation', 'webinar_moderation', 'webinar_sample_upcoming'],
    ['webinar:webinar_sample_upcoming:hosts', 'webinar_hosts', 'webinar_sample_upcoming'],
    ['org:org_sample:programme', 'org_programme', 'org_sample'],
    ['user:user_jovan', 'user', 'user_jovan'],
    [`user:${UUID}`, 'user', UUID],
  ])('serves %s', (room, kind, id) => {
    expect(parseRoom(room)).toEqual({ kind, room, id });
  });

  it.each([
    '',
    'call:',
    'call',
    'call:a:b',
    'call:../session',
    'call: session',
    'call:session ',
    'CALL:session',
    'call:_session',
    `call:${'a'.repeat(129)}`,
    'webinar:w:moderation:extra',
    'webinar::moderation',
    'webinar::hosts',
    'webinar:w:hosts:extra',
    'webinar:w:presenters',
    'org:org_sample:notifications',
    'user:',
    'user:a:b',
    'user:user_jovan:extra',
    'session_1',
  ])('refuses %j', (room) => {
    expect(parseRoom(room)).toBeNull();
  });
});

describe('SubscribeMessageSchema', () => {
  it('needs only a served room', () => {
    expect(SubscribeMessageSchema.parse({ room: 'call:session_1' })).toEqual({ room: 'call:session_1' });
  });

  it('still accepts the action and resource of T-1.11 clients', () => {
    const message = {
      room: 'org:org_sample:programme',
      action: 'program.overview',
      resource: { type: 'program', orgId: 'org_sample' },
    };
    expect(SubscribeMessageSchema.parse(message)).toEqual(message);
  });

  it('refuses a room outside the served patterns on the room field', () => {
    const result = SubscribeMessageSchema.safeParse({ room: 'anything:goes' });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([['room']]);
  });
});

describe('CallSubscribeSchema', () => {
  it('accepts a call room alone or with consultation.join on that call session', () => {
    expect(CallSubscribeSchema.safeParse({ room: 'call:session_1' }).success).toBe(true);
    expect(
      CallSubscribeSchema.safeParse({
        room: 'call:session_1',
        action: 'consultation.join',
        resource: { type: 'call_session', id: 'session_1' },
      }).success,
    ).toBe(true);
  });

  it('refuses another action or resource type: the room decides, not the client', () => {
    expect(
      CallSubscribeSchema.safeParse({
        room: 'call:session_1',
        action: 'program.overview',
        resource: { type: 'program', orgId: 'org_sample' },
      }).success,
    ).toBe(false);
    expect(
      CallSubscribeSchema.safeParse({ room: 'call:session_1', resource: { type: 'appointment', id: 'appt_1' } }).success,
    ).toBe(false);
  });

  it('refuses a resource naming another session', () => {
    expect(
      CallSubscribeSchema.safeParse({ room: 'call:session_1', resource: { type: 'call_session', id: 'session_2' } })
        .success,
    ).toBe(false);
  });

  it('refuses a room that is not a call room', () => {
    expect(CallSubscribeSchema.safeParse({ room: 'webinar:w1' }).success).toBe(false);
  });
});

describe('ROOM_EVENTS (CW-R-36)', () => {
  it('binds every call room event to the call room and its contract schema', () => {
    for (const event of CALL_ROOM_EVENT_NAMES) {
      expect(ROOM_EVENTS[event].roomKinds).toContain('call');
      expect(ROOM_EVENTS[event].schema).toBe(CALL_ROOM_EVENT_PAYLOAD_SCHEMAS[event]);
    }
  });

  it('serves the follow-up proposal and the reminder on the user room (CALL-42, CALL-01)', () => {
    for (const event of USER_ROOM_EVENT_NAMES) expect(ROOM_EVENTS[event].roomKinds).toContain('user');
    expect(ROOM_EVENTS['appointment.follow_up.proposed'].roomKinds).toEqual(['call', 'user']);
    expect(ROOM_EVENTS['appointment.times_suggested'].roomKinds).toEqual(['call', 'user']);
    expect(ROOM_EVENTS['appointment.remind']).toEqual({ roomKinds: ['user'], schema: AppointmentRemindPayloadSchema });
    expect(Object.keys(ROOM_EVENTS).sort()).toEqual(
      [...new Set<string>([...CALL_ROOM_EVENT_NAMES, ...USER_ROOM_EVENT_NAMES, ...WEBINAR_EVENT_NAMES, ...WEBINAR_ROOM_ADDED_EVENT_NAMES, ...WEBINAR_HOSTS_ROOM_EVENT_NAMES, ...WEBINAR_MODERATION_ROOM_ADDED_EVENT_NAMES])].sort(),
    );
  });

  it('binds every webinar event to its room kinds and its contract schema (T-CW-2.3, guidelines 8)', () => {
    for (const event of WEBINAR_ROOM_EVENT_NAMES) {
      expect(ROOM_EVENTS[event].roomKinds).toContain('webinar');
      expect(ROOM_EVENTS[event].schema).toBe(WEBINAR_EVENT_PAYLOAD_SCHEMAS[event]);
    }
    for (const event of WEBINAR_MODERATION_ROOM_EVENT_NAMES) {
      expect(ROOM_EVENTS[event].roomKinds).toContain('webinar_moderation');
      expect(ROOM_EVENTS[event].schema).toBe(WEBINAR_EVENT_PAYLOAD_SCHEMAS[event]);
    }
    // The hosts' room: counts and the floor holder's id, never a name (D-CW-15).
    expect(ROOM_EVENTS['webinar.attendance.count'].roomKinds).toEqual(['webinar_moderation', 'webinar_hosts']);
    expect(ROOM_EVENTS['webinar.hand.count']).toEqual({ roomKinds: ['webinar_hosts'], schema: WEBINAR_HOSTS_ROOM_EVENT_PAYLOAD_SCHEMAS['webinar.hand.count'] });
    for (const event of ['webinar.hand.raised', 'webinar.hand.lowered', 'webinar.message.submitted'] as const) {
      expect(ROOM_EVENTS[event].roomKinds).toEqual(['webinar_moderation']);
    }
    for (const event of WEBINAR_PARTICIPANT_EVENT_NAMES) {
      expect(ROOM_EVENTS[event]).toEqual({ roomKinds: ['user'], schema: WEBINAR_EVENT_PAYLOAD_SCHEMAS[event] });
    }
    expect(ROOM_EVENTS['webinar.message.removed']).toEqual({ roomKinds: ['webinar'], schema: WEBINAR_ROOM_ADDED_EVENT_PAYLOAD_SCHEMAS['webinar.message.removed'] });
    expect(ROOM_EVENTS['webinar.floor.state']).toEqual({
      roomKinds: ['webinar', 'webinar_hosts'],
      schema: WEBINAR_ROOM_ADDED_EVENT_PAYLOAD_SCHEMAS['webinar.floor.state'],
      schemaByRoomKind: { webinar_hosts: WEBINAR_HOSTS_ROOM_EVENT_PAYLOAD_SCHEMAS['webinar.floor.state'] },
    });
    expect(ROOM_EVENTS['webinar.ended'].roomKinds).toEqual(['webinar', 'webinar_moderation']);
    expect(ROOM_EVENTS['webinar.recording.failed']).toEqual({
      roomKinds: ['webinar_moderation'],
      schema: WEBINAR_MODERATION_ROOM_ADDED_EVENT_PAYLOAD_SCHEMAS['webinar.recording.failed'],
    });
  });

  it('carries the recording outcome: ready and failed publicly, the failure reason to the moderators only (CW-R-121)', () => {
    for (const status of ['started', 'stopped', 'ready', 'failed']) {
      expect(checkRoomEvent('webinar:w1', 'webinar.recording', { webinarId: 'w1', status })).toEqual({ webinarId: 'w1', status });
    }
    const failed = { webinarId: 'w1', reason: 'MediaCapturePipelineFailed' };
    expect(checkRoomEvent('webinar:w1:moderation', 'webinar.recording.failed', failed)).toEqual(failed);
    expect(checkRoomEvent('webinar:w1', 'webinar.recording.failed', failed)).toBeNull();
    expect(checkRoomEvent('webinar:w1:hosts', 'webinar.recording.failed', failed)).toBeNull();
  });

  it('keeps names and counts off the public webinar room and the floor off every shared room', () => {
    const hand = { participantId: 'p1', participantName: 'Jovan', raisedAt: '2026-11-10T15:00:00.000Z' };
    expect(checkRoomEvent('webinar:w1', 'webinar.hand.raised', hand)).toBeNull();
    expect(checkRoomEvent('webinar:w1:moderation', 'webinar.hand.raised', hand)).toEqual(hand);
    expect(checkRoomEvent('webinar:w1', 'webinar.attendance.count', { webinarId: 'w1', count: 3 })).toBeNull();
    const floor = { participantId: 'p1', capabilities: { audio: 'send_receive', video: 'receive', content: 'receive' } };
    expect(checkRoomEvent('webinar:w1', 'webinar.floor.given', floor)).toBeNull();
    expect(checkRoomEvent('user:user_jovan', 'webinar.floor.given', floor)).toEqual(floor);
    expect(checkRoomEvent('webinar:w1', 'webinar.floor.state', { active: true })).toEqual({ active: true });
    expect(checkRoomEvent('webinar:w1', 'webinar.message.removed', { messageId: 'm1', text: 'x' })).toBeNull();
  });

  it('names the floor holder by participant id on the hosts room only, and carries no name there', () => {
    const holder = { active: true, participantId: 'p1' };
    expect(checkRoomEvent('webinar:w1:hosts', 'webinar.floor.state', holder)).toEqual(holder);
    expect(checkRoomEvent('webinar:w1', 'webinar.floor.state', holder)).toBeNull();
    expect(checkRoomEvent('webinar:w1:moderation', 'webinar.floor.state', holder)).toBeNull();
    expect(checkRoomEvent('webinar:w1:hosts', 'webinar.floor.state', { ...holder, participantName: 'Jovan' })).toBeNull();
    expect(checkRoomEvent('webinar:w1:hosts', 'webinar.hand.count', { count: 2 })).toEqual({ count: 2 });
    expect(checkRoomEvent('webinar:w1', 'webinar.hand.count', { count: 2 })).toBeNull();
    expect(checkRoomEvent('webinar:w1:hosts', 'webinar.attendance.count', { webinarId: 'w1', count: 3 })).toEqual({ webinarId: 'w1', count: 3 });
    expect(checkRoomEvent('webinar:w1:hosts', 'webinar.hand.raised', { participantId: 'p1', participantName: 'Jovan', raisedAt: '2026-11-10T15:00:00.000Z' })).toBeNull();
  });
});

describe('checkRoomEvent on the user room', () => {
  const proposed = {
    appointmentId: 'appt_done',
    followUpId: 'appt_next',
    startsAt: '2026-11-24T15:00:00.000Z',
    durationMinutes: 50,
  };
  const remind = { appointmentId: 'appt_next', startsAt: '2026-11-24T15:00:00.000Z', offsetMinutes: 60, timeZone: 'Europe/Belgrade' };

  it('passes the follow-up proposal and the reminder to a user room', () => {
    expect(checkRoomEvent(userRoomName('user_jovan'), 'appointment.follow_up.proposed', proposed)).toEqual(proposed);
    // T-CW-1.5: the expert hears a decline on their own room.
    const declined = { appointmentId: 'appt_done', followUpId: 'appt_next' };
    expect(checkRoomEvent(userRoomName('user_milica'), 'appointment.follow_up.declined', declined)).toEqual(declined);
    expect(checkRoomEvent(userRoomName('user_jovan'), 'appointment.remind', remind)).toEqual(remind);
  });

  it('keeps every other call event off the user room and the reminder off the call room', () => {
    expect(checkRoomEvent('user:user_jovan', 'call.signal', { type: 'cannot_hear', fromRole: 'expert' })).toBeNull();
    expect(checkRoomEvent('user:user_jovan', 'call.participant.joined', { participantId: 'p', role: 'expert' })).toBeNull();
    expect(checkRoomEvent('call:session_1', 'appointment.remind', remind)).toBeNull();
  });

  it('drops a reminder payload that carries anything but ids and times', () => {
    expect(checkRoomEvent('user:user_jovan', 'appointment.remind', { ...remind, email: 'x@example.com' })).toBeNull();
  });
});
