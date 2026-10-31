import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AvailableContextEntry, Principal } from '@nestself/contracts';
import { SAMPLE_PRINCIPALS } from '@nestself/sample-data';
import { ContextPicker } from './context-picker';
import { apiError, makeAuth, renderAt, t } from '../cases/cases-test-harness';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// Ruling E: hr_admin defaults to personal; set organization for tests that
// verify the picker behaviour starting from an organization context.
const HR: Principal = {
  ...SAMPLE_PRINCIPALS.hr_admin.principal,
  context: { kind: 'organization', orgId: 'org_sample' },
};

// Available contexts for the HR admin: personal + organization for one org.
const HR_CONTEXTS: AvailableContextEntry[] = [
  { kind: 'personal', orgId: 'org_sample', orgName: 'Example d.o.o.' },
  { kind: 'organization', orgId: 'org_sample', orgName: 'Example d.o.o.' },
];

/** Ivana with a second, invited membership and an expert record and staff templates. */
const MULTI: Principal = {
  ...HR,
  memberships: [
    ...HR.memberships,
    {
      membershipId: 'mem_invited',
      orgId: 'org_invited',
      orgName: 'Invited Org d.o.o.',
      orgUnitId: null,
      status: 'INVITED',
      startDate: '2026-11-01T00:00:00.000Z',
      endDate: null,
    },
    {
      membershipId: 'mem_second',
      orgId: 'org_second',
      orgName: 'Second Org d.o.o.',
      orgUnitId: null,
      status: 'ACTIVE',
      startDate: '2025-01-01T00:00:00.000Z',
      endDate: null,
    },
  ],
  expert: { id: 'expert_x', approvedCategories: [] },
  staffTemplates: ['support_operator'],
};

// Available contexts for the MULTI principal: personal + organization for
// org_sample, personal-only for org_second (no org-workspace grant there),
// plus expert and operations.
const MULTI_CONTEXTS: AvailableContextEntry[] = [
  { kind: 'personal', orgId: 'org_sample', orgName: 'Example d.o.o.' },
  { kind: 'organization', orgId: 'org_sample', orgName: 'Example d.o.o.' },
  { kind: 'personal', orgId: 'org_second', orgName: 'Second Org d.o.o.' },
  { kind: 'expert' },
  { kind: 'operations' },
];

const open = async (user: ReturnType<typeof userEvent.setup>, current: string) => {
  await user.click(await screen.findByRole('button', { name: t('auth:context.picker.open', { name: current }) }));
  return screen.findByRole('menu', { name: t('auth:context.picker.heading') });
};

