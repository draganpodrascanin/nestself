/**
 * Test-only helpers for the expert area and the participant conversations:
 * an i18n instance, a professional API fake, and a render function with a
 * memory router (so links resolve), query, toast and auth providers.
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
import type { ProfessionalApi } from '@nestself/api-client';
import type { ConversationResponse, ConversationSummary, IntakeResponse, Principal } from '@nestself/contracts';
import { SAMPLE_PRINCIPALS } from '@nestself/sample-data';
import { ToastProvider } from '@nestself/ui';
import { AuthContext } from '../../auth/auth-context';
import type { AuthContextValue } from '../../auth';

export const testI18n = i18next.createInstance();
void testI18n.use(initReactI18next).init({
  lng: 'en',
  resources: resourcesFor(['common', 'workspace', 'auth']) as Resource,
  interpolation: { escapeValue: false },
  returnNull: false,
});
export const t = (key: string, opts?: Record<string, unknown>) => testI18n.t(key, opts);

export function apiError(status: number, code: string): ApiError {
  return new ApiError({ status, code, message: `English ${code}`, requestId: null });
}

/** The API's expert: an expert record and staff templates (operations by default). */
export const EXPERT: Principal = {
  ...SAMPLE_PRINCIPALS.expert.principal,
  context: { kind: 'expert' },
};
export const EMPLOYEE: Principal = SAMPLE_PRINCIPALS.employee.principal;

export function summary(id: string, overrides: Partial<ConversationSummary> = {}): ConversationSummary {
  return {
    id,
    caseId: `case_${id}`,
    orgId: 'org_sample',
    employeeUserId: 'user_jovan',
    expertUserId: 'user_milica',
    createdAt: '2026-10-01T09:00:00.000Z',
    messageCount: 2,
    ...overrides,
  };
}

export const CONVERSATION: ConversationResponse = {
  id: 'conv_1',
  caseId: 'case_1',
  orgId: 'org_sample',
  messages: [
    { id: 'm1', authorUserId: 'user_jovan', body: 'First test body', createdAt: '2026-10-01T09:00:00.000Z' },
    { id: 'm2', authorUserId: 'user_milica', body: 'Second test body', createdAt: '2026-10-01T09:05:00.000Z' },
  ],
};

export const INTAKE: IntakeResponse = {
  id: 'intake_1',
  caseId: 'case_1',
  orgId: 'org_sample',
  body: 'Intake test body',
  createdAt: '2026-10-01T08:55:00.000Z',
};

export function makePro(overrides: Partial<Record<keyof ProfessionalApi, unknown>> = {}): ProfessionalApi {
  return {
    listAssignedConversations: vi.fn().mockResolvedValue({ items: [summary('conv_1')], nextCursor: null }),
    listMyConversations: vi.fn().mockResolvedValue({ items: [summary('conv_1')], nextCursor: null }),
    getConversation: vi.fn().mockResolvedValue(CONVERSATION),
    getMyConversation: vi.fn().mockResolvedValue(CONVERSATION),
    getIntake: vi.fn().mockResolvedValue(INTAKE),
    ...overrides,
  } as unknown as ProfessionalApi;
}

export function makeAuth(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    status: 'authenticated',
    principal: EXPERT,
    effectiveActions: [...SAMPLE_PRINCIPALS.expert.effectiveActions],
    signOut: vi.fn().mockResolvedValue(undefined),
    switchContext: vi.fn().mockResolvedValue(undefined),
    stepUp: vi.fn().mockResolvedValue(true),
    refreshPrincipal: vi.fn().mockResolvedValue(undefined),
    error: null,
    ...overrides,
  };
}

export function makeQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

/** Renders `ui` at `path` (any of the expert and conversation routes) with a stand-in elsewhere. */
export function renderAt(
  ui: ReactNode,
  path: string,
  auth: AuthContextValue = makeAuth(),
  queryClient: QueryClient = makeQueryClient(),
) {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const page = () => <>{ui}</>;
  const routes = ['/', '/cases', '/cases/$id', '/conversations', '/conversations/$id'].map((p) =>
    createRoute({ getParentRoute: () => rootRoute, path: p, component: page }),
  );
  const router = createRouter({
    routeTree: rootRoute.addChildren(routes),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={testI18n}>
        <ToastProvider labels={{ dismiss: 'Dismiss' }}>
          <AuthContext value={auth}>
            <RouterProvider router={router} />
          </AuthContext>
        </ToastProvider>
      </I18nextProvider>
    </QueryClientProvider>,
  );
  return { ...utils, router, queryClient };
}
