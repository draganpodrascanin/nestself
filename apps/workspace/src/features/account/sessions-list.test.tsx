import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ApiClient } from '@nestself/api-client';
import type { SessionListItem } from '@nestself/contracts';
import { AuthProvider } from '../../auth';
import { SessionsList } from './sessions-list';
import {
  SIGN_IN_TEXT,
  apiError,
  makeAccountApi,
  EMPLOYEE,
  makeAuth,
  renderAccount,
  t,
} from './account-test-harness';
import type { AccountApi } from './use-account';

const CURRENT: SessionListItem = {
  sessionId: 'hash_current',
  surface: 'workspace',
  createdAt: '2026-10-20T08:00:00.000Z',
  lastActivityAt: '2026-10-25T09:30:00.000Z',
  ipHash: 'ip1',
  userAgentFamily: 'Firefox',
  isCurrent: true,
};
const OTHER: SessionListItem = {
  sessionId: 'hash_other',
  surface: 'admin',
  createdAt: '2026-10-18T08:00:00.000Z',
  lastActivityAt: '2026-10-22T14:00:00.000Z',
  ipHash: 'ip2',
  userAgentFamily: 'Chrome',
  isCurrent: false,
};

function withSessions(overrides: Partial<Record<keyof AccountApi, unknown>> = {}) {
  return makeAccountApi({
    listSessions: vi.fn().mockResolvedValue({ sessions: [CURRENT, OTHER] }),
    ...overrides,
  });
}

