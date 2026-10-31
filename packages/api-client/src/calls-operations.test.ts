/**
 * M1 completion wrappers (CALL-05, CALL-07, CALL-26, CALL-38, CALL-39,
 * PLT-05): the reader-specific appointment fields, booking, diagnostics,
 * problem reports and the expert's decline notice on the user room.
 */
import { describe, expect, it, vi } from 'vitest';
import { APPROVAL_FOLLOW_UP_DESCRIPTION } from '@nestself/contracts';
import { createApiClient } from './client';
import { createCallsApi } from './calls';
import { createUserRoomClient } from './user-room';
import type { RoomSocket } from './call-room';

const APPOINTMENT = {
  id: 'appt_1',
  orgId: 'org_1',
  expertUserId: 'user_expert',
  employeeUserId: 'user_employee',
  startsAt: '2030-01-20T09:00:00.000Z',
  endsAt: '2030-01-20T09:50:00.000Z',
  status: 'confirmed',
  serviceCategory: 'psychological',
  timeZone: 'Europe/Belgrade',
  fundingRef: null,
  followUpOf: null,
};

interface Call {
  url: string;
  method: string;
  body: unknown;
}

function setup(responseBody: unknown, status = 200) {
  const calls: Call[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
    return new Response(JSON.stringify(responseBody), { status, headers: { 'content-type': 'application/json' } });
  };
  const api = createCallsApi(createApiClient({ baseUrl: 'http://x', mode: 'cookie', fetchImpl }));
  return { api, last: () => calls[calls.length - 1]! };
}

describe('appointment reads with the viewer fields', () => {
  it('keeps viewer, the pending running-late signal, the decline reason and the approval outcome', async () => {
    const body = {
      ...APPOINTMENT,
      status: 'declined',
      viewer: { hasJoined: false, sessionEnded: false, pendingSignal: { type: 'running_late', etaMinutes: 10, sentAt: '2030-01-20T08:55:00.000Z' } },
      declineReason: 'Please book it after the quarter ends.',
      approvalOutcome: 'rejected',
    };
    const { api } = setup(body);
    const appointment = await api.getAppointment('appt_1');
    expect(appointment.viewer).toEqual(body.viewer);
    expect(appointment.declineReason).toBe(body.declineReason);
    expect(appointment.approvalOutcome).toBe('rejected');
  });

  it('accepts an appointment without them, and lists with them', async () => {
    const { api } = setup({ items: [{ ...APPOINTMENT, viewer: { hasJoined: true, sessionEnded: false } }], nextCursor: null });
    const page = await api.listAppointments({ from: '2030-01-19T09:00:00.000Z' });
    expect(page.items[0]?.viewer).toEqual({ hasJoined: true, sessionEnded: false });
    const plain = setup(APPOINTMENT);
    expect((await plain.api.getAppointment('appt_1')).viewer).toBeUndefined();
  });
});

describe('createAppointment (CALL-26)', () => {
  it('posts the booking to the organisation', async () => {
    const { api, last } = setup(APPOINTMENT, 201);
    const body = {
      orgId: 'org 1',
      expertUserId: 'user_expert',
      employeeUserId: 'user_employee',
      startsAt: APPOINTMENT.startsAt,
      endsAt: APPOINTMENT.endsAt,
      serviceCategory: 'psychological',
      timeZone: 'Europe/Belgrade',
    };
    await expect(api.createAppointment('org 1', body)).resolves.toMatchObject({ id: 'appt_1' });
    expect(last()).toEqual({ url: 'http://x/api/orgs/org%201/appointments', method: 'POST', body });
  });

  it('surfaces the API code of a refused booking', async () => {
    const { api } = setup({ code: 'subject_not_member', message: 'English' }, 409);
    await expect(
      api.createAppointment('org_1', { ...APPOINTMENT, serviceCategory: 'legal' } as never),
    ).rejects.toMatchObject({ status: 409, code: 'subject_not_member' });
  });
});

