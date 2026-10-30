/**
 * Test-only harness for the operations organization, people and user
 * screens: a mocked `OpsAdminApi`, an auth context in the operations
 * context, and a memory router (the client list links to organization
 * pages) around the screen under test.
 */
import { vi } from 'vitest';
import { configure, render, screen } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
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
import type { OpsAdminApi } from '@nestself/api-client';
import type { GrantResponse, InvitationResponse, MemberItem, OrganizationResponse, Principal } from '@nestself/contracts';
import { SAMPLE_PRINCIPALS } from '@nestself/sample-data';
import { ToastProvider } from '@nestself/ui';
import { AuthContext } from '../../auth/auth-context';
import type { AuthContextValue } from '../../auth';

// The first render of a file waits for the router and the lazy UI imports;
// give `findBy*` more than the 1 s default on a busy machine.
configure({ asyncUtilTimeout: 4000 });

export const testI18n = i18next.createInstance();
void testI18n.use(initReactI18next).init({
  lng: 'en',
  resources: resourcesFor(['common', 'admin', 'auth']) as Resource,
  interpolation: { escapeValue: false },
  returnNull: false,
});
export const t = (key: string, opts?: Record<string, unknown>) => testI18n.t(key, opts);

export const ORG_ID = 'org_sample';
export const ORG_PAGE_TEXT = 'Organization page stand-in';

export function apiError(status: number, code: string, details?: Record<string, unknown>): ApiError {
  return new ApiError({ status, code, message: `English ${code}`, requestId: null, ...(details ? { details } : {}) });
}

export function organization(id: string, name: string, overrides: Partial<OrganizationResponse> = {}): OrganizationResponse {
  return { id, name, slug: name.toLowerCase().replace(/[^a-z]+/g, '-'), status: 'ACTIVE', createdAt: '2026-03-01T00:00:00.000Z', ...overrides };
}

export function member(userId: string, displayName: string, overrides: Partial<MemberItem> = {}): MemberItem {
  return {
    membershipId: `mem_${userId}`,
    userId,
    displayName,
    email: `${userId}@example.test`,
    orgUnitId: null,
    costCenterUnitId: null,
    lineManagerUserId: null,
    status: 'ACTIVE',
    startDate: '2024-01-01T00:00:00.000Z',
    endDate: null,
    ...overrides,
  };
}

export function invitation(id: string, email: string, overrides: Partial<InvitationResponse> = {}): InvitationResponse {
  return {
    id,
    orgId: ORG_ID,
    email,
    templateKey: 'employee',
    orgUnitId: null,
    expiresAt: '2026-11-30T00:00:00.000Z',
    revokedAt: null,
    acceptedAt: null,
    invitedByUserId: 'user_admin',
    createdAt: '2026-10-20T00:00:00.000Z',
    ...overrides,
  };
}

export function ownerGrant(subjectUserId: string, overrides: Partial<GrantResponse> = {}): GrantResponse {
  return {
    id: `g_owner_${subjectUserId}`,
    subjectUserId,
    templateKey: 'employer_owner',
    actions: [],
    scopeType: 'organization',
    scopeOrgId: ORG_ID,
    scopeOrgUnitId: null,
    includeDescendants: false,
    conditions: [],
    validFrom: '2026-01-01T00:00:00.000Z',
    validUntil: null,
    parentGrantId: null,
    grantedByUserId: 'user_admin',
    grantedAt: '2026-01-01T00:00:00.000Z',
    revokedAt: null,
    ...overrides,
  };
}

export const MEMBERS: MemberItem[] = [
  member('user_ivana', 'Ivana Jovanović'),
  member('user_stefan', 'Stefan Marković'),
  member('user_ana', 'Ana Nikolić'),
];

