import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UserEvent } from '@testing-library/user-event';
import type { OrgAdminApi } from '@nestself/api-client';
import { PeopleScreen } from './people-screen';
import {
  HR_PRINCIPAL,
  INVITATIONS,
  MEMBERS,
  ORG_ID,
  actionsWithout,
  apiError,
  invitation,
  makeAdminApi,
  makeAuth,
  member,
  renderWithProviders,
  t,
} from './people-test-harness';
import type { AuthContextValue } from '../../auth';

function renderScreen(opts: { adminApi?: OrgAdminApi; auth?: AuthContextValue; sampleMode?: boolean } = {}) {
  const adminApi = opts.adminApi ?? makeAdminApi();
  const auth = opts.auth ?? makeAuth();
  renderWithProviders(<PeopleScreen adminApi={adminApi} sampleMode={opts.sampleMode ?? false} />, auth);
  return { adminApi, auth };
}

async function choose(user: UserEvent, label: string | RegExp, option: string) {
  await user.click(screen.getByRole('combobox', { name: label }));
  await user.click(await screen.findByRole('option', { name: option }));
}

async function openInvitations(user: UserEvent) {
  await user.click(await screen.findByRole('tab', { name: t('workspace:people.tabs.invitations') }));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('PeopleScreen: members', () => {
  it('renders name, email, org unit, line manager, status and start date', async () => {
    renderScreen();
    const row = (await screen.findByText('Ana Nikolić')).closest('tr')!;
    expect(within(row).getByText('user_ana@example.com')).toBeInTheDocument();
    expect(within(row).getByText('Product')).toBeInTheDocument();
    expect(within(row).getByText('Stefan Marković')).toBeInTheDocument();
    expect(within(row).getByText(t('workspace:people.status.ACTIVE'))).toBeInTheDocument();
    expect(within(row).getByText(/2024/)).toBeInTheDocument();
    const ivana = screen.getByText('Ivana Jovanović').closest('tr')!;
    expect(within(ivana).getByText(t('workspace:people.members.noUnit'))).toBeInTheDocument();
    expect(within(ivana).getByText(t('workspace:people.members.noLineManager'))).toBeInTheDocument();
  });

  it('pages through the API cursor with Load more instead of capping the list (Review Focus 2)', async () => {
    const user = userEvent.setup();
    const listMembers = vi.fn(async (_orgId: string, query: { cursor?: string; status?: string; limit?: number }) => {
      if (query.status === 'ACTIVE' && query.limit === 100) return { items: MEMBERS, nextCursor: null };
      if (query.cursor === 'cursor_2') return { items: [member('user_jovan', 'Jovan Petrović')], nextCursor: null };
      return { items: MEMBERS.slice(0, 2), nextCursor: 'cursor_2' };
    });
    renderScreen({ adminApi: makeAdminApi({ listMembers }) });

    expect(await screen.findByText(t('workspace:people.paging.showingMore', { count: 2 }))).toBeInTheDocument();
    expect(screen.queryByText('Jovan Petrović')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: t('workspace:people.paging.loadMore') }));

    expect(await screen.findByText('Jovan Petrović')).toBeInTheDocument();
    expect(screen.getByText('Ivana Jovanović')).toBeInTheDocument();
    expect(screen.getByText(t('workspace:people.paging.showing', { count: 3 }))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('workspace:people.paging.loadMore') })).not.toBeInTheDocument();
    expect(listMembers).toHaveBeenCalledWith(ORG_ID, expect.objectContaining({ cursor: 'cursor_2', limit: 25 }));
  });

  it('shows a failed next page and keeps the rows already loaded', async () => {
    const user = userEvent.setup();
    const listMembers = vi.fn(async (_orgId: string, query: { cursor?: string; limit?: number }) => {
      if (query.limit === 100) return { items: MEMBERS, nextCursor: null };
      if (query.cursor) throw apiError(429, 'rate_limited');
      return { items: MEMBERS.slice(0, 2), nextCursor: 'cursor_2' };
    });
    renderScreen({ adminApi: makeAdminApi({ listMembers }) });
    await user.click(await screen.findByRole('button', { name: t('workspace:people.paging.loadMore') }));
    expect(await screen.findByText(t('workspace:people.paging.loadMoreFailed'))).toBeInTheDocument();
    expect(screen.getByText(t('workspace:people.errors.rateLimited'))).toBeInTheDocument();
    expect(screen.getByText('Ivana Jovanović')).toBeInTheDocument();
  });

  it('a changed filter shows only the first page of the new filter', async () => {
    const user = userEvent.setup();
    const listMembers = vi.fn(async (_orgId: string, query: { cursor?: string; orgUnitId?: string; limit?: number }) => {
      if (query.limit === 100) return { items: MEMBERS, nextCursor: null };
      if (query.orgUnitId === 'team_sales') {
        return { items: [member('user_jovan', 'Jovan Petrović', { orgUnitId: 'team_sales' })], nextCursor: 'sales_2' };
      }
      if (query.cursor === 'cursor_2') return { items: [MEMBERS[2]!], nextCursor: null };
      return { items: MEMBERS.slice(0, 2), nextCursor: 'cursor_2' };
    });
    renderScreen({ adminApi: makeAdminApi({ listMembers }) });
    await user.click(await screen.findByRole('button', { name: t('workspace:people.paging.loadMore') }));
    expect(await screen.findByText(t('workspace:people.paging.showing', { count: 3 }))).toBeInTheDocument();

    await choose(user, t('workspace:people.filters.orgUnit'), 'Sales');

    expect(await screen.findByText('Jovan Petrović')).toBeInTheDocument();
    const table = screen.getByRole('region', { name: t('workspace:people.members.caption') });
    expect(within(table).queryByText('Ivana Jovanović')).not.toBeInTheDocument();
    expect(within(table).queryByText('Ana Nikolić')).not.toBeInTheDocument();
    expect(screen.getByText(t('workspace:people.paging.showingMore', { count: 1 }))).toBeInTheDocument();
    expect(listMembers).toHaveBeenLastCalledWith(ORG_ID, { limit: 25, orgUnitId: 'team_sales' });
  });

  it('sends the org unit, status and debounced search filters to the API', async () => {
    const user = userEvent.setup();
    const { adminApi } = renderScreen();
    await screen.findByText('Ana Nikolić');

    await choose(user, t('workspace:people.filters.orgUnit'), 'Product');
    await waitFor(() =>
      expect(adminApi.listMembers).toHaveBeenCalledWith(ORG_ID, expect.objectContaining({ orgUnitId: 'team_product', limit: 25 })),
    );

    await choose(user, t('workspace:people.filters.status'), t('workspace:people.status.ENDED'));
    await waitFor(() =>
      expect(adminApi.listMembers).toHaveBeenCalledWith(ORG_ID, expect.objectContaining({ status: 'ENDED', orgUnitId: 'team_product' })),
    );

    await user.type(screen.getByRole('searchbox', { name: t('workspace:people.filters.search') }), 'ana');
    await waitFor(() =>
      expect(adminApi.listMembers).toHaveBeenCalledWith(ORG_ID, expect.objectContaining({ search: 'ana' })),
    );
    // Debounced: no request per keystroke.
    expect(adminApi.listMembers).not.toHaveBeenCalledWith(ORG_ID, expect.objectContaining({ search: 'a' }));
  });

  it('shows a members load failure', async () => {
    renderScreen({ adminApi: makeAdminApi({ listMembers: vi.fn().mockRejectedValue(apiError(500, 'internal')) }) });
    expect(await screen.findByText(t('workspace:people.errors.membersLoadTitle'))).toBeInTheDocument();
    expect(screen.getAllByText(t('workspace:people.errors.unknown')).length).toBeGreaterThan(0);
  });

  it('shows an org units load failure', async () => {
    renderScreen({ adminApi: makeAdminApi({ listOrgUnits: vi.fn().mockRejectedValue(apiError(429, 'rate_limited')) }) });
    expect(await screen.findByText(t('workspace:people.errors.orgUnitsLoadTitle'))).toBeInTheDocument();
    expect(screen.getByText(t('workspace:people.errors.rateLimited'))).toBeInTheDocument();
  });

  it('moves the session into the organization context once before loading', async () => {
    const auth = makeAuth({ principal: { ...HR_PRINCIPAL, context: { kind: 'personal' } } });
    const { adminApi } = renderScreen({ auth });
    await waitFor(() => expect(auth.switchContext).toHaveBeenCalledWith({ kind: 'organization', orgId: ORG_ID }));
    expect(auth.switchContext).toHaveBeenCalledTimes(1);
    expect(adminApi.listMembers).not.toHaveBeenCalled();
  });

  it('shows a failed context switch', async () => {
    const auth = makeAuth({
      principal: { ...HR_PRINCIPAL, context: { kind: 'personal' } },
      switchContext: vi.fn().mockRejectedValue(apiError(403, 'forbidden')),
    });
    renderScreen({ auth });
    expect(await screen.findByText(t('workspace:people.errors.loadTitle'))).toBeInTheDocument();
    expect(screen.getByText(t('workspace:people.errors.unknown'))).toBeInTheDocument();
  });

  it('hides Move and End membership without people.move and people.deactivate', async () => {
    renderScreen({ auth: makeAuth({ effectiveActions: actionsWithout('people.move', 'people.deactivate') }) });
    await screen.findByText('Ana Nikolić');
    expect(screen.queryByRole('button', { name: t('workspace:people.move.openFor', { name: 'Ana Nikolić' }) })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('workspace:people.end.openFor', { name: 'Ana Nikolić' }) })).not.toBeInTheDocument();
  });

  it('does not offer ending your own membership', async () => {
    renderScreen();
    await screen.findByText('Ivana Jovanović');
    expect(screen.queryByRole('button', { name: t('workspace:people.end.openFor', { name: 'Ivana Jovanović' }) })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('workspace:people.end.openFor', { name: 'Ana Nikolić' }) })).toBeInTheDocument();
  });
});

