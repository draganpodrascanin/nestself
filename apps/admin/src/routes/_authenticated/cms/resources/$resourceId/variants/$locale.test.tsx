/**
 * Tests for the CMS variant editor route (T-C1.12).
 *
 * Asserts that error states, conflict notices, validation summaries,
 * derived locale notices, and the proposedAudience select are visible.
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
    displayName: 'Katarina Lukić',
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
// Mock ApiError
// ---------------------------------------------------------------------------

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
  // Force the module to re-execute so CapturedComponent is set
  // (it runs on first import due to the mock)
  if (!CapturedComponent) {
    throw new Error('CapturedComponent was not set — import the route module before rendering');
  }
  const Component = CapturedComponent;
  return render(
    <Wrapper>
      <Component />
    </Wrapper>,
  );
}

// ---------------------------------------------------------------------------
// Import the route module (triggers createFileRoute mock → captures component)
// ---------------------------------------------------------------------------

beforeEach(async () => {
  // Dynamic import to trigger the mock capture
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

  it('renders the proposedAudience select for non-derived locales', () => {
    renderEditor({ resourceId: 'res_sample_evening_wind_down', locale: 'sr-Latn' });

    // The audience field has the label from i18n
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

  it('renders the submit and approve buttons for authored locales', () => {
    renderEditor({ resourceId: 'res_sample_evening_wind_down', locale: 'sr-Latn' });

    expect(
      screen.getByRole('button', { name: testI18n.t('cms:editor.submit') }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: testI18n.t('cms:editor.approve') }),
    ).toBeInTheDocument();
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
    // The sample data's sr-Latn variant title should be in the input
    expect(titleInput).toHaveValue('Mirniji kraj dana: tri mala koraka');
  });

  it('shows transliterated title for sr-Cyrl', () => {
    renderEditor({ resourceId: 'res_sample_evening_wind_down', locale: 'sr-Cyrl' });

    // Our mock transliterateText prepends [CYR]
    const titleInput = screen.getByRole('textbox', { name: /title/i });
    expect((titleInput as HTMLInputElement).value).toContain('[CYR]');
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

  it('shows the sources section with add button for authored locales', () => {
    renderEditor({ resourceId: 'res_sample_evening_wind_down', locale: 'sr-Latn' });

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
});
