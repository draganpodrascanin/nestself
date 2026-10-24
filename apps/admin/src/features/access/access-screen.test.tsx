import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor, within, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UserEvent } from '@testing-library/user-event';
import { createRouter, createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import i18next from 'i18next';
import type { Resource } from 'i18next';
import type { ReactNode } from 'react';
import { resourcesFor } from '@nestself/i18n';
import { ApiError } from '@nestself/api-client';
import type { OpsAdminApi } from '@nestself/api-client';
import type { GrantResponse, MemberItem, Principal } from '@nestself/contracts';
import { SAMPLE_GRANTS, SAMPLE_PRINCIPALS } from '@nestself/sample-data';
import { ToastProvider } from '@nestself/ui';
import { AuthContext } from '../../auth/auth-context';
import type { AuthContextValue } from '../../auth';
import appI18n from '../../i18n';
import { routeTree } from '../../routeTree.gen';
import { OrgAccessScreen } from './org-access-screen';
import { PlatformAccessScreen } from './platform-access-screen';

const testI18n = i18next.createInstance();
void testI18n.use(initReactI18next).init({
  lng: 'en',
  resources: resourcesFor(['common', 'admin', 'auth']) as Resource,
  interpolation: { escapeValue: false },
  returnNull: false,
});
const t = (key: string, opts?: Record<string, unknown>) => testI18n.t(key, opts);

const ORG_ID = 'org_sample';

function apiError(status: number, code: string): ApiError {
  return new ApiError({ status, code, message: `English ${code}`, requestId: null });
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

function grant(
  overrides: Partial<GrantResponse> & Pick<GrantResponse, 'id' | 'subjectUserId' | 'templateKey'>,
): GrantResponse {
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
    grantedByUserId: 'user_admin',
    grantedAt: '2026-01-01T00:00:00.000Z',
    revokedAt: null,
    ...overrides,
  };
}

const GRANTS: GrantResponse[] = [
  grant({ id: 'g_owner', subjectUserId: 'user_ivana', templateKey: 'employer_owner' }),
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

const PLATFORM_GRANTS: GrantResponse[] = [
  grant({
    id: 'pg_ops',
    subjectUserId: 'user_nikola',
    templateKey: 'client_operations',
    scopeType: 'assigned_clients',
    scopeOrgId: null,
  }),
];

const NEW_PLATFORM_GRANT = grant({
  id: 'pg_support',
  subjectUserId: 'user_mira',
  templateKey: 'support_operator',
  scopeType: 'assigned_cases',
  scopeOrgId: null,
});

function makeOpsApi(overrides: Partial<Record<keyof OpsAdminApi, unknown>> = {}): OpsAdminApi {
  return {
    listGrants: vi.fn().mockResolvedValue({ items: GRANTS }),
    listMembers: vi.fn().mockResolvedValue({ items: MEMBERS, nextCursor: null }),
    createGrant: vi.fn().mockResolvedValue(GRANTS[0]),
    revokeGrant: vi.fn().mockResolvedValue(GRANTS[1]),
    previewAccess: vi.fn(),
    listPlatformGrants: vi.fn().mockResolvedValue({ items: PLATFORM_GRANTS }),
    createPlatformGrant: vi.fn().mockResolvedValue(NEW_PLATFORM_GRANT),
    revokePlatformGrant: vi.fn().mockResolvedValue(PLATFORM_GRANTS[0]),
    userAccess: vi.fn().mockResolvedValue({
      userId: 'user_stefan',
      contexts: [
        { orgId: null, actions: ['support.troubleshoot', 'account.help'], grantIds: ['pg_x'], assignmentIds: [] },
        {
          orgId: ORG_ID,
          actions: ['budget.read', 'budget.allocate', 'events.request'],
          grantIds: ['g_manager'],
          assignmentIds: [],
        },
      ],
    }),
    ...overrides,
  } as unknown as OpsAdminApi;
}

const ADMIN = SAMPLE_PRINCIPALS.admin;
const BASE_PRINCIPAL: Principal = ADMIN.principal;

function makeAuth(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    status: 'authenticated',
    principal: BASE_PRINCIPAL,
    effectiveActions: ADMIN.effectiveActions,
    signOut: vi.fn().mockResolvedValue(undefined),
    switchContext: vi.fn().mockResolvedValue(undefined),
    stepUp: vi.fn().mockResolvedValue(true),
    refreshPrincipal: vi.fn().mockResolvedValue(undefined),
    error: null,
    ...overrides,
  };
}

interface RenderOpts {
  opsApi?: OpsAdminApi;
  auth?: AuthContextValue;
  sampleMode?: boolean;
}

function renderWith(screenFor: (opsApi: OpsAdminApi, sampleMode: boolean) => ReactNode, opts: RenderOpts) {
  const opsApi = opts.opsApi ?? makeOpsApi();
  const auth = opts.auth ?? makeAuth();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = (value: AuthContextValue) => (
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={testI18n}>
        <ToastProvider labels={{ dismiss: 'Dismiss' }}>
          <AuthContext value={value}>{screenFor(opsApi, opts.sampleMode ?? false)}</AuthContext>
        </ToastProvider>
      </I18nextProvider>
    </QueryClientProvider>
  );
  const result = render(ui(auth));
  return { opsApi, auth, rerender: (value: AuthContextValue) => result.rerender(ui(value)) };
}

const renderOrg = (opts: RenderOpts = {}) =>
  renderWith((opsApi, sampleMode) => <OrgAccessScreen opsApi={opsApi} orgId={ORG_ID} sampleMode={sampleMode} />, opts);

const renderPlatform = (opts: RenderOpts = {}) =>
  renderWith((opsApi, sampleMode) => <PlatformAccessScreen opsApi={opsApi} sampleMode={sampleMode} />, opts);

async function choose(user: UserEvent, label: string, option: string) {
  await user.click(screen.getByRole('combobox', { name: label }));
  await user.click(await screen.findByRole('option', { name: option }));
}

const assignDialogName = () => t('admin:access.assign.title');

async function openAssign(user: UserEvent) {
  await user.click(await screen.findByRole('button', { name: t('admin:access.assign.open') }));
  return screen.findByRole('dialog', { name: assignDialogName() });
}

async function fillOrgAssign(user: UserEvent, memberName: string, templateName: string) {
  const dialog = await openAssign(user);
  await choose(user, t('admin:access.assign.member'), memberName);
  await choose(user, t('admin:access.assign.template'), templateName);
  return dialog;
}

async function fillPlatformAssign(user: UserEvent, userId: string, templateName: string) {
  const dialog = await openAssign(user);
  await user.type(within(dialog).getByLabelText(new RegExp(`^${t('admin:access.assign.userId')}`)), userId);
  await choose(user, t('admin:access.assign.template'), templateName);
  return dialog;
}

async function openRevoke(user: UserEvent, template: string, subject: string) {
  await user.click(
    await screen.findByRole('button', { name: t('admin:access.revoke.openFor', { template, subject }) }),
  );
  return screen.findByRole('alertdialog', { name: t('admin:access.revoke.title') });
}

const submitButton = (dialog: HTMLElement) =>
  within(dialog).getByRole('button', { name: t('admin:access.assign.submit') });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Organization access page
// ---------------------------------------------------------------------------

describe('OrgAccessScreen: grant table', () => {
  it('renders a row per grant with template, person, scope and status', async () => {
    renderOrg();

    const managerRow = (await screen.findByText('Stefan Marković')).closest('tr')!;
    expect(within(managerRow).getByText(t('admin:access.templates.team_manager'))).toBeInTheDocument();
    expect(within(managerRow).getByText(t('admin:access.scope.org_unit'))).toBeInTheDocument();
    expect(within(managerRow).getByText(t('admin:access.status.active'))).toBeInTheDocument();
    expect(within(managerRow).getByText(/1 January 2026/)).toBeInTheDocument();

    const ownerRow = screen.getByText('Ivana Jovanović').closest('tr')!;
    expect(within(ownerRow).getByText(t('admin:access.templates.employer_owner'))).toBeInTheDocument();
    expect(within(ownerRow).getByText(t('admin:access.scope.organization'))).toBeInTheDocument();

    const revokedRow = screen.getByText('Ana Nikolić').closest('tr')!;
    expect(within(revokedRow).getByText(t('admin:access.status.revoked'))).toBeInTheDocument();
    expect(within(revokedRow).queryByRole('button', { name: /^Revoke/ })).not.toBeInTheDocument();
  });

  it('lists the grants of the organization from the URL', async () => {
    const { opsApi } = renderOrg();
    await screen.findByText('Stefan Marković');
    expect(opsApi.listGrants).toHaveBeenCalledWith(ORG_ID, { includeRevoked: true });
  });

  it('shows the mapped message in an alert when the grants cannot be loaded', async () => {
    renderOrg({ opsApi: makeOpsApi({ listGrants: vi.fn().mockRejectedValue(apiError(429, 'rate_limited')) }) });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(t('admin:access.errors.loadTitle'));
    expect(alert).toHaveTextContent(t('admin:access.errors.rateLimited'));
    expect(screen.queryByText('English rate_limited')).not.toBeInTheDocument();
  });

  it('shows the forbidden message when the organization is not assigned to the caller', async () => {
    renderOrg({ opsApi: makeOpsApi({ listGrants: vi.fn().mockRejectedValue(apiError(403, 'forbidden')) }) });
    expect(await screen.findByRole('alert')).toHaveTextContent(t('admin:access.errors.forbidden'));
  });

  it('shows the mapped message when the members cannot be loaded and keeps the table', async () => {
    renderOrg({ opsApi: makeOpsApi({ listMembers: vi.fn().mockRejectedValue(apiError(500, 'internal_error')) }) });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(t('admin:access.errors.membersLoadTitle'));
    expect(alert).toHaveTextContent(t('admin:access.errors.unknown'));
    expect(screen.queryByText('English internal_error')).not.toBeInTheDocument();
    expect(await screen.findByText(t('admin:access.templates.team_manager'))).toBeInTheDocument();
    // Without names the table falls back to the user id.
    expect(screen.getByText('user_stefan')).toBeInTheDocument();
  });

  it('shows the empty state when the organization has no grants', async () => {
    renderOrg({ opsApi: makeOpsApi({ listGrants: vi.fn().mockResolvedValue({ items: [] }) }) });
    expect(await screen.findByText(t('admin:access.empty'))).toBeInTheDocument();
  });
});

describe('Access screens: operations context', () => {
  const personal = { ...BASE_PRINCIPAL, context: { kind: 'personal' as const } };

  it('switches to the operations context once and waits before loading', async () => {
    const auth = makeAuth({ principal: personal });
    const { opsApi, rerender } = renderOrg({ auth });

    await waitFor(() => expect(auth.switchContext).toHaveBeenCalledWith({ kind: 'operations' }));
    expect(opsApi.listGrants).not.toHaveBeenCalled();

    rerender({ ...auth, principal: { ...personal } });
    expect(auth.switchContext).toHaveBeenCalledTimes(1);

    rerender({ ...auth, principal: BASE_PRINCIPAL });
    await screen.findByText('Stefan Marković');
    expect(auth.switchContext).toHaveBeenCalledTimes(1);
  });

  it('does not switch when the principal is already in the operations context', async () => {
    const { auth } = renderPlatform();
    await screen.findByText('user_nikola');
    expect(auth.switchContext).not.toHaveBeenCalled();
  });

  it('shows the mapped message when the context switch fails', async () => {
    const auth = makeAuth({
      principal: personal,
      switchContext: vi.fn().mockRejectedValue(apiError(429, 'rate_limited')),
    });
    const { opsApi } = renderPlatform({ auth });
    expect(await screen.findByRole('alert')).toHaveTextContent(t('admin:access.errors.rateLimited'));
    expect(opsApi.listPlatformGrants).not.toHaveBeenCalled();
  });

  it('does not switch in sample mode', async () => {
    const auth = makeAuth({ principal: personal });
    renderOrg({ auth, sampleMode: true });
    await screen.findByText(t('admin:access.sampleNote'));
    expect(auth.switchContext).not.toHaveBeenCalled();
  });
});

describe('OrgAccessScreen: action gating', () => {
  it('hides assign and revoke without the matching actions', async () => {
    renderOrg({ auth: makeAuth({ effectiveActions: ['access.preview'] }) });
    await screen.findByText('Stefan Marković');
    expect(screen.queryByRole('button', { name: t('admin:access.assign.open') })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Revoke/ })).not.toBeInTheDocument();
  });
});

