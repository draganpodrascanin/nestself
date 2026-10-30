import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { SAMPLE_PRINCIPALS } from '@nestself/sample-data';
import { routeTree } from '../../routeTree.gen';
import { t, testI18n } from './people-test-harness';

function renderRoute(initialUrl: string, role: 'employee' | 'hr_admin') {
  // The sample auth provider reads its role from `?role=`.
  window.history.replaceState(null, '', `/?role=${role}`);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const sample = SAMPLE_PRINCIPALS[role];
  const router = createRouter({
    routeTree,
    context: { queryClient, auth: { principal: sample.principal, effectiveActions: sample.effectiveActions, availableContexts: [] } },
    history: createMemoryHistory({ initialEntries: [initialUrl] }),
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={testI18n}>
        <RouterProvider router={router} />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

describe('HR people and org units routes', () => {
  it('an employee sees neither nav item', async () => {
    renderRoute('/', 'employee');
    await screen.findAllByRole('link', { name: t('common:nav.home') });
    expect(screen.queryByRole('link', { name: t('workspace:people.nav') })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: t('workspace:orgUnits.nav') })).not.toBeInTheDocument();
  });

  it('an employee is turned away from /hr/people and /hr/org-units', async () => {
    renderRoute('/hr/people', 'employee');
    expect(await screen.findByText(/this view is not available/i)).toBeInTheDocument();
    cleanup();
    renderRoute('/hr/org-units', 'employee');
    expect(await screen.findByText(/this view is not available/i)).toBeInTheDocument();
  });

  it('the sample HR admin reaches People with the sample banner and both nav items', async () => {
    renderRoute('/hr/people', 'hr_admin');
    expect(await screen.findByRole('heading', { name: t('workspace:people.title') })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: t('workspace:people.nav') }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: t('workspace:orgUnits.nav') }).length).toBeGreaterThan(0);
    expect(screen.getByText(t('common:sample.banner'))).toBeInTheDocument();
  });

  it('the sample HR admin reaches Org units', async () => {
    renderRoute('/hr/org-units', 'hr_admin');
    expect(await screen.findByRole('heading', { name: t('workspace:orgUnits.title') })).toBeInTheDocument();
    expect(screen.getByText('Engineering')).toBeInTheDocument();
  });
});
