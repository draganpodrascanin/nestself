import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UserEvent } from '@testing-library/user-event';
import type { OrgAdminApi } from '@nestself/api-client';
import type { AuthContextValue } from '../../auth';
import {
  HR_PRINCIPAL,
  ORG_ID,
  ORG_UNITS,
  actionsWithout,
  apiError,
  makeAdminApi,
  makeAuth,
  makeQueryClient,
  renderWithProviders,
  t,
} from '../people/people-test-harness';
import { QueryClient } from '@tanstack/react-query';
import { AccessScreen } from '../access/access-screen';
import { useOrgUnits } from '../access/use-org-admin';
import { OrgUnitsScreen } from './org-units-screen';

function renderScreen(opts: { adminApi?: OrgAdminApi; auth?: AuthContextValue; sampleMode?: boolean } = {}) {
  const adminApi = opts.adminApi ?? makeAdminApi();
  const auth = opts.auth ?? makeAuth();
  renderWithProviders(<OrgUnitsScreen adminApi={adminApi} sampleMode={opts.sampleMode ?? false} />, auth);
  return { adminApi, auth };
}

async function choose(user: UserEvent, label: string, option: string) {
  await user.click(screen.getByRole('combobox', { name: label }));
  await user.click(await screen.findByRole('option', { name: option }));
}

function nodeOf(name: string): HTMLElement {
  return screen.getByText(name).closest('li')!;
}

async function openAction(user: UserEvent, key: 'rename' | 'addChild' | 'move', name: string) {
  await user.click(await screen.findByRole('button', { name: t(`workspace:orgUnits.${key}.openFor`, { name }) }));
  return screen.findByRole('dialog', { name: t(`workspace:orgUnits.${key}.title`) });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('OrgUnitsScreen: tree', () => {
  it('builds the tree from the flat list, indented by depth, with kind badges', async () => {
    renderScreen();
    const tree = await screen.findByRole('list', { name: t('workspace:orgUnits.treeLabel') });
    const items = within(tree).getAllByRole('listitem');
    expect(items.map((li) => [li.getAttribute('data-org-unit-id'), li.getAttribute('data-depth')])).toEqual([
      ['ou_root', '0'],
      ['ou_commercial', '1'],
      ['team_sales', '2'],
      ['ou_engineering', '1'],
      ['team_product', '2'],
    ]);
    expect(within(nodeOf('Example d.o.o.')).getByText(t('workspace:orgUnits.kinds.COMPANY'))).toBeInTheDocument();
    expect(within(nodeOf('Engineering')).getByText(t('workspace:orgUnits.kinds.DEPARTMENT'))).toBeInTheDocument();
    expect(within(nodeOf('Product')).getByText(t('workspace:orgUnits.kinds.TEAM'))).toBeInTheDocument();
  });

  it('hides archived units', async () => {
    renderScreen({
      adminApi: makeAdminApi({
        listOrgUnits: vi.fn().mockResolvedValue([
          ...ORG_UNITS,
          { ...ORG_UNITS[2]!, id: 'team_old', name: 'Old team', archivedAt: '2026-01-01T00:00:00.000Z' },
        ]),
      }),
    });
    await screen.findByText('Product');
    expect(screen.queryByText('Old team')).not.toBeInTheDocument();
  });

  it('the root COMPANY cannot be moved', async () => {
    renderScreen();
    await screen.findByText('Example d.o.o.');
    expect(within(nodeOf('Example d.o.o.')).queryByRole('button', { name: t('workspace:orgUnits.move.openFor', { name: 'Example d.o.o.' }) })).not.toBeInTheDocument();
    expect(within(nodeOf('Engineering')).getByRole('button', { name: t('workspace:orgUnits.move.openFor', { name: 'Engineering' }) })).toBeInTheDocument();
  });

  it('shows no actions without org_units.manage', async () => {
    renderScreen({ auth: makeAuth({ effectiveActions: actionsWithout('org_units.manage') }) });
    await screen.findByText('Engineering');
    expect(screen.queryByRole('button', { name: t('workspace:orgUnits.rename.openFor', { name: 'Engineering' }) })).not.toBeInTheDocument();
  });

  it('shows a load failure', async () => {
    renderScreen({ adminApi: makeAdminApi({ listOrgUnits: vi.fn().mockRejectedValue(apiError(429, 'rate_limited')) }) });
    expect(await screen.findByText(t('workspace:orgUnits.errors.loadTitle'))).toBeInTheDocument();
    expect(screen.getByText(t('workspace:orgUnits.errors.rateLimited'))).toBeInTheDocument();
  });

  it('switches into the organization context once', async () => {
    const auth = makeAuth({ principal: { ...HR_PRINCIPAL, context: { kind: 'personal' } } });
    const { adminApi } = renderScreen({ auth });
    await waitFor(() => expect(auth.switchContext).toHaveBeenCalledTimes(1));
    expect(adminApi.listOrgUnits).not.toHaveBeenCalled();
  });

  it('asks to choose an organization in the header when the context is personal and there are two', async () => {
    const auth = makeAuth({
      principal: {
        ...HR_PRINCIPAL,
        memberships: [...HR_PRINCIPAL.memberships, { ...HR_PRINCIPAL.memberships[0]!, membershipId: 'mem_org_b', orgId: 'org_b', orgName: 'Second Example d.o.o.' }],
        context: { kind: 'personal' },
      },
    });
    const { adminApi } = renderScreen({ auth });
    expect(await screen.findByText(t('workspace:orgUnits.chooseOrganization'))).toBeInTheDocument();
    expect(auth.switchContext).not.toHaveBeenCalled();
    expect(adminApi.listOrgUnits).not.toHaveBeenCalled();
  });

  it('sample mode shows fixtures with actions disabled', async () => {
    const { adminApi } = renderScreen({ sampleMode: true });
    expect(screen.getByText(t('workspace:orgUnits.sampleNote'))).toBeInTheDocument();
    expect(await screen.findByText('Engineering')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('workspace:orgUnits.rename.openFor', { name: 'Engineering' }) })).toBeDisabled();
    expect(adminApi.listOrgUnits).not.toHaveBeenCalled();
  });
});

