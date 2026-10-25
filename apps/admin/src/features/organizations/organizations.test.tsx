import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UserEvent } from '@testing-library/user-event';
import { SAMPLE_ORG } from '@nestself/sample-data';
import { OrganizationsScreen } from './organizations-screen';
import { OrgHeading } from './org-heading';
import { OrgOverviewScreen } from './org-overview-screen';
import {
  MEMBERS,
  OPS_PRINCIPAL,
  ORG_ID,
  ORG_PAGE_TEXT,
  apiError,
  choose,
  makeAuth,
  makeOpsApi,
  organization,
  ownerGrant,
  renderOps,
  t,
} from './ops-test-harness';
import type { RenderOpts } from './ops-test-harness';

const renderList = (opts: RenderOpts = {}) =>
  renderOps((opsApi, sampleMode) => <OrganizationsScreen opsApi={opsApi} sampleMode={sampleMode} />, opts);

const renderDetail = (opts: RenderOpts = {}) =>
  renderOps(
    (opsApi, sampleMode) => (
      <>
        <OrgHeading opsApi={opsApi} orgId={ORG_ID} sampleMode={sampleMode} />
        <OrgOverviewScreen opsApi={opsApi} orgId={ORG_ID} sampleMode={sampleMode} />
      </>
    ),
    opts,
  );

const personal = { ...OPS_PRINCIPAL, context: { kind: 'personal' as const } };

// ---------------------------------------------------------------------------
// Client list
// ---------------------------------------------------------------------------

