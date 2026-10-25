/**
 * The M1 completion on the employee's pages in API mode: the home page's
 * next appointment (CALL-02), Cancel (CALL-27), the approver's decline
 * reason and a lapsed approval (CALL-39), and the closed join window with
 * the technical support contact for someone who never joined (CALL-07).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { UserRoomHandlers } from '@nestself/api-client';
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
  search: string;
  body: unknown;
}

function serve(routes: Record<string, () => Response>, me: { principal: unknown; effectiveActions: readonly string[] } = employee): Sent[] {
  const sent: Sent[] = [];
  fetchMock.mockImplementation((input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://localhost');
    const method = init?.method ?? 'GET';
    sent.push({ method, path: url.pathname, search: url.search, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
    if (url.pathname === '/api/auth/me') return Promise.resolve(json(200, { principal: me.principal, effectiveActions: me.effectiveActions }));
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


const MINUTE = 60_000;

function appointment(overrides: Record<string, unknown> = {}) {
  return followUp({ id: 'appt_1', status: 'confirmed', followUpOf: null, ...overrides });
}

describe('appointment pages, M1 completion (API mode)', { timeout: 20_000 }, () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });
  afterEach(() => cleanup());

  it('shows the next confirmed appointment on the home page, linked to its page (CALL-02)', async () => {
    serve({
      'GET /api/appointments': () =>
        json(200, { items: [appointment({ id: 'appt_next' }), appointment({ id: 'appt_proposal', status: 'proposed' })], nextCursor: null }),
    });
    renderAt('/');
    const link = await screen.findByRole('link', { name: en.appointments.openNext }, { timeout: 5000 });
    expect(link).toHaveAttribute('href', '/appointments/appt_next');
    expect(screen.getByText('With Milica')).toBeInTheDocument();
  });

  it('says so on the home page when the next appointment cannot be loaded', async () => {
    serve({ 'GET /api/appointments': () => json(503, { code: 'unavailable', message: 'English' }) });
    renderAt('/');
    expect(await screen.findByText(new RegExp(en.appointments.nextLoadFailed), {}, { timeout: 5000 })).toBeInTheDocument();
  });

  it('cancels a confirmed appointment after the confirmation dialog (CALL-27)', async () => {
    const sent = serve({
      'GET /api/appointments/appt_1': () => json(200, appointment()),
      'POST /api/appointments/appt_1/cancel': () => json(200, appointment({ status: 'canceled' })),
    });
    const user = userEvent.setup();
    renderAt('/appointments/appt_1');
    await user.click(await screen.findByRole('button', { name: en.cancel.button }, { timeout: 5000 }));
    const dialog = await screen.findByRole('alertdialog', { name: en.cancel.title });
    await user.click(within(dialog).getByRole('button', { name: en.cancel.confirm }));

    expect(await screen.findByText(en.cancel.done)).toBeInTheDocument();
    expect(sent.some((s) => s.method === 'POST' && s.path === '/api/appointments/appt_1/cancel')).toBe(true);
  });

  it('renders a refused cancel as translated copy', async () => {
    serve({
      'GET /api/appointments/appt_1': () => json(200, appointment()),
      'POST /api/appointments/appt_1/cancel': () => json(409, { code: 'appointment_not_joinable', message: 'English' }),
    });
    const user = userEvent.setup();
    renderAt('/appointments/appt_1');
    await user.click(await screen.findByRole('button', { name: en.cancel.button }, { timeout: 5000 }));
    const dialog = await screen.findByRole('alertdialog', { name: en.cancel.title });
    await user.click(within(dialog).getByRole('button', { name: en.cancel.keep }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: en.cancel.button }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: en.cancel.confirm }));
    expect(await screen.findByText(en.errors.appointmentNotJoinable)).toBeInTheDocument();
  });

  it("shows the manager's reason on a declined follow-up, and a lapsed approval (CALL-39)", async () => {
    serve({
      'GET /api/appointments/appt_2': () =>
        json(200, followUp({ status: 'declined', approvalOutcome: 'rejected', declineReason: 'Please book it after the audit week.' })),
      'GET /api/appointments/appt_3': () => json(200, followUp({ id: 'appt_3', status: 'declined', approvalOutcome: 'expired' })),
    });
    renderAt('/appointments/appt_2');
    expect(await screen.findByText('Your manager declined this follow-up: Please book it after the audit week.', {}, { timeout: 5000 })).toBeInTheDocument();
    cleanup();

    renderAt('/appointments/appt_3');
    expect(await screen.findByText(en.followUp.approvalExpired, {}, { timeout: 5000 })).toBeInTheDocument();
  });

  it('shows someone who never joined the closed window with the technical support contact (CALL-07)', async () => {
    const startsAt = Date.now() - 11 * MINUTE;
    serve({
      'GET /api/appointments/appt_1': () =>
        json(
          200,
          appointment({
            startsAt: new Date(startsAt).toISOString(),
            endsAt: new Date(startsAt + 50 * MINUTE).toISOString(),
            viewer: { hasJoined: false, sessionEnded: false },
          }),
        ),
    });
    renderAt('/appointments/appt_1');
    expect(await screen.findByText(en.join.windowClosed, {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: en.support.technicalContact.replace('{{email}}', 'support@nestself.example') })).toHaveAttribute(
      'href',
      'mailto:support@nestself.example',
    );
    expect(screen.queryByRole('link', { name: en.join.rejoin })).not.toBeInTheDocument();
  });

  it('offers the rejoin to someone the API says already joined', async () => {
    const startsAt = Date.now() - 11 * MINUTE;
    serve({
      'GET /api/appointments/appt_1': () =>
        json(
          200,
          appointment({ startsAt: new Date(startsAt).toISOString(), endsAt: new Date(startsAt + 50 * MINUTE).toISOString(), viewer: { hasJoined: true, sessionEnded: false } }),
        ),
    });
    renderAt('/appointments/appt_1');
    expect(await screen.findByRole('link', { name: en.join.button }, { timeout: 5000 })).toHaveAttribute('href', '/call/appt_1');
    expect(screen.queryByText(en.join.windowClosed)).not.toBeInTheDocument();
  });

  it('hides Appointments and the next appointment from a principal without consultation.join', async () => {
    const hr = SAMPLE_PRINCIPALS.hr_admin;
    const sent = serve({}, { principal: hr.principal, effectiveActions: hr.effectiveActions.filter((action) => action !== 'consultation.join') });
    renderAt('/');
    expect(await screen.findByRole('heading', { level: 1 }, { timeout: 5000 })).toBeInTheDocument();
    await screen.findAllByRole('link', { name: 'Support' });
    expect(screen.queryByRole('link', { name: 'Appointments' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Your next appointment' })).not.toBeInTheDocument();
    expect(sent.some((s) => s.path === '/api/appointments')).toBe(false);
  });

  it('lists upcoming appointments ascending and past ones descending (two queries)', async () => {
    const sent = serve({ 'GET /api/appointments': () => json(200, { items: [], nextCursor: null }) });
    renderAt('/appointments');
    await waitFor(() => expect(sent.filter((s) => s.path === '/api/appointments')).toHaveLength(2));
    const searches = sent.filter((s) => s.path === '/api/appointments').map((s) => new URLSearchParams(s.search));
    expect(searches.some((q) => q.get('order') === 'asc' && q.has('from'))).toBe(true);
    expect(searches.some((q) => q.get('order') === 'desc' && q.has('to'))).toBe(true);
  });

  it('offers neither Join nor Rejoin once the session was ended for everyone', async () => {
    const startsAt = Date.now() - 5 * MINUTE;
    serve({
      'GET /api/appointments/appt_1': () =>
        json(
          200,
          appointment({ startsAt: new Date(startsAt).toISOString(), endsAt: new Date(startsAt + 50 * MINUTE).toISOString(), viewer: { hasJoined: true, sessionEnded: true } }),
        ),
    });
    renderAt('/appointments/appt_1');
    expect(await screen.findByText(en.consultation.sessionEnded, {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: en.join.button })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: en.join.rejoin })).not.toBeInTheDocument();
  });
});
