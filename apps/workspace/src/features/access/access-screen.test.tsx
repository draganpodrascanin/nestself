import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, within, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UserEvent } from '@testing-library/user-event';
import {
  createRouter,
  createMemoryHistory,
  RouterProvider,
} from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import i18next from 'i18next';
import type { Resource } from 'i18next';
import { resourcesFor } from '@nestself/i18n';
import { ApiError } from '@nestself/api-client';
import type { OrgAdminApi } from '@nestself/api-client';
import type { GrantResponse, MemberItem, OrgUnitResponse, Principal } from '@nestself/contracts';
import { SAMPLE_GRANTS, SAMPLE_PRINCIPALS } from '@nestself/sample-data';
import { ToastProvider } from '@nestself/ui';
import { AuthContext } from '../../auth/auth-context';
import type { AuthContextValue } from '../../auth';
import { routeTree } from '../../routeTree.gen';
import { AccessScreen } from './access-screen';

const testI18n = i18next.createInstance();
void testI18n.use(initReactI18next).init({
  lng: 'en',
  resources: resourcesFor(['common', 'workspace', 'auth']) as Resource,
  interpolation: { escapeValue: false },
  returnNull: false,
});
const t = (key: string, opts?: Record<string, unknown>) => testI18n.t(key, opts);

const ORG_ID = 'org_sample';
const ACCESS_ACTIONS = ['access.preview', 'access.grant', 'access.revoke', 'access.delegate'];

function apiError(status: number, code: string, details?: Record<string, unknown>): ApiError {
  return new ApiError({ status, code, message: `English ${code}`, requestId: null, details });
}

function member(userId: string, displayName: string): MemberItem {
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
  };
}

const MEMBERS: MemberItem[] = [
  member('user_ivana', 'Ivana Jovanović'),
  member('user_stefan', 'Stefan Marković'),
  member('user_ana', 'Ana Nikolić'),
];

const ORG_UNITS: OrgUnitResponse[] = [
  { id: 'ou_root', orgId: ORG_ID, parentId: null, kind: 'COMPANY', name: 'Example d.o.o.', costCenterCode: null, archivedAt: null },
  { id: 'team_product', orgId: ORG_ID, parentId: 'ou_root', kind: 'TEAM', name: 'Product', costCenterCode: null, archivedAt: null },
];

function grant(overrides: Partial<GrantResponse> & Pick<GrantResponse, 'id' | 'subjectUserId' | 'templateKey'>): GrantResponse {
  return {
    actions: [],
    scopeType: 'organization',
    scopeOrgId: ORG_ID,
    scopeOrgUnitId: null,
    includeDescendants: false,
    conditions: [],
    validFrom: '2026-01-01T00:00:00.000Z',
    validUntil: null,
    parentGrantId: null,
    grantedByUserId: 'user_ivana',
    grantedAt: '2026-01-01T00:00:00.000Z',
    revokedAt: null,
    ...overrides,
  };
}

const GRANTS: GrantResponse[] = [
  grant({
    id: 'g_owner',
    subjectUserId: 'user_ivana',
    templateKey: 'employer_owner',
    actions: ['access.delegate', 'access.preview', 'policy.manage'],
  }),
  grant({
    id: 'g_manager',
    subjectUserId: 'user_stefan',
    templateKey: 'team_manager',
    scopeType: 'org_unit',
    scopeOrgUnitId: 'team_product',
    includeDescendants: true,
  }),
  grant({
    id: 'g_reporting',
    subjectUserId: 'user_ana',
    templateKey: 'reporting_user',
    revokedAt: '2026-02-01T00:00:00.000Z',
  }),
];

function makeAdminApi(overrides: Partial<Record<keyof OrgAdminApi, unknown>> = {}): OrgAdminApi {
  return {
    listGrants: vi.fn().mockResolvedValue({ items: GRANTS }),
    listMembers: vi.fn().mockResolvedValue({ items: MEMBERS, nextCursor: null }),
    listOrgUnits: vi.fn().mockResolvedValue(ORG_UNITS),
    previewAccess: vi.fn().mockResolvedValue({
      userId: 'user_stefan',
      orgId: ORG_ID,
      actions: ['budget.read', 'budget.allocate', 'events.request'],
      grantIds: ['g_manager'],
      assignmentIds: [],
    }),
    createGrant: vi.fn().mockResolvedValue(GRANTS[0]),
    revokeGrant: vi.fn().mockResolvedValue(GRANTS[1]),
    delegateGrant: vi.fn().mockResolvedValue(GRANTS[0]),
    transferOwnership: vi.fn().mockResolvedValue({
      revokedGrantId: 'g_owner',
      createdGrant: grant({ id: 'g_owner_new', subjectUserId: 'user_stefan', templateKey: 'employer_owner' }),
    }),
    ...overrides,
  } as unknown as OrgAdminApi;
}

const BASE_PRINCIPAL: Principal = SAMPLE_PRINCIPALS.hr_admin.principal;

function makeAuth(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    status: 'authenticated',
    principal: BASE_PRINCIPAL,
    effectiveActions: [...SAMPLE_PRINCIPALS.hr_admin.effectiveActions, ...ACCESS_ACTIONS],
    signOut: vi.fn().mockResolvedValue(undefined),
    switchContext: vi.fn().mockResolvedValue(undefined),
    stepUp: vi.fn().mockResolvedValue(true),
    refreshPrincipal: vi.fn().mockResolvedValue(undefined),
    error: null,
    ...overrides,
  };
}

function renderScreen(opts: { adminApi?: OrgAdminApi; auth?: AuthContextValue; sampleMode?: boolean } = {}) {
  const adminApi = opts.adminApi ?? makeAdminApi();
  const auth = opts.auth ?? makeAuth();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = (value: AuthContextValue) => (
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={testI18n}>
        <ToastProvider labels={{ dismiss: 'Dismiss' }}>
          <AuthContext value={value}>
            <AccessScreen adminApi={adminApi} sampleMode={opts.sampleMode ?? false} />
          </AuthContext>
        </ToastProvider>
      </I18nextProvider>
    </QueryClientProvider>
  );
  const result = render(ui(auth));
  return { adminApi, auth, rerender: (value: AuthContextValue) => result.rerender(ui(value)) };
}