describe('OrganizationsScreen', () => {
  async function search(user: UserEvent, text: string) {
    await user.click(screen.getByRole('searchbox', { name: new RegExp(`^${t('admin:organizations.search')}`) }));
    await user.paste(text);
    await user.click(screen.getByRole('button', { name: t('admin:organizations.searchSubmit') }));
  }

  it('lists the clients from the API with status and a link to each', async () => {
    const user = userEvent.setup();
    const { opsApi } = renderList();
    const link = await screen.findByRole('link', { name: 'Example d.o.o.' });
    const row = link.closest('tr')!;
    expect(within(row).getByText(t('admin:organizations.statuses.ACTIVE'))).toBeInTheDocument();
    expect(opsApi.listOrganizations).toHaveBeenCalledWith({ limit: 25 });

    await user.click(link);
    expect(await screen.findByText(ORG_PAGE_TEXT)).toBeInTheDocument();
  });

  it('searches by the submitted text', async () => {
    const user = userEvent.setup();
    const listOrganizations = vi
      .fn()
      .mockResolvedValueOnce({ items: [organization('org_a', 'Alpha'), organization('org_b', 'Beta')], nextCursor: null })
      .mockResolvedValueOnce({ items: [organization('org_b', 'Beta')], nextCursor: null });
    renderList({ opsApi: makeOpsApi({ listOrganizations }) });
    await screen.findByRole('link', { name: 'Alpha' });

    await search(user, ' Be ');

    await waitFor(() => expect(listOrganizations).toHaveBeenLastCalledWith({ limit: 25, search: 'Be' }));
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Alpha' })).not.toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Beta' })).toBeInTheDocument();
  });

  it('says when no client matches the search', async () => {
    const user = userEvent.setup();
    const listOrganizations = vi
      .fn()
      .mockResolvedValueOnce({ items: [organization('org_a', 'Alpha')], nextCursor: null })
      .mockResolvedValueOnce({ items: [], nextCursor: null });
    renderList({ opsApi: makeOpsApi({ listOrganizations }) });
    await screen.findByRole('link', { name: 'Alpha' });
    await search(user, 'zzz');
    expect(await screen.findByText(t('admin:organizations.noMatch'))).toBeInTheDocument();
  });

  it('pages with the API cursor on Load more instead of capping the list', async () => {
    const user = userEvent.setup();
    const listOrganizations = vi
      .fn()
      .mockResolvedValueOnce({ items: [organization('org_a', 'Alpha')], nextCursor: 'org_a' })
      .mockResolvedValueOnce({ items: [organization('org_b', 'Beta')], nextCursor: null });
    renderList({ opsApi: makeOpsApi({ listOrganizations }) });
    await screen.findByRole('link', { name: 'Alpha' });
    expect(screen.getByText(t('admin:paging.showingMore', { count: 1 }))).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: t('admin:paging.loadMore') }));

    expect(await screen.findByRole('link', { name: 'Beta' })).toBeInTheDocument();
    expect(listOrganizations).toHaveBeenLastCalledWith({ limit: 25, cursor: 'org_a' });
    expect(screen.getByRole('link', { name: 'Alpha' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('admin:paging.loadMore') })).not.toBeInTheDocument();
    expect(screen.getByText(t('admin:paging.showing', { count: 2 }))).toBeInTheDocument();
  });

  it('shows a failed next page under the rows', async () => {
    const user = userEvent.setup();
    const listOrganizations = vi
      .fn()
      .mockResolvedValueOnce({ items: [organization('org_a', 'Alpha')], nextCursor: 'org_a' })
      .mockRejectedValueOnce(apiError(429, 'rate_limited'));
    renderList({ opsApi: makeOpsApi({ listOrganizations }) });
    await screen.findByRole('link', { name: 'Alpha' });
    await user.click(screen.getByRole('button', { name: t('admin:paging.loadMore') }));
    expect(await screen.findByRole('alert')).toHaveTextContent(t('admin:organizations.errors.rateLimited'));
    expect(screen.getByRole('link', { name: 'Alpha' })).toBeInTheDocument();
  });

  it('turns a 403 into the assigned-clients note, not an error', async () => {
    renderList({ opsApi: makeOpsApi({ listOrganizations: vi.fn().mockRejectedValue(apiError(403, 'forbidden')) }) });
    expect(await screen.findByText(t('admin:organizations.limited'))).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('admin:organizations.searchSubmit') })).toBeDisabled();
  });

  it.each([
    ['rate_limited', 429, 'rateLimited'],
    ['internal_error', 500, 'unknown'],
  ] as const)('shows the %s list failure as organizations.errors.%s', async (code, status, key) => {
    renderList({ opsApi: makeOpsApi({ listOrganizations: vi.fn().mockRejectedValue(apiError(status, code)) }) });
    expect(await screen.findByRole('alert')).toHaveTextContent(t(`admin:organizations.errors.${key}`));
    expect(screen.queryByText(`English ${code}`)).not.toBeInTheDocument();
  });

  it('switches to the operations context once before listing', async () => {
    const auth = makeAuth({ principal: personal });
    const { opsApi, rerender } = renderList({ auth });
    await waitFor(() => expect(auth.switchContext).toHaveBeenCalledWith({ kind: 'operations' }));
    expect(opsApi.listOrganizations).not.toHaveBeenCalled();
    rerender({ ...auth, principal: OPS_PRINCIPAL });
    expect(await screen.findByRole('link', { name: 'Example d.o.o.' })).toBeInTheDocument();
    expect(auth.switchContext).toHaveBeenCalledTimes(1);
  });

  it('shows a failed context switch', async () => {
    const auth = makeAuth({ principal: personal, switchContext: vi.fn().mockRejectedValue(apiError(500, 'internal_error')) });
    const { opsApi } = renderList({ auth });
    expect(await screen.findByRole('alert')).toHaveTextContent(t('admin:access.errors.unknown'));
    expect(opsApi.listOrganizations).not.toHaveBeenCalled();
  });

  it('shows the sample organization in sample mode without calling the API', async () => {
    const { opsApi } = renderList({ sampleMode: true });
    expect(await screen.findByRole('link', { name: SAMPLE_ORG.name })).toBeInTheDocument();
    expect(opsApi.listOrganizations).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Organization heading and overview
// ---------------------------------------------------------------------------

describe('OrgHeading and OrgOverviewScreen', () => {
  const OPEN = () => t('admin:access.transfer.open');
  const TITLE = () => t('admin:access.transfer.title');

  it('shows the API name, id, slug, status and owner', async () => {
    const { opsApi } = renderDetail();
    expect(await screen.findByRole('heading', { level: 2, name: 'Example d.o.o.' })).toBeInTheDocument();
    expect(screen.getByText('example')).toBeInTheDocument();
    expect(screen.getByText(ORG_ID)).toBeInTheDocument();
    expect(screen.getByText(t('admin:organizations.statuses.ACTIVE'))).toBeInTheDocument();
    const owner = screen.getByRole('region', { name: t('admin:organizations.owner.title') });
    expect(await within(owner).findByText(t('admin:organizations.owner.current', { name: 'Ivana Jovanović' }))).toBeInTheDocument();
    // One read serves the heading and the overview.
    expect(opsApi.getOrganization).toHaveBeenCalledTimes(1);
    expect(opsApi.listGrants).toHaveBeenCalledWith(ORG_ID, { includeRevoked: true });
  });

  it('switches to the operations context once for the heading and the tab together', async () => {
    let resolveSwitch: () => void = () => {};
    const switchContext = vi.fn().mockImplementation(() => new Promise<void>((resolve) => (resolveSwitch = resolve)));
    const auth = makeAuth({ principal: personal, switchContext });
    const { opsApi, rerender } = renderDetail({ auth });
    await waitFor(() => expect(switchContext).toHaveBeenCalledTimes(1));
    expect(opsApi.getOrganization).not.toHaveBeenCalled();
    resolveSwitch();
    rerender({ ...auth, principal: OPS_PRINCIPAL });
    expect(await screen.findByRole('heading', { level: 2, name: 'Example d.o.o.' })).toBeInTheDocument();
    expect(switchContext).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['not_found', 404, 'notFound'],
    ['forbidden', 403, 'forbidden'],
    ['rate_limited', 429, 'rateLimited'],
    ['internal_error', 500, 'unknown'],
  ] as const)('shows a %s organization read as organizations.errors.%s', async (code, status, key) => {
    renderDetail({ opsApi: makeOpsApi({ getOrganization: vi.fn().mockRejectedValue(apiError(status, code)) }) });
    await waitFor(() =>
      expect(screen.getAllByRole('alert').some((a) => a.textContent?.includes(t(`admin:organizations.errors.${key}`)))).toBe(true),
    );
    expect(screen.queryByText(`English ${code}`)).not.toBeInTheDocument();
  });

  it('shows a failed owner read in the owner card', async () => {
    renderDetail({ opsApi: makeOpsApi({ listGrants: vi.fn().mockRejectedValue(apiError(500, 'internal_error')) }) });
    const owner = await screen.findByRole('region', { name: t('admin:organizations.owner.title') });
    expect(await within(owner).findByRole('alert')).toHaveTextContent(t('admin:access.errors.unknown'));
    expect(within(owner).getByRole('button')).toBeDisabled();
  });

  it('says there is no owner and offers to set the first one through the ops route', async () => {
    const user = userEvent.setup();
    const { opsApi } = renderDetail({ opsApi: makeOpsApi({ listGrants: vi.fn().mockResolvedValue({ items: [] }) }) });
    const owner = await screen.findByRole('region', { name: t('admin:organizations.owner.title') });
    expect(await within(owner).findByText(t('admin:organizations.owner.none'))).toBeInTheDocument();

    await user.click(within(owner).getByRole('button', { name: t('admin:organizations.owner.set') }));
    const dialog = await screen.findByRole('dialog', { name: TITLE() });
    expect(within(dialog).getByText(t('admin:access.transfer.noOwner'))).toBeInTheDocument();
    await choose(user, t('admin:access.transfer.member'), 'Stefan Marković');
    await user.click(within(dialog).getByRole('button', { name: t('admin:access.transfer.submit') }));

    await waitFor(() => expect(opsApi.transferOwnership).toHaveBeenCalledWith(ORG_ID, { newOwnerUserId: 'user_stefan' }));
    await waitFor(() => expect(opsApi.listGrants).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: TITLE() })).not.toBeInTheDocument());
  });

  it('transfers ownership after a verified step-up and offers only other members', async () => {
    const user = userEvent.setup();
    const transferOwnership = vi
      .fn()
      .mockRejectedValueOnce(apiError(403, 'step_up_required'))
      .mockResolvedValueOnce({ revokedGrantId: 'g_owner_user_ivana', createdGrant: ownerGrant('user_ana') });
    const auth = makeAuth();
    renderDetail({ auth, opsApi: makeOpsApi({ transferOwnership }) });
    await user.click(await screen.findByRole('button', { name: OPEN() }));
    const dialog = await screen.findByRole('dialog', { name: TITLE() });
    await user.click(screen.getByRole('combobox', { name: t('admin:access.transfer.member') }));
    const options = (await screen.findAllByRole('option')).map((o) => o.textContent);
    expect(options).toEqual(MEMBERS.filter((m) => m.userId !== 'user_ivana').map((m) => m.displayName));
    await user.click(screen.getByRole('option', { name: 'Ana Nikolić' }));
    await user.click(within(dialog).getByRole('button', { name: t('admin:access.transfer.submit') }));

    await waitFor(() => expect(transferOwnership).toHaveBeenCalledTimes(2));
    expect(auth.stepUp).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: TITLE() })).not.toBeInTheDocument());
  });

  it.each([
    ['conflict', 409, 'alreadyOwner'],
    ['subject_not_member', 409, 'subjectNotMember'],
    ['owner_exists', 409, 'ownerExists'],
    ['internal_error', 500, 'unknown'],
  ] as const)('maps a %s transfer failure to access.errors.%s in the dialog', async (code, status, key) => {
    const user = userEvent.setup();
    renderDetail({ opsApi: makeOpsApi({ transferOwnership: vi.fn().mockRejectedValue(apiError(status, code)) }) });
    await user.click(await screen.findByRole('button', { name: OPEN() }));
    const dialog = await screen.findByRole('dialog', { name: TITLE() });
    await choose(user, t('admin:access.transfer.member'), 'Stefan Marković');
    await user.click(within(dialog).getByRole('button', { name: t('admin:access.transfer.submit') }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(t(`admin:access.errors.${key}`));
  });

  it('hides the transfer button without access.grant and the owner card without access.preview', async () => {
    renderDetail({ auth: makeAuth({ effectiveActions: ['access.preview', 'client.configure'] }) });
    const owner = await screen.findByRole('region', { name: t('admin:organizations.owner.title') });
    await within(owner).findByText(t('admin:organizations.owner.current', { name: 'Ivana Jovanović' }));
    expect(within(owner).queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows no owner card and reads no grants without access.preview', async () => {
    const { opsApi } = renderDetail({ auth: makeAuth({ effectiveActions: ['client.configure'] }) });
    await screen.findByRole('heading', { level: 2, name: 'Example d.o.o.' });
    expect(screen.queryByRole('region', { name: t('admin:organizations.owner.title') })).not.toBeInTheDocument();
    expect(opsApi.listGrants).not.toHaveBeenCalled();
  });

  it('shows the sample organization with the transfer disabled in sample mode', async () => {
    const { opsApi } = renderDetail({ sampleMode: true });
    expect(await screen.findByRole('heading', { level: 2, name: SAMPLE_ORG.name })).toBeInTheDocument();
    expect(screen.getByText(t('admin:organizations.sampleNote'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: OPEN() })).toBeDisabled();
    expect(opsApi.getOrganization).not.toHaveBeenCalled();
    expect(opsApi.listGrants).not.toHaveBeenCalled();
  });
});