describe('PeopleScreen: move', () => {
  async function openMove(user: UserEvent, name = 'Ana Nikolić') {
    await user.click(await screen.findByRole('button', { name: t('workspace:people.move.openFor', { name }) }));
    return screen.findByRole('dialog', { name: t('workspace:people.move.title') });
  }

  it('updates org unit and line manager', async () => {
    const user = userEvent.setup();
    const { adminApi } = renderScreen();
    await openMove(user);
    await choose(user, t('workspace:people.move.orgUnit'), 'Sales');
    await choose(user, t('workspace:people.move.lineManager'), 'Ivana Jovanović');
    await user.click(screen.getByRole('button', { name: t('workspace:people.move.submit') }));
    await waitFor(() =>
      expect(adminApi.updateMember).toHaveBeenCalledWith(ORG_ID, 'mem_user_ana', {
        orgUnitId: 'team_sales',
        lineManagerUserId: 'user_ivana',
      }),
    );
    expect(await screen.findByText(t('workspace:people.move.success', { name: 'Ana Nikolić' }))).toBeInTheDocument();
  });

  it('clears the line manager', async () => {
    const user = userEvent.setup();
    const { adminApi } = renderScreen();
    await openMove(user);
    await choose(user, t('workspace:people.move.lineManager'), t('workspace:people.move.noLineManager'));
    await user.click(screen.getByRole('button', { name: t('workspace:people.move.submit') }));
    await waitFor(() =>
      expect(adminApi.updateMember).toHaveBeenCalledWith(ORG_ID, 'mem_user_ana', { lineManagerUserId: null }),
    );
  });

  it('asks for a change before sending', async () => {
    const user = userEvent.setup();
    const { adminApi } = renderScreen();
    const dialog = await openMove(user);
    await user.click(within(dialog).getByRole('button', { name: t('workspace:people.move.submit') }));
    expect((await within(dialog).findAllByText(t('workspace:people.errors.noChange'), { exact: false })).length).toBeGreaterThan(0);
    expect(adminApi.updateMember).not.toHaveBeenCalled();
  });

  it.each([
    ['validation', apiError(400, 'validation', { issues: [{ path: ['orgUnitId'], message: 'x', code: 'y' }] }), 'validation'],
    ['not_found', apiError(404, 'not_found'), 'notFound'],
    ['subject_not_member', apiError(400, 'subject_not_member'), 'subjectNotMember'],
    ['conflict', apiError(409, 'conflict'), 'conflict'],
    ['429', apiError(429, 'rate_limited'), 'rateLimited'],
    ['unknown', apiError(500, 'internal'), 'unknown'],
  ])('shows %s from the API', async (_label, err, key) => {
    const user = userEvent.setup();
    renderScreen({ adminApi: makeAdminApi({ updateMember: vi.fn().mockRejectedValue(err) }) });
    const dialog = await openMove(user);
    await choose(user, t('workspace:people.move.orgUnit'), 'Sales');
    await user.click(within(dialog).getByRole('button', { name: t('workspace:people.move.submit') }));
    expect((await within(dialog).findAllByText(t(`workspace:people.errors.${key}`), { exact: false })).length).toBeGreaterThan(0);
    expect(screen.queryByText('English', { exact: false })).not.toBeInTheDocument();
  });

  it('a cancelled step-up closes the dialog quietly', async () => {
    const user = userEvent.setup();
    const auth = makeAuth({ stepUp: vi.fn().mockResolvedValue(false) });
    renderScreen({ auth, adminApi: makeAdminApi({ updateMember: vi.fn().mockRejectedValue(apiError(403, 'step_up_required')) }) });
    await openMove(user);
    await choose(user, t('workspace:people.move.orgUnit'), 'Sales');
    await user.click(screen.getByRole('button', { name: t('workspace:people.move.submit') }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: t('workspace:people.move.title') })).not.toBeInTheDocument());
    expect(auth.stepUp).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(t('workspace:people.errors.unknown'))).not.toBeInTheDocument();
  });
});

