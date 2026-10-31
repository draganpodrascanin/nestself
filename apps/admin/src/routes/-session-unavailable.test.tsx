/**
 * A `GET /auth/me` that fails for any reason other than 401 (API down, a 5xx,
 * no answer in time) must show "we could not load your account" with a way to
 * try again. It must neither look like a sign-out (a redirect to /sign-in) nor
 * leave a blank screen, and "Try again" must ask the API again.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ComponentType } from 'react';
import { render, screen, waitFor, act, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRouter, createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import type { ErrorComponentProps } from '@tanstack/react-router';
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
import { releaseInitialMe } from '../auth/route-auth';
import i18n from '../i18n';
import { Route as AuthenticatedRoute } from './_authenticated';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const urlOf = (input: Parameters<typeof fetch>[0]) =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

const isMe = (input: Parameters<typeof fetch>[0]) => urlOf(input).endsWith('/api/auth/me');
const meCalls = () => fetchMock.mock.calls.filter(([input]) => isMe(input));

const SERVER_FAILURE = () => json(500, { code: 'internal_error', message: 'English developer message' });
const ADMIN = SAMPLE_PRINCIPALS.admin;
const SIGNED_IN = () => json(200, { principal: ADMIN.principal, effectiveActions: ADMIN.effectiveActions });

/** Answers `/auth/me` with `response(attempt)`, the first attempt being 1; every other URL is 404. */
function answerMe(response: (attempt: number) => Response | Promise<Response>) {
  let attempt = 0;
  fetchMock.mockImplementation((input) => {
    if (isMe(input)) {
      attempt += 1;
      return Promise.resolve(response(attempt));
    }
    return Promise.resolve(json(404, { code: 'not_found', message: 'Not found' }));
  });
}

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree,
    // As main.tsx builds it in API mode.
    context: {
      queryClient,
      auth: { principal: null, effectiveActions: [], settled: false, ensure: () => initialSnapshot(api) },
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

/** Lets the provider, the router sync and any redirect they would cause run to the end. */
async function letTheAppSettle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
}

const TITLE = () => i18n.t('common:state.sessionUnavailable.title');
const BODY = () => i18n.t('common:state.sessionUnavailable.body');
const TRY_AGAIN = () => i18n.t('common:action.retry');

describe('admin: the session cannot be loaded (API mode)', () => {
  beforeEach(async () => {
    fetchMock.mockReset();
    releaseInitialMe(api);
    await i18n.changeLanguage('en');
    // The router restores the scroll position, which jsdom does not implement.
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows the account error state with a Try again button when /auth/me answers 500, and stays there', async () => {
    answerMe(SERVER_FAILURE);

    const router = renderAt('/settings');

    expect(await screen.findByText(TITLE())).toBeInTheDocument();
    expect(screen.getByText(BODY())).toBeInTheDocument();
    expect(screen.getByRole('button', { name: TRY_AGAIN() })).toBeInTheDocument();
    // Not the API's own message, which is English and meant for developers.
    expect(screen.queryByText(/English developer message/)).not.toBeInTheDocument();

    // The provider has read the same failure by now; that must not turn into a sign-out.
    await letTheAppSettle();
    expect(router.state.location.pathname).toBe('/settings');
    expect(screen.getByText(TITLE())).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument();
    // One request, shared by the guard and the provider.
    expect(meCalls()).toHaveLength(1);
  });

  it('shows the same state when the API does not answer within the timeout', async () => {
    // `AbortSignal.timeout` runs on a native timer that fake timers do not move:
    // the request gets a signal the test aborts itself.
    const timeout = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal);
    fetchMock.mockImplementation((input, init) =>
      isMe(input)
        ? new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation timed out.', 'TimeoutError')));
          })
        : Promise.resolve(json(404, { code: 'not_found', message: 'Not found' })),
    );

    const router = renderAt('/settings');
    await waitFor(() => expect(meCalls()).toHaveLength(1));
    expect(screen.queryByText(TITLE())).not.toBeInTheDocument();

    timeout.abort();

    expect(await screen.findByText(TITLE())).toBeInTheDocument();
    await letTheAppSettle();
    expect(router.state.location.pathname).toBe('/settings');
  });

  it('Try again asks /auth/me again, opens the page once it answers and gives the shell the principal', async () => {
    const user = userEvent.setup();
    answerMe((attempt) => (attempt === 1 ? SERVER_FAILURE() : SIGNED_IN()));
    const router = renderAt('/settings');
    await user.click(await screen.findByRole('button', { name: TRY_AGAIN() }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' }, { timeout: 5000 })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/settings');
    expect(screen.queryByText(TITLE())).not.toBeInTheDocument();
    expect(meCalls()).toHaveLength(2);
    // The shell reads the principal from the provider, not from the guard: it
    // renders nothing at all unless the provider took the answer of the retry.
    expect(screen.getAllByRole('link', { name: i18n.t('admin:nav.organizations') }).length).toBeGreaterThan(0);
  });

  it('shows that it is trying while Try again waits for the answer, and the error state again when that fails', async () => {
    const user = userEvent.setup();
    let answer!: (response: Response) => void;
    answerMe((attempt) => (attempt === 1 ? SERVER_FAILURE() : new Promise<Response>((resolve) => (answer = resolve))));
    renderAt('/settings');
    await user.click(await screen.findByRole('button', { name: TRY_AGAIN() }));

    expect(await screen.findByText(i18n.t('common:state.loading'))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: TRY_AGAIN() })).not.toBeInTheDocument();

    answer(SERVER_FAILURE());

    expect(await screen.findByRole('button', { name: TRY_AGAIN() })).toBeInTheDocument();
    expect(screen.getByText(TITLE())).toBeInTheDocument();
    expect(screen.queryByText(i18n.t('common:state.loading'))).not.toBeInTheDocument();
  });

  it('keeps the error state when Try again fails again', async () => {
    const user = userEvent.setup();
    answerMe(SERVER_FAILURE);
    const router = renderAt('/settings');
    await user.click(await screen.findByRole('button', { name: TRY_AGAIN() }));

    await waitFor(() => expect(meCalls()).toHaveLength(2));
    await letTheAppSettle();

    expect(screen.getByText(TITLE())).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/settings');
  });

  it('sends the user to /sign-in with the return path when Try again finds that the session is gone', async () => {
    const user = userEvent.setup();
    answerMe((attempt) => (attempt === 1 ? SERVER_FAILURE() : json(401, { code: 'unauthenticated', message: 'No session' })));
    const router = renderAt('/settings');
    await user.click(await screen.findByRole('button', { name: TRY_AGAIN() }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/sign-in'));
    expect(router.state.location.search).toEqual({ return: '/settings' });
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('does not report an error that has nothing to do with the session as an account problem', () => {
    const ErrorView = AuthenticatedRoute.options.errorComponent as ComponentType<ErrorComponentProps>;

    render(<ErrorView error={new Error('A screen failed to render')} reset={() => undefined} />);

    expect(screen.queryByText(TITLE())).not.toBeInTheDocument();
    expect(screen.getByText('A screen failed to render')).toBeInTheDocument();
  });
});
