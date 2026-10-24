import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { QueryClient } from '@tanstack/react-query';
import { SAMPLE_PRINCIPALS } from '@nestself/sample-data';
import { routeTree } from '../routeTree.gen';
import i18n from '../i18n';
import type { AuthSnapshot } from '../auth';

function renderWithRouter(opts: { path: string; auth: AuthSnapshot }) {
  // Sync window.location.search so SampleAuthProvider picks the correct role.
  const roleKey = (Object.keys(SAMPLE_PRINCIPALS) as (keyof typeof SAMPLE_PRINCIPALS)[])
    .find((k) => SAMPLE_PRINCIPALS[k].principal === opts.auth.principal) ?? 'employee';
  window.history.replaceState(null, '', `/?role=${roleKey}`);

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient, auth: opts.auth },
    history: createMemoryHistory({ initialEntries: [opts.path] }),
  });

  return render(<RouterProvider router={router} />);
}

function authFor(role: keyof typeof SAMPLE_PRINCIPALS): AuthSnapshot {
  const p = SAMPLE_PRINCIPALS[role];
  return { principal: p.principal, effectiveActions: p.effectiveActions, availableContexts: p.availableContexts };
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

describe('Admin: Experts table', () => {
  it('renders three expert rows', async () => {
    renderWithRouter({ path: '/experts', auth: authFor('admin') });

    // Wait for the heading to appear
    const heading = await screen.findByRole('heading', { name: /experts/i });
    expect(heading).toBeInTheDocument();

    // The table should have 3 body rows
    const rows = document.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(3);
  });

  it('compact toggle changes table density attribute', async () => {
    const user = userEvent.setup();
    renderWithRouter({ path: '/experts', auth: authFor('admin') });

    await screen.findByRole('heading', { name: /experts/i });

    // Default density
    const table = document.querySelector('table');
    expect(table).toHaveAttribute('data-density', 'default');

    // Click compact button
    const compactBtn = screen.getByRole('radio', { name: /compact/i });
    await user.click(compactBtn);

    expect(table).toHaveAttribute('data-density', 'compact');
  });
});

describe('Admin: Permission check', () => {
  it('user without admin permissions sees the permission block', async () => {
    renderWithRouter({ path: '/', auth: authFor('employee') });

    const permBlock = await screen.findByText(/not available to your role/i);
    expect(permBlock).toBeInTheDocument();
  });
});