describe('support reads (PLT-05, CALL-16)', () => {
  it('reads a session diagnostics by id', async () => {
    const diagnostics = {
      sessionId: 'sess 1',
      appointmentId: 'appt_1',
      webinarId: null,
      startedAt: null,
      endedAt: null,
      status: 'ended',
      provider: 'chime',
      providerMeetingId: null,
      participants: [],
      problemReports: [],
    };
    const { api, last } = setup(diagnostics);
    await expect(api.getDiagnostics('sess 1')).resolves.toEqual(diagnostics);
    expect(last()).toMatchObject({ url: 'http://x/api/ops/calls/sess%201/diagnostics', method: 'GET' });
  });

  it('lists problem reports with the defined filters', async () => {
    const report = {
      sessionId: 'sess_1',
      appointmentId: 'appt_1',
      reportedAt: '2030-01-20T10:00:00.000Z',
      role: 'employee',
      category: 'audio',
      summary: { durationMs: 1_200_000, reconnectCount: 2 },
    };
    const { api, last } = setup({ items: [report], nextCursor: 'c2' });
    const page = await api.listProblemReports({ orgId: 'org_1', from: '2030-01-01T00:00:00.000Z', limit: 20 });
    expect(last().url).toBe('http://x/api/ops/calls/problem-reports?orgId=org_1&from=2030-01-01T00%3A00%3A00.000Z&limit=20');
    expect(page).toEqual({ items: [report], nextCursor: 'c2' });
  });
});

describe('user room: follow-up declined (CALL-38)', () => {
  it('hands the expert the declined follow-up', () => {
    const listeners = new Map<string, (payload: unknown) => void>();
    const socket: RoomSocket = {
      on: (event, listener) => listeners.set(event, listener as (payload: unknown) => void),
      emit: () => undefined,
      disconnect: () => undefined,
    };
    const onFollowUpDeclined = vi.fn();
    createUserRoomClient(() => socket).subscribe('user_expert', { onFollowUpDeclined });
    listeners.get('appointment.follow_up.declined')?.({ appointmentId: 'appt_done', followUpId: 'appt_next' });
    listeners.get('appointment.follow_up.declined')?.({ appointmentId: 'appt_done' });
    expect(onFollowUpDeclined).toHaveBeenCalledTimes(1);
    expect(onFollowUpDeclined).toHaveBeenCalledWith({ appointmentId: 'appt_done', followUpId: 'appt_next' });
  });
});

describe('review follow-ups: order, session ended, organisations, experts, approval zone', () => {
  it('sends the list order and keeps viewer.sessionEnded and orgName', async () => {
    const { api, last } = setup({ items: [{ ...APPOINTMENT, viewer: { hasJoined: true, sessionEnded: true }, orgName: 'Example d.o.o.' }], nextCursor: null });
    const page = await api.listAppointments({ to: '2030-01-19T09:00:00.000Z', order: 'desc' });
    expect(last().url).toBe('http://x/api/appointments?to=2030-01-19T09%3A00%3A00.000Z&order=desc');
    expect(page.items[0]?.viewer?.sessionEnded).toBe(true);
    expect(page.items[0]?.orgName).toBe('Example d.o.o.');
  });

  it('lists the operations organisations and the experts for a service', async () => {
    const orgs = setup({ items: [{ id: 'org_1', name: 'Example d.o.o.' }] });
    await expect(orgs.api.listOpsOrganizations('exa')).resolves.toEqual({ items: [{ id: 'org_1', name: 'Example d.o.o.' }] });
    expect(orgs.last().url).toBe('http://x/api/ops/orgs?q=exa');
    const experts = setup({ items: [{ userId: 'user_milica', displayName: 'Milica Ristić' }] });
    await experts.api.listAppointmentExperts({ serviceCategory: 'psychological' });
    expect(experts.last().url).toBe('http://x/api/ops/appointment-experts?serviceCategory=psychological');
  });

  it("keeps the approval item's time zone", async () => {
    const item = {
      id: 'approval_1',
      appointmentId: 'appt_1',
      status: 'pending',
      employeeDisplayName: 'Jovan Petrović',
      description: APPROVAL_FOLLOW_UP_DESCRIPTION,
      startsAt: APPOINTMENT.startsAt,
      durationMinutes: 50,
      timeZone: 'Europe/Belgrade',
    };
    const { api } = setup({ items: [item] });
    const parsed = await api.listApprovals('org_1');
    expect(parsed.items[0]?.timeZone).toBe('Europe/Belgrade');
  });
});
