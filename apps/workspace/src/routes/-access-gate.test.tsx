/**
 * Who reaches `/hr/access` (API mode, the session read from `GET /auth/me`).
 *
 * The page needs `access.preview` and nothing else: an employer owner holds
 * it without any HR template (no `program.overview`), and the API's member and
 * org-unit lists accept it. The nav item and the route follow the effective
 * actions of `/auth/me`; the server decides again on every call.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { createRouter, createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PERMISSION_TEMPLATES } from '@nestself/contracts';
import { SAMPLE_PRINCIPALS } from '@nestself/sample-data';

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

import { routeTree } from '../routeTree.gen';
import { api } from '../api';
import { initialSnapshot } from '../auth';
import { releaseInitialMe } from '../auth/route-auth';
import i18n from '../i18n';

const ORG_ID = 'org_sample';

/** The actions the given permission templates give together, as `effectiveActions` carries them. */
function actionsOf(...templateKeys: string[]): string[] {
  return [...new Set(templateKeys.flatMap((key) => PERMISSION_TEMPLATES.find((t) => t.key === key)?.actions ?? []))];
}

/**
 * The sample HR administrator in the organization context of her membership,
 * with the given effective actions. The sample principal itself starts in the
 * personal context (Ruling E, T-C1.02); the Access page would switch to the
 * organization first, which is not what these tests are about.
 */
function sessionWith(templateKeys: string[]) {
  return {
    principal: { ...SAMPLE_PRINCIPALS.hr_admin.principal, context: { kind: 'organization' as const, orgId: ORG_ID } },
    effectiveActions: actionsOf(...templateKeys),
    availableContexts: [],
  };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** `/auth/me` answers the session; the organization's lists the Access page reads are empty. */
function answerWith(session: ReturnType<typeof sessionWith>) {
  fetchMock.mockImplementation((input) => {
    const { pathname } = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://localhost');
    if (pathname === '/api/auth/me') return Promise.resolve(json(200, session));
    if (pathname === `/api/orgs/${ORG_ID}/grants`) return Promise.resolve(json(200, { items: [] }));
    if (pathname === `/api/orgs/${ORG_ID}/members`) return Promise.resolve(json(200, { items: [], nextCursor: null }));
    if (pathname === `/api/orgs/${ORG_ID}/org-units`) return Promise.resolve(json(200, { items: [] }));
    return Promise.resolve(json(404, { code: 'not_found', message: 'Not found' }));
  });
}

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree,
    // As main.tsx builds it in API mode.
    context: {
      queryClient,
      auth: { principal: null, effectiveActions: [], availableContexts: [], settled: false, ensure: () => initialSnapshot(api) },
    },
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

const ACCESS_TITLE = () => i18n.t('workspace:access.title');
const ACCESS_NAV = () => i18n.t('workspace:access.nav');

describe('/hr/access gate (API mode)', () => {
  beforeEach(async () => {
    fetchMock.mockReset();
    releaseInitialMe(api);
    await i18n.changeLanguage('en');
    // The router restores the scroll position, which jsdom does not implement.
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('opens for an employer owner who holds access.preview but no HR rights, and offers it in the navigation', async () => {
    const session = sessionWith(['employee', 'employer_owner']);
    // The premise of the test: access.preview without program.overview.
    expect(session.effectiveActions).toContain('access.preview');
    expect(session.effectiveActions).not.toContain('program.overview');
    answerWith(session);

    const router = renderAt('/hr/access');

    expect(await screen.findByRole('heading', { level: 1, name: ACCESS_TITLE() }, { timeout: 5000 })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/hr/access');
    expect(screen.getAllByRole('link', { name: ACCESS_NAV() }).length).toBeGreaterThan(0);
    // The page reads the organization's lists with that session.
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes(`/api/orgs/${ORG_ID}/members`))).toBe(true);
  });

  it('does not open the rest of the HR area to that owner: no navigation items, and /hr turns them away', async () => {
    answerWith(sessionWith(['employee', 'employer_owner']));

    const router = renderAt('/hr');

    // The home page re-queries once the provider's principal lands (its list key carries the context), so the
    // notice can leave and come back; wait until it stands.
    await waitFor(() => expect(screen.getByText(/this view is not available/i)).toBeInTheDocument());
    expect(router.state.location.pathname).toBe('/');
    expect(screen.getAllByRole('link', { name: ACCESS_NAV() }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('link', { name: i18n.t('common:nav.hr') })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: i18n.t('workspace:people.nav') })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: i18n.t('workspace:orgUnits.nav') })).not.toBeInTheDocument();
  });

  it('turns away an HR administrator who does not hold access.preview, and does not offer the page', async () => {
    const session = sessionWith(['employee', 'hr_admin']);
    expect(session.effectiveActions).toContain('program.overview');
    expect(session.effectiveActions).not.toContain('access.preview');
    answerWith(session);

    const router = renderAt('/hr/access');

    // The home page re-queries once the provider's principal lands (its list key carries the context), so the
    // notice can leave and come back; wait until it stands.
    await waitFor(() => expect(screen.getByText(/this view is not available/i)).toBeInTheDocument());
    expect(router.state.location.pathname).toBe('/');
    expect(screen.queryByRole('heading', { level: 1, name: ACCESS_TITLE() })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: ACCESS_NAV() })).not.toBeInTheDocument();
    // The HR area itself is theirs.
    expect(screen.getAllByRole('link', { name: i18n.t('common:nav.hr') }).length).toBeGreaterThan(0);
  });

  it('turns away an employee', async () => {
    answerWith(sessionWith(['employee']));

    const router = renderAt('/hr/access');

    // The home page re-queries once the provider's principal lands (its list key carries the context), so the
    // notice can leave and come back; wait until it stands.
    await waitFor(() => expect(screen.getByText(/this view is not available/i)).toBeInTheDocument());
    expect(router.state.location.pathname).toBe('/');
    expect(screen.queryByRole('link', { name: ACCESS_NAV() })).not.toBeInTheDocument();
  });
});
