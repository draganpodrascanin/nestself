import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UserEvent } from '@testing-library/user-event';
import { SAMPLE_INVITATIONS, SAMPLE_PEOPLE } from '@nestself/sample-data';
import {
  MEMBERS,
  ORG_ID,
  OPS_PRINCIPAL,
  apiError,
  choose,
  invitation,
  makeAuth,
  makeOpsApi,
  member,
  renderOps,
  t,
} from '../organizations/ops-test-harness';
import type { RenderOpts } from '../organizations/ops-test-harness';
import { OpsPeopleScreen } from './people-screen';

const renderPeople = (opts: RenderOpts = {}) =>
  renderOps((opsApi, sampleMode) => <OpsPeopleScreen opsApi={opsApi} orgId={ORG_ID} sampleMode={sampleMode} />, opts);

const ALL_ACTIONS = ['client.configure', 'people.onboard', 'people.import', 'people.deactivate'];

async function openInvitations(user: UserEvent) {
  await user.click(await screen.findByRole('tab', { name: t('admin:people.tabs.invitations') }));
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

describe('OpsPeopleScreen: members', () => {
  it('lists members through the ops route with status and start date', async () => {
    const { opsApi } = renderPeople();
    const row = (await screen.findByText('Stefan Marković')).closest('tr')!;
    expect(within(row).getByText('user_stefan@example.test')).toBeInTheDocument();
    expect(within(row).getByText(t('admin:people.status.ACTIVE'))).toBeInTheDocument();
    expect(opsApi.listMembers).toHaveBeenCalledWith(ORG_ID, { limit: 25 });
  });

  it('filters by status and by name or email', async () => {
    const user = userEvent.setup();
    const { opsApi } = renderPeople();
    await screen.findByText('Stefan Marković');

    await choose(user, t('admin:people.filters.status'), t('admin:people.status.ENDED'));
    await waitFor(() => expect(opsApi.listMembers).toHaveBeenLastCalledWith(ORG_ID, { limit: 25, status: 'ENDED' }));

    await user.click(screen.getByRole('searchbox', { name: new RegExp(`^${t('admin:people.filters.search')}`) }));
    await user.paste('ana');
    await waitFor(() =>
      expect(opsApi.listMembers).toHaveBeenLastCalledWith(ORG_ID, { limit: 25, status: 'ENDED', search: 'ana' }),
    );
  });

  it('pages with the API cursor on Load more', async () => {
    const user = userEvent.setup();
    const listMembers = vi
      .fn()
      .mockResolvedValueOnce({ items: [MEMBERS[0]], nextCursor: 'mem_user_ivana' })
      .mockResolvedValueOnce({ items: [MEMBERS[1]], nextCursor: null });
    renderPeople({ opsApi: makeOpsApi({ listMembers }) });
    await screen.findByText('Ivana Jovanović');

    await user.click(screen.getByRole('button', { name: t('admin:paging.loadMore') }));

    expect(await screen.findByText('Stefan Marković')).toBeInTheDocument();
    expect(listMembers).toHaveBeenLastCalledWith(ORG_ID, { limit: 25, cursor: 'mem_user_ivana' });
    expect(screen.getByText('Ivana Jovanović')).toBeInTheDocument();
    expect(screen.getByText(t('admin:paging.showing', { count: 2 }))).toBeInTheDocument();
  });

  it.each([
    ['forbidden', 403, 'forbidden'],
    ['rate_limited', 429, 'rateLimited'],
    ['internal_error', 500, 'unknown'],
  ] as const)('shows a %s member list failure as people.errors.%s', async (code, status, key) => {
    renderPeople({ opsApi: makeOpsApi({ listMembers: vi.fn().mockRejectedValue(apiError(status, code)) }) });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(t('admin:people.errors.membersLoadTitle'));
    expect(alert).toHaveTextContent(t(`admin:people.errors.${key}`));
    expect(screen.queryByText(`English ${code}`)).not.toBeInTheDocument();
  });

  it('offers no Move action (the ops mirror has no member update)', async () => {
    renderPeople();
    await screen.findByText('Stefan Marković');
    expect(screen.queryByRole('button', { name: /^Move/ })).not.toBeInTheDocument();
  });

  it('hides End membership without people.deactivate and for ended members', async () => {
    const listMembers = vi.fn().mockResolvedValue({
      items: [MEMBERS[0], member('user_old', 'Old Member', { status: 'ENDED' })],
      nextCursor: null,
    });
    renderPeople({ opsApi: makeOpsApi({ listMembers }) });
    await screen.findByText('Old Member');
    expect(screen.getByRole('button', { name: t('admin:people.end.openFor', { name: 'Ivana Jovanović' }) })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('admin:people.end.openFor', { name: 'Old Member' }) })).not.toBeInTheDocument();
  });

  it('shows no End membership button without people.deactivate', async () => {
    renderPeople({ auth: makeAuth({ effectiveActions: ['client.configure'] }) });
    await screen.findByText('Stefan Marković');
    expect(screen.queryByRole('button', { name: /^End the membership/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: t('admin:people.tabs.invitations') })).not.toBeInTheDocument();
  });
});

