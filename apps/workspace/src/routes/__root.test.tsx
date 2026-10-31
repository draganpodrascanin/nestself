import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  createRouter,
  createMemoryHistory,
  RouterProvider,
} from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { SAMPLE_PRINCIPALS, SAMPLE_BOOKING } from '@nestself/sample-data';
import { resourcesFor, formatCurrency } from '@nestself/i18n';
import type { Resource } from 'i18next';
import { routeTree } from '../routeTree.gen';

const testI18n = i18next.createInstance();
void testI18n.use(initReactI18next).init({
  lng: 'en',
  resources: resourcesFor(['common', 'workspace', 'auth']) as Resource,
  interpolation: { escapeValue: false },
  returnNull: false,
});

type SampleRole = keyof typeof SAMPLE_PRINCIPALS;

function createTestRouter(opts: {
  initialUrl: string;
  role: SampleRole;
}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const sample = SAMPLE_PRINCIPALS[opts.role];

  const history = createMemoryHistory({
    initialEntries: [opts.initialUrl],
  });

  const router = createRouter({
    routeTree,
    context: {
      queryClient,
      auth: {
        principal: sample.principal,
        effectiveActions: sample.effectiveActions,
        availableContexts: [],
      },
    },
    history,
  });

  return { router, queryClient };
}

function renderWithRouter(opts: {
  initialUrl: string;
  role: SampleRole;
}) {
  // SampleAuthProvider reads window.location.search for the role;
  // sync it so AuthRouterSync doesn't override the test-provided context.
  window.history.replaceState(null, '', `/?role=${opts.role}`);

  const { router, queryClient } = createTestRouter(opts);

  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={testI18n}>
        <RouterProvider router={router} />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

describe('workspace routes', () => {
  beforeEach(() => {
    vi.stubGlobal('__DEV__', true);
  });

  afterEach(() => {
    cleanup();
    window.history.replaceState(null, '', '/');
    vi.restoreAllMocks();
  });

  it('/hr with employee session redirects to / and shows permission StatusBlock', async () => {
    renderWithRouter({ initialUrl: '/hr', role: 'employee' });

    await waitFor(() => {
      expect(screen.getByText(/this view is not available/i)).toBeInTheDocument();
    });
  });

  it('/hr with hr_admin renders the programme heading', async () => {
    renderWithRouter({ initialUrl: '/hr', role: 'hr_admin' });

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Support programme' })).toBeInTheDocument();
    });
  });

  it('/support/legal renders the booking demo and its confirm button contains formatted amount', async () => {
    const user = userEvent.setup();
    renderWithRouter({ initialUrl: '/support/legal', role: 'employee' });

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Legal guidance' })).toBeInTheDocument();
    });

    const seeTimesBtn = await screen.findByRole('button', { name: 'See available times' });
    await user.click(seeTimesBtn);

    const slotBtn = await screen.findByRole('button', { name: '10:00' });
    await user.click(slotBtn);
    const continueBtn = screen.getByRole('button', { name: 'Continue' });
    await user.click(continueBtn);

    const expectedAmount = formatCurrency(SAMPLE_BOOKING.youPay, SAMPLE_BOOKING.currency, 'en');
    const confirmBtn = await screen.findByRole('button', { name: /Confirm/ });
    expect(confirmBtn).toHaveTextContent(expectedAmount);
  });

  it('/support/unknown renders not found', async () => {
    renderWithRouter({ initialUrl: '/support/unknown', role: 'employee' });

    await waitFor(() => {
      expect(screen.getByText(/not available/i)).toBeInTheDocument();
    });
  });

  it('locale switch in settings changes document.documentElement.lang to sr-Cyrl', async () => {
    const appI18n = (await import('../i18n')).default;

    await act(async () => {
      await appI18n.changeLanguage('en');
    });
    expect(document.documentElement.lang).toBe('en');

    await act(async () => {
      await appI18n.changeLanguage('sr-Cyrl');
    });

    expect(document.documentElement.lang).toBe('sr-Cyrl');

    await act(async () => {
      await appI18n.changeLanguage('en');
    });
  });

  it('/sign-in renders the sign-in title', async () => {
    renderWithRouter({ initialUrl: '/sign-in', role: 'employee' });

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    });
  });
});
