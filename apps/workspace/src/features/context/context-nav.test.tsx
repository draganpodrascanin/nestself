/**
 * Review Focus 4: after a switch in the header picker, the gated navigation
 * follows the `effectiveActions` of the new context without a reload. The
 * real AuthProvider runs against a fake API client; the real authenticated
 * layout renders the navigation.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import type { ApiClient } from '@nestself/api-client';
import type { MeResponse } from '@nestself/contracts';
import { SAMPLE_PRINCIPALS } from '@nestself/sample-data';
import { ToastProvider } from '@nestself/ui';
import { AuthProvider } from '../../auth';
import { Route as AuthenticatedRoute } from '../../routes/_authenticated';
import { t, testI18n } from '../cases/cases-test-harness';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const HR = SAMPLE_PRINCIPALS.hr_admin;

const ORG_ME: MeResponse = { principal: HR.principal, effectiveActions: [...HR.effectiveActions] };
const PERSONAL_ME: MeResponse = {
  principal: { ...HR.principal, context: { kind: 'personal' } },
  effectiveActions: ['content.read', 'conversation.participate', 'preferences.manage'],
};

function fakeClient() {
  let current = ORG_ME;
  const request = vi.fn(async (path: string, init: RequestInit) => {
    if (path === '/api/auth/context' && init.method === 'POST') {
      const { context } = JSON.parse(String(init.body)) as { context: { kind: string } };
      current = context.kind === 'personal' ? PERSONAL_ME : ORG_ME;
      return current;
    }
    if (path === '/api/auth/me') return current;
    throw new Error(`unexpected ${path}`);
  });
  return { client: { request, baseUrl: '' } as unknown as ApiClient, request };
}

/** The real layout of the authenticated shell (not code-split under Vitest). */
const AuthenticatedLayout = AuthenticatedRoute.options.component!;

function renderShell(client: ApiClient) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const shell = createRoute({ getParentRoute: () => rootRoute, id: 'shell', component: AuthenticatedLayout });
  const home = createRoute({ getParentRoute: () => shell, path: '/', component: () => <p>home page</p> });
  const router = createRouter({
    routeTree: rootRoute.addChildren([shell.addChildren([home])]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={testI18n}>
        <ToastProvider labels={{ dismiss: 'Dismiss' }}>
          <AuthProvider client={client}>
            <RouterProvider router={router} />
          </AuthProvider>
        </ToastProvider>
      </I18nextProvider>
    </QueryClientProvider>,
  );
  return { router };
}

const sidebar = () => screen.getAllByRole('navigation', { name: t('common:nav.menu') })[0]!;

describe('context switch and gated navigation (Review Focus 4)', () => {
  it('drops the HR items once the new context no longer grants them, without a reload', async () => {
    const user = userEvent.setup();
    const { client, request } = fakeClient();
    renderShell(client);

    await screen.findByText('home page');
    expect(within(sidebar()).getByRole('link', { name: t('common:nav.hr') })).toBeInTheDocument();
    expect(within(sidebar()).getByRole('link', { name: t('workspace:people.nav') })).toBeInTheDocument();
    const homePage = screen.getByText('home page');

    await user.click(screen.getByRole('button', { name: t('auth:context.picker.open', { name: 'Example d.o.o.' }) }));
    const menu = await screen.findByRole('menu', { name: t('auth:context.picker.heading') });
    await user.click(within(menu).getByRole('menuitem', { name: t('auth:context.picker.option.personal') }));

    await waitFor(() =>
      expect(within(sidebar()).queryByRole('link', { name: t('common:nav.hr') })).not.toBeInTheDocument(),
    );
    expect(within(sidebar()).queryByRole('link', { name: t('workspace:people.nav') })).not.toBeInTheDocument();
    expect(within(sidebar()).getByRole('link', { name: t('workspace:conversations.nav') })).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: t('auth:context.picker.open', { name: t('auth:context.picker.option.personal') }),
      }),
    ).toBeInTheDocument();
    // Same document: the page element survived, nothing reloaded.
    expect(homePage).toBeInTheDocument();

    const paths = request.mock.calls.map(([path, init]) => `${(init as RequestInit).method} ${path}`);
    expect(paths.slice(-2)).toEqual(['POST /api/auth/context', 'GET /api/auth/me']);
  });
});
