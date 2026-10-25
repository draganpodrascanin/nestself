/**
 * Admin webinar routes in API mode (WBN-16 to WBN-33, D-CW-36): the form
 * refuses a capacity above 1,000 itself and maps the server's
 * `capacity_above_limit`, and posts the occurrence without any recording
 * field; publish asks first, then transitions the draft; an incomplete draft
 * gets the publishing checklist; every failure renders translated copy (list
 * load, cancel, unknown occurrence, attendance, and in the console a refused
 * join, start, chat load and poll creation); the console waits for the hosts'
 * join window and hydrates the REC indicator from the server.
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
    useConsultationController: () => useState(() => new FakeCallSessionController({ role: 'moderator', format: 'webinar' }))[0],
  };
});

vi.mock('../../../webinars/webinar-room-client', () => ({ webinarRoomClient: { subscribe: () => () => undefined } }));

import { routeTree } from '../../../routeTree.gen';
import { api } from '../../../api';
import { initialSnapshot } from '../../../auth';
import i18n from '../../../i18n';

const operations = SAMPLE_PRINCIPALS.operations;
const ID = 'web_1';
const MINUTE = 60_000;

/** The host's view of the occurrence (`GET /webinars/:id`), starting in ten minutes unless told otherwise. */
function hostView(overrides: Record<string, unknown> = {}) {
  const startsAt = Date.now() + 10 * MINUTE;
  return {
    id: ID,
    title: { en: 'Sleep and rest' },
    description: null,
    startsAt: new Date(startsAt).toISOString(),
    endsAt: new Date(startsAt + 60 * MINUTE).toISOString(),
    timeZone: 'Europe/Belgrade',
    status: 'published',
    capacity: 120,
    capacityRemaining: 100,
    presenters: [{ displayName: 'Milica' }],
    registered: false,
    ...overrides,
  };
}

function hostJoin() {
  const now = Date.now();
  return {
    webinarId: ID,
    sessionId: 'sess_1',
    participantId: 'part_host',
    format: 'webinar',
    startsAt: new Date(now).toISOString(),
    endsAt: new Date(now + 60 * MINUTE).toISOString(),
    meeting: { MeetingId: 'm1', MediaRegion: 'eu-central-1', MediaPlacement: { AudioHostUrl: 'a:1', AudioFallbackUrl: 'b', SignalingUrl: 'c' } },
    attendee: { AttendeeId: 'att_host', ExternalUserId: 'part_host', JoinToken: 'token' },
    role: 'moderator',
    capabilities: { audio: 'send_receive', video: 'send_receive', content: 'send_receive' },
  };
}

const RECORDING = () => json(200, { webinarId: ID, status: 'recording', startedAt: new Date().toISOString(), stoppedAt: null });
const NO_MESSAGES = () => json(200, { items: [], nextCursor: null });