describe('PeopleScreen: end membership (Review Focus 1)', () => {
  async function openEnd(user: UserEvent, name = 'Ana Nikolić') {
    await user.click(await screen.findByRole('button', { name: t('workspace:people.end.openFor', { name }) }));
    return screen.findByRole('alertdialog', { name: t('workspace:people.end.title') });
  }

  it('shows the confirmation sentence and sends the chosen reason', async () => {
    const user = userEvent.setup();
    const { adminApi } = renderScreen();
    const dialog = await openEnd(user);
    expect(within(dialog).getByText(t('workspace:people.end.description', { name: 'Ana Nikolić' }))).toBeInTheDocument();
    await choose(user, t('workspace:people.end.reason'), t('workspace:people.end.reasons.LEFT'));
    await user.click(within(dialog).getByRole('button', { name: t('workspace:people.end.confirm') }));
    await waitFor(() => expect(adminApi.endMember).toHaveBeenCalledWith(ORG_ID, 'mem_user_ana', { reason: 'LEFT' }));
    expect(await screen.findByText(t('workspace:people.end.success', { name: 'Ana Nikolić' }))).toBeInTheDocument();
  });

  it('a step_up_required answer opens step-up and retries, never a bare error', async () => {
    const user = userEvent.setup();
    const auth = makeAuth();
    const endMember = vi
      .fn()
      .mockRejectedValueOnce(apiError(403, 'step_up_required'))
      .mockResolvedValueOnce({ membershipId: 'mem_user_ana', status: 'ENDED', endDate: '2026-10-25T10:00:00.000Z', endedReason: 'DEACTIVATED_BY_HR', revokedGrantIds: [] });
    renderScreen({ auth, adminApi: makeAdminApi({ endMember }) });
    const dialog = await openEnd(user);
    await user.click(within(dialog).getByRole('button', { name: t('workspace:people.end.confirm') }));
    await waitFor(() => expect(endMember).toHaveBeenCalledTimes(2));
    expect(auth.stepUp).toHaveBeenCalledTimes(1);
    expect(endMember).toHaveBeenLastCalledWith(ORG_ID, 'mem_user_ana', { reason: 'DEACTIVATED_BY_HR' });
    expect(await screen.findByText(t('workspace:people.end.success', { name: 'Ana Nikolić' }))).toBeInTheDocument();
    expect(screen.queryByText(t('workspace:people.errors.unknown'))).not.toBeInTheDocument();
  });

  it('a cancelled step-up closes quietly', async () => {
    const user = userEvent.setup();
    const auth = makeAuth({ stepUp: vi.fn().mockResolvedValue(false) });
    renderScreen({ auth, adminApi: makeAdminApi({ endMember: vi.fn().mockRejectedValue(apiError(403, 'step_up_required')) }) });
    const dialog = await openEnd(user);
    await user.click(within(dialog).getByRole('button', { name: t('workspace:people.end.confirm') }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(auth.stepUp).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(t('workspace:people.errors.unknown'))).not.toBeInTheDocument();
  });

  it.each([
    ['not_found', apiError(404, 'not_found'), 'notFound'],
    ['conflict', apiError(409, 'conflict'), 'conflict'],
    ['validation', apiError(400, 'validation'), 'validation'],
    ['429', apiError(429, 'rate_limited'), 'rateLimited'],
    ['unknown', apiError(500, 'internal'), 'unknown'],
  ])('keeps the dialog open and shows %s', async (_label, err, key) => {
    const user = userEvent.setup();
    renderScreen({ adminApi: makeAdminApi({ endMember: vi.fn().mockRejectedValue(err) }) });
    const dialog = await openEnd(user);
    await user.click(within(dialog).getByRole('button', { name: t('workspace:people.end.confirm') }));
    expect((await within(dialog).findAllByText(t(`workspace:people.errors.${key}`), { exact: false })).length).toBeGreaterThan(0);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });
});

describe('PeopleScreen: invitations', () => {
  it('lists pending invitations with template, org unit and expiry', async () => {
    const user = userEvent.setup();
    renderScreen();
    await openInvitations(user);
    const row = (await screen.findByText('marko.ilic@example.com')).closest('tr')!;
    expect(within(row).getByText(t('workspace:access.templates.employee'))).toBeInTheDocument();
    expect(within(row).getByText('Product')).toBeInTheDocument();
    expect(within(row).getByText(/2026/)).toBeInTheDocument();
    const jelena = screen.getByText('jelena.savic@example.com').closest('tr')!;
    expect(within(jelena).getByText(t('workspace:access.templates.team_manager'))).toBeInTheDocument();
  });

  it('pages invitations with Load more', async () => {
    const user = userEvent.setup();
    const listInvitations = vi.fn(async (_orgId: string, query: { cursor?: string }) =>
      query.cursor === 'inv_c'
        ? { items: [invitation('inv_petar', 'petar.kovac@example.com')], nextCursor: null }
        : { items: INVITATIONS, nextCursor: 'inv_c' },
    );
    renderScreen({ adminApi: makeAdminApi({ listInvitations }) });
    await openInvitations(user);
    expect(await screen.findByText(t('workspace:people.paging.showingMore', { count: 2 }))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('workspace:people.paging.loadMore') }));
    expect(await screen.findByText('petar.kovac@example.com')).toBeInTheDocument();
    expect(listInvitations).toHaveBeenCalledWith(ORG_ID, { limit: 25, cursor: 'inv_c' });
  });

  it('shows an invitations load failure', async () => {
    const user = userEvent.setup();
    renderScreen({ adminApi: makeAdminApi({ listInvitations: vi.fn().mockRejectedValue(apiError(503, 'unavailable')) }) });
    await openInvitations(user);
    expect(await screen.findByText(t('workspace:people.errors.invitationsLoadTitle'))).toBeInTheDocument();
    expect(screen.getByText(t('workspace:people.errors.unknown'))).toBeInTheDocument();
  });

  it('hides the tab without people.invite and people.import', async () => {
    renderScreen({ auth: makeAuth({ effectiveActions: actionsWithout('people.invite', 'people.import') }) });
    await screen.findByText('Ana Nikolić');
    expect(screen.queryByRole('tab', { name: t('workspace:people.tabs.invitations') })).not.toBeInTheDocument();
  });

  it('offers Import but no list without people.invite', async () => {
    const user = userEvent.setup();
    const { adminApi } = renderScreen({ auth: makeAuth({ effectiveActions: actionsWithout('people.invite') }) });
    await openInvitations(user);
    expect(screen.getByRole('button', { name: t('workspace:people.import.open') })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('workspace:people.invite.open') })).not.toBeInTheDocument();
    expect(adminApi.listInvitations).not.toHaveBeenCalled();
  });
});

