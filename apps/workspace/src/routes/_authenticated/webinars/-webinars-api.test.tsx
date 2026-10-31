/**
 * Webinar routes in API mode (T-CW-2.4, WBN-01 to WBN-07): the list is what
 * the server answers; registration success, `webinar_full` and
 * `not_eligible` render translated copy; a load failure explains itself; the
 * live view joins receive-only with no camera control, waits in the lobby on
 * `webinar_not_open` and joins when the room reports `live`, shows a refused
 * join on the pre-join screen, and thanks the attendee when the webinar
 * ends. The Chime controller is `FakeCallSessionController`; the rooms are a
 * stub whose handler the test calls as the server would.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOBBY_RETRY_MS } from '../../../webinars/webinar-live';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { WebinarRoomHandlers } from '@nestself/api-client';
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

vi.mock('../../../calls/user-room-client', () => ({
  userRoomClient: { subscribe: () => () => undefined },
}));

vi.mock('../../../calls/use-consultation-controller', async () => {
  const { useState } = await import('react');
  const { FakeCallSessionController } = await import('@nestself/video');
  return {
    useConsultationController: () => useState(() => new FakeCallSessionController({ role: 'attendee', format: 'webinar' }))[0],
  };
});

/** The webinar rooms as the route sees them: the test fires the server's events. */
const rooms = vi.hoisted(() => ({ subscriptions: [] as { rooms: readonly string[]; handlers: WebinarRoomHandlers }[] }));
vi.mock('../../../webinars/webinar-room-client', () => ({
  webinarRoomClient: {
    subscribe: (names: readonly string[], handlers: WebinarRoomHandlers) => {
      const entry = { rooms: names, handlers };
      rooms.subscriptions.push(entry);
      return () => {
        rooms.subscriptions = rooms.subscriptions.filter((candidate) => candidate !== entry);
      };
    },
  },
}));

import { routeTree } from '../../../routeTree.gen';
import { api } from '../../../api';
import { initialSnapshot } from '../../../auth';

const MINUTE = 60_000;
const employee = SAMPLE_PRINCIPALS.employee;
const ID = 'web_1';

function webinar(overrides: Record<string, unknown> = {}) {
  const startsAt = Date.now() + 5 * MINUTE;
  return {
    id: ID,
    title: { en: 'Planning a balanced week', 'sr-Latn': 'Planiranje uravnotežene nedelje' },
    description: { en: 'Practical ways to plan your week.' },
    startsAt: new Date(startsAt).toISOString(),
    endsAt: new Date(startsAt + 60 * MINUTE).toISOString(),
    timeZone: 'Europe/Belgrade',
    status: 'published',
    capacity: 250,
    capacityRemaining: 12,
    presenters: [{ displayName: 'Milica' }],
    registered: false,
    ...overrides,
  };
}