describe('OrgUnitsScreen: rename', () => {
  it('renames a unit', async () => {
    const user = userEvent.setup();
    const { adminApi } = renderScreen();
    const dialog = await openAction(user, 'rename', 'Engineering');
    const input = within(dialog).getByRole('textbox', { name: t('workspace:orgUnits.fields.name') });
    await user.clear(input);
    await user.type(input, 'Product engineering');
    await user.click(within(dialog).getByRole('button', { name: t('workspace:orgUnits.rename.submit') }));
    await waitFor(() =>
      expect(adminApi.updateOrgUnit).toHaveBeenCalledWith(ORG_ID, 'ou_engineering', { name: 'Product engineering' }),
    );
    expect(await screen.findByText(t('workspace:orgUnits.rename.success', { name: 'Product engineering' }))).toBeInTheDocument();
  });

  it('checks the name before sending', async () => {
    const user = userEvent.setup();
    const { adminApi } = renderScreen();
    const dialog = await openAction(user, 'rename', 'Engineering');
    await user.clear(within(dialog).getByRole('textbox', { name: t('workspace:orgUnits.fields.name') }));
    await user.click(within(dialog).getByRole('button', { name: t('workspace:orgUnits.rename.submit') }));
    expect((await within(dialog).findAllByText(t('workspace:orgUnits.errors.nameLength'), { exact: false })).length).toBeGreaterThan(0);
    expect(adminApi.updateOrgUnit).not.toHaveBeenCalled();
  });

  it.each([
    ['validation', apiError(400, 'validation', { issues: [{ path: ['name'], message: 'x', code: 'y' }] }), 'validation'],
    ['not_found', apiError(404, 'not_found'), 'notFound'],
    ['conflict', apiError(409, 'conflict'), 'conflict'],
    ['429', apiError(429, 'rate_limited'), 'rateLimited'],
    ['unknown', apiError(500, 'internal'), 'unknown'],
  ])('shows %s from the API', async (_label, err, key) => {
    const user = userEvent.setup();
    renderScreen({ adminApi: makeAdminApi({ updateOrgUnit: vi.fn().mockRejectedValue(err) }) });
    const dialog = await openAction(user, 'rename', 'Engineering');
    await user.type(within(dialog).getByRole('textbox', { name: t('workspace:orgUnits.fields.name') }), ' 2');
    await user.click(within(dialog).getByRole('button', { name: t('workspace:orgUnits.rename.submit') }));
    expect((await within(dialog).findAllByText(t(`workspace:orgUnits.errors.${key}`), { exact: false })).length).toBeGreaterThan(0);
  });

  it('a cancelled step-up closes quietly', async () => {
    const user = userEvent.setup();
    const auth = makeAuth({ stepUp: vi.fn().mockResolvedValue(false) });
    renderScreen({ auth, adminApi: makeAdminApi({ updateOrgUnit: vi.fn().mockRejectedValue(apiError(403, 'step_up_required')) }) });
    const dialog = await openAction(user, 'rename', 'Engineering');
    await user.type(within(dialog).getByRole('textbox', { name: t('workspace:orgUnits.fields.name') }), ' 2');
    await user.click(within(dialog).getByRole('button', { name: t('workspace:orgUnits.rename.submit') }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(auth.stepUp).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(t('workspace:orgUnits.errors.unknown'), { exact: false })).not.toBeInTheDocument();
  });
});

describe('OrgUnitsScreen: add child', () => {
  it('creates a child with name and kind', async () => {
    const user = userEvent.setup();
    const { adminApi } = renderScreen();
    const dialog = await openAction(user, 'addChild', 'Engineering');
    await user.type(within(dialog).getByRole('textbox', { name: t('workspace:orgUnits.fields.name') }), 'Platform');
    await choose(user, t('workspace:orgUnits.fields.kind'), t('workspace:orgUnits.kinds.TEAM'));
    await user.click(within(dialog).getByRole('button', { name: t('workspace:orgUnits.addChild.submit') }));
    await waitFor(() =>
      expect(adminApi.createOrgUnit).toHaveBeenCalledWith(ORG_ID, { parentId: 'ou_engineering', kind: 'TEAM', name: 'Platform' }),
    );
    expect(await screen.findByText(t('workspace:orgUnits.addChild.success', { name: 'Platform' }))).toBeInTheDocument();
  });

  it.each([
    ['invalid_kind', apiError(400, 'invalid_kind'), 'invalidKind'],
    ['not_found', apiError(404, 'not_found'), 'notFound'],
    ['validation', apiError(400, 'validation'), 'validation'],
    ['429', apiError(429, 'rate_limited'), 'rateLimited'],
    ['unknown', apiError(500, 'internal'), 'unknown'],
  ])('shows %s from the API', async (_label, err, key) => {
    const user = userEvent.setup();
    renderScreen({ adminApi: makeAdminApi({ createOrgUnit: vi.fn().mockRejectedValue(err) }) });
    const dialog = await openAction(user, 'addChild', 'Engineering');
    await user.type(within(dialog).getByRole('textbox', { name: t('workspace:orgUnits.fields.name') }), 'Platform');
    await user.click(within(dialog).getByRole('button', { name: t('workspace:orgUnits.addChild.submit') }));
    expect((await within(dialog).findAllByText(t(`workspace:orgUnits.errors.${key}`), { exact: false })).length).toBeGreaterThan(0);
  });
});

describe('OrgUnitsScreen: move', () => {
  it('offers parents other than itself, its descendants and its current parent', async () => {
    const user = userEvent.setup();
    renderScreen();
    await openAction(user, 'move', 'Engineering');
    await user.click(screen.getByRole('combobox', { name: t('workspace:orgUnits.fields.parent') }));
    const options = (await screen.findAllByRole('option')).map((o) => o.textContent);
    expect(options).toEqual(expect.arrayContaining(['Commercial', 'Sales']));
    expect(options).not.toContain('Engineering');
    expect(options).not.toContain('Product');
    expect(options).not.toContain('Example d.o.o.');
  });

  it('moves a unit', async () => {
    const user = userEvent.setup();
    const { adminApi } = renderScreen();
    const dialog = await openAction(user, 'move', 'Product');
    await choose(user, t('workspace:orgUnits.fields.parent'), 'Commercial');
    await user.click(within(dialog).getByRole('button', { name: t('workspace:orgUnits.move.submit') }));
    await waitFor(() => expect(adminApi.moveOrgUnit).toHaveBeenCalledWith(ORG_ID, 'team_product', { parentId: 'ou_commercial' }));
    expect(await screen.findByText(t('workspace:orgUnits.move.success', { name: 'Product', parent: 'Commercial' }))).toBeInTheDocument();
  });

  it('asks for a parent', async () => {
    const user = userEvent.setup();
    const { adminApi } = renderScreen();
    const dialog = await openAction(user, 'move', 'Product');
    await user.click(within(dialog).getByRole('button', { name: t('workspace:orgUnits.move.submit') }));
    expect((await within(dialog).findAllByText(t('workspace:orgUnits.errors.parentRequired'), { exact: false })).length).toBeGreaterThan(0);
    expect(adminApi.moveOrgUnit).not.toHaveBeenCalled();
  });

  it.each([
    ['root_immovable', apiError(400, 'root_immovable'), 'rootImmovable'],
    ['cycle', apiError(400, 'cycle'), 'cycle'],
    ['not_found', apiError(404, 'not_found'), 'notFound'],
    ['conflict', apiError(409, 'conflict'), 'conflict'],
    ['429', apiError(429, 'rate_limited'), 'rateLimited'],
    ['unknown', apiError(500, 'internal'), 'unknown'],
  ])('shows %s from the API', async (_label, err, key) => {
    const user = userEvent.setup();
    renderScreen({ adminApi: makeAdminApi({ moveOrgUnit: vi.fn().mockRejectedValue(err) }) });
    const dialog = await openAction(user, 'move', 'Product');
    await choose(user, t('workspace:orgUnits.fields.parent'), 'Commercial');
    await user.click(within(dialog).getByRole('button', { name: t('workspace:orgUnits.move.submit') }));
    expect((await within(dialog).findAllByText(t(`workspace:orgUnits.errors.${key}`), { exact: false })).length).toBeGreaterThan(0);
  });

  it('retries through step-up', async () => {
    const user = userEvent.setup();
    const auth = makeAuth();
    const moveOrgUnit = vi.fn().mockRejectedValueOnce(apiError(403, 'step_up_required')).mockResolvedValueOnce(ORG_UNITS[2]);
    renderScreen({ auth, adminApi: makeAdminApi({ moveOrgUnit }) });
    const dialog = await openAction(user, 'move', 'Product');
    await choose(user, t('workspace:orgUnits.fields.parent'), 'Commercial');
    await user.click(within(dialog).getByRole('button', { name: t('workspace:orgUnits.move.submit') }));
    await waitFor(() => expect(moveOrgUnit).toHaveBeenCalledTimes(2));
    expect(auth.stepUp).toHaveBeenCalledTimes(1);
  });
});

describe('org-unit cache shared with the access screen', () => {
  it('the tree stays populated after the access screen loaded the same organization', async () => {
    // The app's default staleTime, so the second screen reads the cache.
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } });
    const archived = { ...ORG_UNITS[2]!, id: 'team_old', name: 'Old team', archivedAt: '2026-01-01T00:00:00.000Z' };
    const adminApi = makeAdminApi({
      listOrgUnits: vi.fn().mockResolvedValue([...ORG_UNITS, archived]),
      listGrants: vi.fn().mockResolvedValue({ items: [] }),
      previewAccess: vi.fn().mockResolvedValue({ userId: 'x', orgId: ORG_ID, actions: [], grantIds: [], assignmentIds: [] }),
    });
    const auth = makeAuth({ effectiveActions: [...makeAuth().effectiveActions, 'access.preview', 'access.grant'] });

    const first = renderWithProviders(<AccessScreen adminApi={adminApi} sampleMode={false} />, auth, queryClient);
    await waitFor(() => expect(adminApi.listOrgUnits).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(queryClient.getQueryData(['org-admin', ORG_ID, 'org-units'])).toBeDefined());
    first.unmount();

    renderWithProviders(<OrgUnitsScreen adminApi={adminApi} sampleMode={false} />, auth, queryClient);
    const tree = await screen.findByRole('list', { name: t('workspace:orgUnits.treeLabel') });
    expect(within(tree).getAllByRole('listitem')).toHaveLength(ORG_UNITS.length);
    expect(within(tree).getByText('Engineering')).toBeInTheDocument();
    expect(adminApi.listOrgUnits).toHaveBeenCalledTimes(1);
  });

  it('the access screen still gets active units only from the full cached list', async () => {
    const queryClient = makeQueryClient();
    const archived = { ...ORG_UNITS[2]!, id: 'team_old', name: 'Old team', archivedAt: '2026-01-01T00:00:00.000Z' };
    queryClient.setQueryData(['org-admin', ORG_ID, 'org-units'], [...ORG_UNITS, archived]);
    const seen: unknown[] = [];
    function Probe() {
      const q = useOrgUnits(makeAdminApi(), ORG_ID);
      seen.push(q.data);
      return null;
    }
    renderWithProviders(<Probe />, makeAuth(), queryClient);
    await waitFor(() => expect(seen.at(-1)).toBeDefined());
    const units = seen.at(-1) as { id: string; name: string }[];
    expect(units.map((u) => u.id)).not.toContain('team_old');
    expect(units[0]).toEqual({ id: 'ou_root', name: 'Example d.o.o.' });
  });
});
