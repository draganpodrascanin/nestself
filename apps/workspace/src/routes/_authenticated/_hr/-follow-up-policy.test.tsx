/**
 * HR's follow-up approval policy screen in API mode (T-CW-1.10, CALL-41):
 * both choices explained, the current policy selected, a save, and every
 * failure as translated copy. Reachable with `program.overview` only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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

vi.mock('../../../calls/user-room-client', () => ({
  userRoomClient: { subscribe: () => () => undefined },
}));

import { routeTree } from '../../../routeTree.gen';
import { api } from '../../../api';
import { initialSnapshot } from '../../../auth';

/** A sample principal switched to the organization context of `orgId`. */
function withOrgContext<T extends { principal: { context: unknown } }>(sample: T, orgId: string): T {
  return { ...sample, principal: { ...sample.principal, context: { kind: 'organization', orgId } } };
}

// The policy is an organization-workspace screen: HR has switched to "Manage"
// (Ruling E: HR admins start in their personal context).
const hr = withOrgContext(SAMPLE_PRINCIPALS.hr_admin, 'org_sample');
const POLICY = '/api/orgs/org_sample/settings/follow-up-approval';
const policyCopy = en.approval.policy;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

interface Sent {
  method: string;
  path: string;
  body: unknown;
}

function serve(routes: Record<string, () => Response>, who: { principal: unknown; effectiveActions: readonly string[] } = hr) {
  const sent: Sent[] = [];
  fetchMock.mockImplementation((input, init) => {
    if (input === undefined) return Promise.resolve(json(404, { code: 'not_found', message: 'Not found' }));
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://localhost');
    const method = init?.method ?? 'GET';
    sent.push({ method, path: url.pathname, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
    if (url.pathname === '/api/auth/me') return Promise.resolve(json(200, { availableContexts: [(who.principal as { context: unknown }).context], ...who }));
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

describe('the follow-up approval policy (API mode)', () => {
  beforeEach(() => fetchMock.mockReset());
  afterEach(() => cleanup());

  it('explains both policies and selects the current one', async () => {
    serve({ [`GET ${POLICY}`]: () => json(200, { policy: 'manager_approval' }) });
    renderAt('/follow-up-policy');
    expect(await screen.findByRole('heading', { name: policyCopy.title }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText(policyCopy.intro)).toBeInTheDocument();
    expect(await screen.findByText(policyCopy.automaticBody)).toBeInTheDocument();
    expect(screen.getByText(policyCopy.managerBody)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: new RegExp(policyCopy.managerTitle) })).toBeChecked();
    expect(screen.getByRole('radio', { name: new RegExp(policyCopy.automaticTitle) })).not.toBeChecked();
    expect(screen.getByRole('button', { name: policyCopy.save })).toBeDisabled();
  });

  it('saves a new choice', async () => {
    const sent = serve({
      [`GET ${POLICY}`]: () => json(200, { policy: 'automatic' }),
      [`PATCH ${POLICY}`]: () => json(200, { policy: 'manager_approval' }),
    });
    renderAt('/follow-up-policy');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('radio', { name: new RegExp(policyCopy.managerTitle) }, { timeout: 5000 }));
    await user.click(screen.getByRole('button', { name: policyCopy.save }));
    expect(await screen.findByText(policyCopy.saved)).toBeInTheDocument();
    expect(sent.find((s) => s.method === 'PATCH')).toEqual({ method: 'PATCH', path: POLICY, body: { policy: 'manager_approval' } });
    await waitFor(() => expect(screen.getByRole('button', { name: policyCopy.save })).toBeDisabled());
  });

  it.each([
    ['rate_limited', 429, en.errors.rateLimited],
    ['not_found', 404, en.errors.notFound],
    ['something_new', 500, en.errors.unknown],
  ])('renders a refused save (%s) as translated copy', async (code, status, message) => {
    serve({
      [`GET ${POLICY}`]: () => json(200, { policy: 'automatic' }),
      [`PATCH ${POLICY}`]: () => json(status, { code, message: 'English text for developers' }),
    });
    renderAt('/follow-up-policy');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('radio', { name: new RegExp(policyCopy.managerTitle) }, { timeout: 5000 }));
    await user.click(screen.getByRole('button', { name: policyCopy.save }));
    expect(await screen.findByText(policyCopy.saveFailedTitle)).toBeInTheDocument();
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.queryByText('English text for developers')).not.toBeInTheDocument();
  });

  it('renders a failed load as translated copy', async () => {
    serve({ [`GET ${POLICY}`]: () => json(500, { code: 'internal', message: 'English text for developers' }) });
    renderAt('/follow-up-policy');
    expect(await screen.findByText(policyCopy.loadFailedTitle, {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText(en.errors.unknown)).toBeInTheDocument();
  });

  it('is not reachable without program.overview, and the navigation hides it', async () => {
    const employee = SAMPLE_PRINCIPALS.employee;
    serve({}, employee);
    const router = renderAt('/follow-up-policy');
    await waitFor(() => expect(router.state.location.pathname).toBe('/'), { timeout: 5000 });
    expect(await screen.findByText(common.state.permission.title)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: common.nav.followUpPolicy })).not.toBeInTheDocument();
  });

  it('the navigation shows the policy to HR', async () => {
    serve({ [`GET ${POLICY}`]: () => json(200, { policy: 'automatic' }) });
    renderAt('/follow-up-policy');
    expect((await screen.findAllByRole('link', { name: common.nav.followUpPolicy }, { timeout: 5000 })).length).toBeGreaterThan(0);
  });
});