describe('PeopleScreen: invite', () => {
  async function openInvite(user: UserEvent) {
    await openInvitations(user);
    await user.click(await screen.findByRole('button', { name: t('workspace:people.invite.open') }));
    return screen.findByRole('dialog', { name: t('workspace:people.invite.title') });
  }

  async function fillInvite(user: UserEvent, email: string, template: string) {
    const dialog = await openInvite(user);
    await user.type(within(dialog).getByRole('textbox', { name: t('workspace:people.invite.email') }), email);
    await choose(user, t('workspace:people.invite.template'), template);
    return dialog;
  }

  it('offers only invitable templates', async () => {
    const user = userEvent.setup();
    renderScreen();
    await openInvite(user);
    await user.click(screen.getByRole('combobox', { name: t('workspace:people.invite.template') }));
    expect(await screen.findByRole('option', { name: t('workspace:access.templates.employee') })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: t('workspace:access.templates.employer_owner') })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Platform Owner' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Expert' })).not.toBeInTheDocument();
  });

  it('creates an invitation with the org unit', async () => {
    const user = userEvent.setup();
    const { adminApi } = renderScreen();
    await fillInvite(user, 'New.Person@Example.com', t('workspace:access.templates.employee'));
    await choose(user, new RegExp(`^${t('workspace:people.invite.orgUnit')}`), 'Sales');
    await user.click(screen.getByRole('button', { name: t('workspace:people.invite.submit') }));
    await waitFor(() =>
      expect(adminApi.createInvitation).toHaveBeenCalledWith(ORG_ID, {
        email: 'new.person@example.com',
        templateKey: 'employee',
        orgUnitId: 'team_sales',
      }),
    );
    expect(await screen.findByText(t('workspace:people.invite.success', { email: 'new.person@example.com' }))).toBeInTheDocument();
  });

  it('checks the email and template before sending', async () => {
    const user = userEvent.setup();
    const { adminApi } = renderScreen();
    const dialog = await openInvite(user);
    await user.click(within(dialog).getByRole('button', { name: t('workspace:people.invite.submit') }));
    expect((await within(dialog).findAllByText(t('workspace:people.errors.emailInvalid'))).length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText(t('workspace:people.errors.templateRequired')).length).toBeGreaterThan(0);
    expect(adminApi.createInvitation).not.toHaveBeenCalled();
  });

  it.each([
    ['owner_exists', apiError(409, 'owner_exists'), 'workspace:people.errors.ownerExists'],
    ['validation on templateKey', apiError(400, 'validation', { templateKey: 'employer_owner' }), 'workspace:people.errors.templateInvalid'],
    ['validation on email', apiError(400, 'validation', { issues: [{ path: ['email'], message: 'x', code: 'y' }] }), 'workspace:people.errors.emailInvalid'],
    ['validation on orgUnitId', apiError(400, 'validation', { issues: [{ path: ['orgUnitId'], message: 'x', code: 'y' }] }), 'workspace:people.errors.orgUnitInvalid'],
    ['validation without details', apiError(400, 'validation'), 'workspace:people.errors.validation'],
    ['duplicate_invitation', apiError(409, 'duplicate_invitation'), 'workspace:people.errors.duplicateInvitation'],
    ['already_member', apiError(409, 'already_member'), 'workspace:people.errors.alreadyMember'],
    ['conflict', apiError(409, 'conflict'), 'workspace:people.errors.conflict'],
    ['429', apiError(429, 'rate_limited'), 'workspace:people.errors.rateLimited'],
    ['unknown', apiError(500, 'internal'), 'workspace:people.errors.unknown'],
  ])('shows %s from the API', async (_label, err, key) => {
    const user = userEvent.setup();
    renderScreen({ adminApi: makeAdminApi({ createInvitation: vi.fn().mockRejectedValue(err) }) });
    const dialog = await fillInvite(user, 'someone@example.com', t('workspace:access.templates.employer_owner'));
    await user.click(within(dialog).getByRole('button', { name: t('workspace:people.invite.submit') }));
    expect((await within(dialog).findAllByText(t(key), { exact: false })).length).toBeGreaterThan(0);
    expect(screen.getByRole('dialog', { name: t('workspace:people.invite.title') })).toBeInTheDocument();
  });

  it('retries through step-up', async () => {
    const user = userEvent.setup();
    const auth = makeAuth();
    const createInvitation = vi
      .fn()
      .mockRejectedValueOnce(apiError(403, 'step_up_required'))
      .mockResolvedValueOnce(invitation('inv_new', 'someone@example.com'));
    renderScreen({ auth, adminApi: makeAdminApi({ createInvitation }) });
    const dialog = await fillInvite(user, 'someone@example.com', t('workspace:access.templates.employee'));
    await user.click(within(dialog).getByRole('button', { name: t('workspace:people.invite.submit') }));
    await waitFor(() => expect(createInvitation).toHaveBeenCalledTimes(2));
    expect(auth.stepUp).toHaveBeenCalledTimes(1);
  });
});