describe('OrgAccessScreen: assign dialog', () => {
  it('offers only active organization templates and no org-unit scope', async () => {
    const user = userEvent.setup();
    renderOrg();
    const dialog = await openAssign(user);
    expect(within(dialog).queryByRole('radiogroup')).not.toBeInTheDocument();
    await user.click(screen.getByRole('combobox', { name: t('admin:access.assign.template') }));
    const options = (await screen.findAllByRole('option')).map((o) => o.textContent);
    expect(options).toContain(t('admin:access.templates.team_manager'));
    expect(options).not.toContain(t('admin:access.templates.employee'));
    expect(options).not.toContain(t('admin:access.templates.platform_owner'));
    expect(options).not.toContain(t('admin:access.templates.support_operator'));
  });

  it('shows the missing-conditions message when a required condition is empty', async () => {
    const user = userEvent.setup();
    const { opsApi } = renderOrg();
    const dialog = await fillOrgAssign(user, 'Ana Nikolić', t('admin:access.templates.approver'));

    await user.click(submitButton(dialog));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(t('admin:access.errors.missingConditions'));
    expect(opsApi.createGrant).not.toHaveBeenCalled();
  });

  it('requires a member and a template', async () => {
    const user = userEvent.setup();
    const { opsApi } = renderOrg();
    const dialog = await openAssign(user);

    await user.click(submitButton(dialog));

    const summary = await within(dialog).findByRole('alert');
    expect(summary).toHaveTextContent(t('admin:access.errors.memberRequired'));
    expect(summary).toHaveTextContent(t('admin:access.errors.templateRequired'));
    expect(opsApi.createGrant).not.toHaveBeenCalled();
  });

  it('creates an organization-wide grant with the conditions and closes', async () => {
    const user = userEvent.setup();
    const { opsApi } = renderOrg();
    const dialog = await fillOrgAssign(user, 'Ana Nikolić', t('admin:access.templates.team_manager'));

    await user.type(within(dialog).getByLabelText(new RegExp(`^${t('admin:access.conditions.amount')}`)), '1500');
    await user.type(within(dialog).getByLabelText(new RegExp(`^${t('admin:access.conditions.currency')}`)), 'eur');
    await user.click(submitButton(dialog));

    await waitFor(() => expect(opsApi.createGrant).toHaveBeenCalledTimes(1));
    expect(opsApi.createGrant).toHaveBeenCalledWith(ORG_ID, {
      templateKey: 'team_manager',
      subjectUserId: 'user_ana',
      scopeType: 'organization',
      includeDescendants: false,
      conditions: [{ type: 'spending_ceiling', amountMinor: 150000, currency: 'EUR' }],
    });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: assignDialogName() })).not.toBeInTheDocument());
  });

  it.each([
    ['missing_conditions', 400, 'admin:access.errors.missingConditions'],
    ['subject_not_member', 400, 'admin:access.errors.subjectNotMember'],
    ['template_inactive', 400, 'admin:access.errors.templateInactive'],
    ['forbidden', 403, 'admin:access.errors.forbidden'],
    ['rate_limited', 429, 'admin:access.errors.rateLimited'],
    ['conflict', 409, 'admin:access.errors.conflict'],
    ['internal_error', 500, 'admin:access.errors.unknown'],
  ])('maps the API error %s to its message', async (code, status, key) => {
    const user = userEvent.setup();
    const { opsApi } = renderOrg({
      opsApi: makeOpsApi({ createGrant: vi.fn().mockRejectedValue(apiError(status, code)) }),
    });
    const dialog = await fillOrgAssign(user, 'Ana Nikolić', t('admin:access.templates.employer_owner'));

    await user.click(submitButton(dialog));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(t(key));
    expect(screen.queryByText(`English ${code}`)).not.toBeInTheDocument();
    expect(opsApi.createGrant).toHaveBeenCalledTimes(1);
  });

  it('closes quietly when the user cancels step-up', async () => {
    const user = userEvent.setup();
    const auth = makeAuth({ stepUp: vi.fn().mockResolvedValue(false) });
    renderOrg({
      auth,
      opsApi: makeOpsApi({ createGrant: vi.fn().mockRejectedValue(apiError(403, 'step_up_required')) }),
    });
    const dialog = await fillOrgAssign(user, 'Ana Nikolić', t('admin:access.templates.employer_owner'));

    await user.click(submitButton(dialog));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: assignDialogName() })).not.toBeInTheDocument());
    expect(auth.stepUp).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('retries the call once after a verified step-up', async () => {
    const user = userEvent.setup();
    const createGrant = vi
      .fn()
      .mockRejectedValueOnce(apiError(403, 'step_up_required'))
      .mockResolvedValueOnce(GRANTS[0]);
    const auth = makeAuth();
    renderOrg({ auth, opsApi: makeOpsApi({ createGrant }) });
    const dialog = await fillOrgAssign(user, 'Ana Nikolić', t('admin:access.templates.employer_owner'));

    await user.click(submitButton(dialog));

    await waitFor(() => expect(createGrant).toHaveBeenCalledTimes(2));
    expect(auth.stepUp).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: assignDialogName() })).not.toBeInTheDocument());
  });
});