async function choose(user: UserEvent, label: string, option: string) {
  await user.click(screen.getByRole('combobox', { name: label }));
  await user.click(await screen.findByRole('option', { name: option }));
}

async function openAssign(user: UserEvent) {
  await user.click(await screen.findByRole('button', { name: t('workspace:access.assign.open') }));
  return screen.findByRole('dialog', { name: t('workspace:access.assign.title') });
}

async function fillAssign(user: UserEvent, memberName: string, templateName: string) {
  const dialog = await openAssign(user);
  await choose(user, t('workspace:access.assign.member'), memberName);
  await choose(user, t('workspace:access.assign.template'), templateName);
  return dialog;
}

async function openRevoke(user: UserEvent, template: string, subject: string) {
  await user.click(
    await screen.findByRole('button', {
      name: t('workspace:access.revoke.openFor', { template, subject }),
    }),
  );
  return screen.findByRole('alertdialog', { name: t('workspace:access.revoke.title') });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('AccessScreen: grant table', () => {
  it('renders a row per grant with template, person, scope, validity and status', async () => {
    renderScreen();

    const managerRow = (await screen.findByText('Stefan Marković')).closest('tr')!;
    expect(within(managerRow).getByText(t('workspace:access.templates.team_manager'))).toBeInTheDocument();
    expect(
      within(managerRow).getByText(t('workspace:access.scope.unitWithDescendants', { name: 'Product' })),
    ).toBeInTheDocument();
    expect(within(managerRow).getByText(t('workspace:access.status.active'))).toBeInTheDocument();
    expect(within(managerRow).getByText(/1 January 2026/)).toBeInTheDocument();

    const ownerRow = screen.getByText('Ivana Jovanović').closest('tr')!;
    expect(within(ownerRow).getByText(t('workspace:access.templates.employer_owner'))).toBeInTheDocument();
    expect(within(ownerRow).getByText(t('workspace:access.scope.organization'))).toBeInTheDocument();

    const revokedRow = screen.getByText('Ana Nikolić').closest('tr')!;
    expect(within(revokedRow).getByText(t('workspace:access.status.revoked'))).toBeInTheDocument();
    expect(
      within(revokedRow).queryByRole('button', { name: /Revoke/ }),
    ).not.toBeInTheDocument();
  });

  it('reads the organization from the membership and lists its grants', async () => {
    const { adminApi } = renderScreen();
    await screen.findByText('Stefan Marković');
    expect(adminApi.listGrants).toHaveBeenCalledWith(ORG_ID, { includeRevoked: true });
  });

  it('shows the mapped message in an alert when the grants cannot be loaded', async () => {
    renderScreen({
      adminApi: makeAdminApi({ listGrants: vi.fn().mockRejectedValue(apiError(429, 'rate_limited')) }),
    });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(t('workspace:access.errors.loadTitle'));
    expect(alert).toHaveTextContent(t('workspace:access.errors.rateLimited'));
    expect(screen.queryByText('English rate_limited')).not.toBeInTheDocument();
  });

  it('shows the mapped message when the members cannot be loaded and keeps the table', async () => {
    renderScreen({
      adminApi: makeAdminApi({ listMembers: vi.fn().mockRejectedValue(apiError(429, 'rate_limited')) }),
    });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(t('workspace:access.errors.membersLoadTitle'));
    expect(alert).toHaveTextContent(t('workspace:access.errors.rateLimited'));
    expect(screen.getByText(t('workspace:access.templates.team_manager'))).toBeInTheDocument();
  });

  it('shows the fallback message when the org units cannot be loaded and keeps the table', async () => {
    renderScreen({
      adminApi: makeAdminApi({ listOrgUnits: vi.fn().mockRejectedValue(apiError(500, 'internal_error')) }),
    });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(t('workspace:access.errors.orgUnitsLoadTitle'));
    expect(alert).toHaveTextContent(t('workspace:access.errors.unknown'));
    expect(screen.queryByText('English internal_error')).not.toBeInTheDocument();
    expect(await screen.findByText('Stefan Marković')).toBeInTheDocument();
  });

  it('shows the empty state when the organization has no grants', async () => {
    renderScreen({ adminApi: makeAdminApi({ listGrants: vi.fn().mockResolvedValue({ items: [] }) }) });
    expect(await screen.findByText(t('workspace:access.empty'))).toBeInTheDocument();
  });
});

describe('AccessScreen: organization context', () => {
  it('switches to the membership organization once and waits before loading', async () => {
    const personal = { ...BASE_PRINCIPAL, context: { kind: 'personal' as const } };
    const auth = makeAuth({ principal: personal });
    const { adminApi, rerender } = renderScreen({ auth });

    await waitFor(() =>
      expect(auth.switchContext).toHaveBeenCalledWith({ kind: 'organization', orgId: ORG_ID }),
    );
    expect(adminApi.listGrants).not.toHaveBeenCalled();

    rerender({ ...auth, principal: { ...personal } });
    expect(auth.switchContext).toHaveBeenCalledTimes(1);

    rerender({ ...auth, principal: BASE_PRINCIPAL });
    await screen.findByText('Stefan Marković');
    expect(auth.switchContext).toHaveBeenCalledTimes(1);
  });

  it('does not switch when the principal is already in the organization', async () => {
    const { auth } = renderScreen();
    await screen.findByText('Stefan Marković');
    expect(auth.switchContext).not.toHaveBeenCalled();
  });

  it('uses the organization chosen in the header when the account has two active memberships', async () => {
    const auth = makeAuth({
      principal: {
        ...BASE_PRINCIPAL,
        memberships: [...BASE_PRINCIPAL.memberships, { ...BASE_PRINCIPAL.memberships[0]!, membershipId: 'mem_org_b', orgId: 'org_b', orgName: 'Second Example d.o.o.' }],
        context: { kind: 'organization', orgId: 'org_b' },
      },
    });
    const { adminApi } = renderScreen({ auth });
    expect(await screen.findByText('Stefan Marković')).toBeInTheDocument();
    expect(vi.mocked(adminApi.listGrants).mock.calls.every((call) => call[0] === 'org_b')).toBe(true);
    expect(auth.switchContext).not.toHaveBeenCalled();
    expect(screen.queryByText(t('workspace:access.noOrganization'))).not.toBeInTheDocument();
  });

  it('asks to choose an organization in the header when the context is personal and there are two', async () => {
    const auth = makeAuth({
      principal: {
        ...BASE_PRINCIPAL,
        memberships: [...BASE_PRINCIPAL.memberships, { ...BASE_PRINCIPAL.memberships[0]!, membershipId: 'mem_org_b', orgId: 'org_b', orgName: 'Second Example d.o.o.' }],
        context: { kind: 'personal' },
      },
    });
    const { adminApi } = renderScreen({ auth });
    expect(await screen.findByText(t('workspace:access.chooseOrganization'))).toBeInTheDocument();
    expect(auth.switchContext).not.toHaveBeenCalled();
    expect(adminApi.listGrants).not.toHaveBeenCalled();
  });

  it('shows the mapped message when the context switch fails', async () => {
    const auth = makeAuth({
      principal: { ...BASE_PRINCIPAL, context: { kind: 'personal' } },
      switchContext: vi.fn().mockRejectedValue(apiError(429, 'rate_limited')),
    });
    renderScreen({ auth });
    expect(await screen.findByRole('alert')).toHaveTextContent(t('workspace:access.errors.rateLimited'));
  });

  it('explains when the account has no single active membership', async () => {
    const { adminApi } = renderScreen({
      auth: makeAuth({ principal: { ...BASE_PRINCIPAL, memberships: [] } }),
    });
    expect(await screen.findByText(t('workspace:access.noOrganization'))).toBeInTheDocument();
    expect(adminApi.listGrants).not.toHaveBeenCalled();
  });
});

describe('AccessScreen: action gating', () => {
  it('hides assign, revoke and delegate without the matching actions', async () => {
    renderScreen({
      auth: makeAuth({ effectiveActions: ['program.overview', 'access.preview'] }),
    });
    await screen.findByText('Stefan Marković');
    expect(screen.queryByRole('button', { name: t('workspace:access.assign.open') })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Revoke/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Delegate/ })).not.toBeInTheDocument();
  });

  it('offers delegation only on the signed-in user’s own grants', async () => {
    renderScreen();
    await screen.findByText('Stefan Marković');
    const delegateButtons = screen.getAllByRole('button', { name: /^Delegate/ });
    expect(delegateButtons).toHaveLength(1);
    expect(delegateButtons[0]).toHaveAccessibleName(
      t('workspace:access.delegate.openFor', { template: t('workspace:access.templates.employer_owner') }),
    );
  });
});