describe('PeopleScreen: import', () => {
  async function openImport(user: UserEvent) {
    await openInvitations(user);
    await user.click(await screen.findByRole('button', { name: t('workspace:people.import.open') }));
    return screen.findByRole('dialog', { name: t('workspace:people.import.title') });
  }

  async function paste(user: UserEvent, dialog: HTMLElement, text: string) {
    await user.click(within(dialog).getByRole('textbox', { name: t('workspace:people.import.rows') }));
    await user.paste(text);
  }

  it('lists bad lines and sends nothing until they are fixed', async () => {
    const user = userEvent.setup();
    const { adminApi } = renderScreen();
    const dialog = await openImport(user);
    await paste(user, dialog, 'ana@example.com,employee\nbroken-line\n');
    expect(within(dialog).getByText(t('workspace:people.import.preview', { count: 1 }))).toBeInTheDocument();
    expect(within(dialog).getByText(t('workspace:people.import.problems.columns', { line: 2, value: 'broken-line' }))).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: t('workspace:people.import.submit') }));
    expect((await within(dialog).findAllByText(t('workspace:people.import.fixProblems'))).length).toBeGreaterThan(0);
    expect(adminApi.importInvitations).not.toHaveBeenCalled();
  });

  it('asks for at least one row', async () => {
    const user = userEvent.setup();
    renderScreen();
    const dialog = await openImport(user);
    await user.click(within(dialog).getByRole('button', { name: t('workspace:people.import.submit') }));
    expect((await within(dialog).findAllByText(t('workspace:people.import.noRows'))).length).toBeGreaterThan(0);
  });

  it('imports the parsed rows and shows created, skipped and errors with translated reasons', async () => {
    const user = userEvent.setup();
    const importInvitations = vi.fn().mockResolvedValue({
      created: 1,
      skipped: 1,
      errors: [
        { email: 'ivan@example.com', reason: 'already_member' },
        { email: 'boss@example.com', reason: 'owner_exists' },
        { email: 'x@example.com', reason: 'Something the server said' },
      ],
    });
    renderScreen({ adminApi: makeAdminApi({ importInvitations }) });
    const dialog = await openImport(user);
    await paste(
      user,
      dialog,
      'email,template,unit\nana@example.com,employee,Product\nivan@example.com,employee\nboss@example.com,employer_owner\nx@example.com,employee',
    );
    expect(within(dialog).getByText(t('workspace:people.import.preview', { count: 4 }))).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: t('workspace:people.import.submit') }));

    await waitFor(() =>
      expect(importInvitations).toHaveBeenCalledWith(ORG_ID, {
        invitations: [
          { email: 'ana@example.com', templateKey: 'employee', orgUnitId: 'team_product' },
          { email: 'ivan@example.com', templateKey: 'employee' },
          { email: 'boss@example.com', templateKey: 'employer_owner' },
          { email: 'x@example.com', templateKey: 'employee' },
        ],
      }),
    );
    expect(await within(dialog).findByText(t('workspace:people.import.resultSummary', { created: 1, skipped: 1, failed: 3 }))).toBeInTheDocument();
    const table = within(dialog).getByRole('region', { name: t('workspace:people.import.errorsCaption') });
    expect(within(table).getByText(t('workspace:people.import.reasons.alreadyMember'))).toBeInTheDocument();
    expect(within(table).getByText(t('workspace:people.import.reasons.ownerExists'))).toBeInTheDocument();
    expect(within(table).getByText(t('workspace:people.import.reasons.unknown'))).toBeInTheDocument();
    expect(screen.queryByText('Something the server said')).not.toBeInTheDocument();
  });

  it.each([
    ['validation', apiError(400, 'validation'), 'validation'],
    ['429', apiError(429, 'rate_limited'), 'rateLimited'],
    ['unknown', apiError(500, 'internal'), 'unknown'],
  ])('shows %s from the API', async (_label, err, key) => {
    const user = userEvent.setup();
    renderScreen({ adminApi: makeAdminApi({ importInvitations: vi.fn().mockRejectedValue(err) }) });
    const dialog = await openImport(user);
    await paste(user, dialog, 'ana@example.com,employee');
    await user.click(within(dialog).getByRole('button', { name: t('workspace:people.import.submit') }));
    expect((await within(dialog).findAllByText(t(`workspace:people.errors.${key}`), { exact: false })).length).toBeGreaterThan(0);
  });
});