function joinResponse() {
  const now = Date.now();
  return {
    webinarId: ID,
    sessionId: 'sess_1',
    participantId: 'part_1',
    format: 'webinar',
    startsAt: new Date(now).toISOString(),
    endsAt: new Date(now + 60 * MINUTE).toISOString(),
    meeting: { MeetingId: 'm1', MediaRegion: 'eu-central-1', MediaPlacement: { AudioHostUrl: 'a:1', AudioFallbackUrl: 'b', SignalingUrl: 'c' } },
    attendee: { AttendeeId: 'att_1', ExternalUserId: 'part_1', JoinToken: 'token' },
    role: 'attendee',
    capabilities: { audio: 'receive', video: 'receive', content: 'receive' },
  };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const coded = (status: number, code: string) => () => json(status, { code, message: 'English developer message' });

interface Sent {
  method: string;
  path: string;
  body: unknown;
}

function serve(routes: Record<string, () => Response>) {
  const sent: Sent[] = [];
  fetchMock.mockImplementation((input, init) => {
    if (input === undefined) return Promise.resolve(json(404, { code: 'not_found', message: 'Not found' }));
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://localhost');
    const method = init?.method ?? 'GET';
    sent.push({ method, path: url.pathname, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
    if (url.pathname === '/api/auth/me') return Promise.resolve(json(200, { principal: employee.principal, effectiveActions: employee.effectiveActions, availableContexts: [employee.principal.context] }));
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

/** The server's event on a room (the public room by default). */
function emit(event: string, payload: unknown, room = `webinar:${ID}`) {
  act(() => {
    for (const subscription of rooms.subscriptions) if (subscription.rooms.includes(room)) subscription.handlers.onEvent(event, payload);
  });
}

const PUBLISHED = {
  id: 'msg_1',
  webinarId: ID,
  kind: 'host',
  status: 'published',
  text: 'Welcome, we start in a minute.',
  authorFirstName: 'Milica',
  answerText: null,
  publishedAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
};

describe('webinar discovery and registration (API mode)', { timeout: 30_000 }, () => {
  beforeEach(() => fetchMock.mockReset());
  afterEach(() => cleanup());

  it('lists what the server answers and registers with a success message', async () => {
    const sent = serve({
      'GET /api/webinars': () => json(200, { items: [webinar()], nextCursor: null }),
      [`POST /api/webinars/${ID}/register`]: () => json(200, { webinarId: ID, registered: true, registeredAt: new Date().toISOString() }),
    });
    const user = userEvent.setup();
    renderAt('/webinars');

    const card = (await screen.findByRole('link', { name: 'Planning a balanced week' }, { timeout: 5000 })).closest('li')!;
    expect(within(card).getByText('12 places left')).toBeInTheDocument();
    expect(within(card).getByText(en.webinar.recordingNotice)).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: en.webinar.register }));

    expect(await screen.findByText(en.webinar.registeredSuccess)).toBeInTheDocument();
    expect(sent).toContainEqual({ method: 'POST', path: `/api/webinars/${ID}/register`, body: {} });
    // Eligibility is the server's: the list request carries no filter of its own.
    expect(sent.find((entry) => entry.path === '/api/webinars')).toMatchObject({ method: 'GET' });
  });

  it('shows webinar_full as translated copy', async () => {
    serve({
      'GET /api/webinars': () => json(200, { items: [webinar()], nextCursor: null }),
      [`POST /api/webinars/${ID}/register`]: coded(409, 'webinar_full'),
    });
    const user = userEvent.setup();
    renderAt('/webinars');
    await user.click(await screen.findByRole('button', { name: en.webinar.register }, { timeout: 5000 }));
    expect(await screen.findByText(en.errors.webinarFull)).toBeInTheDocument();
    expect(screen.queryByText('English developer message')).not.toBeInTheDocument();
  });

  it('shows not_eligible on the detail page', async () => {
    serve({
      [`GET /api/webinars/${ID}`]: () => json(200, webinar()),
      [`POST /api/webinars/${ID}/register`]: coded(403, 'not_eligible'),
    });
    const user = userEvent.setup();
    renderAt(`/webinars/${ID}`);
    expect(await screen.findByRole('heading', { name: 'Planning a balanced week', level: 1 }, { timeout: 5000 })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: en.webinar.register }));
    expect(await screen.findByText(en.errors.notEligible)).toBeInTheDocument();
  });

  it('cancels a registration and enables Join inside the window for a registered employee', async () => {
    const sent = serve({
      [`GET /api/webinars/${ID}`]: () => json(200, webinar({ registered: true })),
      [`DELETE /api/webinars/${ID}/register`]: () => json(200, { webinarId: ID, registered: false, registeredAt: null }),
    });
    const user = userEvent.setup();
    renderAt(`/webinars/${ID}`);
    expect(await screen.findByText(en.webinar.detail.registered, {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: en.webinar.join })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: en.webinar.unregister }));
    expect(await screen.findByText(en.webinar.unregisteredSuccess)).toBeInTheDocument();
    expect(sent).toContainEqual({ method: 'DELETE', path: `/api/webinars/${ID}/register`, body: undefined });
  });

  it('shows a canceled webinar as canceled: no registration status and no Join, even for a registered employee', async () => {
    serve({ [`GET /api/webinars/${ID}`]: () => json(200, webinar({ status: 'canceled', registered: true })) });
    renderAt(`/webinars/${ID}`);
    const canceled = await screen.findByTestId('webinar-detail-canceled', {}, { timeout: 5000 });
    expect(within(canceled).getByText(en.webinar.detail.canceled)).toBeInTheDocument();
    expect(within(canceled).getByText(en.webinar.detail.canceledBody)).toBeInTheDocument();
    expect(screen.queryByText(en.webinar.detail.registered)).not.toBeInTheDocument();
    expect(screen.queryByTestId('webinar-registration-status')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: en.webinar.detail.registrationTitle })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: en.webinar.join })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: en.webinar.unregister })).not.toBeInTheDocument();
    expect(screen.queryByText(en.webinar.recordingNotice)).not.toBeInTheDocument();
  });

  it('explains a failed list load', async () => {
    serve({ 'GET /api/webinars': coded(503, 'video_provider_unavailable') });
    renderAt('/webinars');
    expect(await screen.findByText(en.webinar.discovery.errorTitle, {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText(en.errors.videoProviderUnavailable)).toBeInTheDocument();
  });
});

