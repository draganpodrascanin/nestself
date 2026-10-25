/**
 * Test-only harness for the account feature: a memory router with the screen
 * under test at `/settings` and a stand-in `/sign-in`, so sign-out tests can
 * assert where the user lands.
 */
import { vi } from 'vitest';
import { render } from '@testing-library/react';
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
import { I18nextProvider, initReactI18next } from 'react-i18next';
import i18next from 'i18next';
import type { Resource } from 'i18next';
import { resourcesFor } from '@nestself/i18n';
import { ApiError } from '@nestself/api-client';
import type { Principal } from '@nestself/contracts';
import { SAMPLE_PRINCIPALS } from '@nestself/sample-data';
import { ToastProvider } from '@nestself/ui';
import { AuthContext } from '../../auth/auth-context';
import type { AuthContextValue } from '../../auth';
import type { AccountApi } from './use-account';

export const testI18n = i18next.createInstance();
void testI18n.use(initReactI18next).init({
  lng: 'en',
  resources: resourcesFor(['common', 'admin', 'auth']) as Resource,
  interpolation: { escapeValue: false },
  returnNull: false,
});
export const t = (key: string, opts?: Record<string, unknown>) => testI18n.t(key, opts);

export const SIGN_IN_TEXT = 'Sign-in page stand-in';

export function apiError(status: number, code: string): ApiError {
  return new ApiError({ status, code, message: `English ${code}`, requestId: null });
}

export const EMPLOYEE: Principal = SAMPLE_PRINCIPALS.employee.principal;

export function passwordPrincipal(secondFactor: boolean): Principal {
  return {
    ...SAMPLE_PRINCIPALS.operations.principal,
    auth: { ...SAMPLE_PRINCIPALS.operations.principal.auth, method: 'password_totp', secondFactor },
  };
}

export function makeAccountApi(overrides: Partial<Record<keyof AccountApi, unknown>> = {}): AccountApi {
  return {
    listSessions: vi.fn().mockResolvedValue({ sessions: [] }),
    revokeSession: vi.fn().mockResolvedValue(undefined),
    signOutAll: vi.fn().mockResolvedValue(undefined),
    updateDisplayName: vi.fn().mockResolvedValue(undefined),
    updateLocale: vi.fn().mockResolvedValue(undefined),
    totpEnrolSignedIn: vi
      .fn()
      .mockResolvedValue({ secretUri: 'otpauth://totp/NestSelf:nikola?secret=JBSWY3DPEHPK3PXP', challengeToken: null }),
    totpConfirm: vi.fn().mockResolvedValue({ enrolled: true }),
    ...overrides,
  } as unknown as AccountApi;
}

export function makeAuth(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    status: 'authenticated',
    principal: EMPLOYEE,
    effectiveActions: [],
    signOut: vi.fn().mockResolvedValue(undefined),
    switchContext: vi.fn().mockResolvedValue(undefined),
    stepUp: vi.fn().mockResolvedValue(true),
    refreshPrincipal: vi.fn().mockResolvedValue(undefined),
    error: null,
    ...overrides,
  };
}

/**
 * Renders `ui` at `/` and `/settings` inside the app providers, starting at
 * `path`. `auth` is a context value, or a wrapper that renders a real provider.
 */
export function renderAccount(
  ui: ReactNode,
  auth: AuthContextValue | ((children: ReactNode) => ReactNode) = makeAuth(),
  path = '/settings',
) {
  const withAuth =
    typeof auth === 'function'
      ? auth
      : (children: ReactNode) => <AuthContext value={auth}>{children}</AuthContext>;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: () => <>{ui}</> });
  const settingsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/settings', component: () => <>{ui}</> });
  const signInRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/sign-in',
    component: () => <p>{SIGN_IN_TEXT}</p>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([homeRoute, settingsRoute, signInRoute]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={testI18n}>
        <ToastProvider labels={{ dismiss: 'Dismiss' }}>
          {withAuth(<RouterProvider router={router} />)}
        </ToastProvider>
      </I18nextProvider>
    </QueryClientProvider>,
  );
  return { router };
}
