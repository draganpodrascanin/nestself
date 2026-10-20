import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
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
import { SAMPLE_SESSIONS, SAMPLE_BOOKING } from '@nestself/sample-data';
import { resourcesFor, formatCurrency } from '@nestself/i18n';
import type { Resource } from 'i18next';
import { routeTree } from '../routeTree.gen';

// Set up i18n for tests
const testI18n = i18next.createInstance();
void testI18n.use(initReactI18next).init({
  lng: 'en',
  resources: resourcesFor(['common', 'workspace']) as Resource,
  interpolation: { escapeValue: false },
  returnNull: false,
});

function createTestRouter(opts: {
  initialUrl: string;
  role: 'employee' | 'manager' | 'hr_admin';
}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const history = createMemoryHistory({
    initialEntries: [opts.initialUrl],
  });

  const router = createRouter({
    routeTree,
    context: {
      queryClient,
      session: SAMPLE_SESSIONS[opts.role],
    },
    history,
  });

  return { router, queryClient };
}

function renderWithRouter(opts: {
  initialUrl: string;
  role: 'employee' | 'manager' | 'hr_admin';
}) {
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
    // Mock import.meta.env.DEV
    vi.stubGlobal('__DEV__', true);
  });

  afterEach(() => {
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

    // Wait for the route to render
    await waitFor(() => {
      expect(screen.getByText('Legal guidance')).toBeInTheDocument();
    });

    // Step 1: BookingDemo shows "Choose a time" button — click to advance
    const seeTimesBtn = await screen.findByRole('button', { name: 'Choose a time' });
    await user.click(seeTimesBtn);

    // Step 2: Select a time slot, then click Continue
    const slotBtn = await screen.findByRole('button', { name: '10:00' });
    await user.click(slotBtn);
    const continueBtn = screen.getByRole('button', { name: 'Continue' });
    await user.click(continueBtn);

    // Step 3: Confirm button should contain the formatted youPay amount
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
    // The i18n module from ../i18n sets up a languageChanged listener that
    // syncs document.documentElement.lang. We test that mechanism here.
    const appI18n = (await import('../i18n')).default;

    // Ensure we start in English
    await act(async () => {
      await appI18n.changeLanguage('en');
    });
    expect(document.documentElement.lang).toBe('en');

    // Switch to sr-Cyrl
    await act(async () => {
      await appI18n.changeLanguage('sr-Cyrl');
    });

    expect(document.documentElement.lang).toBe('sr-Cyrl');

    // Restore to English
    await act(async () => {
      await appI18n.changeLanguage('en');
    });
  });
});