describe('OrgAccessScreen: revoke dialog', () => {
  const reasonLabel = () => new RegExp(`^${t('admin:access.reason.label')}`);
  const confirm = (dialog: HTMLElement) =>
    within(dialog).getByRole('button', { name: t('admin:access.revoke.confirm') });

  it.each([
    ['rate_limited', 429, 'admin:access.errors.rateLimited'],
    ['conflict', 409, 'admin:access.errors.conflict'],
    ['not_found', 404, 'admin:access.errors.notFound'],
    ['internal_error', 500, 'admin:access.errors.unknown'],
  ])('shows the mapped message when the revoke fails with %s', async (code, status, key) => {
    const user = userEvent.setup();
    const { opsApi } = renderOrg({
      opsApi: makeOpsApi({ revokeGrant: vi.fn().mockRejectedValue(apiError(status, code)) }),
    });
    const dialog = await openRevoke(user, t('admin:access.templates.team_manager'), 'Stefan Marković');

    await user.type(within(dialog).getByLabelText(reasonLabel()), 'Left the team');
    await user.click(confirm(dialog));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(t(key));
    expect(screen.queryByText(`English ${code}`)).not.toBeInTheDocument();
    expect(opsApi.revokeGrant).toHaveBeenCalledWith(ORG_ID, 'g_manager', { reason: 'Left the team' });
  });

  it('requires a reason of at least three characters', async () => {
    const user = userEvent.setup();
    const { opsApi } = renderOrg();
    const dialog = await openRevoke(user, t('admin:access.templates.team_manager'), 'Stefan Marković');

    await user.type(within(dialog).getByLabelText(reasonLabel()), 'no');
    await user.click(confirm(dialog));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(t('admin:access.errors.reasonLength'));
    expect(opsApi.revokeGrant).not.toHaveBeenCalled();
  });

  it('revokes and closes on success', async () => {
    const user = userEvent.setup();
    const { opsApi } = renderOrg();
    const dialog = await openRevoke(user, t('admin:access.templates.team_manager'), 'Stefan Marković');

    await user.type(within(dialog).getByLabelText(reasonLabel()), 'Left the team');
    await user.click(confirm(dialog));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(opsApi.revokeGrant).toHaveBeenCalledTimes(1);
  });

  it('closes quietly when the user cancels step-up', async () => {
    const user = userEvent.setup();
    renderOrg({
      auth: makeAuth({ stepUp: vi.fn().mockResolvedValue(false) }),
      opsApi: makeOpsApi({ revokeGrant: vi.fn().mockRejectedValue(apiError(403, 'step_up_required')) }),
    });
    const dialog = await openRevoke(user, t('admin:access.templates.team_manager'), 'Stefan Marković');

    await user.type(within(dialog).getByLabelText(reasonLabel()), 'Left the team');
    await user.click(confirm(dialog));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// User access lookup
// ---------------------------------------------------------------------------

describe('UserAccessLookup', () => {
  async function lookUp(user: UserEvent, userId: string) {
    const region = await screen.findByRole('region', { name: t('admin:access.lookup.title') });
    if (userId) await user.type(within(region).getByLabelText(new RegExp(`^${t('admin:access.lookup.userId')}`)), userId);
    await user.click(within(region).getByRole('button', { name: t('admin:access.lookup.submit') }));
    return region;
  }

  it('renders one section per context with actions grouped by prefix', async () => {
    const user = userEvent.setup();
    const { opsApi } = renderOrg();
    const region = await lookUp(user, 'user_stefan');

    const platform = await within(region).findByRole('region', { name: t('admin:access.lookup.platform') });
    expect(within(platform).getByRole('list', { name: 'support' })).toHaveTextContent('support.troubleshoot');
    expect(within(platform).getByRole('list', { name: 'account' })).toHaveTextContent('account.help');

    const org = within(region).getByRole('region', {
      name: t('admin:access.lookup.organization', { orgId: ORG_ID }),
    });
    const budget = within(org).getByRole('list', { name: 'budget' });
    expect(within(budget).getByText('budget.read')).toBeInTheDocument();
    expect(within(budget).getByText('budget.allocate')).toBeInTheDocument();
    expect(within(org).getByRole('list', { name: 'events' })).toHaveTextContent('events.request');

    expect(opsApi.userAccess).toHaveBeenCalledWith('user_stefan');
  });

  it('says so when the user has no access in any context', async () => {
    const user = userEvent.setup();
    renderPlatform({
      opsApi: makeOpsApi({ userAccess: vi.fn().mockResolvedValue({ userId: 'user_x', contexts: [] }) }),
    });
    const region = await lookUp(user, 'user_x');
    expect(await within(region).findByText(t('admin:access.lookup.empty'))).toBeInTheDocument();
  });

  it.each([
    ['not_found', 404, 'admin:access.errors.userNotFound'],
    ['forbidden', 403, 'admin:access.errors.forbidden'],
    ['rate_limited', 429, 'admin:access.errors.rateLimited'],
    ['internal_error', 500, 'admin:access.errors.unknown'],
  ])('shows the mapped message when the lookup fails with %s', async (code, status, key) => {
    const user = userEvent.setup();
    renderOrg({ opsApi: makeOpsApi({ userAccess: vi.fn().mockRejectedValue(apiError(status, code)) }) });
    const region = await lookUp(user, 'user_missing');

    expect(await within(region).findByRole('alert')).toHaveTextContent(t(key));
    expect(screen.queryByText(`English ${code}`)).not.toBeInTheDocument();
  });

  it('asks for a user id before looking up', async () => {
    const user = userEvent.setup();
    const { opsApi } = renderOrg();
    const region = await lookUp(user, '');

    expect(await within(region).findByRole('alert')).toHaveTextContent(t('admin:access.errors.userIdRequired'));
    expect(opsApi.userAccess).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Platform access page
// ---------------------------------------------------------------------------

describe('PlatformAccessScreen', () => {
  it('lists platform grants with a revoke action per active grant', async () => {
    const { opsApi } = renderPlatform();

    const row = (await screen.findByText('user_nikola')).closest('tr')!;
    expect(within(row).getByText(t('admin:access.templates.client_operations'))).toBeInTheDocument();
    expect(within(row).getByText(t('admin:access.scope.assigned_clients'))).toBeInTheDocument();
    expect(within(row).getByText(t('admin:access.status.active'))).toBeInTheDocument();
    expect(
      within(row).getByRole('button', {
        name: t('admin:access.revoke.openFor', { template: t('admin:access.templates.client_operations'), subject: 'user_nikola' }),
      }),
    ).toBeInTheDocument();
    expect(opsApi.listPlatformGrants).toHaveBeenCalledWith({ includeRevoked: true });
  });

  it('revokes a platform grant through the operations route and closes', async () => {
    const user = userEvent.setup();
    const { opsApi } = renderPlatform({
      opsApi: makeOpsApi({ revokePlatformGrant: vi.fn().mockResolvedValue({ ...PLATFORM_GRANTS[0], revokedAt: '2026-10-24T00:00:00.000Z' }) }),
    });
    const dialog = await openRevoke(user, t('admin:access.templates.client_operations'), 'user_nikola');

    await user.type(within(dialog).getByLabelText(new RegExp(`^${t('admin:access.reason.label')}`)), 'Left NestSelf');
    await user.click(within(dialog).getByRole('button', { name: t('admin:access.revoke.confirm') }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(opsApi.revokePlatformGrant).toHaveBeenCalledWith('pg_ops', { reason: 'Left NestSelf' });
    expect(opsApi.revokeGrant).not.toHaveBeenCalled();
  });

  it('shows the conflict message when the platform grant is already revoked (409)', async () => {
    const user = userEvent.setup();
    renderPlatform({
      opsApi: makeOpsApi({ revokePlatformGrant: vi.fn().mockRejectedValue(apiError(409, 'conflict')) }),
    });
    const dialog = await openRevoke(user, t('admin:access.templates.client_operations'), 'user_nikola');

    await user.type(within(dialog).getByLabelText(new RegExp(`^${t('admin:access.reason.label')}`)), 'Left NestSelf');
    await user.click(within(dialog).getByRole('button', { name: t('admin:access.revoke.confirm') }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(t('admin:access.errors.conflict'));
    expect(screen.queryByText('English conflict')).not.toBeInTheDocument();
  });

  it('shows the mapped message when the platform grants cannot be loaded', async () => {
    renderPlatform({
      opsApi: makeOpsApi({ listPlatformGrants: vi.fn().mockRejectedValue(apiError(403, 'forbidden')) }),
    });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(t('admin:access.errors.loadTitle'));
    expect(alert).toHaveTextContent(t('admin:access.errors.forbidden'));
    expect(screen.queryByText('English forbidden')).not.toBeInTheDocument();
  });

  it('offers only active operations templates', async () => {
    const user = userEvent.setup();
    renderPlatform();
    await openAssign(user);
    await user.click(screen.getByRole('combobox', { name: t('admin:access.assign.template') }));
    const options = (await screen.findAllByRole('option')).map((o) => o.textContent);
    expect(options).toContain(t('admin:access.templates.support_operator'));
    expect(options).toContain(t('admin:access.templates.platform_owner'));
    expect(options).not.toContain(t('admin:access.templates.employer_owner'));
    expect(options).not.toContain(t('admin:access.templates.expert'));
  });

  it('assigns support_operator at the template scope and shows the new row', async () => {
    const user = userEvent.setup();
    const listPlatformGrants = vi
      .fn()
      .mockResolvedValueOnce({ items: PLATFORM_GRANTS })
      .mockResolvedValue({ items: [...PLATFORM_GRANTS, NEW_PLATFORM_GRANT] });
    const { opsApi } = renderPlatform({ opsApi: makeOpsApi({ listPlatformGrants }) });
    await screen.findByText('user_nikola');
    const dialog = await fillPlatformAssign(user, 'user_mira', t('admin:access.templates.support_operator'));

    await user.click(submitButton(dialog));

    await waitFor(() =>
      expect(opsApi.createPlatformGrant).toHaveBeenCalledWith({
        templateKey: 'support_operator',
        subjectUserId: 'user_mira',
        scopeType: 'assigned_cases',
        conditions: [],
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog', { name: assignDialogName() })).not.toBeInTheDocument());
    const row = (await screen.findByText('user_mira')).closest('tr')!;
    expect(within(row).getByText(t('admin:access.templates.support_operator'))).toBeInTheDocument();
    expect(within(row).getByText(t('admin:access.scope.assigned_cases'))).toBeInTheDocument();
  });

  it('requires a user id and a template', async () => {
    const user = userEvent.setup();
    const { opsApi } = renderPlatform();
    const dialog = await openAssign(user);

    await user.click(submitButton(dialog));

    const summary = await within(dialog).findByRole('alert');
    expect(summary).toHaveTextContent(t('admin:access.errors.userIdRequired'));
    expect(summary).toHaveTextContent(t('admin:access.errors.templateRequired'));
    expect(opsApi.createPlatformGrant).not.toHaveBeenCalled();
  });

  it.each([
    ['not_found', 404, 'admin:access.errors.userNotFound'],
    ['template_inactive', 400, 'admin:access.errors.templateInactive'],
    ['forbidden', 403, 'admin:access.errors.forbidden'],
    ['rate_limited', 429, 'admin:access.errors.rateLimited'],
    ['internal_error', 500, 'admin:access.errors.unknown'],
  ])('maps the API error %s to its message', async (code, status, key) => {
    const user = userEvent.setup();
    renderPlatform({
      opsApi: makeOpsApi({ createPlatformGrant: vi.fn().mockRejectedValue(apiError(status, code)) }),
    });
    const dialog = await fillPlatformAssign(user, 'user_mira', t('admin:access.templates.support_operator'));

    await user.click(submitButton(dialog));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(t(key));
    expect(screen.queryByText(`English ${code}`)).not.toBeInTheDocument();
  });

  it('closes quietly when the user cancels step-up', async () => {
    const user = userEvent.setup();
    const auth = makeAuth({ stepUp: vi.fn().mockResolvedValue(false) });
    renderPlatform({
      auth,
      opsApi: makeOpsApi({ createPlatformGrant: vi.fn().mockRejectedValue(apiError(403, 'step_up_required')) }),
    });
    const dialog = await fillPlatformAssign(user, 'user_mira', t('admin:access.templates.support_operator'));

    await user.click(submitButton(dialog));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: assignDialogName() })).not.toBeInTheDocument());
    expect(auth.stepUp).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Sample mode
// ---------------------------------------------------------------------------

describe('Access screens: sample mode', () => {
  it('derives organization rows from the sample grants and calls no API', async () => {
    const { opsApi } = renderOrg({ sampleMode: true });

    const orgGrants = SAMPLE_GRANTS.filter((g) => g.scopeOrgId === ORG_ID);
    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(orgGrants.length + 1);
    const ownerRow = within(table).getByText(t('admin:access.templates.employer_owner')).closest('tr')!;
    expect(within(ownerRow).getByText('Ivana Jovanović')).toBeInTheDocument();
    expect(opsApi.listGrants).not.toHaveBeenCalled();
    expect(opsApi.listMembers).not.toHaveBeenCalled();
  });

  it('derives platform rows from the sample grants without an organization', async () => {
    const { opsApi } = renderPlatform({ sampleMode: true });

    const platformGrants = SAMPLE_GRANTS.filter((g) => g.scopeOrgId === null);
    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(platformGrants.length + 1);
    expect(opsApi.listPlatformGrants).not.toHaveBeenCalled();
  });

  it('disables mutations and says that nothing is created', async () => {
    renderOrg({ sampleMode: true });
    expect(await screen.findByText(t('admin:access.sampleNote'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('admin:access.assign.open') })).toBeDisabled();
    const revokeButtons = screen.getAllByRole('button', { name: /^Revoke/ });
    expect(revokeButtons.length).toBeGreaterThan(0);
    for (const button of revokeButtons) expect(button).toBeDisabled();
  });

  it('looks up a sample user from the fixtures', async () => {
    const user = userEvent.setup();
    const { opsApi } = renderPlatform({ sampleMode: true });
    const region = await screen.findByRole('region', { name: t('admin:access.lookup.title') });

    await user.type(within(region).getByLabelText(new RegExp(`^${t('admin:access.lookup.userId')}`)), 'user_ivana');
    await user.click(within(region).getByRole('button', { name: t('admin:access.lookup.submit') }));

    const org = await within(region).findByRole('region', {
      name: t('admin:access.lookup.organization', { orgId: ORG_ID }),
    });
    expect(within(org).getByRole('list', { name: 'access' })).toHaveTextContent('access.preview');
    expect(opsApi.userAccess).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Routes and navigation
// ---------------------------------------------------------------------------

describe('access routes and navigation', () => {
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
    return render(<RouterProvider router={router} />);
  }

  beforeEach(async () => {
    await appI18n.changeLanguage('en');
  });

  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('an operations user without access.preview sees no access nav item and is turned away', async () => {
    renderRoute('/access', 'operations');
    expect(await screen.findByText(t('common:state.permission.title'))).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: t('admin:nav.access') })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: t('admin:access.platform.title') })).not.toBeInTheDocument();
  });

  it('the sample admin sees the nav item and the platform page with the sample banner', async () => {
    renderRoute('/access', 'admin');
    expect(await screen.findByRole('heading', { name: t('admin:access.platform.title') })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: t('admin:nav.access') }).length).toBeGreaterThan(0);
    expect(screen.getByText(t('common:sample.banner'))).toBeInTheDocument();
  });

  it('the organization detail links to its access page', async () => {
    const user = userEvent.setup();
    renderRoute(`/organizations/${ORG_ID}`, 'admin');
    const sections = await screen.findByRole('navigation', { name: t('admin:organizations.tabsLabel') });
    await user.click(within(sections).getByRole('link', { name: t('admin:organizations.tabs.access') }));
    expect(await screen.findByRole('heading', { name: t('admin:access.org.title') })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: t('admin:organizations.detail') })).toBeInTheDocument();
  });
});
