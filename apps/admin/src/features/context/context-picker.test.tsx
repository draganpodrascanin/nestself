import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Principal } from '@nestself/contracts';
import { SAMPLE_PRINCIPALS } from '@nestself/sample-data';
import { ContextPicker } from './context-picker';
import { apiError, makeAuth, renderAccount, t } from '../account/account-test-harness';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Platform staff who is also a member of one organization and invited to another. */
const STAFF: Principal = {
  ...SAMPLE_PRINCIPALS.admin.principal,
  memberships: [
    {
      membershipId: 'mem_active',
      orgId: 'org_sample',
      orgName: 'Example d.o.o.',
      orgUnitId: null,
      status: 'ACTIVE',
      startDate: '2025-01-01T00:00:00.000Z',
      endDate: null,
    },
    {
      membershipId: 'mem_invited',
      orgId: 'org_invited',
      orgName: 'Invited Org d.o.o.',
      orgUnitId: null,
      status: 'INVITED',
      startDate: '2026-11-01T00:00:00.000Z',
      endDate: null,
    },
  ],
};

const OPERATIONS = t('auth:context.picker.option.operations');

const open = async (user: ReturnType<typeof userEvent.setup>, current: string) => {
  await user.click(await screen.findByRole('button', { name: t('auth:context.picker.open', { name: current }) }));
  return screen.findByRole('menu', { name: t('auth:context.picker.heading') });
};

describe('ContextPicker (admin)', () => {
  it('offers personal, the ACTIVE membership by name and operations, marking operations as current', async () => {
    const user = userEvent.setup();
    renderAccount(<ContextPicker sampleMode={false} />, makeAuth({ principal: STAFF }), '/');
    const menu = await open(user, OPERATIONS);
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      t('auth:context.picker.option.personal'),
      'Example d.o.o.',
      `${OPERATIONS}${t('auth:context.picker.current')}`,
    ]);
  });

  it('never offers an organization without an ACTIVE membership (Review Focus 4)', async () => {
    const user = userEvent.setup();
    renderAccount(<ContextPicker sampleMode={false} />, makeAuth({ principal: STAFF }), '/');
    const menu = await open(user, OPERATIONS);
    expect(within(menu).queryByText('Invited Org d.o.o.')).not.toBeInTheDocument();
  });

  it('switches, then refreshes the principal, then opens the overview', async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    const switchContext = vi.fn(async () => {
      calls.push('switch');
    });
    const refreshPrincipal = vi.fn(async () => {
      calls.push('refresh');
    });
    const { router } = renderAccount(
      <ContextPicker sampleMode={false} />,
      makeAuth({ principal: STAFF, switchContext, refreshPrincipal }),
      '/settings',
    );
    const menu = await open(user, OPERATIONS);
    await user.click(within(menu).getByRole('menuitem', { name: 'Example d.o.o.' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(switchContext).toHaveBeenCalledWith({ kind: 'organization', orgId: 'org_sample' });
    expect(calls).toEqual(['switch', 'refresh']);
  });

  it.each([
    [apiError(403, 'invalid_context'), 'invalidContext'],
    [apiError(403, 'org_context_expired'), 'orgContextExpired'],
    [apiError(429, 'rate_limited'), 'rateLimited'],
    [apiError(500, 'internal'), 'unknown'],
  ])('shows translated copy when the switch fails (%s)', async (err, key) => {
    const user = userEvent.setup();
    const refreshPrincipal = vi.fn();
    const { router } = renderAccount(
      <ContextPicker sampleMode={false} />,
      makeAuth({ principal: STAFF, switchContext: vi.fn().mockRejectedValue(err), refreshPrincipal }),
      '/settings',
    );
    const menu = await open(user, OPERATIONS);
    await user.click(within(menu).getByRole('menuitem', { name: t('auth:context.picker.option.personal') }));
    // The toast region repeats its text for screen readers.
    expect((await screen.findAllByText(t('auth:context.picker.errors.title'))).length).toBeGreaterThan(0);
    expect(screen.getAllByText(t(`auth:context.picker.errors.${key}`)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/^English /)).not.toBeInTheDocument();
    expect(refreshPrincipal).not.toHaveBeenCalled();
    expect(router.state.location.pathname).toBe('/settings');
  });

  it('says in sample mode that switching creates nothing', async () => {
    const user = userEvent.setup();
    renderAccount(<ContextPicker sampleMode />, makeAuth({ principal: SAMPLE_PRINCIPALS.admin.principal }), '/');
    const menu = await open(user, OPERATIONS);
    expect(within(menu).getByText(t('auth:context.picker.sampleNote'))).toBeInTheDocument();
  });
});
