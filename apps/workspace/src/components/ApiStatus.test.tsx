/**
 * The header's API badge in API mode without VITE_API_URL (the dev server
 * proxies /api): it must probe /api/health and say "API connected", not the
 * sample-mode warning, when the API answers.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import i18next from 'i18next';
import type { Resource } from 'i18next';
import { resourcesFor } from '@nestself/i18n';

// The API client captures `fetch` when `../api` is first imported.
const fetchMock = vi.hoisted(() => {
  const fn = vi.fn<typeof fetch>();
  globalThis.fetch = fn;
  return fn;
});

vi.mock('../data-source', () => ({
  dataSource: 'api',
  isSampleDataMode: false,
  resolveDataSource: () => 'api',
}));

import { ApiStatus } from './ApiStatus';

const testI18n = i18next.createInstance();
void testI18n.use(initReactI18next).init({
  lng: 'en',
  resources: resourcesFor(['common', 'workspace']) as Resource,
  interpolation: { escapeValue: false },
  returnNull: false,
});

function renderStatus() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <I18nextProvider i18n={testI18n}>
      <QueryClientProvider client={queryClient}>
        <ApiStatus />
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('ApiStatus in API mode', () => {
  afterEach(() => {
    cleanup();
    fetchMock.mockReset();
  });

  it('probes /api/health and shows "API connected" when the API answers ok', async () => {
    fetchMock.mockResolvedValue(json(200, { status: 'ok', info: {}, error: {}, details: {} }));
    renderStatus();
    expect(await screen.findByText('API connected')).toBeInTheDocument();
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url.endsWith('/api/health')).toBe(true);
  });

  it('keeps the warning when the API is unreachable', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    renderStatus();
    expect(await screen.findByText('API not connected (sample mode)')).toBeInTheDocument();
    expect(screen.queryByText('API connected')).not.toBeInTheDocument();
  });
});