export function makeOpsApi(overrides: Partial<Record<keyof OpsAdminApi, unknown>> = {}): OpsAdminApi {
  return {
    listOrganizations: vi.fn().mockResolvedValue({ items: [organization(ORG_ID, 'Example d.o.o.')], nextCursor: null }),
    getOrganization: vi.fn().mockResolvedValue(organization(ORG_ID, 'Example d.o.o.', { slug: 'example' })),
    listGrants: vi.fn().mockResolvedValue({ items: [ownerGrant('user_ivana')] }),
    listMembers: vi.fn().mockResolvedValue({ items: MEMBERS, nextCursor: null }),
    endMember: vi.fn().mockResolvedValue({ membershipId: 'mem_user_ana', status: 'ENDED', endDate: '2026-10-25T00:00:00.000Z' }),
    listInvitations: vi.fn().mockResolvedValue({ items: [invitation('inv_1', 'mila@example.test')], nextCursor: null }),
    createInvitation: vi.fn().mockResolvedValue(invitation('inv_2', 'new@example.test')),
    importInvitations: vi.fn().mockResolvedValue({ created: 1, skipped: 0, errors: [] }),
    revokeInvitation: vi.fn().mockResolvedValue(invitation('inv_1', 'mila@example.test', { revokedAt: '2026-10-25T00:00:00.000Z' })),
    transferOwnership: vi.fn().mockResolvedValue({ revokedGrantId: null, createdGrant: ownerGrant('user_stefan') }),
    userAccess: vi.fn().mockResolvedValue({ userId: 'user_stefan', suspended: false, contexts: [] }),
    suspendUser: vi.fn().mockResolvedValue({ userId: 'user_stefan', suspendedAt: '2026-10-25T00:00:00.000Z' }),
    reinstateUser: vi.fn().mockResolvedValue({ userId: 'user_stefan', reinstatedAt: '2026-10-25T00:00:00.000Z' }),
    ...overrides,
  } as unknown as OpsAdminApi;
}

/** The sample platform owner, in the operations context. */
export const ADMIN = SAMPLE_PRINCIPALS.admin;
export const OPS_PRINCIPAL: Principal = ADMIN.principal;
/** Platform owner actions plus the client-operations onboarding ones, so every control shows. */
export const STAFF_ACTIONS: string[] = [...ADMIN.effectiveActions, 'people.onboard', 'people.import'];

export function makeAuth(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    status: 'authenticated',
    principal: OPS_PRINCIPAL,
    effectiveActions: STAFF_ACTIONS,
    signOut: vi.fn().mockResolvedValue(undefined),
    switchContext: vi.fn().mockResolvedValue(undefined),
    stepUp: vi.fn().mockResolvedValue(true),
    refreshPrincipal: vi.fn().mockResolvedValue(undefined),
    error: null,
    ...overrides,
  };
}

export interface RenderOpts {
  opsApi?: OpsAdminApi;
  auth?: AuthContextValue;
  sampleMode?: boolean;
}

/** Renders `screenFor(...)` at `/` of a memory router with a stand-in organization page. */
export function renderOps(screenFor: (opsApi: OpsAdminApi, sampleMode: boolean) => ReactNode, opts: RenderOpts = {}) {
  const opsApi = opts.opsApi ?? makeOpsApi();
  const auth = opts.auth ?? makeAuth();
  const sampleMode = opts.sampleMode ?? false;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <>{screenFor(opsApi, sampleMode)}</>,
  });
  const orgRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/organizations/$orgId',
    component: () => <p>{ORG_PAGE_TEXT}</p>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, orgRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });

  const ui = (value: AuthContextValue) => (
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={testI18n}>
        <ToastProvider labels={{ dismiss: 'Dismiss' }}>
          <AuthContext value={value}>
            <RouterProvider router={router} />
          </AuthContext>
        </ToastProvider>
      </I18nextProvider>
    </QueryClientProvider>
  );
  const result = render(ui(auth));
  return {
    opsApi,
    auth,
    queryClient,
    router,
    /** Re-renders with another auth value (for example after a context switch). */
    rerender: (value: AuthContextValue) => result.rerender(ui(value)),
  };
}

export async function choose(user: UserEvent, label: string, option: string) {
  await user.click(screen.getByRole('combobox', { name: label }));
  await user.click(await screen.findByRole('option', { name: option }));
}
