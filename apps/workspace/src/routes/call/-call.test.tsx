/**
 * The call route in API mode (T-CW-1.5, T-CW-1.9): join failures render
 * translated copy, a closed window explains itself, a successful join
 * reaches the call and the post-call feedback posts to the API; on the
 * post-call screen the follow-up card follows the feedback when a proposal
 * arrives (call room, user room or already waiting), and the problem report
 * posts a category and the connection summary. The Chime controller is
 * replaced by `FakeCallSessionController`; the call and user rooms by stubs
 * whose handlers the test calls as the server would.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CallRoomHandlers, UserRoomHandlers } from '@nestself/api-client';
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

/** The call room as the route sees it: the test fires the server's events. */
const room = vi.hoisted(() => ({ sessionId: null as string | null, handlers: null as CallRoomHandlers | null }));
vi.mock('../../calls/call-room-client', () => ({
  callRoomClient: {
    subscribe: (sessionId: string, handlers: CallRoomHandlers) => {
      room.sessionId = sessionId;
      room.handlers = handlers;
      return () => {
        room.handlers = null;
      };
    },
  },
}));

/** The user's own room, as the post-call screen sees it. */
const userRoom = vi.hoisted(() => ({ userId: null as string | null, handlers: null as UserRoomHandlers | null }));
vi.mock('../../calls/user-room-client', () => ({
  userRoomClient: {
    subscribe: (userId: string, handlers: UserRoomHandlers) => {
      userRoom.userId = userId;
      userRoom.handlers = handlers;
      return () => {
        userRoom.handlers = null;
      };
    },
  },
}));

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

