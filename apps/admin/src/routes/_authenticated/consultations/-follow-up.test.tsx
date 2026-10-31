/**
 * The expert's follow-up pages in API mode (T-CW-1.9, CALL-35, CALL-37):
 * the employee's first name in the list and on the page, the state of a
 * follow-up already proposed after a completed consultation (read with
 * `?followUpOf=`), picking one of the employee's suggested windows, Rejoin
 * after the first-join window, and every failure as translated copy. The
 * Chime controller is the fake one; the user room never connects.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SAMPLE_PRINCIPALS } from '@nestself/sample-data';
import en from '@nestself/i18n/locales/en/calls.json';

const fetchMock = vi.hoisted(() => {
  const fn = vi.fn<typeof fetch>();
  globalThis.fetch = fn;
  return fn;
});

vi.mock('../../../data-source', () => ({
  dataSource: 'api',
  isSampleDataMode: false,
  resolveDataSource: () => 'api',
}));

vi.mock('../../../calls/user-room-client', () => ({ userRoomClient: { subscribe: () => () => undefined } }));

vi.mock('../../../calls/use-consultation-controller', async () => {
  const { useState } = await import('react');
  const { FakeCallSessionController } = await import('@nestself/video');
  return {
    useConsultationController: () => useState(() => new FakeCallSessionController({ role: 'expert' }))[0],
  };
});

import { routeTree } from '../../../routeTree.gen';
import { api } from '../../../api';
import { initialSnapshot } from '../../../auth';
import i18n from '../../../i18n';

const DAY = 24 * 60 * 60_000;
const expert = SAMPLE_PRINCIPALS.expert;

function at(days: number, hour: number): string {
  const date = new Date(Date.now() + days * DAY);
  date.setUTCHours(hour, 0, 0, 0);
  return date.toISOString();
}

function appointment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'appt_1',
    orgId: 'org_sample',
    expertUserId: expert.principal.userId,
    employeeUserId: 'user_jovan',
    startsAt: at(-2, 9),
    endsAt: new Date(Date.parse(at(-2, 9)) + 50 * 60_000).toISOString(),
    status: 'completed',
    serviceCategory: 'psychological',
    timeZone: 'Europe/Belgrade',
    fundingRef: null,
    followUpOf: null,
    expert: { firstName: 'Milica' },
    employee: { firstName: 'Jovan' },
    ...overrides,
  };
}

const WINDOWS = [
  { startsAt: at(8, 8), endsAt: at(8, 11) },
  { startsAt: at(9, 12), endsAt: at(9, 14) },
];

function followUp(overrides: Record<string, unknown> = {}) {
  return appointment({
    id: 'appt_2',
    startsAt: at(7, 13),
    endsAt: new Date(Date.parse(at(7, 13)) + 50 * 60_000).toISOString(),
    status: 'proposed',
    followUpOf: 'appt_1',
    ...overrides,
  });
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

interface Sent {
  method: string;
  path: string;
  search: string;
  body: unknown;
}

function serve(routes: Record<string, () => Response | Promise<Response>>): Sent[] {
  const sent: Sent[] = [];
  fetchMock.mockImplementation((input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://localhost');
    const method = init?.method ?? 'GET';
    sent.push({ method, path: url.pathname, search: url.search, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
    if (url.pathname === '/api/auth/me') return Promise.resolve(json(200, { principal: expert.principal, effectiveActions: expert.effectiveActions, availableContexts: [expert.principal.context] }));
    const handler = routes[`${method} ${url.pathname}`];
    return Promise.resolve(handler ? handler() : json(404, { code: 'not_found', message: 'Not found' }));
  });
  return sent;
}

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree,
    context: { queryClient, auth: { principal: null, effectiveActions: [], availableContexts: [], settled: false, ensure: () => initialSnapshot(api) } },
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

describe("the expert's follow-ups (API mode)", { timeout: 20_000 }, () => {
  beforeEach(async () => {
    fetchMock.mockReset();
    await i18n.changeLanguage('en');
  });
  afterEach(() => {
    cleanup();
  });

  it('renders a failed lookup of an earlier proposal instead of an empty form, and retries it', async () => {
    let fail = true;
    serve({
      'GET /api/appointments/appt_1': () => json(200, appointment()),
      'GET /api/appointments': () => (fail ? json(500, { code: 'internal', message: 'English' }) : json(200, { items: [followUp()], nextCursor: null })),
    });
    const user = userEvent.setup();
    renderAt('/consultations/appt_1');
    expect(await screen.findByText(new RegExp(en.followUp.lookupFailed), {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: en.followUp.send })).not.toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(en.followUp.waitingForEmployee)).toBeInTheDocument();
  });

  it('names the employee by first name in the list', async () => {
    serve({ 'GET /api/appointments': () => json(200, { items: [appointment()], nextCursor: null }) });
    renderAt('/consultations');
    const table = await screen.findByRole('table', {}, { timeout: 5000 });
    expect(within(table).getByRole('link', { name: 'Jovan' })).toHaveAttribute('href', '/consultations/appt_1');
  });

  it('shows the follow-up already proposed after a completed consultation, with a link to it', async () => {
    const sent = serve({
      'GET /api/appointments/appt_1': () => json(200, appointment()),
      'GET /api/appointments': () => json(200, { items: [followUp()], nextCursor: null }),
    });
    renderAt('/consultations/appt_1');
    expect(await screen.findByText(en.followUp.waitingForEmployee, {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText('Jovan')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: en.followUp.openFollowUp })).toHaveAttribute('href', '/consultations/appt_2');
    expect(screen.queryByRole('button', { name: en.followUp.send })).not.toBeInTheDocument();
    // The server narrows the list to this consultation's follow-ups.
    expect(sent.find((s) => s.method === 'GET' && s.path === '/api/appointments')?.search).toBe('?followUpOf=appt_1');
  });

  it('offers a new proposal after a decline and renders a refused proposal', async () => {
    serve({
      'GET /api/appointments/appt_1': () => json(200, appointment()),
      'GET /api/appointments': () => json(200, { items: [followUp({ status: 'declined' })], nextCursor: null }),
      'POST /api/appointments/appt_1/follow-up': () => json(409, { code: 'follow_up_not_allowed', message: 'English text for developers' }),
    });
    renderAt('/consultations/appt_1');
    const user = userEvent.setup();
    expect(await screen.findByText(en.followUp.declinedPropose, {}, { timeout: 5000 })).toBeInTheDocument();
    await user.type(screen.getByLabelText(en.followUp.date), '2030-03-05');
    await user.type(screen.getByLabelText(en.followUp.time), '10:00');
    await user.click(screen.getByRole('button', { name: en.followUp.send }));
    expect(await screen.findByText(en.errors.followUpNotAllowed)).toBeInTheDocument();
    expect(screen.queryByText('English text for developers')).not.toBeInTheDocument();
  });

  it('waits for the employee on a proposal without suggested windows', async () => {
    serve({ 'GET /api/appointments/appt_2': () => json(200, followUp()) });
    renderAt('/consultations/appt_2');
    expect(await screen.findByText(en.followUp.waitingForEmployee, {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup', { name: en.followUp.pickLabel })).not.toBeInTheDocument();
  });

  it('schedules one of the suggested windows', async () => {
    const scheduledAt = WINDOWS[1]!.startsAt;
    const sent = serve({
      'GET /api/appointments/appt_2': () => json(200, followUp({ suggestedWindows: WINDOWS })),
      'POST /api/appointments/appt_2/schedule': () =>
        json(200, followUp({ status: 'confirmed', startsAt: scheduledAt, endsAt: new Date(Date.parse(scheduledAt) + 50 * 60_000).toISOString() })),
    });
    renderAt('/consultations/appt_2');
    const user = userEvent.setup();

    expect(await screen.findByRole('heading', { name: en.followUp.pickTitle }, { timeout: 5000 })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: en.followUp.schedule }));
    expect(await screen.findByText(en.followUp.errors.pickRequired)).toBeInTheDocument();

    const choices = within(screen.getByRole('radiogroup', { name: en.followUp.pickLabel })).getAllByRole('radio');
    expect(choices).toHaveLength(2);
    await user.click(choices[1]!);
    await user.click(screen.getByRole('button', { name: en.followUp.schedule }));
    expect(await screen.findByText(/^Scheduled for /)).toBeInTheDocument();
    expect(sent.find((s) => s.path === '/api/appointments/appt_2/schedule')).toMatchObject({ method: 'POST', body: { selectedWindowIndex: 1 } });
  });

  it.each([
    ['approver_missing', en.errors.approverMissing],
    ['appointment_not_proposed', en.errors.appointmentNotProposed],
  ])('renders %s when scheduling fails', async (code, message) => {
    serve({
      'GET /api/appointments/appt_2': () => json(200, followUp({ suggestedWindows: WINDOWS })),
      'POST /api/appointments/appt_2/schedule': () => json(409, { code, message: 'English text for developers' }),
    });
    renderAt('/consultations/appt_2');
    const user = userEvent.setup();
    const group = await screen.findByRole('radiogroup', { name: en.followUp.pickLabel }, { timeout: 5000 });
    await user.click(within(group).getAllByRole('radio')[0]!);
    await user.click(screen.getByRole('button', { name: en.followUp.schedule }));
    expect(await screen.findByText(message)).toBeInTheDocument();
  });

  it('at start + 11 minutes offers Rejoin; a join the server refuses shows the translated copy', async () => {
    const startsAt = Date.now() - 11 * 60_000;
    const sent = serve({
      'GET /api/appointments/appt_1': () =>
        json(
          200,
          appointment({
            status: 'confirmed',
            startsAt: new Date(startsAt).toISOString(),
            endsAt: new Date(startsAt + 50 * 60_000).toISOString(),
          }),
        ),
      'POST /api/appointments/appt_1/join': () => json(403, { code: 'join_window_closed', message: 'English text for developers' }),
    });
    renderAt('/consultations/appt_1');
    const user = userEvent.setup();

    const rejoin = await screen.findByRole('button', { name: en.join.rejoin }, { timeout: 5000 });
    expect(screen.getByText(/^If you already joined this session, you can rejoin until /)).toBeInTheDocument();
    expect(screen.queryByText(en.join.windowClosed)).not.toBeInTheDocument();
    await user.click(rejoin);

    const join = await screen.findByRole('button', { name: en.prejoin.joinNow }, { timeout: 5000 });
    await waitFor(() => expect(join).toBeEnabled());
    await user.click(join);
    expect(await screen.findByText(en.errors.joinWindowClosed)).toBeInTheDocument();
    expect(screen.queryByText('English text for developers')).not.toBeInTheDocument();
    expect(sent.some((s) => s.method === 'POST' && s.path === '/api/appointments/appt_1/join')).toBe(true);
  }, 15_000);

  it('after "End for everyone" shows the post-call state with no Join behind the outcome dialog', async () => {
    const startsAt = Date.now() + 5 * 60_000;
    const consultation = appointment({
      status: 'confirmed',
      startsAt: new Date(startsAt).toISOString(),
      endsAt: new Date(startsAt + 50 * 60_000).toISOString(),
    });
    const sent = serve({
      'GET /api/appointments/appt_1': () => json(200, consultation),
      'POST /api/appointments/appt_1/join': () =>
        json(200, {
          sessionId: 'sess_1',
          participantId: 'part_1',
          role: 'expert',
          format: 'consultation',
          startsAt: consultation.startsAt,
          endsAt: consultation.endsAt,
          meeting: {
            MeetingId: 'meeting_1',
            MediaRegion: 'eu-central-1',
            MediaPlacement: { AudioHostUrl: 'audio:3478', AudioFallbackUrl: 'wss://fallback', SignalingUrl: 'wss://signal' },
          },
          attendee: { AttendeeId: 'att_1', ExternalUserId: 'part_1', JoinToken: 'join-token' },
        }),
      'POST /api/appointments/appt_1/end': () => new Response(null, { status: 204 }),
    });
    renderAt('/consultations/appt_1');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: en.join.button }, { timeout: 5000 }));
    const join = await screen.findByRole('button', { name: en.prejoin.joinNow }, { timeout: 5000 });
    await waitFor(() => expect(join).toBeEnabled());
    await user.click(join);
    await user.click(await screen.findByRole('button', { name: en.controls.endForEveryone }, { timeout: 5000 }));
    await user.click(await screen.findByRole('button', { name: en.consultation.end }));

    expect(await screen.findByRole('dialog', { name: en.outcome.title }, { timeout: 5000 })).toBeInTheDocument();
    expect(sent.some((s) => s.method === 'POST' && s.path === '/api/appointments/appt_1/end')).toBe(true);
    expect(screen.getByText(en.postCall.ended)).toBeInTheDocument();
    // Behind the modal too: neither Join nor Rejoin is offered once the session is ended.
    expect(screen.queryByRole('button', { name: en.join.button, hidden: true })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: en.join.rejoin, hidden: true })).not.toBeInTheDocument();
  }, 20_000);

  it('keeps the employee name after the outcome is recorded, and reads the consultation again', async () => {
    const startsAt = Date.now() - 5 * 60_000;
    const consultation = appointment({
      status: 'confirmed',
      startsAt: new Date(startsAt).toISOString(),
      endsAt: new Date(startsAt + 50 * 60_000).toISOString(),
    });
    // The outcome answers the appointment without the participants' names.
    const { expert: _expert, employee: _employee, ...bare } = consultation;
    let detailReads = 0;
    const sent = serve({
      // The refetch never answers here: what the page shows meanwhile is the merged detail.
      'GET /api/appointments/appt_1': () => (++detailReads === 1 ? json(200, consultation) : new Promise<Response>(() => undefined)),
      'POST /api/appointments/appt_1/outcome': () => json(200, { ...bare, status: 'completed' }),
    });
    renderAt('/consultations/appt_1');
    const user = userEvent.setup();
    const employeeName = () => screen.getByText(en.consultations.columns.employee, { selector: 'dt' }).nextElementSibling;

    await user.click(await screen.findByRole('button', { name: en.consultations.recordOutcome }, { timeout: 5000 }));
    expect(employeeName()).toHaveTextContent('Jovan');
    const dialog = await screen.findByRole('dialog', { name: en.outcome.title });
    await user.click(within(dialog).getByRole('radio', { name: en.outcome.status.completed }));
    await user.click(within(dialog).getByRole('button', { name: en.outcome.submit }));

    expect(await screen.findByText(en.consultations.outcomeRecorded.replace('{{status}}', en.outcome.status.completed))).toBeInTheDocument();
    expect(sent.some((s) => s.method === 'POST' && s.path === '/api/appointments/appt_1/outcome')).toBe(true);
    // Not "Employee: Employee": the name the page loaded stays, with the new status.
    expect(employeeName()).toHaveTextContent(/^Jovan$/);
    expect(screen.getByText(en.appointments.details.status, { selector: 'dt' }).nextElementSibling).toHaveTextContent(en.appointments.status.completed);
    await waitFor(() => expect(detailReads).toBe(2));
  });

  it('says a scheduled follow-up waiting for approval is waiting', async () => {
    serve({ 'GET /api/appointments/appt_2': () => json(200, followUp({ status: 'awaiting_approval' })) });
    renderAt('/consultations/appt_2');
    expect(await screen.findByText(en.followUp.awaitingApprovalExpert, {}, { timeout: 5000 })).toBeInTheDocument();
  });

  it('hides Join once the session was ended for everyone', async () => {
    const startsAt = Date.now() - 5 * 60_000;
    serve({
      'GET /api/appointments/appt_1': () =>
        json(
          200,
          appointment({
            status: 'confirmed',
            startsAt: new Date(startsAt).toISOString(),
            endsAt: new Date(startsAt + 50 * 60_000).toISOString(),
            viewer: { hasJoined: true, sessionEnded: true },
          }),
        ),
    });
    renderAt('/consultations/appt_1');
    expect(await screen.findByText(en.postCall.ended, {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: en.join.button })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: en.join.rejoin })).not.toBeInTheDocument();
  });

  it('asks for the past consultations newest first', async () => {
    const sent = serve({ 'GET /api/appointments': () => json(200, { items: [appointment()], nextCursor: null }) });
    renderAt('/consultations');
    await screen.findByRole('table', {}, { timeout: 5000 });
    const searches = sent.filter((s) => s.path === '/api/appointments').map((s) => new URLSearchParams(s.search));
    expect(searches.some((q) => q.has('to') && q.get('order') === 'desc')).toBe(true);
    expect(searches.some((q) => q.has('from') && q.get('order') === 'asc')).toBe(true);
  });
});