describe('AssignTemplateDialog', () => {
  it('offers only active organization templates', async () => {
    const user = userEvent.setup();
    renderScreen();
    await openAssign(user);
    await user.click(screen.getByRole('combobox', { name: t('workspace:access.assign.template') }));
    const options = (await screen.findAllByRole('option')).map((o) => o.textContent);
    expect(options).toContain(t('workspace:access.templates.team_manager'));
    expect(options).not.toContain(t('workspace:access.templates.employee'));
    expect(options).not.toContain('Platform Owner');
  });

  it('shows the missing-conditions message when a required condition is empty', async () => {
    const user = userEvent.setup();
    const { adminApi } = renderScreen();
    const dialog = await fillAssign(user, 'Ana Nikolić', t('workspace:access.templates.approver'));

    await user.click(within(dialog).getByRole('button', { name: t('workspace:access.assign.submit') }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      t('workspace:access.errors.missingConditions'),
    );
    expect(adminApi.createGrant).not.toHaveBeenCalled();
  });

  it('creates the grant with the conditions and closes', async () => {
    const user = userEvent.setup();
    const { adminApi } = renderScreen();
    const dialog = await fillAssign(user, 'Ana Nikolić', t('workspace:access.templates.approver'));

    await user.type(within(dialog).getByLabelText(new RegExp(`^${t('workspace:access.conditions.amount')}`)), '1500');
    await user.type(within(dialog).getByLabelText(new RegExp(`^${t('workspace:access.conditions.currency')}`)), 'eur');
    await user.type(
      within(dialog).getByLabelText(new RegExp(`^${t('workspace:access.conditions.categories')}`)),
      'legal, financial',
    );
    await user.click(within(dialog).getByRole('button', { name: t('workspace:access.assign.submit') }));

    await waitFor(() => expect(adminApi.createGrant).toHaveBeenCalledTimes(1));
    expect(adminApi.createGrant).toHaveBeenCalledWith(ORG_ID, {
      templateKey: 'approver',
      subjectUserId: 'user_ana',
      scopeType: 'organization',
      includeDescendants: false,
      conditions: [
        { type: 'spending_ceiling', amountMinor: 150000, currency: 'EUR' },
        { type: 'categories', allowed: ['legal', 'financial'] },
      ],
    });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: t('workspace:access.assign.title') })).not.toBeInTheDocument());
  });

  it('requires an org unit for an org-unit scope and sends it', async () => {
    const user = userEvent.setup();
    const { adminApi } = renderScreen();
    const dialog = await fillAssign(user, 'Ana Nikolić', t('workspace:access.templates.reporting_user'));

    await user.click(within(dialog).getByRole('button', { name: t('workspace:access.assign.submit') }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      t('workspace:access.errors.orgUnitRequired'),
    );

    await choose(user, t('workspace:access.scope.unitLabel'), 'Product');
    await user.click(within(dialog).getByRole('checkbox', { name: t('workspace:access.scope.includeDescendants') }));
    await user.click(within(dialog).getByRole('button', { name: t('workspace:access.assign.submit') }));

    await waitFor(() =>
      expect(adminApi.createGrant).toHaveBeenCalledWith(ORG_ID, {
        templateKey: 'reporting_user',
        subjectUserId: 'user_ana',
        scopeType: 'org_unit',
        scopeOrgUnitId: 'team_product',
        includeDescendants: true,
        conditions: [],
      }),
    );
  });

  it.each([
    ['missing_conditions', 400, 'workspace:access.errors.missingConditions'],
    ['subject_not_member', 400, 'workspace:access.errors.subjectNotMember'],
    ['template_inactive', 400, 'workspace:access.errors.templateInactive'],
    ['rate_limited', 429, 'workspace:access.errors.rateLimited'],
    ['conflict', 409, 'workspace:access.errors.conflict'],
    ['internal_error', 500, 'workspace:access.errors.unknown'],
  ])('maps the API error %s to its message', async (code, status, key) => {
    const user = userEvent.setup();
    const { adminApi } = renderScreen({
      adminApi: makeAdminApi({ createGrant: vi.fn().mockRejectedValue(apiError(status, code)) }),
    });
    const dialog = await fillAssign(user, 'Ana Nikolić', t('workspace:access.templates.employer_owner'));

    await user.click(within(dialog).getByRole('button', { name: t('workspace:access.assign.submit') }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(t(key));
    expect(screen.queryByText(`English ${code}`)).not.toBeInTheDocument();
    expect(adminApi.createGrant).toHaveBeenCalledTimes(1);
  });

  it('retries after step-up and closes quietly when the user cancels step-up', async () => {
    const user = userEvent.setup();
    const auth = makeAuth({ stepUp: vi.fn().mockResolvedValue(false) });
    const createGrant = vi.fn().mockRejectedValue(apiError(403, 'step_up_required'));
    renderScreen({ auth, adminApi: makeAdminApi({ createGrant }) });
    const dialog = await fillAssign(user, 'Ana Nikolić', t('workspace:access.templates.employer_owner'));

    await user.click(within(dialog).getByRole('button', { name: t('workspace:access.assign.submit') }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: t('workspace:access.assign.title') })).not.toBeInTheDocument());
    expect(auth.stepUp).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows the owner-exists message when the organization already has an owner', async () => {
    const user = userEvent.setup();
    renderScreen({ adminApi: makeAdminApi({ createGrant: vi.fn().mockRejectedValue(apiError(409, 'owner_exists')) }) });
    const dialog = await fillAssign(user, 'Ana Nikolić', t('workspace:access.templates.employer_owner'));

    await user.click(within(dialog).getByRole('button', { name: t('workspace:access.assign.submit') }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(t('workspace:access.errors.ownerExists'));
  });

  it('retries the call once after a verified step-up', async () => {
    const user = userEvent.setup();
    const createGrant = vi
      .fn()
      .mockRejectedValueOnce(apiError(403, 'step_up_required'))
      .mockResolvedValueOnce(GRANTS[0]);
    const auth = makeAuth();
    renderScreen({ auth, adminApi: makeAdminApi({ createGrant }) });
    const dialog = await fillAssign(user, 'Ana Nikolić', t('workspace:access.templates.employer_owner'));

    await user.click(within(dialog).getByRole('button', { name: t('workspace:access.assign.submit') }));

    await waitFor(() => expect(createGrant).toHaveBeenCalledTimes(2));
    expect(auth.stepUp).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: t('workspace:access.assign.title') })).not.toBeInTheDocument());
  });
});