describe('call route (API mode)', { timeout: 20_000 }, () => {
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
    const support = en.support.technicalContact.replace('{{email}}', 'support@nestself.example');
    expect(screen.getByRole('link', { name: support })).toHaveAttribute('href', 'mailto:support@nestself.example');
    expect(screen.queryByRole('button', { name: en.prejoin.joinNow })).not.toBeInTheDocument();
  });

  it('at start + 11 minutes offers a rejoin; a first join the server refuses shows the translated copy', async () => {
    const appointment = appointmentAt(Date.now() - 11 * MINUTE);
    const sent = serve({
      'GET /api/appointments/appt_1': () => json(200, appointment),
      'POST /api/appointments/appt_1/join': () => json(403, { code: 'join_window_closed', message: 'English text for developers' }),
    });
    renderCall();
    const user = userEvent.setup();

    expect(await screen.findByText(/^If you already joined this session, you can rejoin until /, {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByText(en.join.windowClosed)).not.toBeInTheDocument();
    await user.click(await readyToJoin());
    expect(await screen.findByText(en.errors.joinWindowClosed)).toBeInTheDocument();
    expect(screen.queryByText('English text for developers')).not.toBeInTheDocument();
    expect(sent.some((s) => s.method === 'POST' && s.path === '/api/appointments/appt_1/join')).toBe(true);
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

  it('shows the expert running late, signals as toasts, and the post-call screen after the session ends', async () => {
    const appointment = appointmentAt(Date.now() + 5 * MINUTE);
    serve({
      'GET /api/appointments/appt_1': () => json(200, appointment),
      'POST /api/appointments/appt_1/join': () => json(200, joinResponse(appointment)),
    });
    renderCall();
    const user = userEvent.setup();
    await user.click(await readyToJoin());

    // CALL-05 criterion 3: the waiting status, once (the stage leaves it to the waiting panel).
    expect(await screen.findByRole('heading', { name: 'Your expert will join shortly' }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getAllByText(en.consultation.waiting)).toHaveLength(1);
    expect(screen.queryByText(en.consultation.waitingExpert)).not.toBeInTheDocument();
    await waitFor(() => expect(room.sessionId).toBe('sess_1'));

    act(() => room.handlers?.onSignal?.({ type: 'running_late', etaMinutes: 5, fromRole: 'expert' }));
    expect(await screen.findByText('Your expert is running late and will join in about 5 minutes.')).toBeInTheDocument();

    act(() => room.handlers?.onSignal?.({ type: 'cannot_hear', fromRole: 'expert' }));
    expect((await screen.findAllByText(en.signals.cannotHear)).length).toBeGreaterThan(0);

    act(() => room.handlers?.onSessionEnded?.());
    expect(await screen.findByText(en.consultation.sessionEnded)).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: en.postCall.ended }, { timeout: 8000 })).toBeInTheDocument();
  }, 15_000);

  async function toPostCall(routes: Record<string, () => Response> = {}, overrides: Record<string, unknown> = {}) {
    const appointment = appointmentAt(Date.now() + 5 * MINUTE, overrides);
    const sent = serve({
      'GET /api/appointments/appt_1': () => json(200, appointment),
      'POST /api/appointments/appt_1/join': () => json(200, joinResponse(appointment)),
      ...routes,
    });
    renderCall();
    const user = userEvent.setup();
    await user.click(await readyToJoin());
    await user.click(await screen.findByRole('button', { name: en.consultation.leave }, { timeout: 5000 }));
    await screen.findByRole('heading', { name: en.postCall.left }, { timeout: 5000 });
    return { user, sent, appointment };
  }

  const proposal = (startsAt: number) => ({
    appointmentId: 'appt_1',
    followUpId: 'appt_2',
    startsAt: new Date(startsAt).toISOString(),
    durationMinutes: 50,
  });

  it('names the expert from the API in the waiting state', async () => {
    const appointment = appointmentAt(Date.now() + 5 * MINUTE, { expert: { firstName: 'Milica' }, employee: { firstName: 'Jovan' } });
    serve({
      'GET /api/appointments/appt_1': () => json(200, appointment),
      'POST /api/appointments/appt_1/join': () => json(200, joinResponse(appointment)),
    });
    renderCall();
    const user = userEvent.setup();
    await user.click(await readyToJoin());
    expect(await screen.findByText('Milica will join shortly', {}, { timeout: 5000 })).toBeInTheDocument();
  });

  it('shows the follow-up card after the feedback when the proposal arrives on the call room; approval wording on confirm', async () => {
    const followUpAt = Date.now() + 7 * 24 * 60 * MINUTE;
    const { user, sent } = await toPostCall({
      'POST /api/appointments/appt_2/confirm': () =>
        json(200, appointmentAt(followUpAt, { id: 'appt_2', status: 'awaiting_approval', followUpOf: 'appt_1' })),
    });
    expect(screen.queryByRole('heading', { name: en.followUp.employeeTitle })).not.toBeInTheDocument();

    act(() => room.handlers?.onFollowUpProposed?.(proposal(followUpAt)));
    const card = await screen.findByRole('heading', { name: en.followUp.employeeTitle });
    const feedback = screen.getByRole('heading', { name: en.feedback.title });
    // D-CW-37: feedback first, then the card.
    expect(feedback.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await user.click(screen.getByRole('button', { name: en.followUp.confirm }));
    expect(await screen.findByText(en.followUp.awaitingApproval)).toBeInTheDocument();
    expect(sent.find((s) => s.path === '/api/appointments/appt_2/confirm')).toMatchObject({ method: 'POST', body: {} });
  });

  it('renders approver_missing on the card when the organisation has no approver', async () => {
    const { user } = await toPostCall({
      'POST /api/appointments/appt_2/confirm': () => json(409, { code: 'approver_missing', message: 'English text for developers' }),
    });
    act(() => room.handlers?.onFollowUpProposed?.(proposal(Date.now() + 7 * 24 * 60 * MINUTE)));
    await user.click(await screen.findByRole('button', { name: en.followUp.confirm }));
    expect(await screen.findByText(en.errors.approverMissing)).toBeInTheDocument();
    expect(screen.queryByText('English text for developers')).not.toBeInTheDocument();
  });

  it('shows a proposal that arrives on the user room, and one already waiting when the screen opens (CALL-42)', async () => {
    const followUpAt = Date.now() + 7 * 24 * 60 * MINUTE;
    const waiting = appointmentAt(followUpAt, { id: 'appt_2', status: 'proposed', followUpOf: 'appt_1' });
    await toPostCall({ 'GET /api/appointments': () => json(200, { items: [waiting], nextCursor: null }) });
    expect(await screen.findByRole('heading', { name: en.followUp.employeeTitle })).toBeInTheDocument();
    cleanup();

    await toPostCall();
    expect(userRoom.userId).toBe(employee.principal.userId);
    act(() => userRoom.handlers?.onFollowUpProposed?.({ ...proposal(followUpAt), appointmentId: 'appt_other' }));
    expect(screen.queryByRole('heading', { name: en.followUp.employeeTitle })).not.toBeInTheDocument();
    act(() => userRoom.handlers?.onFollowUpProposed?.(proposal(followUpAt)));
    expect(await screen.findByRole('heading', { name: en.followUp.employeeTitle })).toBeInTheDocument();
  }, 15_000);

  it('reports a technical problem with a category and the connection summary, and renders a failure', async () => {
    let fail = true;
    const { user, sent } = await toPostCall({
      'POST /api/calls/sess_1/problem-report': () =>
        fail ? json(429, { code: 'rate_limited', message: 'Too many' }) : new Response(null, { status: 204 }),
    });
    await user.click(screen.getByRole('button', { name: en.report.open }));
    const dialog = await screen.findByRole('dialog', { name: en.report.title });
    await user.click(within(dialog).getByRole('button', { name: en.report.send }));
    expect(await within(dialog).findByText(en.report.categoryRequired)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('radio', { name: en.report.categories.audio }));
    await user.click(within(dialog).getByRole('button', { name: en.report.send }));
    expect(await within(dialog).findByText(en.errors.rateLimited)).toBeInTheDocument();

    fail = false;
    await user.click(within(dialog).getByRole('button', { name: en.report.send }));
    expect(await screen.findByText(en.report.sent)).toBeInTheDocument();
    const report = sent.filter((s) => s.path === '/api/calls/sess_1/problem-report').at(-1)!;
    expect(report.body).toMatchObject({ category: 'audio', summary: { reconnectCount: 0 } });
    expect(Object.keys(report.body as object).sort()).toEqual(['category', 'summary']);
  }, 15_000);

  it('shows a running-late signal the expert sent before the page opened (CALL-05)', async () => {
    const appointment = appointmentAt(Date.now() + 5 * MINUTE, {
      viewer: { hasJoined: false, sessionEnded: false, pendingSignal: { type: 'running_late', etaMinutes: 10, sentAt: new Date().toISOString() } },
    });
    serve({
      'GET /api/appointments/appt_1': () => json(200, appointment),
      'POST /api/appointments/appt_1/join': () => json(200, joinResponse(appointment)),
    });
    renderCall();
    const user = userEvent.setup();
    await user.click(await readyToJoin());
    expect(await screen.findByText('Your expert is running late and will join in about 10 minutes.', {}, { timeout: 5000 })).toBeInTheDocument();
  });

  it('shows someone who never joined the closed window and the technical support contact, not a rejoin (CALL-07)', async () => {
    serve({ 'GET /api/appointments/appt_1': () => json(200, appointmentAt(Date.now() - 11 * MINUTE, { viewer: { hasJoined: false, sessionEnded: false } })) });
    renderCall();

    expect(await screen.findByText(en.join.windowClosed, {}, { timeout: 5000 })).toBeInTheDocument();
    const support = en.support.technicalContact.replace('{{email}}', 'support@nestself.example');
    expect(screen.getByRole('link', { name: support })).toHaveAttribute('href', 'mailto:support@nestself.example');
    expect(screen.queryByText(/If you already joined this session/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: en.prejoin.joinNow })).not.toBeInTheDocument();
  });

  it('says so when the lookup for a waiting proposal fails, and retries it', async () => {
    let fail = true;
    const followUpAt = Date.now() + 7 * 24 * 60 * MINUTE;
    const waiting = appointmentAt(followUpAt, { id: 'appt_2', status: 'proposed', followUpOf: 'appt_1' });
    const { user } = await toPostCall({
      'GET /api/appointments': () => (fail ? json(500, { code: 'internal', message: 'English' }) : json(200, { items: [waiting], nextCursor: null })),
    });
    expect(await screen.findByText(new RegExp(en.postCall.proposalLookupFailed), {}, { timeout: 5000 })).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: en.followUp.employeeTitle })).toBeInTheDocument();
  });

  it('offers no join on a session that was ended for everyone', async () => {
    serve({ 'GET /api/appointments/appt_1': () => json(200, appointmentAt(Date.now() - 5 * MINUTE, { viewer: { hasJoined: true, sessionEnded: true } })) });
    renderCall();
    expect(await screen.findByText(en.consultation.sessionEnded, {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: en.prejoin.joinNow })).not.toBeInTheDocument();
  });

  it("shows the expert's photo and credentials in the waiting state (CALL-05)", async () => {
    const appointment = appointmentAt(Date.now() + 5 * MINUTE, {
      expert: { firstName: 'Milica', photoUrl: 'https://media.nestself.example/experts/milica.jpg', credentials: 'Licensed psychologist' },
    });
    serve({
      'GET /api/appointments/appt_1': () => json(200, appointment),
      'POST /api/appointments/appt_1/join': () => json(200, joinResponse(appointment)),
    });
    renderCall();
    const user = userEvent.setup();
    await user.click(await readyToJoin());
    expect(await screen.findByText('Milica will join shortly', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText('Licensed psychologist')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Milica' })).toHaveAttribute('src', 'https://media.nestself.example/experts/milica.jpg');
  });

  it("asks the server for this consultation's open proposals after the call", async () => {
    await toPostCall({ 'GET /api/appointments': () => json(200, { items: [], nextCursor: null }) });
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([input]) => {
          const url = new URL(String(input), 'http://localhost');
          return url.pathname === '/api/appointments' && url.searchParams.get('followUpOf') === 'appt_1' && url.searchParams.get('status') === 'proposed';
        }),
      ).toBe(true),
    );
  });

  it('sends a signed-out visitor to sign-in with the call as the return path', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json(401, { code: 'unauthenticated', message: 'No session' })));
    const router = renderCall();
    await waitFor(() => expect(router.state.location.pathname).toBe('/sign-in'));
    expect(router.state.location.search).toEqual({ return: '/call/appt_1' });
  });
});
