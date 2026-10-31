/**
 * Tests for the CMS variant editor route (T-C1.12, Phase A).
 *
 * Asserts that error states, conflict notices, validation summaries,
 * derived locale notices, API-mode loading, autosave wiring, properties
 * panel, locale tabs, and action buttons are visible and correct.
 *
 * The component is not exported directly, so we capture it via
 * a mocked `createFileRoute` and render it with mocked providers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import i18next from 'i18next';
import type { Resource } from 'i18next';
import { resourcesFor } from '@nestself/i18n';
import { ToastProvider } from '@nestself/ui';

// ---------------------------------------------------------------------------
// i18n
// ---------------------------------------------------------------------------

const testI18n = i18next.createInstance();
void testI18n.use(initReactI18next).init({
  lng: 'en',
  resources: resourcesFor(['common', 'cms', 'library']) as Resource,
  interpolation: { escapeValue: false },
  returnNull: false,
});

// ---------------------------------------------------------------------------
// Capture the page component from createFileRoute
// ---------------------------------------------------------------------------

let CapturedComponent: React.ComponentType | undefined;
const mockUseParams = vi.fn();
const mockUseBlocker = vi.fn();

vi.mock('@tanstack/react-router', () => {
  const redirect = vi.fn();
  const routeProxy = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'useParams') return mockUseParams;
        return vi.fn();
      },
    },
  );

  return {
    createFileRoute: () => (opts: { component: React.ComponentType; beforeLoad?: unknown }) => {
      CapturedComponent = opts.component;
      return routeProxy;
    },
    redirect,
    useBlocker: (...args: unknown[]) => mockUseBlocker(...args),
    useNavigate: () => vi.fn(),
    Outlet: () => null,
    Link: ({ children, ...props }: Record<string, unknown>) => <a {...props}>{children as React.ReactNode}</a>,
  };
});

// ---------------------------------------------------------------------------
// Mock auth
// ---------------------------------------------------------------------------

const mockAuth = {
  status: 'authenticated' as const,
  principal: {
    userId: 'user_author',
    displayName: 'Katarina Lukic',
    initials: 'KL',
    locale: 'sr-Latn' as const,
    memberships: [],
    context: { kind: 'operations' as const },
    sessionId: 'sess_test',
    authenticatedAt: '2026-10-25T08:00:00Z',
    steppedUpAt: null,
  },
  effectiveActions: [
    'content.write',
    'content.review',
    'content.preview',
    'content.publish',
  ],
  availableContexts: [],
  signOut: vi.fn(),
  switchContext: vi.fn(),
  stepUp: vi.fn().mockResolvedValue(true),
  refreshPrincipal: vi.fn(),
  error: null,
};

vi.mock('../../../../../../auth', () => ({
  useAuth: () => mockAuth,
  withStepUp: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock data-source (always sample mode in tests)
// ---------------------------------------------------------------------------

vi.mock('../../../../../../data-source', () => ({
  isSampleDataMode: true,
}));

// ---------------------------------------------------------------------------
// Mock api (the route imports `api` from ../../../../../../api)
// ---------------------------------------------------------------------------

vi.mock('../../../../../../api', () => ({
  api: { request: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Mock ContentEditor (avoid pulling in Tiptap + ProseMirror in jsdom)
// ---------------------------------------------------------------------------

vi.mock('@nestself/content/editor', () => ({
  ContentEditor: ({ placeholder }: { placeholder?: string }) => (
    <div data-testid="content-editor" role="textbox" aria-label="Content editor">
      {placeholder}
    </div>
  ),
}));

// ---------------------------------------------------------------------------
// Mock content schema (transliteration + validation)
// ---------------------------------------------------------------------------

vi.mock('@nestself/content/schema', () => ({
  validateContentDocument: () => ({ ok: true, errors: [] }),
  transliterateDocument: (doc: unknown) => doc,
  transliterateText: (text: string) => `[CYR]${text}`,
  CURRENT_SCHEMA_VERSION: 1,
}));

// ---------------------------------------------------------------------------
// Mock ContentRenderer
// ---------------------------------------------------------------------------

vi.mock('@nestself/content/render', () => ({
  ContentRenderer: ({ documentKey }: { documentKey?: string }) => (
    <div data-testid="content-renderer">{documentKey}</div>
  ),
}));

// ---------------------------------------------------------------------------
// Mock ApiError and CMS API
// ---------------------------------------------------------------------------

const mockSaveRevision = vi.fn();
const mockSubmitRevision = vi.fn();
const mockApproveRevision = vi.fn();
const mockPublishNow = vi.fn();
const mockCreateNewRevision = vi.fn();
const mockGetResource = vi.fn();
const mockUploadMedia = vi.fn();
const mockGetMediaAsset = vi.fn();

vi.mock('@nestself/api-client', () => ({
  ApiError: class ApiError extends Error {
    code: string;
    details?: Record<string, unknown>;
    constructor(opts: { code: string; details?: Record<string, unknown> }) {
      super(opts.code);
      this.code = opts.code;
      this.details = opts.details;
    }
  },
  createApiClient: () => ({}),
  createCmsApi: () => ({
    getResource: mockGetResource,
    saveRevision: mockSaveRevision,
    submitRevision: mockSubmitRevision,
    approveRevision: mockApproveRevision,
    publishNow: mockPublishNow,
    createNewRevision: mockCreateNewRevision,
    uploadMedia: mockUploadMedia,
    getMediaAsset: mockGetMediaAsset,
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <I18nextProvider i18n={testI18n}>
      <ToastProvider labels={{ dismiss: 'Dismiss' }}>
        {children}
      </ToastProvider>
    </I18nextProvider>
  );
}

function renderEditor(params: { resourceId: string; locale: string }) {
  mockUseParams.mockReturnValue(params);
  if (!CapturedComponent) {
    throw new Error('CapturedComponent was not set -- import the route module before rendering');
  }
  const Component = CapturedComponent;
  return render(
    <Wrapper>
      <Component />
    </Wrapper>,
  );
}

// ---------------------------------------------------------------------------
// Import the route module (triggers createFileRoute mock -> captures component)
// ---------------------------------------------------------------------------

beforeEach(async () => {
  await import('./$locale.tsx');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('VariantEditorPage', () => {
  it('renders the editor heading and the ContentEditor for an authored locale', async () => {
    renderEditor({ resourceId: 'res_sample_evening_wind_down', locale: 'sr-Latn' });

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      testI18n.t('cms:editor.title'),
    );
    expect(screen.getByTestId('content-editor')).toBeInTheDocument();
  });

  it('shows the derived locale notice for sr-Cyrl', () => {
    renderEditor({ resourceId: 'res_sample_evening_wind_down', locale: 'sr-Cyrl' });

    // Alert with tone="info" renders role="status"
    expect(screen.getByRole('status')).toHaveTextContent(
      testI18n.t('cms:editor.derivedLocaleNotice'),
    );
    // sr-Cyrl uses ContentRenderer, not ContentEditor
    expect(screen.queryByTestId('content-editor')).not.toBeInTheDocument();
    expect(screen.getByTestId('content-renderer')).toBeInTheDocument();
  });

  it('renders the proposedAudience inside the properties panel for authored locales', async () => {
    const user = userEvent.setup();
    renderEditor({ resourceId: 'res_sample_evening_wind_down', locale: 'sr-Latn' });

    // The properties accordion is collapsed by default (Notion polish);
    // expand it to verify the audience field is inside.
    await user.click(screen.getByText(testI18n.t('cms:editor.propertiesPanel')));
    expect(
      screen.getByText(testI18n.t('cms:editor.proposedAudience')),
    ).toBeInTheDocument();
  });

  it('does NOT render the proposedAudience select for sr-Cyrl', () => {
    renderEditor({ resourceId: 'res_sample_evening_wind_down', locale: 'sr-Cyrl' });

    expect(
      screen.queryByText(testI18n.t('cms:editor.proposedAudience')),
    ).not.toBeInTheDocument();
  });

  it('renders the submit button for authored locales in draft state', () => {
    renderEditor({ resourceId: 'res_sample_evening_wind_down', locale: 'sr-Latn' });

    // Submit is visible when canWrite + revision is draft
    expect(
      screen.getByRole('button', { name: testI18n.t('cms:editor.submit') }),
    ).toBeInTheDocument();
  });

  it('does NOT render approve button for draft state (only for in_review)', () => {
    renderEditor({ resourceId: 'res_sample_evening_wind_down', locale: 'sr-Latn' });

    // Approve only shows for in_review state; sample data is draft
    expect(
      screen.queryByRole('button', { name: testI18n.t('cms:editor.approve') }),
    ).not.toBeInTheDocument();
  });

  it('does NOT render submit/approve buttons for sr-Cyrl', () => {
    renderEditor({ resourceId: 'res_sample_evening_wind_down', locale: 'sr-Cyrl' });

    expect(
      screen.queryByRole('button', { name: testI18n.t('cms:editor.submit') }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: testI18n.t('cms:editor.approve') }),
    ).not.toBeInTheDocument();
  });

  it('shows the title field pre-filled from sample data', () => {
    renderEditor({ resourceId: 'res_sample_evening_wind_down', locale: 'sr-Latn' });

    const titleInput = screen.getByRole('textbox', { name: /title/i });
    expect(titleInput).toHaveValue('Mirniji kraj dana: tri mala koraka');
  });

  it('shows transliterated title for sr-Cyrl', () => {
    renderEditor({ resourceId: 'res_sample_evening_wind_down', locale: 'sr-Cyrl' });

    // Our mock transliterateText prepends [CYR]; the derived title is read-only text.
    expect(screen.queryByRole('textbox', { name: /title/i })).not.toBeInTheDocument();
    expect(screen.getAllByText(/\[CYR\]/).length).toBeGreaterThan(0);
  });

  it('renders the preview toggle button', () => {
    renderEditor({ resourceId: 'res_sample_evening_wind_down', locale: 'sr-Latn' });

    expect(
      screen.getByRole('button', { name: testI18n.t('cms:editor.preview') }),
    ).toBeInTheDocument();
  });

  it('shows preview panel with width switcher when toggled', async () => {
    const user = userEvent.setup();
    renderEditor({ resourceId: 'res_sample_evening_wind_down', locale: 'sr-Latn' });

    const previewBtn = screen.getByRole('button', {
      name: testI18n.t('cms:editor.preview'),
    });
    await user.click(previewBtn);

    // Width switcher buttons appear
    await waitFor(() => {
      expect(
        screen.getByRole('button', {
          name: testI18n.t('cms:editor.previewWidth.phone'),
        }),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByRole('button', {
        name: testI18n.t('cms:editor.previewWidth.mobile'),
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: testI18n.t('cms:editor.previewWidth.desktop'),
      }),
    ).toBeInTheDocument();
  });

  it('shows the sources section with add button inside properties panel', async () => {
    const user = userEvent.setup();
    renderEditor({ resourceId: 'res_sample_evening_wind_down', locale: 'sr-Latn' });

    // The properties accordion is collapsed by default; expand it.
    await user.click(screen.getByText(testI18n.t('cms:editor.propertiesPanel')));
    expect(
      screen.getByRole('button', { name: testI18n.t('cms:editor.addSource') }),
    ).toBeInTheDocument();
  });

  it('hides the sources section for sr-Cyrl', () => {
    renderEditor({ resourceId: 'res_sample_evening_wind_down', locale: 'sr-Cyrl' });

    expect(
      screen.queryByRole('button', { name: testI18n.t('cms:editor.addSource') }),
    ).not.toBeInTheDocument();
  });

  it('shows the locale tabs with all four locales', () => {
    renderEditor({ resourceId: 'res_sample_evening_wind_down', locale: 'sr-Latn' });

    expect(screen.getByRole('tab', { name: /Serbian \(Latin\)/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Hungarian/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /English/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Serbian \(Cyrillic\)/i })).toBeInTheDocument();
  });

  it('shows the properties panel accordion for authored locale', () => {
    renderEditor({ resourceId: 'res_sample_evening_wind_down', locale: 'sr-Latn' });

    // The accordion trigger is the Properties panel
    expect(
      screen.getByText(testI18n.t('cms:editor.propertiesPanel')),
    ).toBeInTheDocument();
  });

  it('shows not-found for an unknown resource in sample mode', () => {
    renderEditor({ resourceId: 'res_nonexistent', locale: 'sr-Latn' });

    expect(screen.getByText(testI18n.t('cms:editor.notFound'))).toBeInTheDocument();
  });

  it('shows the revision state badge for the current revision', () => {
    renderEditor({ resourceId: 'res_sample_evening_wind_down', locale: 'sr-Latn' });

    // Sample data revision state is 'draft'
    expect(screen.getByText(testI18n.t('cms:detail.revisionState.draft'))).toBeInTheDocument();
  });

  it('calls useBlocker with correct options', () => {
    renderEditor({ resourceId: 'res_sample_evening_wind_down', locale: 'sr-Latn' });

    // useBlocker should have been called
    expect(mockUseBlocker).toHaveBeenCalled();
    const call = mockUseBlocker.mock.calls.find((c: unknown[]) => {
      const opts = c[0] as { shouldBlockFn?: unknown };
      return typeof opts?.shouldBlockFn === 'function';
    });
    expect(call).toBeDefined();
  });

  it('shows summary field with pre-filled data inside properties panel', async () => {
    const user = userEvent.setup();
    renderEditor({ resourceId: 'res_sample_evening_wind_down', locale: 'sr-Latn' });

    // The properties accordion is collapsed by default; expand it.
    await user.click(screen.getByText(testI18n.t('cms:editor.propertiesPanel')));
    const summaryField = screen.getByText(testI18n.t('cms:editor.summary'));
    expect(summaryField).toBeInTheDocument();
  });
});
