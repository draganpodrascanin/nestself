import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { QueryClient } from '@tanstack/react-query';
import type { Session } from '@nestself/contracts';
import { SAMPLE_SESSIONS } from '@nestself/sample-data';
import { routeTree } from '../routeTree.gen';
import i18n from '../i18n';

function renderWithRouter(opts: { path: string; session: Session }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient, session: opts.session },
    history: createMemoryHistory({ initialEntries: [opts.path] }),
  });

  return render(<RouterProvider router={router} />);
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

describe('Admin: Experts table', () => {
  it('renders three expert rows', async () => {
    renderWithRouter({ path: '/experts', session: SAMPLE_SESSIONS.admin });

    // Wait for the heading to appear
    const heading = await screen.findByRole('heading', { name: /experts/i });
    expect(heading).toBeInTheDocument();

    // The table should have 3 body rows
    const rows = document.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(3);
  });

  it('compact toggle changes table density attribute', async () => {
    const user = userEvent.setup();
    renderWithRouter({ path: '/experts', session: SAMPLE_SESSIONS.admin });

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
  it('session without platformRole sees the permission block', async () => {
    renderWithRouter({ path: '/', session: SAMPLE_SESSIONS.employee });

    const permBlock = await screen.findByText(/not available to your role/i);
    expect(permBlock).toBeInTheDocument();
  });
});
