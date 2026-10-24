/**
 * The call route in API mode (T-CW-1.5): join failures render translated
 * copy, a closed window explains itself, a successful join reaches the call
 * and the post-call feedback posts to the API. The Chime controller is
 * replaced by `FakeCallSessionController`; the call room by the no-op client.
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

vi.mock('../../data-source', () => ({
  dataSource: 'api',
  isSampleDataMode: false,
  resolveDataSource: () => 'api',
}));

vi.mock('../../calls/use-consultation-controller', async () => {
  const { useState } = await import('react');
  const { FakeCallSessionController } = await import('@nestself/video');
  return {
    useConsultationController: () => useState(() => new FakeCallSessionController({ role: 'employee' }))[0],
  };
});

vi.mock('../../calls/call-room-client', async () => {
  const { noopCallRoomClient } = await import('@nestself/api-client');
  return { callRoomClient: noopCallRoomClient };
});

import { routeTree } from '../../routeTree.gen';
import { api } from '../../api';
import { initialSnapshot } from '../../auth';

const MINUTE = 60_000;
const employee = SAMPLE_PRINCIPALS.employee;

function appointmentAt(startsAt: number, overrides: Record<string, unknown> = {}) {
  return {
    id: 'appt_1',
    orgId: 'org_sample',
    expertUserId: 'user_milica',
    employeeUserId: employee.principal.userId,
    startsAt: new Date(startsAt).toISOString(),
    endsAt: new Date(startsAt + 50 * MINUTE).toISOString(),
    status: 'confirmed',
    serviceCategory: 'legal',
    timeZone: 'Europe/Belgrade',
    fundingRef: null,
    followUpOf: null,
    ...overrides,
  };
}

function joinResponse(appointment: ReturnType<typeof appointmentAt>) {
  return {
    sessionId: 'sess_1',
    participantId: 'part_1',
    role: 'employee',
    format: 'consultation',
    startsAt: appointment.startsAt,
    endsAt: appointment.endsAt,
    meeting: {
      MeetingId: 'meeting_1',
      MediaRegion: 'eu-central-1',
      MediaPlacement: { AudioHostUrl: 'audio:3478', AudioFallbackUrl: 'wss://fallback', SignalingUrl: 'wss://signal' },
    },
    attendee: { AttendeeId: 'att_1', ExternalUserId: 'part_1', JoinToken: 'join-token' },
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
    if (handler) return Promise.resolve(handler());
    if (url.pathname.endsWith('/client-events')) return Promise.resolve(new Response(null, { status: 204 }));
    return Promise.resolve(json(404, { code: 'not_found', message: 'Not found' }));
  });
  return sent;
}

function renderCall(path = '/call/appt_1') {
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

async function readyToJoin() {
  await screen.findByRole('heading', { name: en.call.title }, { timeout: 5000 });
  const join = await screen.findByRole('button', { name: en.prejoin.joinNow });
  await waitFor(() => expect(join).toBeEnabled());
  return join;
}

describe('call route (API mode)', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });
  afterEach(() => cleanup());

  it.each([
    ['join_window_closed', 403, en.errors.joinWindowClosed],
    ['appointment_not_joinable', 409, en.errors.appointmentNotJoinable],
    ['code_from_the_future', 500, en.errors.unknown],
  ])('renders the translated message when the join fails with %s', async (code, status, message) => {
    const appointment = appointmentAt(Date.now() + 5 * MINUTE);
    serve({
      'GET /api/appointments/appt_1': () => json(200, appointment),
      'POST /api/appointments/appt_1/join': () => json(status, { code, message: 'English text for developers' }),
    });
    renderCall();
    const user = userEvent.setup();
    await user.click(await readyToJoin());

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.queryByText('English text for developers')).not.toBeInTheDocument();
  });

  it('explains a closed join window with a support link and offers no join', async () => {
    serve({ 'GET /api/appointments/appt_1': () => json(200, appointmentAt(Date.now() - 3 * 60 * MINUTE)) });
    renderCall();

    expect(await screen.findByText(en.join.windowClosed, {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: en.join.contactSupport })).toHaveAttribute('href', '/support');
    expect(screen.queryByRole('button', { name: en.prejoin.joinNow })).not.toBeInTheDocument();
  });

  it('says when to come back before the window opens', async () => {
    serve({ 'GET /api/appointments/appt_1': () => json(200, appointmentAt(Date.now() + 2 * 60 * MINUTE)) });
    renderCall();

    expect(await screen.findByText(/^Come back at /, {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: en.prejoin.joinNow })).not.toBeInTheDocument();
  });

  it('joins with the shared location, leaves to the post-call screen and submits feedback', async () => {
    const appointment = appointmentAt(Date.now() + 5 * MINUTE, { serviceCategory: 'psychological' });
    const sent = serve({
      'GET /api/appointments/appt_1': () => json(200, appointment),
      'POST /api/appointments/appt_1/join': () => json(200, joinResponse(appointment)),
      'POST /api/appointments/appt_1/feedback': () => new Response(null, { status: 204 }),
    });
    renderCall();
    const user = userEvent.setup();
    const join = await readyToJoin();
    await user.type(screen.getByRole('textbox', { name: new RegExp(en.location.label) }), 'At home in Novi Sad');
    await user.click(join);

    await waitFor(() => expect(sent.find((s) => s.path === '/api/appointments/appt_1/join')?.body).toEqual({ locationText: 'At home in Novi Sad' }));

    await user.click(await screen.findByRole('button', { name: en.consultation.leave }, { timeout: 5000 }));
    expect(await screen.findByRole('heading', { name: en.postCall.left }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText(en.feedback.privacy)).toBeInTheDocument();

    const rating = screen.getByRole('radiogroup', { name: en.feedback.rating });
    await user.click(within(rating).getByRole('radio', { name: '4 of 5' }));
    await user.click(screen.getByRole('button', { name: en.feedback.submit }));

    expect(await screen.findByText(en.feedback.thanks)).toBeInTheDocument();
    expect(sent.find((s) => s.path === '/api/appointments/appt_1/feedback')).toMatchObject({ method: 'POST', body: { score: 4, comment: null } });
  });

  it('asks for a rating before sending feedback and renders a failed submission', async () => {
    const appointment = appointmentAt(Date.now() + 5 * MINUTE);
    serve({
      'GET /api/appointments/appt_1': () => json(200, appointment),
      'POST /api/appointments/appt_1/join': () => json(200, joinResponse(appointment)),
      'POST /api/appointments/appt_1/feedback': () => json(429, { code: 'rate_limited', message: 'Too many' }),
    });
    renderCall();
    const user = userEvent.setup();
    await user.click(await readyToJoin());
    await user.click(await screen.findByRole('button', { name: en.consultation.leave }, { timeout: 5000 }));
    await screen.findByRole('heading', { name: en.postCall.left }, { timeout: 5000 });

    await user.click(screen.getByRole('button', { name: en.feedback.submit }));
    expect((await screen.findAllByText(en.feedback.errors.ratingRequired)).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('radio', { name: '2 of 5' }));
    await user.click(screen.getByRole('button', { name: en.feedback.submit }));
    expect((await screen.findAllByText(en.errors.rateLimited)).length).toBeGreaterThan(0);
  });

  it('sends a signed-out visitor to sign-in with the call as the return path', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json(401, { code: 'unauthenticated', message: 'No session' })));
    const router = renderCall();
    await waitFor(() => expect(router.state.location.pathname).toBe('/sign-in'));
    expect(router.state.location.search).toEqual({ return: '/call/appt_1' });
  });
});
