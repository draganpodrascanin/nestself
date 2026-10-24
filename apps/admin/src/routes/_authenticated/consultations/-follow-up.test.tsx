/**
 * The expert's follow-up pages in API mode (T-CW-1.9, CALL-35, CALL-37):
 * the employee's first name in the list and on the page, the state of a
 * follow-up already proposed after a completed consultation, picking one of
 * the employee's suggested windows, and every failure as translated copy.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
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
  body: unknown;
}

function serve(routes: Record<string, () => Response>): Sent[] {
  const sent: Sent[] = [];
  fetchMock.mockImplementation((input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://localhost');
    const method = init?.method ?? 'GET';
    sent.push({ method, path: url.pathname, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
    if (url.pathname === '/api/auth/me') return Promise.resolve(json(200, { principal: expert.principal, effectiveActions: expert.effectiveActions }));
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

describe("the expert's follow-ups (API mode)", () => {
  beforeEach(async () => {
    fetchMock.mockReset();
    await i18n.changeLanguage('en');
  });
  afterEach(() => {
    cleanup();
  });

  it('names the employee by first name in the list', async () => {
    serve({ 'GET /api/appointments': () => json(200, { items: [appointment()], nextCursor: null }) });
    renderAt('/consultations');
    const table = await screen.findByRole('table', {}, { timeout: 5000 });
    expect(within(table).getByRole('link', { name: 'Jovan' })).toHaveAttribute('href', '/consultations/appt_1');
  });

  it('shows the follow-up already proposed after a completed consultation, with a link to it', async () => {
    serve({
      'GET /api/appointments/appt_1': () => json(200, appointment()),
      'GET /api/appointments': () => json(200, { items: [followUp()], nextCursor: null }),
    });
    renderAt('/consultations/appt_1');
    expect(await screen.findByText(en.followUp.waitingForEmployee, {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText('Jovan')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: en.followUp.openFollowUp })).toHaveAttribute('href', '/consultations/appt_2');
    expect(screen.queryByRole('button', { name: en.followUp.send })).not.toBeInTheDocument();
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

  it('says a scheduled follow-up waiting for approval is waiting', async () => {
    serve({ 'GET /api/appointments/appt_2': () => json(200, followUp({ status: 'awaiting_approval' })) });
    renderAt('/consultations/appt_2');
    expect(await screen.findByText(en.followUp.awaitingApprovalExpert, {}, { timeout: 5000 })).toBeInTheDocument();
  });
});
