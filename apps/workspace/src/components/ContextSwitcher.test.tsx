/**
 * ContextSwitcher tests (Ruling C, T-C1.02).
 *
 * - Renders options with labels and marks the current context.
 * - Hidden when there is at most one available context.
 * - Calls switchContext with the right context on selection.
 * - Shows translated error via toast when the switch rejects.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { resourcesFor } from '@nestself/i18n';
import type { Resource } from 'i18next';
import type { Principal, AvailableContextEntry, ActiveContext } from '@nestself/contracts';
import { ToastProvider } from '@nestself/ui';
import { AuthContext } from '../auth/auth-context';
import type { AuthContextValue } from '../auth/types';
import { ContextSwitcher } from './ContextSwitcher';

// ---------------------------------------------------------------------------
// i18n setup
// ---------------------------------------------------------------------------

const testI18n = i18next.createInstance();
void testI18n.use(initReactI18next).init({
  lng: 'en',
  resources: resourcesFor(['common', 'workspace']) as Resource,
  interpolation: { escapeValue: false },
  returnNull: false,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePrincipal(
  context: Principal['context'],
): Principal {
  return {
    userId: 'u1',
    displayName: 'Test',
    initials: 'T',
    locale: 'en',
    memberships: [
      {
        membershipId: 'mem-1',
        orgId: 'org_a',
        orgName: 'Test Org',
        orgUnitId: null,
        status: 'ACTIVE',
        startDate: '2024-01-01T00:00:00Z',
        endDate: null,
      },
    ],
    staffTemplates: [],
    expert: null,
    context,
    auth: {
      method: 'email_otp',
      time: new Date().toISOString(),
      secondFactor: false,
      lastStepUpAt: null,
    },
    sessionId: 'sess-1',
    tokenFamily: null,
  };
}

function renderSwitcher(opts: {
  principal: Principal;
  availableContexts: AvailableContextEntry[];
  switchContext?: (ctx: ActiveContext) => Promise<void>;
}) {
  const value: AuthContextValue = {
    status: 'authenticated',
    principal: opts.principal,
    effectiveActions: [],
    availableContexts: opts.availableContexts,
    signOut: vi.fn(),
    switchContext: opts.switchContext ?? vi.fn(),
    stepUp: vi.fn(),
    refreshPrincipal: vi.fn(),
    error: null,
  };

  return render(
    <I18nextProvider i18n={testI18n}>
      <ToastProvider labels={{ dismiss: 'Dismiss' }}>
        <AuthContext value={value}>
          <ContextSwitcher />
        </AuthContext>
      </ToastProvider>
    </I18nextProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ContextSwitcher', () => {
  const contexts: AvailableContextEntry[] = [
    { kind: 'personal', orgId: 'org_a', orgName: 'Acme' },
    { kind: 'organization', orgId: 'org_a', orgName: 'Acme' },
  ];

  it('renders the trigger with the current context label', () => {
    const principal = makePrincipal({ kind: 'personal', orgId: 'org_a' });
    renderSwitcher({ principal, availableContexts: contexts });

    // The trigger button shows the current context label.
    const trigger = screen.getByRole('button');
    expect(trigger).toHaveTextContent(/My space/);
    expect(trigger).toHaveTextContent(/Acme/);
  });

  it('is hidden when there is at most one available context', () => {
    const principal = makePrincipal({ kind: 'personal', orgId: 'org_a' });
    renderSwitcher({
      principal,
      availableContexts: [{ kind: 'personal', orgId: 'org_a' }],
    });
    // No menu trigger should be rendered.
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('opens a menu with all context options when clicked', async () => {
    const user = userEvent.setup();
    const principal = makePrincipal({ kind: 'personal', orgId: 'org_a' });
    renderSwitcher({ principal, availableContexts: contexts });

    await user.click(screen.getByRole('button'));

    // Menu items should appear (async, portal-rendered).
    const first = await screen.findByRole('menuitem', { name: /My space/ });
    const all = screen.getAllByRole('menuitem');
    expect(all).toHaveLength(2);
    expect(first).toHaveTextContent(/Acme/);
    expect(all[1]).toHaveTextContent(/Manage/);
    expect(all[1]).toHaveTextContent(/Acme/);

    // Current item has primary text styling.
    expect(first.className).toContain('text-primary');
  });

  it('calls switchContext with the right context on selection', async () => {
    const user = userEvent.setup();
    const switchFn = vi.fn().mockResolvedValue(undefined);
    const principal = makePrincipal({ kind: 'personal', orgId: 'org_a' });
    renderSwitcher({
      principal,
      availableContexts: contexts,
      switchContext: switchFn,
    });

    await user.click(screen.getByRole('button'));
    const orgItem = await screen.findByRole('menuitem', { name: /Manage/ });
    await user.click(orgItem);

    expect(switchFn).toHaveBeenCalledWith({
      kind: 'organization',
      orgId: 'org_a',
    });
  });

  it('shows a translated error toast when the switch rejects', async () => {
    const user = userEvent.setup();
    const switchFn = vi.fn().mockRejectedValue(new Error('Network error'));
    const principal = makePrincipal({ kind: 'personal', orgId: 'org_a' });
    renderSwitcher({
      principal,
      availableContexts: contexts,
      switchContext: switchFn,
    });

    await user.click(screen.getByRole('button'));
    const orgItem = await screen.findByRole('menuitem', { name: /Manage/ });
    await user.click(orgItem);

    // The toast should appear with the fallback error message.
    const region = await screen.findByRole('region');
    expect(region).toHaveTextContent(/Could not switch workspace/);
  });

  // Item 8: aria-current="true" on the current entry (not a CSS class)
  it('sets aria-current="true" on the current context menu item', async () => {
    const user = userEvent.setup();
    const principal = makePrincipal({ kind: 'personal', orgId: 'org_a' });
    renderSwitcher({ principal, availableContexts: contexts });

    await user.click(screen.getByRole('button'));
    const currentItem = await screen.findByRole('menuitem', { name: /My space/ });
    expect(currentItem).toHaveAttribute('aria-current', 'true');

    const otherItem = screen.getByRole('menuitem', { name: /Manage/ });
    expect(otherItem).not.toHaveAttribute('aria-current');
  });

  // I5: trigger uses visible text with visually-hidden prefix (no replacing aria-label)
  it('trigger includes visually-hidden prefix and visible context label', () => {
    const principal = makePrincipal({ kind: 'personal', orgId: 'org_a' });
    renderSwitcher({ principal, availableContexts: contexts });

    const trigger = screen.getByRole('button');
    // The accessible name combines the sr-only prefix and the visible label.
    expect(trigger).toHaveTextContent(/Switch workspace/);
    expect(trigger).toHaveTextContent(/My space/);
    // No replacing aria-label attribute.
    expect(trigger).not.toHaveAttribute('aria-label');
  });

  // I5: disabled state during pending switch
  it('disables all menu items while switching', async () => {
    const user = userEvent.setup();
    let resolveSwitch!: () => void;
    const switchFn = vi.fn().mockReturnValue(
      new Promise<void>((resolve) => { resolveSwitch = resolve; }),
    );
    const principal = makePrincipal({ kind: 'personal', orgId: 'org_a' });
    renderSwitcher({
      principal,
      availableContexts: contexts,
      switchContext: switchFn,
    });

    await user.click(screen.getByRole('button'));
    const orgItem = await screen.findByRole('menuitem', { name: /Manage/ });
    await user.click(orgItem);

    // The live region should announce the switching state.
    const liveRegion = document.querySelector('[aria-live="polite"]');
    expect(liveRegion?.textContent).toContain('Switching workspace');

    // Re-open the menu and assert disabled state on all items.
    await user.click(screen.getByRole('button'));
    const allItems = await screen.findAllByRole('menuitem');
    for (const item of allItems) {
      expect(item).toHaveAttribute('aria-disabled', 'true');
    }

    // Resolve the switch to clean up.
    resolveSwitch();
  });

  // Item 8: unknown error shows error.unknown copy
  it('shows error.unknown copy for unrecognised error codes', async () => {
    const user = userEvent.setup();
    const { ApiError: ApiErrorClass } = await import('@nestself/api-client');
    const switchFn = vi.fn().mockRejectedValue(
      new ApiErrorClass({ status: 500, code: 'totally_unknown_code', message: 'Boom', requestId: null }),
    );
    const principal = makePrincipal({ kind: 'personal', orgId: 'org_a' });
    renderSwitcher({
      principal,
      availableContexts: contexts,
      switchContext: switchFn,
    });

    await user.click(screen.getByRole('button'));
    const orgItem = await screen.findByRole('menuitem', { name: /Manage/ });
    await user.click(orgItem);

    // The toast should fall back to error.unknown
    const region = await screen.findByRole('region');
    expect(region).toHaveTextContent(/Could not switch workspace/);
    // And it should NOT contain the raw code
    expect(region.textContent).not.toContain('totally_unknown_code');
  });
});