function occurrence(overrides: Record<string, unknown> = {}) {
  return {
    id: ID,
    orgId: null,
    title: { en: 'Sleep and rest' },
    description: null,
    audiencePolicy: { type: 'all_eligible' },
    capacity: 120,
    startsAt: '2030-12-02T16:00:00.000Z',
    endsAt: '2030-12-02T17:00:00.000Z',
    timeZone: 'Europe/Belgrade',
    status: 'draft',
    chatPolicy: 'moderated',
    createdByUserId: operations.principal.userId,
    hosts: [
      { userId: 'user_milica', role: 'presenter', displayName: 'Milica' },
      { userId: 'user_nikola', role: 'moderator', displayName: 'Nikola' },
    ],
    ...overrides,
  };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const coded = (status: number, code: string, details?: Record<string, unknown>) => () =>
  json(status, { code, message: 'English developer message', ...(details ? { details } : {}) });

interface Sent {
  method: string;
  path: string;
  body: unknown;
}

function serve(routes: Record<string, () => Response>, who: (typeof SAMPLE_PRINCIPALS)[keyof typeof SAMPLE_PRINCIPALS] = operations) {
  const sent: Sent[] = [];
  fetchMock.mockImplementation((input, init) => {
    if (input === undefined) return Promise.resolve(json(404, { code: 'not_found', message: 'Not found' }));
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://localhost');
    const method = init?.method ?? 'GET';
    sent.push({ method, path: url.pathname, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
    if (url.pathname === '/api/auth/me') return Promise.resolve(json(200, { principal: who.principal, effectiveActions: who.effectiveActions }));
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

describe('admin webinars (API mode)', { timeout: 30_000 }, () => {
  beforeEach(async () => {
    fetchMock.mockReset();
    await i18n.changeLanguage('en');
  });
  afterEach(() => cleanup());

  async function fillForm(user: ReturnType<typeof userEvent.setup>, capacity: string) {
    const titles = await screen.findByRole('group', { name: en.webinar.form.titleLegend }, { timeout: 5000 });
    // The host list failed: the ids field replaces the picker.
    await waitFor(() => expect(screen.getByLabelText(en.webinar.form.presenters)).toHaveAttribute('name', 'presenters'));
    await user.type(within(titles).getByLabelText(en.webinar.form.languages.en), 'Sleep and rest');
    await user.type(within(titles).getByLabelText(en.webinar.form.languages['sr-Latn']), 'San i odmor');
    const field = screen.getByLabelText(en.webinar.form.capacity);
    expect(field).toHaveAttribute('max', '1000');
    await user.clear(field);
    await user.type(field, capacity);
    await user.type(screen.getByLabelText(en.webinar.form.presenters), 'user_milica');
    await user.type(screen.getByLabelText(en.webinar.form.moderator), 'user_nikola');
    await user.type(screen.getByLabelText(en.webinar.form.date), '2030-12-02');
    await user.type(screen.getByLabelText(en.webinar.form.startTime), '17:00');
    await user.type(screen.getByLabelText(en.webinar.form.endTime), '18:00');
    await user.click(screen.getByRole('button', { name: en.webinar.form.submit }));
  }

  const LIMIT_MESSAGE = 'Capacity can be at most 1,000 attendees.';

  /** The pickers' lists fail, so the form takes ids (the fallback). */
  const NO_LISTS = {
    'GET /api/ops/webinars/host-candidates': coded(404, 'not_found'),
    'GET /api/ops/orgs': coded(404, 'not_found'),
  };

  it('refuses a capacity of 1,200 before sending, naming the limit', async () => {
    const sent = serve(NO_LISTS);
    const user = userEvent.setup();
    renderAt('/webinars/new');
    await fillForm(user, '1200');

    expect(en.webinar.capacityAboveLimit.replace('{{limit}}', '1,000')).toBe(LIMIT_MESSAGE);
    expect(en.webinar.capacityAboveLimit).not.toContain('M3');
    expect((await screen.findAllByText(new RegExp(LIMIT_MESSAGE.replace('.', '\\.')))).length).toBeGreaterThan(0);
    expect(sent.some((entry) => entry.method === 'POST' && entry.path === '/api/ops/webinars')).toBe(false);
  });

  it("posts the occurrence and shows the server's capacity_above_limit at the field", async () => {
    const sent = serve({ ...NO_LISTS, 'POST /api/ops/webinars': coded(400, 'capacity_above_limit', { field: 'capacity', limit: 1000 }) });
    const user = userEvent.setup();
    renderAt('/webinars/new');
    await fillForm(user, '200');

    expect((await screen.findAllByText(new RegExp(LIMIT_MESSAGE.replace('.', '\\.')))).length).toBeGreaterThan(0);
    expect(screen.queryByText('English developer message')).not.toBeInTheDocument();
    expect(sent.find((entry) => entry.method === 'POST' && entry.path === '/api/ops/webinars')?.body).toEqual({
      title: { en: 'Sleep and rest', 'sr-Latn': 'San i odmor' },
      presenterUserIds: ['user_milica'],
      moderatorUserId: 'user_nikola',
      // 17:00 to 18:00 in Belgrade on 2 December (winter time, UTC+1).
      startsAt: '2030-12-02T16:00:00.000Z',
      endsAt: '2030-12-02T17:00:00.000Z',
      timeZone: 'Europe/Belgrade',
      audiencePolicy: { type: 'all_eligible' },
      capacity: 200,
    });
  });

  it('picks presenters, the moderator and organisations from the API lists by name', async () => {
    const sent = serve({
      'GET /api/ops/webinars/host-candidates': () => {
        const role = new URL(String(fetchMock.mock.lastCall?.[0]), 'http://localhost').searchParams.get('role');
        return json(200, { items: role === 'presenter' ? [{ userId: 'user_milica', displayName: 'Milica' }] : [{ userId: 'user_admin', displayName: 'Platform' }] });
      },
      'GET /api/ops/orgs': () => json(200, { items: [{ id: 'org_sample', name: 'Example d.o.o.' }] }),
      'POST /api/ops/webinars': () => json(201, occurrence()),
      [`GET /api/ops/webinars/${ID}`]: () => json(200, occurrence()),
    });
    const user = userEvent.setup();
    renderAt('/webinars/new');

    const titles = await screen.findByRole('group', { name: en.webinar.form.titleLegend }, { timeout: 5000 });
    await user.type(within(titles).getByLabelText(en.webinar.form.languages.en), 'Sleep and rest');
    await user.click(await screen.findByRole('checkbox', { name: 'Milica' }));
    await user.click(screen.getByRole('radio', { name: en.webinar.form.audienceOrganizations }));
    await user.click(await screen.findByRole('checkbox', { name: 'Example d.o.o.' }));
    await user.type(screen.getByLabelText(en.webinar.form.date), '2030-12-02');
    await user.type(screen.getByLabelText(en.webinar.form.startTime), '17:00');
    await user.type(screen.getByLabelText(en.webinar.form.endTime), '18:00');
    await user.click(screen.getByRole('button', { name: en.webinar.form.submit }));

    await waitFor(() => expect(sent.some((entry) => entry.method === 'POST' && entry.path === '/api/ops/webinars')).toBe(true));
    expect(sent.find((entry) => entry.method === 'POST' && entry.path === '/api/ops/webinars')?.body).toMatchObject({
      presenterUserIds: ['user_milica'],
      moderatorUserId: null,
      audiencePolicy: { type: 'organization', orgIds: ['org_sample'] },
    });
    expect(sent.some((entry) => entry.path === '/api/ops/webinars/host-candidates')).toBe(true);
  });

  it('falls back to ids and says so when the host list cannot be loaded', async () => {
    serve(NO_LISTS);
    renderAt('/webinars/new');
    expect((await screen.findAllByText(new RegExp(en.webinar.form.hostsUnavailable.replace('.', '\\.')), {}, { timeout: 5000 })).length).toBeGreaterThan(0);
    expect(screen.getByLabelText(en.webinar.form.presenters)).toHaveAttribute('name', 'presenters');
  });

  it("lists a presenter's own occurrences, read-only, linked to the live view", async () => {
    const sent = serve({ 'GET /api/ops/webinars': () => json(200, { items: [occurrence({ status: 'published' })], nextCursor: null }) }, SAMPLE_PRINCIPALS.expert);
    renderAt('/webinars');
    expect(await screen.findByRole('link', { name: 'Sleep and rest' }, { timeout: 5000 })).toHaveAttribute('href', `/webinars/${ID}/live`);
    expect(screen.queryByRole('link', { name: en.webinar.admin.new })).not.toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: en.webinar.nav }).length).toBeGreaterThan(0);
    expect(sent.find((entry) => entry.path === '/api/ops/webinars')).toBeDefined();
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/api/ops/webinars?mine=true'))).toBe(true);
  });

  it('creates the draft and opens it', async () => {
    serve({
      'POST /api/ops/webinars': () => json(201, occurrence()),
      [`GET /api/ops/webinars/${ID}`]: () => json(200, occurrence()),
    });
    const user = userEvent.setup();
    const router = renderAt('/webinars/new');

    const titles = await screen.findByRole('group', { name: en.webinar.form.titleLegend }, { timeout: 5000 });
    await user.type(within(titles).getByLabelText(en.webinar.form.languages.en), 'Sleep and rest');
    await user.type(screen.getByLabelText(en.webinar.form.date), '2030-12-02');
    await user.type(screen.getByLabelText(en.webinar.form.startTime), '17:00');
    await user.type(screen.getByLabelText(en.webinar.form.endTime), '18:00');
    await user.click(screen.getByRole('button', { name: en.webinar.form.submit }));

    expect(await screen.findByText(en.webinar.admin.created, {}, { timeout: 5000 })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/webinars/${ID}`);
  });

  it('publishes a draft after the confirmation; the status sentence follows', async () => {
    let status = 'draft';
    const sent = serve({
      [`GET /api/ops/webinars/${ID}`]: () => json(200, occurrence({ status })),
      [`POST /api/ops/webinars/${ID}/publish`]: () => {
        status = 'published';
        return json(200, { webinarId: ID, status: 'published' });
      },
    });
    const user = userEvent.setup();
    renderAt(`/webinars/${ID}`);

    expect(await screen.findByTestId('webinar-admin-status', {}, { timeout: 5000 })).toHaveTextContent(en.webinar.admin.created);
    await user.click(screen.getByRole('button', { name: en.webinar.admin.publish }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(en.webinar.admin.publishBody)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: en.webinar.admin.publish }));

    await waitFor(() => expect(screen.getByTestId('webinar-admin-status')).toHaveTextContent(en.webinar.admin.published));
    expect(screen.queryByText(en.webinar.admin.created)).not.toBeInTheDocument();
    expect(sent).toContainEqual({ method: 'POST', path: `/api/ops/webinars/${ID}/publish`, body: {} });
  });

  it.each([
    ['draft', en.webinar.admin.created],
    ['published', en.webinar.admin.published],
    ['live', en.webinar.admin.statusLive],
    ['ended', en.webinar.ended],
    ['canceled', en.webinar.admin.canceled],
  ])('says one status sentence for a %s occurrence', async (status, sentence) => {
    serve({
      [`GET /api/ops/webinars/${ID}`]: () => json(200, occurrence({ status })),
      [`GET /api/ops/webinars/${ID}/attendance`]: () => json(200, { webinarId: ID, registeredCount: 0, joinedCount: 0, peakConcurrent: 0, registrants: [] }),
    });
    renderAt(`/webinars/${ID}`);
    const block = await screen.findByTestId('webinar-admin-status', {}, { timeout: 5000 });
    expect(block).toHaveTextContent(sentence);
    const others = [en.webinar.admin.created, en.webinar.admin.published, en.webinar.admin.statusLive, en.webinar.ended, en.webinar.admin.canceled].filter((text) => text !== sentence);
    for (const other of others) expect(screen.queryByText(other)).not.toBeInTheDocument();
  });

  it('explains what an incomplete draft needs before publishing', async () => {
    serve({
      [`GET /api/ops/webinars/${ID}`]: () => json(200, occurrence({ hosts: [] })),
      [`POST /api/ops/webinars/${ID}/publish`]: coded(400, 'validation', { field: 'presenterUserIds' }),
    });
    const user = userEvent.setup();
    renderAt(`/webinars/${ID}`);

    expect(await screen.findAllByText(en.webinar.admin.notAssigned, {}, { timeout: 5000 })).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: en.webinar.admin.publish }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: en.webinar.admin.publish }));
    expect(await screen.findByText(en.webinar.admin.publishNeeds)).toBeInTheDocument();
  });

  it('explains a failed list load', async () => {
    serve({ 'GET /api/ops/webinars': coded(429, 'rate_limited') });
    renderAt('/webinars');
    expect(await screen.findByText(en.webinar.admin.errorTitle, {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText(en.errors.rateLimited)).toBeInTheDocument();
  });
  it('shows a failed cancellation', async () => {
    serve({
      [`GET /api/ops/webinars/${ID}`]: () => json(200, occurrence({ status: 'published' })),
      [`POST /api/ops/webinars/${ID}/cancel`]: coded(409, 'conflict', { reason: 'not_cancelable' }),
    });
    const user = userEvent.setup();
    renderAt(`/webinars/${ID}`);
    await user.click(await screen.findByRole('button', { name: en.webinar.admin.cancel }, { timeout: 5000 }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: en.webinar.admin.cancel }));
    expect(await screen.findByText(en.errors.conflict)).toBeInTheDocument();
  });

  it('says when the occurrence is not found', async () => {
    // `GET /ops/webinars/:id` answers 404 to an unknown id and to anyone outside its operations context (D-CW-30).
    serve({});
    renderAt(`/webinars/${ID}`);
    expect(await screen.findByText(en.webinar.admin.notFoundTitle, {}, { timeout: 5000 })).toBeInTheDocument();
  });

  it('shows a failed attendance load', async () => {
    serve({
      [`GET /api/ops/webinars/${ID}`]: () => json(200, occurrence({ status: 'ended' })),
      [`GET /api/ops/webinars/${ID}/attendance`]: coded(503, 'video_provider_unavailable'),
    });
    renderAt(`/webinars/${ID}`);
    expect(await screen.findByText(en.webinar.admin.attendanceErrorTitle, {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText(en.errors.videoProviderUnavailable)).toBeInTheDocument();
  });
});

describe('the moderator console (API mode)', { timeout: 30_000 }, () => {
  beforeEach(async () => {
    fetchMock.mockReset();
    await i18n.changeLanguage('en');
  });
  afterEach(() => cleanup());

  async function joinConsole(user: ReturnType<typeof userEvent.setup>) {
    const join = await screen.findByRole('button', { name: en.prejoin.joinNow }, { timeout: 5000 });
    await waitFor(() => expect(join).toBeEnabled());
    await user.click(join);
  }

  it('waits for the hosts\' join window', async () => {
    serve({ [`GET /api/webinars/${ID}`]: () => json(200, hostView({ startsAt: new Date(Date.now() + 120 * MINUTE).toISOString(), endsAt: new Date(Date.now() + 180 * MINUTE).toISOString() })) });
    const user = userEvent.setup();
    renderAt(`/webinars/${ID}/live`);
    expect(await screen.findByTestId('webinar-console-opens', {}, { timeout: 5000 })).toHaveTextContent(/^You can join from /);
    await joinConsole(user);
    expect((await screen.findAllByText(/^You can join from /)).length).toBeGreaterThan(1);
  });

  it('shows a refused join', async () => {
    serve({
      [`GET /api/webinars/${ID}`]: () => json(200, hostView()),
      [`POST /api/webinars/${ID}/join`]: coded(409, 'webinar_not_open'),
    });
    const user = userEvent.setup();
    renderAt(`/webinars/${ID}/live`);
    await joinConsole(user);
    expect(await screen.findByText(en.errors.webinarNotOpen, {}, { timeout: 5000 })).toBeInTheDocument();
  });

  it('hydrates the REC indicator, and shows failed start, chat load and poll creation', async () => {
    const sent = serve({
      [`GET /api/webinars/${ID}`]: () => json(200, hostView()),
      [`POST /api/webinars/${ID}/join`]: () => json(200, hostJoin()),
      [`GET /api/webinars/${ID}/messages`]: coded(429, 'rate_limited'),
      [`GET /api/webinars/${ID}/recording`]: RECORDING,
      [`POST /api/webinars/${ID}/start`]: coded(409, 'webinar_not_open'),
      [`POST /api/webinars/${ID}/polls`]: coded(409, 'conflict'),
    });
    const user = userEvent.setup();
    renderAt(`/webinars/${ID}/live`);
    await joinConsole(user);

    // The chat history could not be loaded.
    expect(await screen.findByText(en.errors.rateLimited, {}, { timeout: 5000 })).toBeInTheDocument();
    expect(sent).toContainEqual({ method: 'GET', path: `/api/webinars/${ID}/recording`, body: undefined });

    const lobby = await screen.findByTestId('webinar-lobby');
    await user.click(within(lobby).getByRole('button', { name: en.webinar.start }));
    expect(await screen.findByText(en.errors.webinarNotOpen)).toBeInTheDocument();

    const creator = screen.getByRole('region', { name: en.webinar.console.pollTitle });
    await user.type(within(creator).getByLabelText(en.webinar.console.pollQuestion), 'Which break?');
    await user.type(within(creator).getByLabelText(new RegExp(`^${en.webinar.console.pollOption.replace('{{number}}', '1')}`)), 'A walk');
    await user.type(within(creator).getByLabelText(new RegExp(`^${en.webinar.console.pollOption.replace('{{number}}', '2')}`)), 'Tea');
    await user.click(within(creator).getByRole('button', { name: en.webinar.console.pollCreate }));
    expect(await within(creator).findByText(en.errors.conflict)).toBeInTheDocument();
  });

  it('shows a failed end on the stage', async () => {
    serve({
      [`GET /api/webinars/${ID}`]: () => json(200, hostView({ status: 'live' })),
      [`POST /api/webinars/${ID}/join`]: () => json(200, { ...hostJoin(), recordingStatus: 'recording' }),
      [`GET /api/webinars/${ID}/messages`]: NO_MESSAGES,
      [`GET /api/webinars/${ID}/recording`]: RECORDING,
      [`POST /api/webinars/${ID}/end`]: coded(409, 'webinar_not_open'),
      [`GET /api/webinars/${ID}/polls`]: () =>
        json(200, { items: [{ poll: { id: 'poll_1', webinarId: ID, question: 'Which break suits you?', options: [{ id: 'o1', label: 'A walk', position: 0 }, { id: 'o2', label: 'Tea', position: 1 }], openedAt: null, closedAt: null }, results: null, voted: false }] }),
    });
    const user = userEvent.setup();
    renderAt(`/webinars/${ID}/live`);
    await joinConsole(user);

    expect(await screen.findByTestId('webinar-rec-indicator', {}, { timeout: 5000 })).toBeInTheDocument();
    // The join response carried the recording state, so the console did not ask again; the prepared poll is back.
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith(`/api/webinars/${ID}/recording`))).toBe(false);
    expect(await screen.findByText('Which break suits you?')).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: en.webinar.endForEveryone }));
    const dialog = await screen.findByRole('alertdialog', { name: en.webinar.endConfirmTitle });
    await user.click(within(dialog).getByRole('button', { name: en.webinar.endForEveryone }));
    expect(await screen.findByText(en.errors.webinarNotOpen)).toBeInTheDocument();
  });
});
