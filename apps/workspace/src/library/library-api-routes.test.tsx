/**
 * Library route tests — API mode (T-C1.13, Must fix 2).
 *
 * These tests stub `isSampleDataMode` to false and mock `api.request` so the
 * routes exercise the real API code paths without a running server.
 *
 * Tests:
 * - 404 on detail shows neutral unavailable copy
 * - Network error on detail shows translated network copy
 * - Unknown error code shows error.unknown
 * - Failed save shows saveFailed toast
 * - Failed unsave shows unsaveFailed toast
 * - Saved renders an unavailable item
 * - CTA open_content renders a working link
 * - CTA kinds without a destination screen are omitted
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, act } from '@testing-library/react';
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
import { SAMPLE_PRINCIPALS } from '@nestself/sample-data';
import { resourcesFor } from '@nestself/i18n';
import { ApiError } from '@nestself/api-client';
import type { Resource } from 'i18next';
import { routeTree } from '../routeTree.gen';

// ---------------------------------------------------------------------------
// Mock: force API mode
// ---------------------------------------------------------------------------

vi.mock('../data-source', () => ({
  dataSource: 'api' as const,
  isSampleDataMode: false,
  resolveDataSource: () => 'api' as const,
}));

// ---------------------------------------------------------------------------
// Mock: api.request
// ---------------------------------------------------------------------------

const mockRequest = vi.fn();
vi.mock('../api', () => ({
  api: {
    request: (...args: unknown[]) => mockRequest(...args),
    baseUrl: '',
  },
}));

// ---------------------------------------------------------------------------
// Mock: AuthProvider → SampleAuthProvider
//
// When isSampleDataMode is false, __root.tsx renders <AuthProvider> which
// calls the real auth API. We replace AuthProvider with SampleAuthProvider
// so the test principal comes from the URL param ?role=<role> instead.
// ---------------------------------------------------------------------------

vi.mock('../auth', async () => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- vi.importActual requires dynamic import
  const actual = await vi.importActual<typeof import('../auth')>('../auth');
  return {
    ...actual,
    // AuthProvider receives { client, children } from __root.tsx but we
    // ignore the client and delegate to SampleAuthProvider.
    AuthProvider: ({ children }: { children: React.ReactNode }) => {
      const { SampleAuthProvider } = actual;
      return <SampleAuthProvider>{children}</SampleAuthProvider>;
    },
  };
});

// ---------------------------------------------------------------------------
// i18n for tests
// ---------------------------------------------------------------------------

const testI18n = i18next.createInstance();
void testI18n.use(initReactI18next).init({
  lng: 'en',
  resources: resourcesFor(['common', 'workspace', 'auth', 'library']) as Resource,
  interpolation: { escapeValue: false },
  returnNull: false,
});

type SampleRole = keyof typeof SAMPLE_PRINCIPALS;

function createTestRouter(opts: { initialUrl: string; role: SampleRole }) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        // The query-level retry in libraryContentDetailOptions overrides this
        // default, so we also zero-out the delay so retries complete instantly.
        retryDelay: 0,
      },
    },
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

function renderWithRouter(opts: { initialUrl: string; role: SampleRole }) {
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

describe('Library API-mode routes', () => {
  beforeEach(() => {
    mockRequest.mockReset();
  });

  afterEach(() => {
    cleanup();
    window.history.replaceState(null, '', '/');
    vi.restoreAllMocks();
  });

  // --- Detail ---

  it('404 on detail shows neutral unavailable copy', async () => {
    mockRequest.mockRejectedValue(
      new ApiError({ status: 404, code: 'content_not_available', message: '', requestId: null }),
    );

    renderWithRouter({
      initialUrl: '/content/res_api_test',
      role: 'employee',
    });

    await waitFor(() => {
      expect(screen.getAllByText(/not available/i).length).toBeGreaterThanOrEqual(1);
    });

    // No content title is revealed
    const headings = screen.queryAllByRole('heading', { level: 1 });
    const hasContentTitle = headings.some(
      (h) => h.textContent && !h.textContent.includes('not available'),
    );
    expect(hasContentTitle).toBe(false);
  });

  it('network error on detail shows translated network copy', async () => {
    mockRequest.mockRejectedValue(
      new ApiError({ status: 0, code: 'network', message: 'fetch failed', requestId: null }),
    );

    renderWithRouter({
      initialUrl: '/content/res_net_error',
      role: 'employee',
    });

    // libraryContentDetailOptions retries non-404 errors once, so allow extra time.
    await waitFor(
      () => {
        expect(
          screen.getByText(/could not load content/i),
        ).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
  });

  it('unknown error code on detail shows error.unknown', async () => {
    mockRequest.mockRejectedValue(
      new ApiError({ status: 500, code: 'internal', message: '', requestId: null }),
    );

    renderWithRouter({
      initialUrl: '/content/res_unknown_err',
      role: 'employee',
    });

    // libraryContentDetailOptions retries non-404 errors once, so allow extra time.
    await waitFor(
      () => {
        expect(
          screen.getByText(/something went wrong/i),
        ).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
  });

  // --- Save/unsave toasts ---

  it('failed save shows saveFailed toast', async () => {
    // First call: detail load succeeds
    const detail = makeDetail({ saved: false });
    mockRequest.mockImplementation((path: string, opts?: { method?: string }) => {
      if (opts?.method === 'PUT') {
        return Promise.reject(
          new ApiError({ status: 500, code: 'server_error', message: '', requestId: null }),
        );
      }
      return Promise.resolve(detail);
    });

    renderWithRouter({
      initialUrl: '/content/res_save_test',
      role: 'employee',
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    });

    // Click save button
    const saveBtn = screen.getByRole('button', { name: /save this resource/i });
    await act(async () => {
      await userEvent.click(saveBtn);
    });

    await waitFor(() => {
      expect(
        screen.getAllByText(/could not save this resource/i).length,
      ).toBeGreaterThanOrEqual(1);
    });
  });

  it('failed unsave shows unsaveFailed toast', async () => {
    const detail = makeDetail({ saved: true });
    mockRequest.mockImplementation((path: string, opts?: { method?: string }) => {
      if (opts?.method === 'DELETE') {
        return Promise.reject(
          new ApiError({ status: 500, code: 'server_error', message: '', requestId: null }),
        );
      }
      return Promise.resolve(detail);
    });

    renderWithRouter({
      initialUrl: '/content/res_unsave_test',
      role: 'employee',
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    });

    // Click unsave button
    const unsaveBtn = screen.getByRole('button', { name: /remove from saved/i });
    await act(async () => {
      await userEvent.click(unsaveBtn);
    });

    await waitFor(() => {
      expect(
        screen.getAllByText(/could not remove this resource from saved/i).length,
      ).toBeGreaterThanOrEqual(1);
    });
  });

  // --- Saved ---

  it('Saved page renders an unavailable item', async () => {
    mockRequest.mockResolvedValue({
      items: [
        {
          resourceId: 'res_gone',
          type: null,
          title: null,
          status: 'unavailable',
          categoryName: null,
          coverImageUrl: null,
          savedAt: '2026-10-01T08:00:00Z',
        },
      ],
      nextCursor: null,
    });

    renderWithRouter({ initialUrl: '/saved', role: 'employee' });

    await waitFor(() => {
      expect(
        screen.getByText(/no longer available/i),
      ).toBeInTheDocument();
    });
  });

  // --- CTA ---

  it('CTA open_content in body renders exactly one link to /content/<targetId>', async () => {
    const detail = makeDetail({
      cta: { kind: 'open_content', targetId: 'res_target_123', label: 'Read now' },
    });
    mockRequest.mockResolvedValue(detail);

    renderWithRouter({
      initialUrl: '/content/res_cta_test',
      role: 'employee',
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    });

    // The CTA renders exactly once (from the body node via ContentRenderer,
    // not duplicated by a standalone block).
    const links = screen.getAllByRole('link', { name: 'Read now' });
    expect(links).toHaveLength(1);
    expect(links[0]!.getAttribute('href')).toBe('/content/res_target_123');
  });

  it('CTA suggest_topic is omitted (no destination screen at M1)', async () => {
    const detail = makeDetail({
      cta: { kind: 'suggest_topic', targetId: 'topic_123', label: 'Suggest' },
    });
    mockRequest.mockResolvedValue(detail);

    renderWithRouter({
      initialUrl: '/content/res_cta_suggest',
      role: 'employee',
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    });

    // The CTA should not render
    expect(screen.queryByText('Suggest')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDetail(overrides?: {
  saved?: boolean;
  cta?: { kind: string; targetId: string; label: string | null } | null;
}) {
  // When a CTA is provided, inject it as a body node (FMT-R-27: the API
  // extracts detail.cta from the body's cta node, so both carry the same data).
  const bodyContent: unknown[] = [
    { type: 'paragraph', content: [{ type: 'text', text: 'Body text.' }] },
  ];
  if (overrides?.cta) {
    bodyContent.push({
      type: 'cta',
      attrs: {
        ctaKind: overrides.cta.kind,
        targetId: overrides.cta.targetId,
        label: overrides.cta.label,
      },
    });
  }

  return {
    id: 'res_test',
    type: 'article',
    locale: 'en',
    title: 'Test Article',
    summary: 'A test article.',
    outcome: 'Test outcome.',
    body: {
      type: 'doc',
      schemaVersion: 1,
      content: bodyContent,
    },
    durationSeconds: 300,
    durationBand: 'under_5',
    difficulty: 'easy',
    category: { id: 'cat_test', slug: 'test', label: 'Test', description: null },
    secondaryCategories: [],
    topics: [],
    authorName: 'Reviewer',
    reviewerName: null,
    reviewedAt: null,
    sources: [],
    media: [],
    relatedResources: [],
    cta: overrides?.cta ?? null,
    availableLocales: ['en'],
    saved: overrides?.saved ?? false,
    playbackPosition: null,
    replacementLink: null,
  };
}