describe('the live webinar (API mode)', { timeout: 30_000 }, () => {
  beforeEach(() => {
    fetchMock.mockReset();
    rooms.subscriptions = [];
  });
  afterEach(() => cleanup());

  async function joinFromPrejoin(user: ReturnType<typeof userEvent.setup>) {
    const join = await screen.findByRole('button', { name: en.prejoin.joinNow }, { timeout: 5000 });
    await waitFor(() => expect(join).toBeEnabled());
    await user.click(join);
  }

  it('joins receive-only: attendee controls, the hand, the chat, and no camera control', async () => {
    const opened = new Date().toISOString();
    const sent = serve({
      [`GET /api/webinars/${ID}`]: () => json(200, webinar({ status: 'live', registered: true })),
      [`POST /api/webinars/${ID}/join`]: () => json(200, { ...joinResponse(), recordingStatus: 'recording' }),
      [`GET /api/webinars/${ID}/messages`]: () => json(200, { items: [], nextCursor: null }),
      // A late joiner gets the poll that is already open.
      [`GET /api/webinars/${ID}/polls`]: () =>
        json(200, {
          items: [
            {
              poll: { id: 'poll_1', webinarId: ID, question: 'Which break suits you?', options: [{ id: 'o1', label: 'A walk', position: 0 }, { id: 'o2', label: 'Tea', position: 1 }], openedAt: opened, closedAt: null },
              results: null,
              voted: false,
            },
          ],
        }),
    });
    const user = userEvent.setup();
    renderAt(`/webinars/${ID}/live`);
    await joinFromPrejoin(user);

    const controls = await screen.findByTestId('webinar-attendee-controls', {}, { timeout: 5000 });
    expect(within(controls).getByRole('button', { name: en.webinar.hand.raise })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: new RegExp(`${en.controls.cameraOn}|${en.controls.cameraOff}`, 'i') })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: en.controls.shareScreen })).not.toBeInTheDocument();
    expect(sent).toContainEqual({ method: 'POST', path: `/api/webinars/${ID}/join`, body: {} });
    expect(await screen.findByText('Which break suits you?')).toBeInTheDocument();
    // The join response carried the recording state: no second request for it.
    expect(sent.some((entry) => entry.path === `/api/webinars/${ID}/recording`)).toBe(false);
    expect(screen.getByTestId('webinar-rec-indicator')).toBeInTheDocument();
    // The public room joins with the user's own room, which carries the floor events.
    expect(rooms.subscriptions.some((entry) => entry.rooms.join() === `webinar:${ID},user:${employee.principal.userId}`)).toBe(true);
    expect(rooms.subscriptions.some((entry) => entry.rooms.some((room) => room.endsWith(':moderation')))).toBe(false);
  });

  it('waits in the lobby on webinar_not_open and joins when the room reports live', async () => {
    let started = false;
    const sent = serve({
      [`GET /api/webinars/${ID}`]: () => json(200, webinar({ registered: true })),
      [`POST /api/webinars/${ID}/join`]: () => (started ? json(200, joinResponse()) : coded(409, 'webinar_not_open')()),
      [`GET /api/webinars/${ID}/messages`]: () => json(200, { items: [], nextCursor: null }),
    });
    const user = userEvent.setup();
    renderAt(`/webinars/${ID}/live`);
    await joinFromPrejoin(user);

    const lobby = await screen.findByTestId('webinar-lobby', {}, { timeout: 5000 });
    expect(within(lobby).getByText(en.webinar.lobby)).toBeInTheDocument();
    expect(within(lobby).getByText(en.webinar.recordingNotice)).toBeInTheDocument();
    expect(screen.getByText(en.webinar.liveView.waitingForStart)).toBeInTheDocument();

    started = true;
    emit('webinar.state', { webinarId: ID, status: 'live' });
    expect(await screen.findByTestId('webinar-attendee-controls', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(sent.filter((entry) => entry.path === `/api/webinars/${ID}/join`)).toHaveLength(2);
  });

  it('keeps what the lobby received, hydrates the REC indicator from the server, and hides the media note in the lobby', async () => {
    let started = false;
    const sent = serve({
      [`GET /api/webinars/${ID}`]: () => json(200, webinar({ registered: true })),
      [`POST /api/webinars/${ID}/join`]: () => (started ? json(200, joinResponse()) : coded(409, 'webinar_not_open')()),
      [`GET /api/webinars/${ID}/messages`]: () => json(200, { items: [], nextCursor: null }),
      [`GET /api/webinars/${ID}/recording`]: () => json(200, { webinarId: ID, status: 'recording', startedAt: new Date().toISOString(), stoppedAt: null }),
    });
    const user = userEvent.setup();
    renderAt(`/webinars/${ID}/live`);
    await joinFromPrejoin(user);
    await screen.findByTestId('webinar-lobby', {}, { timeout: 5000 });

    // A room failure in the lobby: the 30-second retry covers it, and the media note does not apply yet.
    act(() => rooms.subscriptions.forEach((subscription) => subscription.handlers.onUnavailable?.('connect_error')));
    expect(screen.queryByText(en.webinar.liveView.realtimeUnavailable)).not.toBeInTheDocument();

    emit('webinar.message.published', PUBLISHED);
    started = true;
    emit('webinar.state', { webinarId: ID, status: 'live' });
    expect(await screen.findByTestId('webinar-attendee-controls', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText(PUBLISHED.text)).toBeInTheDocument();
    expect(await screen.findByTestId('webinar-rec-indicator')).toBeInTheDocument();
    expect(sent).toContainEqual({ method: 'GET', path: `/api/webinars/${ID}/recording`, body: undefined });
  });

  it('retries the join every 30 seconds while waiting in the lobby', async () => {
    // Only the lobby's 30-second timer is captured; every other interval runs for real.
    const realSetInterval = window.setInterval.bind(window);
    const lobbyTimers: (() => void)[] = [];
    const spy = vi.spyOn(window, 'setInterval').mockImplementation(((handler: () => void, delay?: number) => {
      if (delay === LOBBY_RETRY_MS) {
        lobbyTimers.push(handler);
        return 0;
      }
      return realSetInterval(handler, delay);
    }) as typeof window.setInterval);
    try {
      let started = false;
      const sent = serve({
        [`GET /api/webinars/${ID}`]: () => json(200, webinar({ registered: true })),
        [`POST /api/webinars/${ID}/join`]: () => (started ? json(200, joinResponse()) : coded(409, 'webinar_not_open')()),
        [`GET /api/webinars/${ID}/messages`]: () => json(200, { items: [], nextCursor: null }),
        [`GET /api/webinars/${ID}/recording`]: () => json(200, { webinarId: ID, status: 'recording', startedAt: null, stoppedAt: null }),
      });
      const user = userEvent.setup();
      renderAt(`/webinars/${ID}/live`);
      await joinFromPrejoin(user);
      await screen.findByTestId('webinar-lobby', {}, { timeout: 5000 });
      expect(lobbyTimers).toHaveLength(1);

      // The room never says `live` (it is unavailable); the timer joins anyway.
      started = true;
      act(() => lobbyTimers[0]!());
      expect(await screen.findByTestId('webinar-attendee-controls', {}, { timeout: 5000 })).toBeInTheDocument();
      expect(sent.filter((entry) => entry.path === `/api/webinars/${ID}/join`)).toHaveLength(2);
    } finally {
      spy.mockRestore();
    }
  });

  it('shows the floor dialog with the recording sentence when the floor is given on the user room', async () => {
    serve({
      [`GET /api/webinars/${ID}`]: () => json(200, webinar({ status: 'live', registered: true })),
      [`POST /api/webinars/${ID}/join`]: () => json(200, joinResponse()),
      [`GET /api/webinars/${ID}/messages`]: () => json(200, { items: [], nextCursor: null }),
      [`GET /api/webinars/${ID}/recording`]: () => json(200, { webinarId: ID, status: 'recording', startedAt: null, stoppedAt: null }),
    });
    const user = userEvent.setup();
    renderAt(`/webinars/${ID}/live`);
    await joinFromPrejoin(user);
    await screen.findByTestId('webinar-attendee-controls', {}, { timeout: 5000 });

    emit(
      'webinar.floor.given',
      { participantId: 'part_1', capabilities: { audio: 'send_receive', video: 'receive', content: 'receive' } },
      `user:${employee.principal.userId}`,
    );
    const dialog = await screen.findByRole('dialog', { name: en.webinar.floorDialog.title });
    expect(within(dialog).getByText(en.webinar.recordingNoticeFloor)).toBeInTheDocument();
  });

  it('lowers the hand with the floor and shows the unmute request from the user room', async () => {
    serve({
      [`GET /api/webinars/${ID}`]: () => json(200, webinar({ status: 'live', registered: true })),
      [`POST /api/webinars/${ID}/join`]: () => json(200, { ...joinResponse(), recordingStatus: 'recording' }),
      [`GET /api/webinars/${ID}/messages`]: () => json(200, { items: [], nextCursor: null }),
      [`GET /api/webinars/${ID}/polls`]: () => json(200, { items: [] }),
      [`POST /api/webinars/${ID}/hand`]: () => json(200, { raised: true, raisedAt: new Date().toISOString() }),
    });
    const user = userEvent.setup();
    renderAt(`/webinars/${ID}/live`);
    await joinFromPrejoin(user);
    const controls = await screen.findByTestId('webinar-attendee-controls', {}, { timeout: 5000 });
    await user.click(within(controls).getByRole('button', { name: en.webinar.hand.raise }));
    expect(await within(controls).findByRole('button', { name: en.webinar.hand.lower })).toBeInTheDocument();

    const userRoom = `user:${employee.principal.userId}`;
    emit('webinar.floor.given', { participantId: 'part_1', capabilities: { audio: 'send_receive', video: 'receive', content: 'receive' } }, userRoom);
    // The API lowered the hand with the floor (the floor dialog is modal, so the control is read by its state).
    const floor = await screen.findByRole('dialog', { name: en.webinar.floorDialog.title });
    await waitFor(() => expect(within(controls).getByTestId('webinar-hand-raise')).toHaveAttribute('data-state', 'lowered'));
    await user.click(within(floor).getByRole('button', { name: en.webinar.floorDialog.later }));

    // A host mutes, then asks to unmute: the consent prompt opens (WBN-26).
    emit('webinar.floor.muted', {}, userRoom);
    emit('webinar.floor.unmute_requested', {}, userRoom);
    expect(await screen.findByRole('dialog', { name: en.webinar.unmuteRequest.title })).toBeInTheDocument();
  });

  it("posts the controller's client events for the session when the attendee leaves", async () => {
    const sent = serve({
      [`GET /api/webinars/${ID}`]: () => json(200, webinar({ status: 'live', registered: true })),
      [`POST /api/webinars/${ID}/join`]: () => json(200, { ...joinResponse(), recordingStatus: 'recording' }),
      [`GET /api/webinars/${ID}/messages`]: () => json(200, { items: [], nextCursor: null }),
      [`GET /api/webinars/${ID}/polls`]: () => json(200, { items: [] }),
      'POST /api/calls/sess_1/client-events': () => new Response(null, { status: 204 }),
    });
    const user = userEvent.setup();
    renderAt(`/webinars/${ID}/live`);
    await joinFromPrejoin(user);
    const controls = await screen.findByTestId('webinar-attendee-controls', {}, { timeout: 5000 });
    await user.click(within(controls).getByRole('button', { name: en.consultation.leave }));
    await waitFor(() => expect(sent.some((entry) => entry.method === 'POST' && entry.path === '/api/calls/sess_1/client-events')).toBe(true));
    expect(sent.find((entry) => entry.path === '/api/calls/sess_1/client-events')?.body).toMatchObject({ events: [{ eventName: 'meetingStartSucceeded' }] });
  });

  it('shows a refused join on the pre-join screen', async () => {
    serve({
      [`GET /api/webinars/${ID}`]: () => json(200, webinar({ status: 'live', registered: true })),
      [`POST /api/webinars/${ID}/join`]: coded(403, 'not_eligible'),
    });
    const user = userEvent.setup();
    renderAt(`/webinars/${ID}/live`);
    await joinFromPrejoin(user);
    expect(await screen.findByText(en.errors.notEligible, {}, { timeout: 5000 })).toBeInTheDocument();
  });

  it('thanks the attendee when the webinar ends', async () => {
    serve({
      [`GET /api/webinars/${ID}`]: () => json(200, webinar({ status: 'live', registered: true })),
      [`POST /api/webinars/${ID}/join`]: () => json(200, joinResponse()),
      [`GET /api/webinars/${ID}/messages`]: () => json(200, { items: [], nextCursor: null }),
    });
    const user = userEvent.setup();
    renderAt(`/webinars/${ID}/live`);
    await joinFromPrejoin(user);
    await screen.findByTestId('webinar-attendee-controls', {}, { timeout: 5000 });

    emit('webinar.ended', { webinarId: ID, endedAt: new Date().toISOString() });
    expect(await screen.findByRole('heading', { name: en.webinar.liveView.thanksTitle }, { timeout: 5000 })).toBeInTheDocument();
    // WBN-13: every webinar is recorded (D-CW-34), so the replay is stated, not hedged.
    expect(screen.getByText('A replay will be available after review.')).toBeInTheDocument();
  });
});
