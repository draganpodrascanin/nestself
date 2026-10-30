/**
 * Deep links in API mode: on a full page load the router runs the guards
 * before AuthProvider has read the session. The guards must wait for
 * `GET /auth/me` instead of redirecting on the empty initial context.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { createRouter, createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SAMPLE_PRINCIPALS } from '@nestself/sample-data';

// The API client captures `fetch` when `../api` is first imported.
const fetchMock = vi.hoisted(() => {
  const fn = vi.fn<typeof fetch>();
  globalThis.fetch = fn;
  return fn;
});

vi.mock('../data-source', () => ({
  dataSource: 'api',
  isSampleDataMode: false,
  resolveDataSource: () => 'api',
}));

import { routeTree } from '../routeTree.gen';
import { api } from '../api';
import { initialSnapshot } from '../auth';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function answerMe(response: () => Response) {
  fetchMock.mockImplementation((input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith('/api/auth/me')) return Promise.resolve(response());
    return Promise.resolve(json(404, { code: 'not_found', message: 'Not found' }));
  });
}

function renderDeepLink(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree,
    // As main.tsx builds it in API mode.
    context: {
      queryClient,
      auth: { principal: null, effectiveActions: [], availableContexts: [], settled: false, ensure: () => initialSnapshot(api) },
    },
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

describe('workspace deep links (API mode)', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders a gated route once /auth/me answers with a session', async () => {
    const hrAdmin = SAMPLE_PRINCIPALS.hr_admin;
    answerMe(() => json(200, { principal: hrAdmin.principal, effectiveActions: hrAdmin.effectiveActions, availableContexts: hrAdmin.availableContexts }));

    const router = renderDeepLink('/hr');

    expect(await screen.findByRole('heading', { name: 'Support programme' }, { timeout: 5000 })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/hr');
    // The provider and the guard share one request.
    const meCalls = fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/api/auth/me'));
    expect(meCalls).toHaveLength(1);
  });

  it('redirects to /sign-in with the return path when /auth/me fails', async () => {
    answerMe(() => json(401, { code: 'unauthenticated', message: 'No session' }));

    const router = renderDeepLink('/hr');

    await waitFor(() => expect(router.state.location.pathname).toBe('/sign-in'));
    expect(router.state.location.search).toEqual({ return: '/hr' });
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });
});