describe('RevokeGrantDialog', () => {
  it('shows the rate-limited message when the revoke is refused with 429', async () => {
    const user = userEvent.setup();
    const { adminApi } = renderScreen({
      adminApi: makeAdminApi({ revokeGrant: vi.fn().mockRejectedValue(apiError(429, 'rate_limited')) }),
    });
    const dialog = await openRevoke(user, t('workspace:access.templates.team_manager'), 'Stefan Marković');

    await user.type(within(dialog).getByLabelText(new RegExp(`^${t('workspace:access.reason.label')}`)), 'Left the team');
    await user.click(within(dialog).getByRole('button', { name: t('workspace:access.revoke.confirm') }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      t('workspace:access.errors.rateLimited'),
    );
    expect(adminApi.revokeGrant).toHaveBeenCalledWith(ORG_ID, 'g_manager', { reason: 'Left the team' });
  });

  it('shows the conflict message when the grant was already revoked', async () => {
    const user = userEvent.setup();
    renderScreen({
      adminApi: makeAdminApi({ revokeGrant: vi.fn().mockRejectedValue(apiError(409, 'conflict')) }),
    });
    const dialog = await openRevoke(user, t('workspace:access.templates.team_manager'), 'Stefan Marković');

    await user.type(within(dialog).getByLabelText(new RegExp(`^${t('workspace:access.reason.label')}`)), 'Left the team');
    await user.click(within(dialog).getByRole('button', { name: t('workspace:access.revoke.confirm') }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(t('workspace:access.errors.conflict'));
  });

  it('requires a reason of at least three characters', async () => {
    const user = userEvent.setup();
    const { adminApi } = renderScreen();
    const dialog = await openRevoke(user, t('workspace:access.templates.team_manager'), 'Stefan Marković');

    await user.type(within(dialog).getByLabelText(new RegExp(`^${t('workspace:access.reason.label')}`)), 'no');
    await user.click(within(dialog).getByRole('button', { name: t('workspace:access.revoke.confirm') }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      t('workspace:access.errors.reasonLength'),
    );
    expect(adminApi.revokeGrant).not.toHaveBeenCalled();
  });

  it('revokes and closes on success', async () => {
    const user = userEvent.setup();
    const { adminApi } = renderScreen();
    const dialog = await openRevoke(user, t('workspace:access.templates.team_manager'), 'Stefan Marković');

    await user.type(within(dialog).getByLabelText(new RegExp(`^${t('workspace:access.reason.label')}`)), 'Left the team');
    await user.click(within(dialog).getByRole('button', { name: t('workspace:access.revoke.confirm') }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(adminApi.revokeGrant).toHaveBeenCalledTimes(1);
  });

  it('disables the confirm button while the revoke runs', async () => {
    const user = userEvent.setup();
    let finish: (value: GrantResponse) => void = () => {};
    const revokeGrant = vi.fn(() => new Promise<GrantResponse>((resolve) => (finish = resolve)));
    renderScreen({ adminApi: makeAdminApi({ revokeGrant }) });
    const dialog = await openRevoke(user, t('workspace:access.templates.team_manager'), 'Stefan Marković');

    await user.type(within(dialog).getByLabelText(new RegExp(`^${t('workspace:access.reason.label')}`)), 'Left the team');
    await user.click(within(dialog).getByRole('button', { name: t('workspace:access.revoke.confirm') }));

    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: t('workspace:access.revoke.confirm') })).toBeDisabled(),
    );
    finish(GRANTS[1]!);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(revokeGrant).toHaveBeenCalledTimes(1);
  });

  it('closes quietly when the user cancels step-up', async () => {
    const user = userEvent.setup();
    const auth = makeAuth({ stepUp: vi.fn().mockResolvedValue(false) });
    renderScreen({
      auth,
      adminApi: makeAdminApi({ revokeGrant: vi.fn().mockRejectedValue(apiError(403, 'step_up_required')) }),
    });
    const dialog = await openRevoke(user, t('workspace:access.templates.team_manager'), 'Stefan Marković');

    await user.type(within(dialog).getByLabelText(new RegExp(`^${t('workspace:access.reason.label')}`)), 'Left the team');
    await user.click(within(dialog).getByRole('button', { name: t('workspace:access.revoke.confirm') }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('DelegateGrantDialog', () => {
  async function openDelegate(user: UserEvent) {
    await user.click(
      await screen.findByRole('button', {
        name: t('workspace:access.delegate.openFor', { template: t('workspace:access.templates.employer_owner') }),
      }),
    );
    return screen.findByRole('dialog', { name: t('workspace:access.delegate.title') });
  }

  it('delegates the chosen actions of the parent grant', async () => {
    const user = userEvent.setup();
    const { adminApi } = renderScreen();
    const dialog = await openDelegate(user);

    await choose(user, t('workspace:access.delegate.member'), 'Ana Nikolić');
    await user.click(within(dialog).getByRole('checkbox', { name: 'access.preview' }));
    await user.click(within(dialog).getByRole('button', { name: t('workspace:access.delegate.submit') }));

    await waitFor(() =>
      expect(adminApi.delegateGrant).toHaveBeenCalledWith(ORG_ID, {
        parentGrantId: 'g_owner',
        subjectUserId: 'user_ana',
        actions: ['access.preview'],
        conditions: [],
      }),
    );
  });

  it('requires at least one action', async () => {
    const user = userEvent.setup();
    const { adminApi } = renderScreen();
    const dialog = await openDelegate(user);

    await choose(user, t('workspace:access.delegate.member'), 'Ana Nikolić');
    await user.click(within(dialog).getByRole('button', { name: t('workspace:access.delegate.submit') }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      t('workspace:access.errors.actionsRequired'),
    );
    expect(
      within(dialog).getByRole('group', { name: t('workspace:access.delegate.actions') }),
    ).toHaveAccessibleDescription(t('workspace:access.errors.actionsRequired'));
    expect(adminApi.delegateGrant).not.toHaveBeenCalled();
  });

  it('shows the boundary message when the delegation exceeds the delegator', async () => {
    const user = userEvent.setup();
    renderScreen({
      adminApi: makeAdminApi({
        delegateGrant: vi
          .fn()
          .mockRejectedValue(apiError(403, 'delegation_exceeds_boundary', { reason: 'actions' })),
      }),
    });
    const dialog = await openDelegate(user);

    await choose(user, t('workspace:access.delegate.member'), 'Ana Nikolić');
    await user.click(within(dialog).getByRole('checkbox', { name: 'access.preview' }));
    await user.click(within(dialog).getByRole('button', { name: t('workspace:access.delegate.submit') }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      t('workspace:access.errors.delegationExceedsBoundary'),
    );
  });
});

describe('EffectiveAccessPanel', () => {
  it('lists the previewed actions grouped by prefix', async () => {
    const user = userEvent.setup();
    const { adminApi } = renderScreen();
    await screen.findByText('Stefan Marković');

    await choose(user, t('workspace:access.preview.member'), 'Stefan Marković');

    const panel = screen.getByRole('region', { name: t('workspace:access.preview.title') });
    const budget = await within(panel).findByRole('list', { name: 'budget' });
    expect(within(budget).getByText('budget.read')).toBeInTheDocument();
    expect(within(budget).getByText('budget.allocate')).toBeInTheDocument();
    expect(within(panel).getByRole('list', { name: 'events' })).toHaveTextContent('events.request');
    expect(adminApi.previewAccess).toHaveBeenCalledWith(ORG_ID, 'user_stefan');
  });

  it('shows the mapped message when the preview fails', async () => {
    const user = userEvent.setup();
    renderScreen({
      adminApi: makeAdminApi({ previewAccess: vi.fn().mockRejectedValue(apiError(429, 'rate_limited')) }),
    });
    await screen.findByText('Stefan Marković');

    await choose(user, t('workspace:access.preview.member'), 'Stefan Marković');

    const panel = screen.getByRole('region', { name: t('workspace:access.preview.title') });
    expect(await within(panel).findByRole('alert')).toHaveTextContent(t('workspace:access.errors.rateLimited'));
  });
});

describe('TransferOwnershipDialog', () => {
  const TRANSFER_OPEN = () => t('workspace:access.transfer.open');
  const TRANSFER_TITLE = () => t('workspace:access.transfer.title');

  async function openTransfer(user: UserEvent) {
    await user.click(await screen.findByRole('button', { name: TRANSFER_OPEN() }));
    return screen.findByRole('dialog', { name: TRANSFER_TITLE() });
  }

  async function submitTransfer(user: UserEvent, dialog: HTMLElement, memberName = 'Stefan Marković') {
    await choose(user, t('workspace:access.transfer.member'), memberName);
    await user.click(within(dialog).getByRole('button', { name: t('workspace:access.transfer.submit') }));
  }

  it('is offered only to the holder of the active owner grant', async () => {
    renderScreen();
    expect(await screen.findByRole('button', { name: TRANSFER_OPEN() })).toBeEnabled();
    cleanup();

    const revokedOwner = GRANTS.map((g) => (g.id === 'g_owner' ? { ...g, revokedAt: '2026-03-01T00:00:00.000Z' } : g));
    renderScreen({ adminApi: makeAdminApi({ listGrants: vi.fn().mockResolvedValue({ items: revokedOwner }) }) });
    await screen.findByText('Stefan Marković');
    expect(screen.queryByRole('button', { name: TRANSFER_OPEN() })).not.toBeInTheDocument();
    cleanup();

    const someoneElse = GRANTS.map((g) => (g.id === 'g_owner' ? { ...g, subjectUserId: 'user_ana' } : g));
    renderScreen({ adminApi: makeAdminApi({ listGrants: vi.fn().mockResolvedValue({ items: someoneElse }) }) });
    await screen.findByText('Stefan Marković');
    expect(screen.queryByRole('button', { name: TRANSFER_OPEN() })).not.toBeInTheDocument();
  });

  it('lists the other active members and says that the caller loses owner rights', async () => {
    const user = userEvent.setup();
    renderScreen();
    const dialog = await openTransfer(user);

    expect(within(dialog).getByText(t('workspace:access.transfer.confirmation'))).toBeInTheDocument();
    await user.click(screen.getByRole('combobox', { name: t('workspace:access.transfer.member') }));
    const options = (await screen.findAllByRole('option')).map((o) => o.textContent);
    expect(options).toEqual(['Stefan Marković', 'Ana Nikolić']);
  });

  it('requires a member', async () => {
    const user = userEvent.setup();
    const { adminApi } = renderScreen();
    const dialog = await openTransfer(user);

    await user.click(within(dialog).getByRole('button', { name: t('workspace:access.transfer.submit') }));

    expect(await within(dialog).findAllByText(t('workspace:access.errors.memberRequired'))).not.toHaveLength(0);
    expect(adminApi.transferOwnership).not.toHaveBeenCalled();
  });

  it('transfers, refetches the grants, refreshes the principal and drops the owner-only controls', async () => {
    const user = userEvent.setup();
    const afterTransfer: GrantResponse[] = [
      ...GRANTS.map((g) => (g.id === 'g_owner' ? { ...g, revokedAt: '2026-10-25T00:00:00.000Z' } : g)),
      grant({ id: 'g_owner_new', subjectUserId: 'user_stefan', templateKey: 'employer_owner' }),
    ];
    const listGrants = vi
      .fn()
      .mockResolvedValueOnce({ items: GRANTS })
      .mockResolvedValue({ items: afterTransfer });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const adminApi = makeAdminApi({ listGrants });
    // refreshPrincipal swaps in the actions the caller keeps without the owner grant.
    let current: AuthContextValue;
    const ui = () => (
      <QueryClientProvider client={queryClient}>
        <I18nextProvider i18n={testI18n}>
          <ToastProvider labels={{ dismiss: 'Dismiss' }}>
            <AuthContext value={current}>
              <AccessScreen adminApi={adminApi} sampleMode={false} />
            </AuthContext>
          </ToastProvider>
        </I18nextProvider>
      </QueryClientProvider>
    );
    const refreshPrincipal = vi.fn(async () => {
      current = { ...current, effectiveActions: [...SAMPLE_PRINCIPALS.hr_admin.effectiveActions, 'access.preview'].filter((a) => a !== 'access.grant' && a !== 'access.revoke') };
      result.rerender(ui());
    });
    current = makeAuth({ refreshPrincipal });
    const result = render(ui());

    expect(await screen.findByRole('button', { name: t('workspace:access.assign.open') })).toBeInTheDocument();
    const dialog = await openTransfer(user);
    await submitTransfer(user, dialog);

    await waitFor(() => expect(adminApi.transferOwnership).toHaveBeenCalledWith(ORG_ID, { newOwnerUserId: 'user_stefan' }));
    await waitFor(() => expect(listGrants).toHaveBeenCalledTimes(2));
    expect(refreshPrincipal).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: TRANSFER_TITLE() })).not.toBeInTheDocument());
    expect(await screen.findByText(t('workspace:access.transfer.success'))).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: TRANSFER_OPEN() })).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: t('workspace:access.assign.open') })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Revoke/ })).not.toBeInTheDocument();
  });

  it.each([
    ['forbidden', 403, 'notOwner'],
    ['subject_not_member', 409, 'subjectNotMember'],
    ['conflict', 409, 'alreadyOwner'],
    ['owner_exists', 409, 'ownerExists'],
    ['rate_limited', 429, 'rateLimited'],
    ['internal_error', 500, 'unknown'],
  ] as const)('shows the %s failure (%i) as access.errors.%s', async (code, status, key) => {
    const user = userEvent.setup();
    const auth = makeAuth();
    renderScreen({
      auth,
      adminApi: makeAdminApi({ transferOwnership: vi.fn().mockRejectedValue(apiError(status, code)) }),
    });
    const dialog = await openTransfer(user);

    await submitTransfer(user, dialog);

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(t(`workspace:access.errors.${key}`));
    expect(screen.getByRole('dialog', { name: TRANSFER_TITLE() })).toBeInTheDocument();
    expect(auth.refreshPrincipal).not.toHaveBeenCalled();
  });

  it('retries once after a verified step-up', async () => {
    const user = userEvent.setup();
    const transferOwnership = vi
      .fn()
      .mockRejectedValueOnce(apiError(403, 'step_up_required'))
      .mockResolvedValueOnce({ revokedGrantId: 'g_owner', createdGrant: GRANTS[0] });
    const auth = makeAuth();
    renderScreen({ auth, adminApi: makeAdminApi({ transferOwnership }) });
    const dialog = await openTransfer(user);

    await submitTransfer(user, dialog);

    await waitFor(() => expect(transferOwnership).toHaveBeenCalledTimes(2));
    expect(auth.stepUp).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: TRANSFER_TITLE() })).not.toBeInTheDocument());
  });

  it('closes quietly when the user cancels step-up', async () => {
    const user = userEvent.setup();
    const auth = makeAuth({ stepUp: vi.fn().mockResolvedValue(false) });
    renderScreen({
      auth,
      adminApi: makeAdminApi({ transferOwnership: vi.fn().mockRejectedValue(apiError(403, 'step_up_required')) }),
    });
    const dialog = await openTransfer(user);

    await submitTransfer(user, dialog);

    await waitFor(() => expect(screen.queryByRole('dialog', { name: TRANSFER_TITLE() })).not.toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(auth.refreshPrincipal).not.toHaveBeenCalled();
  });
});

