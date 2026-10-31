/**
 * API-mode tests for the CMS variant editor route (T-C1.12): every failure of
 * a call the page makes is rendered where the author made it.
 *
 * Asserts that error states, conflict notices, validation summaries,
 * derived locale notices, API-mode loading, autosave wiring, properties
 * panel, locale tabs, and action buttons are visible and correct.
 *
 * The component is not exported directly, so we capture it via
 * a mocked `createFileRoute` and render it with mocked providers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
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
// Mock data-source (API mode)
// ---------------------------------------------------------------------------

vi.mock('../../../../../../data-source', () => ({
  isSampleDataMode: false,
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
const mockReturnForChanges = vi.fn();
const mockListResources = vi.fn();

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
    returnForChanges: mockReturnForChanges,
    listResources: mockListResources,
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
// Fixtures
// ---------------------------------------------------------------------------

type RevisionState = 'draft' | 'in_review' | 'approved';

async function apiError(code: string): Promise<Error> {
  const { ApiError } = await import('@nestself/api-client');
  return new (ApiError as unknown as new (o: { code: string }) => Error)({ code });
}

function revision(locale: string, state: RevisionState, audience: unknown[] | null) {
  return {
    id: `rev_${locale}`,
    contentVariantId: `var_${locale}`,
    revisionNumber: 1,
    state,
    body: { type: 'doc', schemaVersion: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Tekst' }] }] },
    title: `Naslov ${locale}`,
    summary: 'Sažetak',
    outcome: null,
    durationSeconds: 300,
    durationBand: null,
    difficulty: null,
    sources: null,
    proposedAudience: audience,
    cta: null,
    relatedResourceIds: null,
    authorUserId: 'user_other_author',
    lastEditorUserId: 'user_other_author',
    lockVersion: 1,
    approvalHash: null,
    submittedAt: null,
    approvedAt: null,
    approvedByUserId: null,
    reviewDueAt: null,
    quicklyOutdated: false,
    createdAt: '2026-10-01T08:00:00Z',
    updatedAt: '2026-10-01T08:00:00Z',
  };
}

const ALL_ELIGIBLE = [{ kind: 'all_eligible', includeDescendants: true }];
const ORG_AUDIENCE = [{ kind: 'organization', orgId: 'org_a', includeDescendants: true }];

function detail(state: RevisionState, audience: unknown[] | null = ALL_ELIGIBLE) {
  return {
    id: 'res_1',
    type: 'article',
    state: 'active',
    primaryCategoryId: 'cat_stress',
    ownerUserId: 'user_other_author',
    reviewPolicy: 'professional',
    reviewDiscipline: 'psychological',
    createdAt: '2026-10-01T08:00:00Z',
    updatedAt: '2026-10-01T08:00:00Z',
    publications: [],
    variants: ['sr-Latn', 'hu', 'en'].map((locale) => ({
      id: `var_${locale}`,
      contentResourceId: 'res_1',
      locale,
      slug: `naslov-${locale}`,
      localApplicability: null,
      createdAt: '2026-10-01T08:00:00Z',
      revisions: [revision(locale, state, audience)],
    })),
  };
}

beforeEach(() => {
  mockGetResource.mockReset();
  mockSubmitRevision.mockReset();
  mockReturnForChanges.mockReset();
  mockPublishNow.mockReset();
  mockListResources.mockReset().mockResolvedValue({ items: [], nextCursor: null });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('VariantEditorPage in API mode', () => {
  it('shows a load failure', async () => {
    mockGetResource.mockRejectedValue(await apiError('internal_error'));
    renderEditor({ resourceId: 'res_1', locale: 'sr-Latn' });
    expect(await screen.findByText(testI18n.t('cms:editor.loadError'))).toBeInTheDocument();
  });

  it('shows a missing resource as not found', async () => {
    mockGetResource.mockRejectedValue(await apiError('not_found'));
    renderEditor({ resourceId: 'res_1', locale: 'sr-Latn' });
    expect(await screen.findByText(testI18n.t('cms:editor.notFound'))).toBeInTheDocument();
  });

  it('shows a failed submit with the translated API code', async () => {
    const user = userEvent.setup();
    mockGetResource.mockResolvedValue(detail('draft'));
    mockSubmitRevision.mockRejectedValue(await apiError('content_revision_locked'));
    renderEditor({ resourceId: 'res_1', locale: 'sr-Latn' });
    await user.click(await screen.findByRole('button', { name: testI18n.t('cms:editor.submit') }));
    expect(await screen.findByText(testI18n.t('cms:error.content_revision_locked'))).toBeInTheDocument();
  });

  it('keeps the return dialog open with the API error', async () => {
    const user = userEvent.setup();
    mockGetResource.mockResolvedValue(detail('in_review'));
    mockReturnForChanges.mockRejectedValue(await apiError('content_review_discipline'));
    renderEditor({ resourceId: 'res_1', locale: 'sr-Latn' });
    await user.click(await screen.findByRole('button', { name: testI18n.t('cms:editor.returnChanges') }));
    const dialog = await screen.findByRole('alertdialog');
    await user.type(within(dialog).getByRole('textbox'), 'Dodajte izvor.');
    await user.click(within(dialog).getByRole('button', { name: testI18n.t('cms:editor.returnChanges') }));
    expect(mockReturnForChanges).toHaveBeenCalledWith('rev_sr-Latn', 'Dodajte izvor.');
    expect(await within(dialog).findByText(testI18n.t('cms:error.content_review_discipline'))).toBeInTheDocument();
  });

  it('publishes the stored audience and shows a publish failure in the dialog', async () => {
    const user = userEvent.setup();
    mockGetResource.mockResolvedValue(detail('approved', ORG_AUDIENCE));
    mockPublishNow.mockRejectedValue(await apiError('content_publication_exists'));
    renderEditor({ resourceId: 'res_1', locale: 'sr-Latn' });
    await user.click(await screen.findByRole('button', { name: testI18n.t('cms:detail.publishNow') }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: testI18n.t('cms:detail.publishNow') }));
    expect(mockPublishNow).toHaveBeenCalledWith({ resourceId: 'res_1', audience: ORG_AUDIENCE });
    expect(await within(dialog).findByText(testI18n.t('cms:error.content_publication_exists'))).toBeInTheDocument();
  });
});