describe('PeopleScreen: revoke invitation', () => {
  async function openRevoke(user: UserEvent, email = 'marko.ilic@example.com') {
    await openInvitations(user);
    await user.click(await screen.findByRole('button', { name: t('workspace:people.revoke.openFor', { email }) }));
    return screen.findByRole('alertdialog', { name: t('workspace:people.revoke.title') });
  }

  it('revokes the invitation', async () => {
    const user = userEvent.setup();
    const { adminApi } = renderScreen();
    const dialog = await openRevoke(user);
    await user.click(within(dialog).getByRole('button', { name: t('workspace:people.revoke.confirm') }));
    await waitFor(() => expect(adminApi.revokeInvitation).toHaveBeenCalledWith(ORG_ID, 'inv_marko'));
    expect(await screen.findByText(t('workspace:people.revoke.success', { email: 'marko.ilic@example.com' }))).toBeInTheDocument();
  });

  it.each([
    ['not_found', apiError(404, 'not_found'), 'notFound'],
    ['429', apiError(429, 'rate_limited'), 'rateLimited'],
    ['unknown', apiError(500, 'internal'), 'unknown'],
  ])('keeps the dialog open and shows %s', async (_label, err, key) => {
    const user = userEvent.setup();
    renderScreen({ adminApi: makeAdminApi({ revokeInvitation: vi.fn().mockRejectedValue(err) }) });
    const dialog = await openRevoke(user);
    await user.click(within(dialog).getByRole('button', { name: t('workspace:people.revoke.confirm') }));
    expect(await within(dialog).findByText(t(`workspace:people.errors.${key}`))).toBeInTheDocument();
  });
});

describe('PeopleScreen: sample mode', () => {
  it('shows fixtures, disables every mutation and never calls the API', async () => {
    const user = userEvent.setup();
    const { adminApi } = renderScreen({ sampleMode: true });
    expect(screen.getByText(t('workspace:people.sampleNote'))).toBeInTheDocument();
    expect(await screen.findByText('Jovan Petrović')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('workspace:people.move.openFor', { name: 'Jovan Petrović' }) })).toBeDisabled();
    expect(screen.getByRole('button', { name: t('workspace:people.end.openFor', { name: 'Jovan Petrović' }) })).toBeDisabled();
    await openInvitations(user);
    expect(await screen.findByText('marko.ilic@example.com')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('workspace:people.invite.open') })).toBeDisabled();
    expect(screen.getByRole('button', { name: t('workspace:people.import.open') })).toBeDisabled();
    expect(adminApi.listMembers).not.toHaveBeenCalled();
    expect(adminApi.listInvitations).not.toHaveBeenCalled();
  });
});