/** A member list that answers `search` as the API does: a prefix of the name or the email. */
function searchableMembers() {
  return vi.fn(async (_orgId: string, query: { search?: string }) => {
    const term = query.search?.toLowerCase();
    return {
      items: MEMBERS.filter(
        (m) => !term || m.displayName.toLowerCase().startsWith(term) || m.email.toLowerCase().startsWith(term),
      ),
      nextCursor: null,
    };
  });
}

const SEARCH_LABEL = () => new RegExp(`^${t('workspace:access.memberSearch.label')}`);

describe('AccessScreen: member search', () => {
  it('assigns a template to the member found by searching the dialog', async () => {
    const user = userEvent.setup();
    const listMembers = searchableMembers();
    const { adminApi } = renderScreen({ adminApi: makeAdminApi({ listMembers }) });
    const dialog = await openAssign(user);

    await user.type(within(dialog).getByRole('searchbox', { name: SEARCH_LABEL() }), 'ana');
    await waitFor(() => expect(listMembers).toHaveBeenCalledWith(ORG_ID, { status: 'ACTIVE', limit: 100, search: 'ana' }));
    await user.click(screen.getByRole('combobox', { name: t('workspace:access.assign.member') }));
    expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual(['Ana Nikolić']);
    await user.click(screen.getByRole('option', { name: 'Ana Nikolić' }));
    await choose(user, t('workspace:access.assign.template'), t('workspace:access.templates.employer_owner'));
    await user.click(within(dialog).getByRole('button', { name: t('workspace:access.assign.submit') }));

    await waitFor(() =>
      expect(adminApi.createGrant).toHaveBeenCalledWith(
        ORG_ID,
        expect.objectContaining({ templateKey: 'employer_owner', subjectUserId: 'user_ana' }),
      ),
    );
  });

  it('does not submit the dialog when Enter is pressed in the search field', async () => {
    const user = userEvent.setup();
    const { adminApi } = renderScreen({ adminApi: makeAdminApi({ listMembers: searchableMembers() }) });
    const dialog = await openAssign(user);

    await user.type(within(dialog).getByRole('searchbox', { name: SEARCH_LABEL() }), 'ana{Enter}');

    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
    expect(adminApi.createGrant).not.toHaveBeenCalled();
  });

  it('shows a failed search in the dialog as translated copy, never the API message', async () => {
    const user = userEvent.setup();
    const listMembers = vi
      .fn()
      .mockResolvedValueOnce({ items: MEMBERS, nextCursor: null })
      .mockRejectedValue(apiError(429, 'rate_limited'));
    renderScreen({ adminApi: makeAdminApi({ listMembers }) });
    const dialog = await openAssign(user);

    await user.type(within(dialog).getByRole('searchbox', { name: SEARCH_LABEL() }), 'ana');

    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent(t('workspace:access.errors.membersLoadTitle'));
    expect(alert).toHaveTextContent(t('workspace:access.errors.rateLimited'));
    expect(screen.queryByText('English rate_limited')).not.toBeInTheDocument();
  });

  it('offers the delegation to the members found, never to the delegator', async () => {
    const user = userEvent.setup();
    const listMembers = searchableMembers();
    renderScreen({ adminApi: makeAdminApi({ listMembers }) });
    await user.click(
      await screen.findByRole('button', {
        name: t('workspace:access.delegate.openFor', { template: t('workspace:access.templates.employer_owner') }),
      }),
    );
    const dialog = await screen.findByRole('dialog', { name: t('workspace:access.delegate.title') });

    // Ivana is the signed-in delegator: she is not among the choices even when the search finds her.
    await user.type(within(dialog).getByRole('searchbox', { name: SEARCH_LABEL() }), 'iva');
    await waitFor(() => expect(listMembers).toHaveBeenCalledWith(ORG_ID, { status: 'ACTIVE', limit: 100, search: 'iva' }));
    await user.click(screen.getByRole('combobox', { name: t('workspace:access.delegate.member') }));

    expect(await screen.findByText(t('workspace:access.memberSearch.noMatch'))).toBeInTheDocument();
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
  });

  it('hands the ownership to the member found by searching the dialog', async () => {
    const user = userEvent.setup();
    const listMembers = searchableMembers();
    const { adminApi } = renderScreen({ adminApi: makeAdminApi({ listMembers }) });
    await user.click(await screen.findByRole('button', { name: t('workspace:access.transfer.open') }));
    const dialog = await screen.findByRole('dialog', { name: t('workspace:access.transfer.title') });

    await user.type(within(dialog).getByRole('searchbox', { name: SEARCH_LABEL() }), 'ste');
    await waitFor(() => expect(listMembers).toHaveBeenCalledWith(ORG_ID, { status: 'ACTIVE', limit: 100, search: 'ste' }));
    await user.click(screen.getByRole('combobox', { name: t('workspace:access.transfer.member') }));
    expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual(['Stefan Marković']);
    await user.click(screen.getByRole('option', { name: 'Stefan Marković' }));
    await user.click(within(dialog).getByRole('button', { name: t('workspace:access.transfer.submit') }));

    await waitFor(() => expect(adminApi.transferOwnership).toHaveBeenCalledWith(ORG_ID, { newOwnerUserId: 'user_stefan' }));
  });

  it('previews the access of the member found by searching the panel', async () => {
    const user = userEvent.setup();
    const listMembers = searchableMembers();
    const { adminApi } = renderScreen({ adminApi: makeAdminApi({ listMembers }) });
    await screen.findByText('Stefan Marković');
    const panel = screen.getByRole('region', { name: t('workspace:access.preview.title') });

    await user.type(within(panel).getByRole('searchbox', { name: SEARCH_LABEL() }), 'ste');
    await waitFor(() => expect(listMembers).toHaveBeenCalledWith(ORG_ID, { status: 'ACTIVE', limit: 100, search: 'ste' }));
    await user.click(within(panel).getByRole('combobox', { name: t('workspace:access.preview.member') }));
    expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual(['Stefan Marković']);
    await user.click(screen.getByRole('option', { name: 'Stefan Marković' }));

    await waitFor(() => expect(adminApi.previewAccess).toHaveBeenCalledWith(ORG_ID, 'user_stefan'));
  });

  it('keeps naming people in the grant table from the plain member list while searching', async () => {
    const user = userEvent.setup();
    renderScreen({ adminApi: makeAdminApi({ listMembers: searchableMembers() }) });
    await screen.findByText('Stefan Marković');
    const panel = screen.getByRole('region', { name: t('workspace:access.preview.title') });

    await user.type(within(panel).getByRole('searchbox', { name: SEARCH_LABEL() }), 'zzz');
    expect(await within(panel).findByText(t('workspace:access.memberSearch.noMatch'))).toBeInTheDocument();

    const managerRow = screen.getByText(t('workspace:access.templates.team_manager')).closest('tr')!;
    expect(within(managerRow).getByText('Stefan Marković')).toBeInTheDocument();
  });
});

