/**
 * The follow-up and problem-report wrappers (T-CW-1.9, CALL-16, CALL-35 to
 * CALL-38): paths, bodies and the response parse.
 */
import { describe, expect, it } from 'vitest';
import { createApiClient } from './client';
import { createCallsApi } from './calls';

const APPOINTMENT = {
  id: 'appt_next',
  orgId: 'org_1',
  expertUserId: 'user_expert',
  employeeUserId: 'user_employee',
  startsAt: '2030-01-20T09:00:00.000Z',
  endsAt: '2030-01-20T09:50:00.000Z',
  status: 'proposed',
  serviceCategory: 'psychological',
  timeZone: 'Europe/Belgrade',
  fundingRef: null,
  followUpOf: 'appt_done',
  expert: { firstName: 'Milica' },
  employee: { firstName: 'Jovan' },
  suggestedWindows: [{ startsAt: '2030-01-21T09:00:00.000Z', endsAt: '2030-01-21T12:00:00.000Z' }],
};

interface Call {
  url: string;
  method: string;
  body: unknown;
}

function setup(responseBody: unknown, status = 200) {
  const calls: Call[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    return status === 204
      ? new Response(null, { status })
      : new Response(JSON.stringify(responseBody), { status, headers: { 'content-type': 'application/json' } });
  };
  const api = createCallsApi(createApiClient({ baseUrl: 'http://x', mode: 'cookie', fetchImpl }));
  return { api, last: () => calls[calls.length - 1]! };
}

describe('follow-up wrappers', () => {
  it('keep the participants’ first names and the suggested windows of the response', async () => {
    const { api, last } = setup(APPOINTMENT);
    await expect(api.getAppointment('appt_next')).resolves.toEqual(APPOINTMENT);
    expect(last()).toMatchObject({ url: 'http://x/api/appointments/appt_next', method: 'GET' });
  });

  it('post to the five follow-up routes', async () => {
    const { api, last } = setup(APPOINTMENT);
    const proposal = { startsAt: '2030-01-20T09:00:00.000Z', durationMinutes: 50, timeZone: 'Europe/Belgrade' };
    await api.proposeFollowUp('appt_done', proposal);
    expect(last()).toEqual({ url: 'http://x/api/appointments/appt_done/follow-up', method: 'POST', body: proposal });
    await api.confirmFollowUp('appt_next');
    expect(last()).toEqual({ url: 'http://x/api/appointments/appt_next/confirm', method: 'POST', body: {} });
    const windows = { windows: APPOINTMENT.suggestedWindows };
    await api.suggestTimes('appt_next', windows);
    expect(last()).toEqual({ url: 'http://x/api/appointments/appt_next/suggest-times', method: 'POST', body: windows });
    await api.scheduleFollowUp('appt_next', { selectedWindowIndex: 0 });
    expect(last()).toEqual({ url: 'http://x/api/appointments/appt_next/schedule', method: 'POST', body: { selectedWindowIndex: 0 } });
    await api.declineFollowUp('appt_next');
    expect(last()).toEqual({ url: 'http://x/api/appointments/appt_next/decline', method: 'POST', body: {} });
  });

  it('keeps the earlier name as an alias of suggestTimes', () => {
    const { api } = setup(APPOINTMENT);
    expect(api.suggestFollowUpTimes).toBe(api.suggestTimes);
  });
});

describe('reportProblem (CALL-16)', () => {
  it('posts a category and the connection summary to the session’s problem-report route (204)', async () => {
    const { api, last } = setup(undefined, 204);
    const body = { category: 'audio' as const, summary: { durationMs: 1_200_000, reconnectCount: 1, browser: 'Firefox' } };
    await expect(api.reportProblem('sess 1', body)).resolves.toBeUndefined();
    expect(last()).toEqual({ url: 'http://x/api/calls/sess%201/problem-report', method: 'POST', body });
  });
});
