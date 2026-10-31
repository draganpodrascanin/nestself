/**
 * `/invite/:token` in API mode: accepting sends the language the page is
 * shown in, so the code email the acceptance sends is written in it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRouter, createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

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
import i18n from '../i18n';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const urlOf = (input: Parameters<typeof fetch>[0]) =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

/** No session; the invitation previews and accepts with an email code. */
function answerInvitationRoutes() {
  fetchMock.mockImplementation((input) => {
    const url = urlOf(input);
    if (url.endsWith('/api/invitations/tok-1/preview')) return Promise.resolve(json(200, { organizationName: 'Example d.o.o.' }));
    if (url.endsWith('/api/invitations/accept')) {
      return Promise.resolve(json(200, { method: 'email_otp', challengeToken: 'challenge-1', ssoStartUrl: null, step: null }));
    }
    return Promise.resolve(json(401, { code: 'unauthenticated', message: 'No session' }));
  });
}

function acceptBody(): unknown {
  const call = fetchMock.mock.calls.find(([input]) => urlOf(input).endsWith('/api/invitations/accept'));
  return call ? JSON.parse(call[1]!.body as string) : undefined;
}

function renderInvite() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree,
    context: {
      queryClient,
      auth: { principal: null, effectiveActions: [], settled: false, ensure: () => initialSnapshot(api) },
    },
    history: createMemoryHistory({ initialEntries: ['/invite/tok-1'] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('invitation acceptance (API mode)', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    answerInvitationRoutes();
    // The router restores the scroll position, which jsdom does not implement.
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    cleanup();
    vi.restoreAllMocks();
    await i18n.changeLanguage('en');
  });

  it('accepting sends the language of the page for the code email', async () => {
    await i18n.changeLanguage('hu');
    renderInvite();

    const accept = await screen.findByRole('button', { name: i18n.t('auth:invite.accept') }, { timeout: 5000 });
    await userEvent.setup().click(accept);

    await waitFor(() => expect(acceptBody()).toEqual({ token: 'tok-1', locale: 'hu' }));
  });
});