async function openEnd(user: ReturnType<typeof userEvent.setup>, rowText: string) {
  const row = (await screen.findByText(rowText)).closest('tr')!;
  await user.click(within(row).getByRole('button'));
  return screen.findByRole('alertdialog');
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SessionsList', () => {
  it('lists each session with app, dates and a badge on the current one', async () => {
    renderAccount(<SessionsList authApi={withSessions()} sampleMode={false} />);
    const table = await screen.findByRole('table', { name: t('auth:account.sessions.caption') });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(within(rows[1]!).getByText('Firefox')).toBeInTheDocument();
    expect(within(rows[1]!).getByText(t('auth:account.sessions.current'))).toBeInTheDocument();
    expect(within(rows[1]!).getByText(t('auth:account.sessions.surface.workspace'))).toBeInTheDocument();
    expect(within(rows[2]!).getByText(t('auth:account.sessions.surface.admin'))).toBeInTheDocument();
    expect(within(rows[2]!).queryByText(t('auth:account.sessions.current'))).not.toBeInTheDocument();
    expect(within(rows[2]!).getByText('22 October 2026 at 16:00')).toBeInTheDocument();
  });

  it('ends another session after confirmation and reloads the list', async () => {
    const user = userEvent.setup();
    const authApi = withSessions();
    const auth = makeAuth();
    renderAccount(<SessionsList authApi={authApi} sampleMode={false} />, auth);
    const dialog = await openEnd(user, 'Chrome');
    expect(within(dialog).getByText(t('auth:account.sessions.endTitle'))).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: t('auth:account.sessions.endConfirm') }));
    await waitFor(() => expect(authApi.revokeSession).toHaveBeenCalledWith('hash_other'));
    expect(await screen.findByText(t('auth:account.sessions.ended'))).toBeInTheDocument();
    await waitFor(() => expect(authApi.listSessions).toHaveBeenCalledTimes(2));
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it.each([
    [apiError(404, 'not_found'), 'auth:account.errors.sessionNotFound'],
    [apiError(429, 'rate_limited'), 'auth:account.errors.rateLimited'],
    [apiError(503, 'unavailable'), 'auth:error.unavailable'],
    [apiError(500, 'something_else'), 'auth:error.unknown'],
  ])('shows translated copy when ending a session fails (%o)', async (error, key) => {
    const user = userEvent.setup();
    const authApi = withSessions({ revokeSession: vi.fn().mockRejectedValue(error) });
    renderAccount(<SessionsList authApi={authApi} sampleMode={false} />);
    const dialog = await openEnd(user, 'Chrome');
    await user.click(within(dialog).getByRole('button', { name: t('auth:account.sessions.endConfirm') }));
    expect(await screen.findByRole('alert')).toHaveTextContent(t(key));
    expect(screen.queryByText('English', { exact: false })).not.toBeInTheDocument();
  });

  it('Review Focus 3: ending the current session signs out and lands on /sign-in', async () => {
    const user = userEvent.setup();
    const authApi = withSessions();
    const auth = makeAuth();
    const { router } = renderAccount(<SessionsList authApi={authApi} sampleMode={false} />, auth);
    const dialog = await openEnd(user, 'Firefox');
    expect(within(dialog).getByText(t('auth:account.sessions.currentTitle'))).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: t('auth:account.sessions.currentConfirm') }));
    expect(await screen.findByText(SIGN_IN_TEXT)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/sign-in');
    expect(auth.signOut).toHaveBeenCalledTimes(1);
    // The API refuses DELETE on the current session; sign-out ends it instead.
    expect(authApi.revokeSession).not.toHaveBeenCalled();
    // Nothing of the signed-in screen is left behind.
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('Review Focus 3 with the real AuthProvider: the session ends, nothing refetches, /sign-in shows', async () => {
    const user = userEvent.setup();
    let signedIn = true;
    const request = vi.fn(async (path: string) => {
      if (path === '/api/auth/me') {
        if (signedIn) return { principal: EMPLOYEE, effectiveActions: [] };
        throw apiError(401, 'unauthenticated');
      }
      if (path === '/api/auth/sign-out') {
        signedIn = false;
        return undefined;
      }
      throw apiError(404, 'not_found');
    });
    const client = { baseUrl: '', request } as unknown as ApiClient;
    const authApi = withSessions();
    const { router } = renderAccount(<SessionsList authApi={authApi} sampleMode={false} />, (children) => (
      <AuthProvider client={client}>{children}</AuthProvider>
    ));
    const dialog = await openEnd(user, 'Firefox');
    await user.click(within(dialog).getByRole('button', { name: t('auth:account.sessions.currentConfirm') }));
    expect(await screen.findByText(SIGN_IN_TEXT)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/sign-in');
    expect(request).toHaveBeenCalledWith('/api/auth/sign-out', expect.anything());
    expect(signedIn).toBe(false);
    expect(authApi.listSessions).toHaveBeenCalledTimes(1);
    expect(authApi.revokeSession).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('signs out everywhere: other sessions, then this one, then /sign-in', async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    const authApi = withSessions({
      signOutAll: vi.fn(async () => {
        calls.push('signOutAll');
      }),
    });
    const auth = makeAuth({
      signOut: vi.fn(async () => {
        calls.push('signOut');
      }),
    });
    const { router } = renderAccount(<SessionsList authApi={authApi} sampleMode={false} />, auth);
    await user.click(await screen.findByRole('button', { name: t('auth:account.sessions.everywhere') }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: t('auth:account.sessions.everywhereConfirm') }));
    expect(await screen.findByText(SIGN_IN_TEXT)).toBeInTheDocument();
    expect(calls).toEqual(['signOutAll', 'signOut']);
    expect(router.state.location.pathname).toBe('/sign-in');
  });

  it.each([
    [apiError(429, 'rate_limited'), 'auth:account.errors.rateLimited'],
    [apiError(0, 'network'), 'auth:error.network'],
    [apiError(401, 'session_required'), 'auth:error.expired'],
  ])('stays on the page with a message when sign-out-all fails (%o)', async (error, key) => {
    const user = userEvent.setup();
    const authApi = withSessions({ signOutAll: vi.fn().mockRejectedValue(error) });
    const auth = makeAuth();
    renderAccount(<SessionsList authApi={authApi} sampleMode={false} />, auth);
    await user.click(await screen.findByRole('button', { name: t('auth:account.sessions.everywhere') }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: t('auth:account.sessions.everywhereConfirm') }));
    expect(await screen.findByRole('alert')).toHaveTextContent(t(key));
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(screen.queryByText(SIGN_IN_TEXT)).not.toBeInTheDocument();
  });

  it('shows a translated message when the list cannot be loaded', async () => {
    const authApi = makeAccountApi({ listSessions: vi.fn().mockRejectedValue(apiError(503, 'unavailable')) });
    renderAccount(<SessionsList authApi={authApi} sampleMode={false} />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(t('auth:account.sessions.loadError'));
    expect(alert).toHaveTextContent(t('auth:error.unavailable'));
  });

  it('falls back to the unknown message for an unexpected load failure', async () => {
    const authApi = makeAccountApi({ listSessions: vi.fn().mockRejectedValue(new Error('boom')) });
    renderAccount(<SessionsList authApi={authApi} sampleMode={false} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(t('auth:error.unknown'));
  });

  it('does not call the API in sample mode and says why', async () => {
    const authApi = withSessions();
    renderAccount(<SessionsList authApi={authApi} sampleMode />);
    expect(await screen.findByText(t('auth:account.sessions.sampleNote'))).toBeInTheDocument();
    expect(authApi.listSessions).not.toHaveBeenCalled();
  });
});
