/**
 * Test-only helpers for the People and Org units screens: an i18n instance,
 * API fakes and a render function with query, toast and auth providers.
 */
import { vi } from 'vitest';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import i18next from 'i18next';
import type { Resource } from 'i18next';
import { resourcesFor } from '@nestself/i18n';
import { ApiError } from '@nestself/api-client';
import type { OrgAdminApi } from '@nestself/api-client';
import type { InvitationResponse, MemberItem, OrgUnitResponse, Principal } from '@nestself/contracts';
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

export const ORG_ID = 'org_sample';

export function apiError(status: number, code: string, details?: Record<string, unknown>): ApiError {
  return new ApiError({ status, code, message: `English ${code}`, requestId: null, details });
}

export function member(userId: string, displayName: string, overrides: Partial<MemberItem> = {}): MemberItem {
  return {
    membershipId: `mem_${userId}`,
    userId,
    displayName,
    email: `${userId}@example.com`,
    orgUnitId: null,
    costCenterUnitId: null,
    lineManagerUserId: null,
    status: 'ACTIVE',
    startDate: '2024-01-15T00:00:00.000Z',
    endDate: null,
    ...overrides,
  };
}

export function unit(id: string, parentId: string | null, kind: OrgUnitResponse['kind'], name: string): OrgUnitResponse {
  return { id, orgId: ORG_ID, parentId, kind, name, costCenterCode: null, archivedAt: null };
}

export const ORG_UNITS: OrgUnitResponse[] = [
  unit('ou_root', null, 'COMPANY', 'Example d.o.o.'),
  unit('ou_engineering', 'ou_root', 'DEPARTMENT', 'Engineering'),
  unit('team_product', 'ou_engineering', 'TEAM', 'Product'),
  unit('ou_commercial', 'ou_root', 'DEPARTMENT', 'Commercial'),
  unit('team_sales', 'ou_commercial', 'TEAM', 'Sales'),
];

export const MEMBERS: MemberItem[] = [
  member('user_ivana', 'Ivana Jovanović', { startDate: '2023-11-01T00:00:00.000Z' }),
  member('user_stefan', 'Stefan Marković', { orgUnitId: 'team_product' }),
  member('user_ana', 'Ana Nikolić', { orgUnitId: 'team_product', lineManagerUserId: 'user_stefan' }),
];

export function invitation(id: string, email: string, overrides: Partial<InvitationResponse> = {}): InvitationResponse {
  return {
    id,
    email,
    orgId: ORG_ID,
    orgUnitId: null,
    templateKey: 'employee',
    expiresAt: '2026-11-08T09:00:00.000Z',
    revokedAt: null,
    acceptedAt: null,
    invitedByUserId: 'user_ivana',
    createdAt: '2026-10-25T09:00:00.000Z',
    ...overrides,
  };
}

export const INVITATIONS: InvitationResponse[] = [
  invitation('inv_marko', 'marko.ilic@example.com', { orgUnitId: 'team_product' }),
  invitation('inv_jelena', 'jelena.savic@example.com', { templateKey: 'team_manager' }),
];

export function makeAdminApi(overrides: Partial<Record<keyof OrgAdminApi, unknown>> = {}): OrgAdminApi {
  return {
    listMembers: vi.fn().mockResolvedValue({ items: MEMBERS, nextCursor: null }),
    listOrgUnits: vi.fn().mockResolvedValue(ORG_UNITS),
    listInvitations: vi.fn().mockResolvedValue({ items: INVITATIONS, nextCursor: null }),
    updateMember: vi.fn().mockResolvedValue(MEMBERS[2]),
    endMember: vi.fn().mockResolvedValue({
      membershipId: 'mem_user_ana',
      status: 'ENDED',
      endDate: '2026-10-25T10:00:00.000Z',
      endedReason: 'DEACTIVATED_BY_HR',
      revokedGrantIds: [],
    }),
    createInvitation: vi.fn().mockResolvedValue(invitation('inv_new', 'new.person@example.com')),
    importInvitations: vi.fn().mockResolvedValue({ created: 1, skipped: 0, errors: [] }),
    revokeInvitation: vi.fn().mockResolvedValue(INVITATIONS[0]),
    createOrgUnit: vi.fn().mockResolvedValue(ORG_UNITS[2]),
    updateOrgUnit: vi.fn().mockResolvedValue(ORG_UNITS[2]),
    moveOrgUnit: vi.fn().mockResolvedValue(ORG_UNITS[2]),
    ...overrides,
  } as unknown as OrgAdminApi;
}

export const HR_PRINCIPAL: Principal = SAMPLE_PRINCIPALS.hr_admin.principal;

export function makeAuth(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    status: 'authenticated',
    principal: HR_PRINCIPAL,
    effectiveActions: [...SAMPLE_PRINCIPALS.hr_admin.effectiveActions],
    signOut: vi.fn().mockResolvedValue(undefined),
    switchContext: vi.fn().mockResolvedValue(undefined),
    stepUp: vi.fn().mockResolvedValue(true),
    refreshPrincipal: vi.fn().mockResolvedValue(undefined),
    error: null,
    ...overrides,
  };
}

/** Effective actions of the sample HR admin without the listed ones. */
export function actionsWithout(...removed: string[]): string[] {
  return SAMPLE_PRINCIPALS.hr_admin.effectiveActions.filter((a) => !removed.includes(a));
}

export function makeQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

export function renderWithProviders(
  element: ReactElement,
  auth: AuthContextValue = makeAuth(),
  queryClient: QueryClient = makeQueryClient(),
) {
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={testI18n}>
        <ToastProvider labels={{ dismiss: 'Dismiss' }}>
          <AuthContext value={auth}>{element}</AuthContext>
        </ToastProvider>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}
