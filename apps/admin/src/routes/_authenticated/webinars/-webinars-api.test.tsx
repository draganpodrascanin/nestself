/**
 * Admin webinar routes in API mode (WBN-30, WBN-31, D-CW-36): the form
 * posts the occurrence without any recording field and shows
 * `capacity_above_limit` with the limit and the milestone; publish asks
 * first, then transitions the draft and says so; an incomplete draft gets
 * the publishing checklist; a failed list load explains itself.
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

vi.mock('../../../calls/user-room-client', () => ({ userRoomClient: { subscribe: () => () => undefined } }));

import { routeTree } from '../../../routeTree.gen';
import { api } from '../../../api';
import { initialSnapshot } from '../../../auth';
import i18n from '../../../i18n';

const operations = SAMPLE_PRINCIPALS.operations;
const ID = 'web_1';

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

function serve(routes: Record<string, () => Response>) {
  const sent: Sent[] = [];
  fetchMock.mockImplementation((input, init) => {
    if (input === undefined) return Promise.resolve(json(404, { code: 'not_found', message: 'Not found' }));
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://localhost');
    const method = init?.method ?? 'GET';
    sent.push({ method, path: url.pathname, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
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

describe('admin webinars (API mode)', () => {
  beforeEach(async () => {
    fetchMock.mockReset();
    await i18n.changeLanguage('en');
  });
  afterEach(() => cleanup());

  it('posts the occurrence and shows capacity_above_limit with the limit and M3', async () => {
    const sent = serve({ 'POST /api/ops/webinars': coded(400, 'capacity_above_limit', { field: 'capacity', limit: 250 }) });
    const user = userEvent.setup();
    renderAt('/webinars/new');

    const titles = await screen.findByRole('group', { name: en.webinar.form.titleLegend }, { timeout: 5000 });
    await user.type(within(titles).getByLabelText(en.webinar.form.languages.en), 'Sleep and rest');
    await user.type(within(titles).getByLabelText(en.webinar.form.languages['sr-Latn']), 'San i odmor');
    const capacity = screen.getByLabelText(en.webinar.form.capacity);
    await user.clear(capacity);
    await user.type(capacity, '300');
    await user.type(screen.getByLabelText(en.webinar.form.presenters), 'user_milica');
    await user.type(screen.getByLabelText(en.webinar.form.moderator), 'user_nikola');
    await user.type(screen.getByLabelText(en.webinar.form.date), '2030-12-02');
    await user.type(screen.getByLabelText(en.webinar.form.startTime), '17:00');
    await user.type(screen.getByLabelText(en.webinar.form.endTime), '18:00');
    await user.click(screen.getByRole('button', { name: en.webinar.form.submit }));

    const message = 'Capacity can be at most 250 attendees until larger webinars are supported in milestone M3.';
    expect(en.webinar.capacityAboveLimit.replace('{{limit}}', '250')).toBe(message);
    expect((await screen.findAllByText(new RegExp(message.replace('.', '\\.')))).length).toBeGreaterThan(0);
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
      capacity: 300,
    });
  });

  it('creates the draft and opens it', async () => {
    serve({
      'POST /api/ops/webinars': () => json(201, occurrence()),
      'GET /api/ops/webinars': () => json(200, { items: [occurrence()], nextCursor: null }),
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

  it('publishes a draft after the confirmation', async () => {
    const sent = serve({
      'GET /api/ops/webinars': () => json(200, { items: [occurrence()], nextCursor: null }),
      [`POST /api/ops/webinars/${ID}/publish`]: () => json(200, { webinarId: ID, status: 'published' }),
    });
    const user = userEvent.setup();
    renderAt(`/webinars/${ID}`);

    await user.click(await screen.findByRole('button', { name: en.webinar.admin.publish }, { timeout: 5000 }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(en.webinar.admin.publishBody)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: en.webinar.admin.publish }));

    expect(await screen.findByText(en.webinar.admin.published)).toBeInTheDocument();
    expect(sent).toContainEqual({ method: 'POST', path: `/api/ops/webinars/${ID}/publish`, body: {} });
  });

  it('explains what an incomplete draft needs before publishing', async () => {
    serve({
      'GET /api/ops/webinars': () => json(200, { items: [occurrence({ hosts: [] })], nextCursor: null }),
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
});