describe('ContextPicker', () => {
  it('offers personal, each ACTIVE membership by name, expert and operations, and marks the current one', async () => {
    const user = userEvent.setup();
    renderAt(<ContextPicker sampleMode={false} />, '/', makeAuth({ principal: MULTI, availableContexts: MULTI_CONTEXTS }));
    const menu = await open(user, 'Example d.o.o.');
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual([
      t('auth:context.picker.option.personal'),
      `Example d.o.o.${t('auth:context.picker.current')}`,
      'Second Org d.o.o.',
      t('auth:context.picker.option.expert'),
      t('auth:context.picker.option.operations'),
    ]);
  });

  it('never offers an organization without an ACTIVE membership (Review Focus 4)', async () => {
    const user = userEvent.setup();
    renderAt(<ContextPicker sampleMode={false} />, '/', makeAuth({ principal: MULTI, availableContexts: MULTI_CONTEXTS }));
    const menu = await open(user, 'Example d.o.o.');
    // Invited Org is not in availableContexts (the API excludes non-ACTIVE memberships).
    expect(within(menu).queryByText('Invited Org d.o.o.')).not.toBeInTheDocument();
  });

  it('switches, then refreshes the principal, then goes home', async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    const switchContext = vi.fn(async () => {
      calls.push('switch');
    });
    const refreshPrincipal = vi.fn(async () => {
      calls.push('refresh');
    });
    const { router } = renderAt(
      <ContextPicker sampleMode={false} />,
      '/conversations',
      makeAuth({ principal: MULTI, availableContexts: MULTI_CONTEXTS, switchContext, refreshPrincipal }),
    );
    const menu = await open(user, 'Example d.o.o.');
    await user.click(within(menu).getByRole('menuitem', { name: 'Second Org d.o.o.' }));
    await waitFor(() => expect(refreshPrincipal).toHaveBeenCalledTimes(1));
    // Second Org is a personal-only context (no org-workspace grant).
    expect(switchContext).toHaveBeenCalledWith({ kind: 'personal', orgId: 'org_second' });
    expect(calls).toEqual(['switch', 'refresh']);
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });

  it('switching to expert lands on the assigned cases', async () => {
    const user = userEvent.setup();
    const switchContext = vi.fn().mockResolvedValue(undefined);
    const { router } = renderAt(<ContextPicker sampleMode={false} />, '/', makeAuth({ principal: MULTI, availableContexts: MULTI_CONTEXTS, switchContext }));
    const menu = await open(user, 'Example d.o.o.');
    await user.click(within(menu).getByRole('menuitem', { name: t('auth:context.picker.option.expert') }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/cases'));
    expect(switchContext).toHaveBeenCalledWith({ kind: 'expert' });
  });

  it('choosing the current context changes nothing', async () => {
    const user = userEvent.setup();
    const switchContext = vi.fn();
    renderAt(<ContextPicker sampleMode={false} />, '/', makeAuth({ principal: MULTI, availableContexts: MULTI_CONTEXTS, switchContext }));
    const menu = await open(user, 'Example d.o.o.');
    await user.click(within(menu).getByRole('menuitem', { name: new RegExp('^Example d.o.o.') }));
    expect(switchContext).not.toHaveBeenCalled();
  });

  it.each([
    [apiError(403, 'invalid_context'), 'invalidContext'],
    [apiError(403, 'org_context_expired'), 'orgContextExpired'],
    [apiError(429, 'rate_limited'), 'rateLimited'],
    [apiError(500, 'internal'), 'unknown'],
    [new Error('network'), 'unknown'],
  ])('shows translated copy when the switch fails (%s)', async (err, key) => {
    const user = userEvent.setup();
    const refreshPrincipal = vi.fn().mockResolvedValue(undefined);
    const { router } = renderAt(
      <ContextPicker sampleMode={false} />,
      '/conversations',
      makeAuth({ principal: MULTI, availableContexts: MULTI_CONTEXTS, switchContext: vi.fn().mockRejectedValue(err), refreshPrincipal }),
    );
    const menu = await open(user, 'Example d.o.o.');
    await user.click(within(menu).getByRole('menuitem', { name: t('auth:context.picker.option.personal') }));
    // The toast region repeats its text for screen readers.
    expect((await screen.findAllByText(t('auth:context.picker.errors.title'))).length).toBeGreaterThan(0);
    expect(screen.getAllByText(t(`auth:context.picker.errors.${key}`)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/^English /)).not.toBeInTheDocument();
    // Only a context that is no longer valid reloads the principal.
    expect(refreshPrincipal).toHaveBeenCalledTimes(key === 'invalidContext' || key === 'orgContextExpired' ? 1 : 0);
    expect(router.state.location.pathname).toBe('/conversations');
  });

  it('is not shown when there is only one context', async () => {
    const lone: Principal = { ...SAMPLE_PRINCIPALS.expert.principal, expert: null, context: { kind: 'personal' } };
    renderAt(
      <>
        <p>ready</p>
        <ContextPicker sampleMode={false} />
      </>,
      '/',
      makeAuth({ principal: lone }),
    );
    await screen.findByText('ready');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('a failed refresh after a successful switch is not reported as a failed switch', async () => {
    const user = userEvent.setup();
    const switchContext = vi.fn().mockResolvedValue(undefined);
    const refreshPrincipal = vi.fn().mockRejectedValue(new Error('network'));
    const { router } = renderAt(
      <ContextPicker sampleMode={false} />,
      '/conversations',
      makeAuth({ principal: MULTI, availableContexts: MULTI_CONTEXTS, switchContext, refreshPrincipal }),
    );
    const menu = await open(user, 'Example d.o.o.');
    await user.click(within(menu).getByRole('menuitem', { name: 'Second Org d.o.o.' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(refreshPrincipal).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(t('auth:context.picker.errors.title'))).not.toBeInTheDocument();
  });

  it('says in sample mode that switching creates nothing', async () => {
    const user = userEvent.setup();
    renderAt(<ContextPicker sampleMode />, '/', makeAuth({ principal: HR, availableContexts: HR_CONTEXTS }));
    const menu = await open(user, 'Example d.o.o.');
    expect(within(menu).getByText(t('auth:context.picker.sampleNote'))).toBeInTheDocument();
  });
});
