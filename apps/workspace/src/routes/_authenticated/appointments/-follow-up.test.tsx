/**
 * Follow-ups on the appointment list and page in API mode (T-CW-1.9,
 * CALL-36 to CALL-38, CALL-42): the list badge and the expert's first name,
 * the employee's card on a proposal (confirm, suggest other times, decline),
 * the waiting-for-approval state, and every failure as translated copy. The
 * user room listener of the layout gets a stub whose handlers the test calls
 * as the server would.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { UserRoomHandlers } from '@nestself/api-client';
import { SAMPLE_PRINCIPALS } from '@nestself/sample-data';
import en from '@nestself/i18n/locales/en/calls.json';
import common from '@nestself/i18n/locales/en/common.json';

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

const userRoom = vi.hoisted(() => ({ handlers: null as UserRoomHandlers | null }));
vi.mock('../../../calls/user-room-client', () => ({
  userRoomClient: {
    subscribe: (_userId: string, handlers: UserRoomHandlers) => {
      userRoom.handlers = handlers;
      return () => {
        userRoom.handlers = null;
      };
    },
  },
}));

import { routeTree } from '../../../routeTree.gen';
import { api } from '../../../api';
import { initialSnapshot } from '../../../auth';

const DAY = 24 * 60 * 60_000;
const employee = SAMPLE_PRINCIPALS.employee;

function followUp(overrides: Record<string, unknown> = {}) {
  const startsAt = new Date(Date.now() + 7 * DAY);
  startsAt.setUTCHours(14, 0, 0, 0);
  return {
    id: 'appt_2',
    orgId: 'org_sample',
    expertUserId: 'user_milica',
    employeeUserId: employee.principal.userId,
    startsAt: startsAt.toISOString(),
    endsAt: new Date(startsAt.getTime() + 50 * 60_000).toISOString(),
    status: 'proposed',
    serviceCategory: 'psychological',
    timeZone: 'Europe/Belgrade',
    fundingRef: null,
    followUpOf: 'appt_1',
    expert: { firstName: 'Milica' },
    employee: { firstName: 'Jovan' },
    ...overrides,
  };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

interface Sent {
  method: string;
  path: string;
  body: unknown;
}

function serve(routes: Record<string, () => Response>): Sent[] {
  const sent: Sent[] = [];
  fetchMock.mockImplementation((input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://localhost');
    const method = init?.method ?? 'GET';
    sent.push({ method, path: url.pathname, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
    if (url.pathname === '/api/auth/me') return Promise.resolve(json(200, { principal: employee.principal, effectiveActions: employee.effectiveActions }));
    const handler = routes[`${method} ${url.pathname}`];
    return Promise.resolve(handler ? handler() : json(404, { code: 'not_found', message: 'Not found' }));
  });
  return sent;
}

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree,
    context: { queryClient, auth: { principal: null, effectiveActions: [], settled: false, ensure: () => initialSnapshot(api) } },
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

describe('follow-ups on the appointment pages (API mode)', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });
  afterEach(() => cleanup());

  it('lists a proposal with its badge and the expert’s first name, and refreshes when one arrives on the user room', async () => {
    let items: unknown[] = [];
    const sent = serve({ 'GET /api/appointments': () => json(200, { items, nextCursor: null }) });
    renderAt('/appointments');
    expect(await screen.findByText(common.state.empty.title, {}, { timeout: 5000 })).toBeInTheDocument();

    items = [followUp()];
    await waitFor(() => expect(userRoom.handlers).not.toBeNull());
    act(() =>
      userRoom.handlers?.onFollowUpProposed?.({ appointmentId: 'appt_1', followUpId: 'appt_2', startsAt: followUp().startsAt, durationMinutes: 50 }),
    );
    const upcoming = await screen.findByRole('region', { name: en.appointments.upcoming });
    const [row] = within(upcoming).getAllByRole('listitem');
    expect(within(row!).getByText(en.followUp.proposed)).toBeInTheDocument();
    expect(within(row!).getByText(en.appointments.withExpert.replace('{{name}}', 'Milica'))).toBeInTheDocument();
    expect(sent.filter((s) => s.path === '/api/appointments').length).toBeGreaterThanOrEqual(2);
  });

  it('confirms a proposal under the automatic policy', async () => {
    const sent = serve({
      'GET /api/appointments/appt_2': () => json(200, followUp()),
      'POST /api/appointments/appt_2/confirm': () => json(200, followUp({ status: 'confirmed' })),
    });
    renderAt('/appointments/appt_2');
    const user = userEvent.setup();

    expect(await screen.findByRole('heading', { name: en.followUp.employeeTitle }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText('Milica')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: en.followUp.confirm }));
    expect(await screen.findByText(/^Your follow-up is booked for /)).toBeInTheDocument();
    expect(sent.find((s) => s.path === '/api/appointments/appt_2/confirm')).toMatchObject({ method: 'POST', body: {} });
  });

  it('suggests other times', async () => {
    const sent = serve({
      'GET /api/appointments/appt_2': () => json(200, followUp()),
      'POST /api/appointments/appt_2/suggest-times': () => json(200, followUp()),
    });
    renderAt('/appointments/appt_2');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: en.followUp.suggestTimes }, { timeout: 5000 }));
    const form = await screen.findByRole('group', { name: en.followUp.suggestTitle });
    const window = within(form).getByRole('group', { name: en.followUp.window.replace('{{index}}', '1') });
    fireEvent.change(within(window).getByLabelText(en.followUp.date), { target: { value: '2030-03-05' } });
    fireEvent.change(within(window).getByLabelText(en.followUp.from), { target: { value: '09:00' } });
    fireEvent.change(within(window).getByLabelText(en.followUp.to), { target: { value: '11:00' } });
    await user.click(within(form).getByRole('button', { name: en.followUp.sendSuggestions }));

    expect(await screen.findByText(en.followUp.timesSuggested)).toBeInTheDocument();
    expect(sent.find((s) => s.path === '/api/appointments/appt_2/suggest-times')?.body).toEqual({
      windows: [{ startsAt: '2030-03-05T08:00:00.000Z', endsAt: '2030-03-05T10:00:00.000Z' }],
    });
  });

  it.each([
    ['appointment_not_proposed', 409, en.errors.appointmentNotProposed],
    ['approver_missing', 409, en.errors.approverMissing],
    ['code_from_the_future', 500, en.errors.unknown],
  ])('renders %s as translated copy on the card', async (code, status, message) => {
    serve({
      'GET /api/appointments/appt_2': () => json(200, followUp()),
      'POST /api/appointments/appt_2/decline': () => json(status, { code, message: 'English text for developers' }),
    });
    renderAt('/appointments/appt_2');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: en.followUp.decline }, { timeout: 5000 }));
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.queryByText('English text for developers')).not.toBeInTheDocument();
  });

  it('declines a proposal', async () => {
    serve({
      'GET /api/appointments/appt_2': () => json(200, followUp()),
      'POST /api/appointments/appt_2/decline': () => json(200, followUp({ status: 'declined' })),
    });
    renderAt('/appointments/appt_2');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: en.followUp.decline }, { timeout: 5000 }));
    expect(await screen.findByText(en.followUp.declinedByYou)).toBeInTheDocument();
  });

  it('says a confirmed proposal is waiting for approval', async () => {
    serve({ 'GET /api/appointments/appt_2': () => json(200, followUp({ status: 'awaiting_approval' })) });
    renderAt('/appointments/appt_2');
    expect(await screen.findByText(en.followUp.awaitingApprovalBody, {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: en.followUp.confirm })).not.toBeInTheDocument();
  });
});