describe('AccessScreen: sample mode', () => {
  it('searches the sample members in the browser and calls no API', async () => {
    const user = userEvent.setup();
    const { adminApi } = renderScreen({ sampleMode: true });
    const panel = await screen.findByRole('region', { name: t('workspace:access.preview.title') });

    await user.type(within(panel).getByRole('searchbox', { name: SEARCH_LABEL() }), 'ana');
    await user.click(within(panel).getByRole('combobox', { name: t('workspace:access.preview.member') }));

    await waitFor(() => expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Ana Nikolić']));
    expect(adminApi.listMembers).not.toHaveBeenCalled();
  });

  it('derives rows from the sample grants of the organization and calls no API', async () => {
    const { adminApi } = renderScreen({ sampleMode: true });

    const orgGrants = SAMPLE_GRANTS.filter((g) => g.scopeOrgId === ORG_ID);
    const rows = await screen.findAllByRole('row');
    expect(rows).toHaveLength(orgGrants.length + 1);
    const ownerRow = screen.getByText(t('workspace:access.templates.employer_owner')).closest('tr')!;
    expect(within(ownerRow).getByText('Ivana Jovanović')).toBeInTheDocument();
    expect(adminApi.listGrants).not.toHaveBeenCalled();
  });

  it('disables mutations and says that nothing is created', async () => {
    renderScreen({ sampleMode: true });
    expect(await screen.findByText(t('workspace:access.sampleNote'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('workspace:access.assign.open') })).toBeDisabled();
    expect(screen.getByRole('button', { name: t('workspace:access.transfer.open') })).toBeDisabled();
    for (const button of screen.getAllByRole('button', { name: /^(Revoke|Delegate)/ })) {
      expect(button).toBeDisabled();
    }
  });
});

describe('access route and navigation', () => {
  type SampleRole = keyof typeof SAMPLE_PRINCIPALS;

  function renderRoute(initialUrl: string, role: SampleRole) {
    window.history.replaceState(null, '', `/?role=${role}`);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const sample = SAMPLE_PRINCIPALS[role];
    const router = createRouter({
      routeTree,
      context: {
        queryClient,
        auth: { principal: sample.principal, effectiveActions: sample.effectiveActions },
      },
      history: createMemoryHistory({ initialEntries: [initialUrl] }),
    });
    return render(
      <QueryClientProvider client={queryClient}>
        <I18nextProvider i18n={testI18n}>
          <RouterProvider router={router} />
        </I18nextProvider>
      </QueryClientProvider>,
    );
  }

  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('an employee does not see the access nav item', async () => {
    renderRoute('/', 'employee');
    await screen.findAllByRole('link', { name: t('common:nav.home') });
    expect(screen.queryByRole('link', { name: t('workspace:access.nav') })).not.toBeInTheDocument();
  });

  it('an employee is turned away from /hr/access', async () => {
    renderRoute('/hr/access', 'employee');
    expect(await screen.findByText(/this view is not available/i)).toBeInTheDocument();
  });

  it('the sample HR admin sees the nav item and the screen with the sample banner', async () => {
    renderRoute('/hr/access', 'hr_admin');
    expect(await screen.findByRole('heading', { name: t('workspace:access.title') })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: t('workspace:access.nav') }).length).toBeGreaterThan(0);
    expect(screen.getByText(t('common:sample.banner'))).toBeInTheDocument();
  });
});
