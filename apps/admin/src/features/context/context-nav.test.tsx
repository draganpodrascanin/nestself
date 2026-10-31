/**
 * Review Focus 4 (admin): after a switch in the header picker, the gated
 * navigation follows the `effectiveActions` of the new context without a
 * reload, and the operations hook does not switch back on its own.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
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
import { ApiError } from '@nestself/api-client';
import type { ApiClient } from '@nestself/api-client';
import type { AvailableContextEntry, MeResponse, Principal } from '@nestself/contracts';
import { SAMPLE_PRINCIPALS } from '@nestself/sample-data';
import { ToastProvider } from '@nestself/ui';
import { AuthProvider } from '../../auth';
import { AuthContext } from '../../auth/auth-context';
import type { AuthContextValue } from '../../auth';
import { Route as AuthenticatedRoute } from '../../routes/_authenticated';
import { useOperationsContext } from '../access/use-ops-admin';
import { makeAuth, t, testI18n } from '../account/account-test-harness';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const ADMIN = SAMPLE_PRINCIPALS.admin;

// The admin sample fixture has only [{ kind: 'operations' }] in
// availableContexts. For the picker to render (it needs >=2 options), we add
// a personal context entry so both tests can switch between the two.
const ADMIN_CONTEXTS: AvailableContextEntry[] = [
  { kind: 'operations' },
  { kind: 'personal', orgId: 'org_admin_home', orgName: 'Personal' },
];

const OPS_ME: MeResponse = { principal: ADMIN.principal, effectiveActions: [...ADMIN.effectiveActions], availableContexts: ADMIN_CONTEXTS };
const PERSONAL_ME: MeResponse = {
  principal: { ...ADMIN.principal, context: { kind: 'personal' } },
  effectiveActions: ['preferences.manage'],
  availableContexts: ADMIN_CONTEXTS,
};

function fakeClient() {
  let current = OPS_ME;
  const request = vi.fn(async (path: string, init: RequestInit) => {
    if (path === '/api/auth/context' && init.method === 'POST') {
      const { context } = JSON.parse(String(init.body)) as { context: { kind: string } };
      current = context.kind === 'personal' ? PERSONAL_ME : OPS_ME;
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
  const home = createRoute({ getParentRoute: () => shell, path: '/', component: () => <p>overview page</p> });
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
}

const sidebar = () => screen.getByRole('navigation', { name: 'Admin navigation' });

describe('context switch and gated navigation (admin, Review Focus 4)', () => {
  it('drops Access and Emergency access once the new context no longer grants them, without a reload', async () => {
    const user = userEvent.setup();
    const { client, request } = fakeClient();
    renderShell(client);

    const page = await screen.findByText('overview page');
    expect(within(sidebar()).getByRole('link', { name: t('admin:nav.access') })).toBeInTheDocument();
    expect(within(sidebar()).getByRole('link', { name: t('admin:nav.emergency') })).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', {
        name: t('auth:context.picker.open', { name: t('auth:context.picker.option.operations') }),
      }),
    );
    const menu = await screen.findByRole('menu', { name: t('auth:context.picker.heading') });
    await user.click(within(menu).getByRole('menuitem', { name: t('auth:context.picker.option.personal') }));

    await waitFor(() =>
      expect(within(sidebar()).queryByRole('link', { name: t('admin:nav.access') })).not.toBeInTheDocument(),
    );
    expect(within(sidebar()).queryByRole('link', { name: t('admin:nav.emergency') })).not.toBeInTheDocument();
    expect(page).toBeInTheDocument();
    const paths = request.mock.calls.map(([path, init]) => `${(init as RequestInit).method} ${path}`);
    expect(paths.slice(-2)).toEqual(['POST /api/auth/context', 'GET /api/auth/me']);
  });
});

describe('useOperationsContext', () => {
  function renderWithAuth(initial: AuthContextValue) {
    let auth = initial;
    const wrapper = ({ children }: { children: ReactNode }) => <AuthContext value={auth}>{children}</AuthContext>;
    const utils = renderHook(() => useOperationsContext(false), { wrapper });
    return {
      ...utils,
      setPrincipal(principal: Principal) {
        auth = { ...auth, principal };
        utils.rerender();
      },
    };
  }

  it('switches once when the session is not in the operations context', () => {
    const switchContext = vi.fn().mockResolvedValue(undefined);
    renderWithAuth(makeAuth({ principal: { ...ADMIN.principal, context: { kind: 'personal' } }, switchContext }));
    expect(switchContext).toHaveBeenCalledTimes(1);
    expect(switchContext).toHaveBeenCalledWith({ kind: 'operations' });
  });

  it('does not switch back after the picker moved an operations screen to another context', () => {
    const switchContext = vi.fn().mockResolvedValue(undefined);
    const { result, setPrincipal } = renderWithAuth(makeAuth({ principal: ADMIN.principal, switchContext }));
    expect(result.current.ready).toBe(true);
    setPrincipal({ ...ADMIN.principal, context: { kind: 'personal' } });
    expect(switchContext).not.toHaveBeenCalled();
    expect(result.current.ready).toBe(false);
  });
});

describe('a context that is no longer valid (admin)', () => {
  it('refreshes after invalid_context and the ended organization disappears from the menu', async () => {
    const user = userEvent.setup();
    // The picker derives options from availableContexts, not memberships.
    // Initially the admin has an extra org context that will become invalid.
    const withOrg: MeResponse = {
      ...OPS_ME,
      availableContexts: [
        { kind: 'operations' },
        { kind: 'organization', orgId: 'org_sample', orgName: 'Example d.o.o.' },
      ],
    };
    let current = withOrg;
    const request = vi.fn(async (path: string, init: RequestInit) => {
      if (path === '/api/auth/context' && init.method === 'POST') {
        current = OPS_ME;
        throw new ApiError({ status: 403, code: 'invalid_context', message: 'English', requestId: null });
      }
      if (path === '/api/auth/me') return current;
      throw new Error(`unexpected ${path}`);
    });
    renderShell({ request, baseUrl: '' } as unknown as ApiClient);
    await screen.findByText('overview page');

    const trigger = () =>
      screen.getByRole('button', {
        name: t('auth:context.picker.open', { name: t('auth:context.picker.option.operations') }),
      });
    await user.click(trigger());
    let menu = await screen.findByRole('menu', { name: t('auth:context.picker.heading') });
    await user.click(within(menu).getByRole('menuitem', { name: 'Example d.o.o.' }));

    expect((await screen.findAllByText(t('auth:context.picker.errors.invalidContext'))).length).toBeGreaterThan(0);
    await waitFor(() =>
      expect(request.mock.calls.filter(([path]) => path === '/api/auth/me').length).toBeGreaterThanOrEqual(2),
    );
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    await user.click(trigger());
    menu = await screen.findByRole('menu', { name: t('auth:context.picker.heading') });
    expect(within(menu).queryByText('Example d.o.o.')).not.toBeInTheDocument();
  });
});