describe('OpsPeopleScreen: end membership', () => {
  const TITLE = () => t('admin:people.end.title');

  async function openEnd(user: UserEvent, name = 'Ana Nikolić') {
    await user.click(await screen.findByRole('button', { name: t('admin:people.end.openFor', { name }) }));
    return screen.findByRole('alertdialog', { name: TITLE() });
  }

  async function confirmEnd(user: UserEvent, dialog: HTMLElement, reason: string | null = t('admin:people.end.reasons.LEFT')) {
    if (reason) await choose(user, t('admin:people.end.reason'), reason);
    await user.click(within(dialog).getByRole('button', { name: t('admin:people.end.confirm') }));
  }

  it('requires a reason before calling the API', async () => {
    const user = userEvent.setup();
    const { opsApi } = renderPeople();
    const dialog = await openEnd(user);
    await confirmEnd(user, dialog, null);
    expect(await within(dialog).findAllByText(t('admin:people.errors.reasonRequired'))).not.toHaveLength(0);
    expect(opsApi.endMember).not.toHaveBeenCalled();
  });

  it('offers the platform reason too', async () => {
    const user = userEvent.setup();
    renderPeople();
    await openEnd(user);
    await user.click(screen.getByRole('combobox', { name: t('admin:people.end.reason') }));
    expect(await screen.findByRole('option', { name: t('admin:people.end.reasons.SUSPENDED_BY_PLATFORM') })).toBeInTheDocument();
  });

  it('ends the membership with the reason after a verified step-up and refetches', async () => {
    const user = userEvent.setup();
    const endMember = vi
      .fn()
      .mockRejectedValueOnce(apiError(403, 'step_up_required'))
      .mockResolvedValueOnce({ membershipId: 'mem_user_ana', status: 'ENDED', endDate: '2026-10-25T00:00:00.000Z' });
    const auth = makeAuth();
    const { opsApi } = renderPeople({ auth, opsApi: makeOpsApi({ endMember }) });
    const dialog = await openEnd(user);

    await confirmEnd(user, dialog, t('admin:people.end.reasons.SUSPENDED_BY_PLATFORM'));

    await waitFor(() => expect(endMember).toHaveBeenCalledTimes(2));
    expect(endMember).toHaveBeenLastCalledWith(ORG_ID, 'mem_user_ana', { reason: 'SUSPENDED_BY_PLATFORM' });
    expect(auth.stepUp).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('alertdialog', { name: TITLE() })).not.toBeInTheDocument());
    await waitFor(() => expect(opsApi.listMembers).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(t('admin:people.end.success', { name: 'Ana Nikolić' }))).toBeInTheDocument();
  });

  it('closes quietly when step-up is cancelled', async () => {
    const user = userEvent.setup();
    renderPeople({
      auth: makeAuth({ stepUp: vi.fn().mockResolvedValue(false) }),
      opsApi: makeOpsApi({ endMember: vi.fn().mockRejectedValue(apiError(403, 'step_up_required')) }),
    });
    const dialog = await openEnd(user);
    await confirmEnd(user, dialog);
    await waitFor(() => expect(screen.queryByRole('alertdialog', { name: TITLE() })).not.toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each([
    ['not_found', 404, 'notFound'],
    ['conflict', 409, 'conflict'],
    ['forbidden', 403, 'forbidden'],
    ['cannot_end_self', 409, 'cannotEndSelf'],
    ['rate_limited', 429, 'rateLimited'],
    ['internal_error', 500, 'unknown'],
  ] as const)('keeps the dialog open with the %s failure as people.errors.%s', async (code, status, key) => {
    const user = userEvent.setup();
    renderPeople({ opsApi: makeOpsApi({ endMember: vi.fn().mockRejectedValue(apiError(status, code)) }) });
    const dialog = await openEnd(user);
    await confirmEnd(user, dialog);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(t(`admin:people.errors.${key}`));
    expect(screen.getByRole('alertdialog', { name: TITLE() })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

describe('OpsPeopleScreen: invitations', () => {
  it('lists pending invitations through the ops route', async () => {
    const user = userEvent.setup();
    const { opsApi } = renderPeople();
    await openInvitations(user);
    const row = (await screen.findByText('mila@example.test')).closest('tr')!;
    expect(within(row).getByText(t('admin:access.templates.employee'))).toBeInTheDocument();
    expect(within(row).getByText(t('admin:people.invitations.noOrgUnit'))).toBeInTheDocument();
    expect(opsApi.listInvitations).toHaveBeenCalledWith(ORG_ID, { limit: 25 });
  });

  it('pages invitations with Load more', async () => {
    const user = userEvent.setup();
    const listInvitations = vi
      .fn()
      .mockResolvedValueOnce({ items: [invitation('inv_1', 'mila@example.test')], nextCursor: 'inv_1' })
      .mockResolvedValueOnce({ items: [invitation('inv_2', 'luka@example.test')], nextCursor: null });
    renderPeople({ opsApi: makeOpsApi({ listInvitations }) });
    await openInvitations(user);
    await screen.findByText('mila@example.test');
    await user.click(screen.getByRole('button', { name: t('admin:paging.loadMore') }));
    expect(await screen.findByText('luka@example.test')).toBeInTheDocument();
    expect(listInvitations).toHaveBeenLastCalledWith(ORG_ID, { limit: 25, cursor: 'inv_1' });
  });

  it('shows a failed invitation list', async () => {
    const user = userEvent.setup();
    renderPeople({ opsApi: makeOpsApi({ listInvitations: vi.fn().mockRejectedValue(apiError(500, 'internal_error')) }) });
    await openInvitations(user);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(t('admin:people.errors.invitationsLoadTitle'));
    expect(alert).toHaveTextContent(t('admin:people.errors.unknown'));
  });

  it('gates Invite and the list on people.onboard and Import on people.import', async () => {
    const user = userEvent.setup();
    const { opsApi } = renderPeople({ auth: makeAuth({ effectiveActions: ['client.configure', 'people.import'] }) });
    await openInvitations(user);
    expect(screen.getByRole('button', { name: t('admin:people.import.open') })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('admin:people.invite.open') })).not.toBeInTheDocument();
    expect(opsApi.listInvitations).not.toHaveBeenCalled();
  });

  describe('invite', () => {
    const TITLE = () => t('admin:people.invite.title');

    async function openInvite(user: UserEvent) {
      await openInvitations(user);
      await user.click(screen.getByRole('button', { name: t('admin:people.invite.open') }));
      return screen.findByRole('dialog', { name: TITLE() });
    }

    async function fillInvite(user: UserEvent, dialog: HTMLElement, email = 'new@example.test') {
      await user.click(within(dialog).getByLabelText(new RegExp(`^${t('admin:people.invite.email')}`)));
      await user.paste(email);
      await choose(user, t('admin:people.invite.template'), t('admin:access.templates.employee'));
      await user.click(within(dialog).getByRole('button', { name: t('admin:people.invite.submit') }));
    }

    it('offers only invitable templates', async () => {
      const user = userEvent.setup();
      renderPeople();
      await openInvite(user);
      await user.click(screen.getByRole('combobox', { name: t('admin:people.invite.template') }));
      const options = (await screen.findAllByRole('option')).map((o) => o.textContent);
      expect(options).toContain(t('admin:access.templates.employee'));
      expect(options).toContain(t('admin:access.templates.hr_admin'));
      expect(options).not.toContain(t('admin:access.templates.platform_owner'));
      expect(options).not.toContain(t('admin:access.templates.client_operations'));
      expect(options).not.toContain(t('admin:access.templates.expert'));
    });

    it('validates the email and template before calling the API', async () => {
      const user = userEvent.setup();
      const { opsApi } = renderPeople();
      const dialog = await openInvite(user);
      await user.click(within(dialog).getByRole('button', { name: t('admin:people.invite.submit') }));
      expect(await within(dialog).findAllByText(t('admin:people.errors.emailInvalid'))).not.toHaveLength(0);
      expect(within(dialog).getAllByText(t('admin:people.errors.templateRequired'))).not.toHaveLength(0);
      expect(opsApi.createInvitation).not.toHaveBeenCalled();
    });

    it('invites through the ops route and refetches the list', async () => {
      const user = userEvent.setup();
      const { opsApi } = renderPeople();
      const dialog = await openInvite(user);
      await fillInvite(user, dialog);
      await waitFor(() =>
        expect(opsApi.createInvitation).toHaveBeenCalledWith(ORG_ID, { email: 'new@example.test', templateKey: 'employee' }),
      );
      await waitFor(() => expect(screen.queryByRole('dialog', { name: TITLE() })).not.toBeInTheDocument());
      await waitFor(() => expect(opsApi.listInvitations).toHaveBeenCalledTimes(2));
    });

    it.each([
      ['duplicate_invitation', 409, 'duplicateInvitation'],
      ['already_member', 409, 'alreadyMember'],
      ['owner_exists', 409, 'ownerExists'],
      ['forbidden', 403, 'forbidden'],
      ['rate_limited', 429, 'rateLimited'],
      ['internal_error', 500, 'unknown'],
    ] as const)('shows the %s failure as people.errors.%s', async (code, status, key) => {
      const user = userEvent.setup();
      renderPeople({ opsApi: makeOpsApi({ createInvitation: vi.fn().mockRejectedValue(apiError(status, code)) }) });
      const dialog = await openInvite(user);
      await fillInvite(user, dialog);
      expect(await within(dialog).findByRole('alert')).toHaveTextContent(t(`admin:people.errors.${key}`));
    });

    it('puts a validation answer on the field it names', async () => {
      const user = userEvent.setup();
      const error = apiError(400, 'validation', { templateKey: 'employer_owner' });
      renderPeople({ opsApi: makeOpsApi({ createInvitation: vi.fn().mockRejectedValue(error) }) });
      const dialog = await openInvite(user);
      await fillInvite(user, dialog);
      expect(await within(dialog).findByRole('alert')).toHaveTextContent(t('admin:people.errors.templateInvalid'));
    });
  });

  describe('import', () => {
    const TITLE = () => t('admin:people.import.title');

    async function openImport(user: UserEvent) {
      await openInvitations(user);
      await user.click(screen.getByRole('button', { name: t('admin:people.import.open') }));
      return screen.findByRole('dialog', { name: TITLE() });
    }

    async function paste(user: UserEvent, dialog: HTMLElement, text: string) {
      const area = within(dialog).getByLabelText(new RegExp(`^${t('admin:people.import.rows')}`));
      await user.click(area);
      await user.paste(text);
    }

    it('lists bad lines and sends nothing', async () => {
      const user = userEvent.setup();
      const { opsApi } = renderPeople();
      const dialog = await openImport(user);
      await paste(user, dialog, 'ana@example.test,employee\nnot-an-email,employee\nbo@example.test,platform_owner');
      const problems = within(dialog).getByRole('list', { name: t('admin:people.import.problemsLabel') });
      expect(problems).toHaveTextContent(t('admin:people.import.problems.email', { line: 2, value: 'not-an-email' }));
      expect(problems).toHaveTextContent(t('admin:people.import.problems.template', { line: 3, value: 'platform_owner' }));
      await user.click(within(dialog).getByRole('button', { name: t('admin:people.import.submit') }));
      expect(await within(dialog).findByRole('alert')).toHaveTextContent(t('admin:people.import.fixProblems'));
      expect(opsApi.importInvitations).not.toHaveBeenCalled();
    });

    it('imports through the ops route and shows the per-row result', async () => {
      const user = userEvent.setup();
      const importInvitations = vi.fn().mockResolvedValue({
        created: 1,
        skipped: 0,
        errors: [{ email: 'bo@example.test', reason: 'org_unit_outside_org' }],
      });
      renderPeople({ opsApi: makeOpsApi({ importInvitations }) });
      const dialog = await openImport(user);
      await paste(user, dialog, 'email,template\nana@example.test,employee\nbo@example.test,employee,team_x');
      await user.click(within(dialog).getByRole('button', { name: t('admin:people.import.submit') }));

      await waitFor(() =>
        expect(importInvitations).toHaveBeenCalledWith(ORG_ID, {
          invitations: [
            { email: 'ana@example.test', templateKey: 'employee' },
            { email: 'bo@example.test', templateKey: 'employee', orgUnitId: 'team_x' },
          ],
        }),
      );
      expect(await within(dialog).findByText(t('admin:people.import.resultSummary', { created: 1, skipped: 0, failed: 1 }))).toBeInTheDocument();
      expect(within(dialog).getByText(t('admin:people.import.reasons.invalidOrgUnit'))).toBeInTheDocument();
    });

    it.each([
      ['forbidden', 403, 'forbidden'],
      ['rate_limited', 429, 'rateLimited'],
      ['internal_error', 500, 'unknown'],
    ] as const)('shows the %s import failure as people.errors.%s', async (code, status, key) => {
      const user = userEvent.setup();
      renderPeople({ opsApi: makeOpsApi({ importInvitations: vi.fn().mockRejectedValue(apiError(status, code)) }) });
      const dialog = await openImport(user);
      await paste(user, dialog, 'ana@example.test,employee');
      await user.click(within(dialog).getByRole('button', { name: t('admin:people.import.submit') }));
      expect(await within(dialog).findByRole('alert')).toHaveTextContent(t(`admin:people.errors.${key}`));
    });
  });

  describe('revoke', () => {
    const TITLE = () => t('admin:people.revoke.title');

    async function revoke(user: UserEvent) {
      await openInvitations(user);
      await user.click(await screen.findByRole('button', { name: t('admin:people.revoke.openFor', { email: 'mila@example.test' }) }));
      const dialog = await screen.findByRole('alertdialog', { name: TITLE() });
      await user.click(within(dialog).getByRole('button', { name: t('admin:people.revoke.confirm') }));
      return dialog;
    }

    it('revokes through the ops route and refetches', async () => {
      const user = userEvent.setup();
      const { opsApi } = renderPeople();
      await revoke(user);
      await waitFor(() => expect(opsApi.revokeInvitation).toHaveBeenCalledWith(ORG_ID, 'inv_1'));
      await waitFor(() => expect(screen.queryByRole('alertdialog', { name: TITLE() })).not.toBeInTheDocument());
      await waitFor(() => expect(opsApi.listInvitations).toHaveBeenCalledTimes(2));
    });

    it.each([
      ['not_found', 404, 'notFound'],
      ['rate_limited', 429, 'rateLimited'],
      ['internal_error', 500, 'unknown'],
    ] as const)('keeps the dialog open with the %s failure', async (code, status, key) => {
      const user = userEvent.setup();
      renderPeople({ opsApi: makeOpsApi({ revokeInvitation: vi.fn().mockRejectedValue(apiError(status, code)) }) });
      const dialog = await revoke(user);
      expect(await within(dialog).findByRole('alert')).toHaveTextContent(t(`admin:people.errors.${key}`));
    });
  });
});

// ---------------------------------------------------------------------------
// Context and sample mode
// ---------------------------------------------------------------------------

describe('OpsPeopleScreen: context and sample mode', () => {
  const personal = { ...OPS_PRINCIPAL, context: { kind: 'personal' as const } };

  it('waits for the operations context before reading', async () => {
    const auth = makeAuth({ principal: personal });
    const { opsApi, rerender } = renderPeople({ auth });
    await waitFor(() => expect(auth.switchContext).toHaveBeenCalledWith({ kind: 'operations' }));
    expect(opsApi.listMembers).not.toHaveBeenCalled();
    rerender({ ...auth, principal: OPS_PRINCIPAL });
    expect(await screen.findByText('Stefan Marković')).toBeInTheDocument();
    expect(auth.switchContext).toHaveBeenCalledTimes(1);
  });

  it('shows a failed context switch', async () => {
    const auth = makeAuth({ principal: personal, switchContext: vi.fn().mockRejectedValue(apiError(429, 'rate_limited')) });
    renderPeople({ auth });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(t('admin:people.errors.loadTitle'));
    expect(alert).toHaveTextContent(t('admin:access.errors.rateLimited'));
  });

  it('shows sample members and invitations with every mutation disabled', async () => {
    const user = userEvent.setup();
    const { opsApi } = renderPeople({ sampleMode: true, auth: makeAuth({ effectiveActions: ALL_ACTIONS }) });
    expect(await screen.findByText(t('admin:people.sampleNote'))).toBeInTheDocument();
    const first = SAMPLE_PEOPLE.find((p) => p.orgId === ORG_ID)!;
    expect(await screen.findByText(first.displayName)).toBeInTheDocument();
    for (const button of screen.getAllByRole('button', { name: /^End the membership/ })) expect(button).toBeDisabled();

    await openInvitations(user);
    const sampleInvitation = SAMPLE_INVITATIONS.find((i) => i.orgId === ORG_ID)!;
    expect(await screen.findByText(sampleInvitation.email)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('admin:people.invite.open') })).toBeDisabled();
    expect(screen.getByRole('button', { name: t('admin:people.import.open') })).toBeDisabled();
    for (const button of screen.getAllByRole('button', { name: /^Revoke the invitation/ })) expect(button).toBeDisabled();
    expect(opsApi.listMembers).not.toHaveBeenCalled();
    expect(opsApi.listInvitations).not.toHaveBeenCalled();
  });
});
