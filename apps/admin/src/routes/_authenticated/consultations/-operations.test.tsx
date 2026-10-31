/**
 * Operations and support in the admin app, API mode (CALL-26, CALL-27,
 * CALL-28, CALL-16, PLT-05): booking a consultation with the API's refusals
 * on the fields, the read-only view with Cancel, and the call diagnostics
 * screen with the problem reports (and their 404 for an assignment-scoped
 * operator).
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
const operations = SAMPLE_PRINCIPALS.operations;

function appointment(overrides: Record<string, unknown> = {}) {
  const startsAt = new Date(Date.now() + 3 * DAY);
  startsAt.setUTCHours(9, 0, 0, 0);
  return {
    id: 'appt_1',
    orgId: 'org_1',
    expertUserId: 'user_milica',
    employeeUserId: 'user_jovan',
    startsAt: startsAt.toISOString(),
    endsAt: new Date(startsAt.getTime() + 50 * 60_000).toISOString(),
    status: 'confirmed',
    serviceCategory: 'psychological',
    timeZone: 'Europe/Belgrade',
    fundingRef: null,
    followUpOf: null,
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

function serve(routes: Record<string, () => Response>): Sent[] {
  const sent: Sent[] = [];
  fetchMock.mockImplementation((input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://localhost');
    const method = init?.method ?? 'GET';
    sent.push({ method, path: url.pathname, search: url.search, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
    if (url.pathname === '/api/auth/me') return Promise.resolve(json(200, { principal: operations.principal, effectiveActions: operations.effectiveActions }));
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

async function fillBooking(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByRole('textbox', { name: new RegExp(en.create.organisationId) }, { timeout: 5000 }), 'org_1');
  await user.type(screen.getByRole('textbox', { name: new RegExp(en.create.employeeId) }), 'user_jovan');
  await user.type(screen.getByRole('textbox', { name: new RegExp(en.create.expertId) }), 'user_milica');
  await user.type(screen.getByLabelText(new RegExp(en.create.date)), '2030-03-04');
  await user.type(screen.getByLabelText(new RegExp(en.create.start)), '10:00');
  await user.type(screen.getByLabelText(new RegExp(en.create.end)), '10:50');
}

describe('operations and support (API mode)', { timeout: 20_000 }, () => {
  beforeEach(async () => {
    fetchMock.mockReset();
    await i18n.changeLanguage('en');
  });
  afterEach(() => cleanup());

  it('books a consultation in the organisation zone (CALL-26)', async () => {
    const sent = serve({ 'POST /api/orgs/org_1/appointments': () => json(201, appointment({ startsAt: '2030-03-04T09:00:00.000Z' })) });
    const user = userEvent.setup();
    renderAt('/consultations/new');
    await fillBooking(user);
    await user.click(screen.getByRole('button', { name: en.create.submit }));

    expect(await screen.findByText(/^Consultation booked for /)).toBeInTheDocument();
    expect(sent.find((s) => s.method === 'POST')).toMatchObject({
      path: '/api/orgs/org_1/appointments',
      body: {
        orgId: 'org_1',
        employeeUserId: 'user_jovan',
        expertUserId: 'user_milica',
        serviceCategory: 'psychological',
        // 10:00 in Belgrade in March is 09:00 UTC.
        startsAt: '2030-03-04T09:00:00.000Z',
        endsAt: '2030-03-04T09:50:00.000Z',
        timeZone: 'Europe/Belgrade',
      },
    });
  });

  it('asks for the missing fields before sending', async () => {
    const sent = serve({});
    const user = userEvent.setup();
    renderAt('/consultations/new');
    await user.click(await screen.findByRole('button', { name: en.create.submit }, { timeout: 5000 }));
    expect((await screen.findAllByText(en.create.errors.required)).length).toBeGreaterThan(0);
    expect(sent.some((s) => s.method === 'POST')).toBe(false);
  });

  it.each([
    [400, { code: 'validation', message: 'English', details: { field: 'expertUserId' } }, en.create.errors.expertCategory],
    [409, { code: 'subject_not_member', message: 'English', details: { field: 'employeeUserId' } }, en.create.errors.notMember],
  ])('renders a refused booking (%i) on its field', async (status, body, message) => {
    serve({ 'POST /api/orgs/org_1/appointments': () => json(status, body) });
    const user = userEvent.setup();
    renderAt('/consultations/new');
    await fillBooking(user);
    await user.click(screen.getByRole('button', { name: en.create.submit }));
    expect((await screen.findAllByText(message)).length).toBeGreaterThan(0);
  });

  it('opens a read-only view from the list and cancels for operations (CALL-27, CALL-28)', async () => {
    const sent = serve({
      'GET /api/ops/orgs': () => json(200, { items: [{ id: 'org_1', name: 'Example d.o.o.' }] }),
      'GET /api/appointments': () => json(200, { items: [appointment({ orgName: 'Example d.o.o.' })], nextCursor: null }),
      'POST /api/appointments/appt_1/cancel': () => json(200, appointment({ status: 'canceled' })),
    });
    const user = userEvent.setup();
    renderAt('/consultations');
    const table = await screen.findByRole('table', {}, { timeout: 5000 });
    expect(within(table).getByText('Milica')).toBeInTheDocument();
    expect(within(table).getByText('Example d.o.o.')).toBeInTheDocument();
    await user.click(within(table).getByRole('link', { name: en.consultations.view }));

    expect(await screen.findByText(en.consultations.readOnly)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: en.cancel.button }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: en.cancel.confirm }));
    expect(await screen.findByText(en.cancel.done)).toBeInTheDocument();
    expect(sent.some((s) => s.method === 'POST' && s.path === '/api/appointments/appt_1/cancel')).toBe(true);
    // Operations list newest first by default.
    expect(new URLSearchParams(sent.find((s) => s.path === '/api/appointments')?.search).get('order')).toBe('desc');
  });

  it('sends the list filters to the API (CALL-28)', async () => {
    const sent = serve({ 'GET /api/appointments': () => json(200, { items: [appointment()], nextCursor: null }) });
    const user = userEvent.setup();
    renderAt('/consultations');
    await screen.findByRole('table', {}, { timeout: 5000 });
    await user.type(screen.getByLabelText(en.consultations.filters.from), '2030-01-01');
    await user.click(screen.getByRole('button', { name: en.consultations.filters.apply }));
    await waitFor(() => expect(sent.some((s) => s.path === '/api/appointments' && s.search.includes('from='))).toBe(true));
  });

  it('looks up a session, lists problem reports and opens one (PLT-05, CALL-16)', async () => {
    const report = {
      sessionId: 'sess_9',
      appointmentId: 'appt_1',
      reportedAt: '2030-01-20T10:00:00.000Z',
      role: 'employee',
      category: 'audio',
      summary: { durationMs: 1_200_000, reconnectCount: 2 },
    };
    const diagnostics = {
      sessionId: 'sess_9',
      appointmentId: 'appt_1',
      webinarId: null,
      startedAt: '2030-01-20T09:00:00.000Z',
      endedAt: '2030-01-20T09:48:00.000Z',
      status: 'ended',
      provider: 'chime',
      providerMeetingId: 'meeting_9',
      participants: [
        { role: 'employee', joinedAt: '2030-01-20T09:01:00.000Z', leftAt: null, reconnectCount: 2, qualityMetrics: { rtt: 400 }, errorCodes: ['audioInputFailed'], browser: 'chrome', os: 'mac' },
      ],
      problemReports: [{ category: 'video', reportedAt: '2030-01-20T09:30:00.000Z', role: 'expert' }],
    };
    const sent = serve({
      'GET /api/ops/calls/problem-reports': () => json(200, { items: [report], nextCursor: null }),
      'GET /api/ops/calls/sess_9/diagnostics': () => json(200, diagnostics),
    });
    const user = userEvent.setup();
    renderAt('/support/calls');
    const reports = await screen.findByRole('table', { name: en.supportCalls.reportsTitle }, { timeout: 5000 });
    expect(within(reports).getByText(en.report.categories.audio)).toBeInTheDocument();
    expect(within(reports).getByText('20 minutes, 2 reconnections')).toBeInTheDocument();
    await user.click(within(reports).getByRole('button', { name: en.supportCalls.openDiagnostics }));

    expect(await screen.findByRole('heading', { name: 'Session sess_9' })).toBeInTheDocument();
    expect(screen.getByText('meeting_9')).toBeInTheDocument();
    expect(screen.getByText('audioInputFailed')).toBeInTheDocument();
    const sessionReports = screen.getByRole('table', { name: en.supportCalls.sessionReportsCaption.replace('{{id}}', 'sess_9') });
    expect(within(sessionReports).getByText(en.report.categories.video)).toBeInTheDocument();
    expect(within(sessionReports).getByText(en.supportCalls.roles.expert)).toBeInTheDocument();
    expect(sent.some((s) => s.path === '/api/ops/calls/sess_9/diagnostics')).toBe(true);
  });

  it('explains an unknown session and the problem-report listing an assignment-scoped operator cannot read', async () => {
    serve({});
    const user = userEvent.setup();
    renderAt('/support/calls');
    expect(await screen.findByText(en.supportCalls.reportsUnavailable, {}, { timeout: 5000 })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: en.supportCalls.lookup }));
    expect(await screen.findByText(en.supportCalls.required)).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: en.supportCalls.sessionId }), 'sess_missing');
    await user.click(screen.getByRole('button', { name: en.supportCalls.lookup }));
    expect(await screen.findByText(en.supportCalls.notFound)).toBeInTheDocument();
  });

  it('offers New consultation only with an organisation to book for, and picks organisation and expert from the lists', async () => {
    serve({ 'GET /api/ops/orgs': () => json(200, { items: [] }), 'GET /api/appointments': () => json(200, { items: [], nextCursor: null }) });
    renderAt('/consultations');
    await screen.findByText(en.consultations.operationsNote, {}, { timeout: 5000 });
    expect(screen.queryByRole('link', { name: en.consultations.newConsultation })).not.toBeInTheDocument();
    cleanup();

    const sent = serve({
      'GET /api/ops/orgs': () => json(200, { items: [{ id: 'org_1', name: 'Example d.o.o.' }] }),
      'GET /api/ops/appointment-experts': () => json(200, { items: [{ userId: 'user_milica', displayName: 'Milica Ristić' }] }),
      'GET /api/appointments': () => json(200, { items: [], nextCursor: null }),
    });
    const user = userEvent.setup();
    renderAt('/consultations');
    await user.click(await screen.findByRole('link', { name: en.consultations.newConsultation }, { timeout: 5000 }));
    // Pickers, not the ids-only fallback.
    expect(await screen.findByText(en.create.chooseOrganisation)).toBeInTheDocument();
    expect(await screen.findByText(en.create.chooseExpert)).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: new RegExp(en.create.organisationId) })).not.toBeInTheDocument();
    expect(new URLSearchParams(sent.find((s) => s.path === '/api/ops/appointment-experts')?.search).get('serviceCategory')).toBe('psychological');
  });
});
