import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { SAMPLE_PRINCIPALS } from '@nestself/sample-data';
import { routeTree } from '../../routeTree.gen';
import { t, testI18n } from './cases-test-harness';

function renderRoute(initialUrl: string, role: 'employee' | 'expert') {
  // The sample auth provider reads its role from `?role=`.
  window.history.replaceState(null, '', `/?role=${role}`);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const sample = SAMPLE_PRINCIPALS[role];
  const router = createRouter({
    routeTree,
    context: { queryClient, auth: { principal: sample.principal, effectiveActions: sample.effectiveActions, availableContexts: sample.availableContexts } },
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

describe('expert area and conversation routes', () => {
  it('an employee sees My conversations but not Cases', async () => {
    renderRoute('/', 'employee');
    await screen.findAllByRole('link', { name: t('common:nav.home') });
    expect(screen.getAllByRole('link', { name: t('workspace:conversations.nav') }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('link', { name: t('workspace:cases.nav') })).not.toBeInTheDocument();
  });

  it('an employee is turned away from /cases', async () => {
    renderRoute('/cases', 'employee');
    expect(await screen.findByText(/this view is not available/i)).toBeInTheDocument();
  });

  it('the sample employee reads their sample conversation with the banner', async () => {
    renderRoute('/conversations/conv_sample', 'employee');
    expect(await screen.findByText('Sample message (fixture)')).toBeInTheDocument();
    expect(screen.getByText(t('common:sample.banner'))).toBeInTheDocument();
  });

  it('the sample expert sees Cases, not My conversations, and reaches the case list', async () => {
    renderRoute('/cases', 'expert');
    expect(await screen.findByRole('heading', { name: t('workspace:cases.title') })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: t('workspace:cases.nav') }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('link', { name: t('workspace:conversations.nav') })).not.toBeInTheDocument();
    expect(screen.getByText('case_sample')).toBeInTheDocument();
    expect(screen.getByText(t('common:sample.banner'))).toBeInTheDocument();
  });

  it('the sample expert opens a sample case', async () => {
    renderRoute('/cases/conv_sample', 'expert');
    expect(await screen.findByText('Sample reply (fixture)')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: t('workspace:cases.intake.heading') })).toBeInTheDocument();
  });
});
