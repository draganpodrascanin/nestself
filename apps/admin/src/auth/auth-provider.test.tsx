import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, act, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SAMPLE_PRINCIPALS } from '@nestself/sample-data';
import { ApiError, contextKey } from '@nestself/api-client';
import type { ApiClient } from '@nestself/api-client';
import type { ActiveContext } from '@nestself/contracts';
import { AuthProvider } from './auth-provider';
import { useAuth } from './auth-context';

const sampleMe = {
  principal: SAMPLE_PRINCIPALS.admin.principal,
  effectiveActions: [...SAMPLE_PRINCIPALS.admin.effectiveActions],
  availableContexts: [],
};

function createMockClient(requestImpl: (...args: unknown[]) => Promise<unknown>): ApiClient {
  return { request: requestImpl } as unknown as ApiClient;
}

function AuthStatus() {
  const { status, principal } = useAuth();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="name">{principal?.displayName ?? 'none'}</span>
    </div>
  );
}

function renderProvider(client: ApiClient) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider client={client}>
        <AuthStatus />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

function makeApiError(status: number, code: string): ApiError {
  return new ApiError({ status, code, message: `HTTP ${status}`, requestId: null });
}

describe('AuthProvider (admin)', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('starts in loading state then becomes authenticated on 200', async () => {
    const client = createMockClient(() => Promise.resolve(sampleMe));

    renderProvider(client);

    expect(screen.getByTestId('status').textContent).toBe('loading');

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('authenticated');
    });
    expect(screen.getByTestId('name').textContent).toBe('Platform Admin');
  });

  it('becomes unauthenticated on 401 from /auth/me', async () => {
    const client = createMockClient(() =>
      Promise.reject(makeApiError(401, 'unauthenticated')),
    );

    renderProvider(client);

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('unauthenticated');
    });
    expect(screen.getByTestId('name').textContent).toBe('none');
  });

  it('clears query cache on context switch (CLI-R-08)', async () => {
    const switchMe = {
      principal: {
        ...SAMPLE_PRINCIPALS.admin.principal,
        context: { kind: 'personal' as const, orgId: 'org_b' },
      },
      effectiveActions: [...SAMPLE_PRINCIPALS.admin.effectiveActions],
      availableContexts: [],
    };

    let callCount = 0;
    const client = createMockClient(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve(sampleMe);
      return Promise.resolve(switchMe);
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    // Seed cache with data under an operations key
    queryClient.setQueryData(['ctx', 'operations', 'some-data'], { items: ['cached'] });

    const onSwitch = vi.fn<(ctx: ActiveContext) => Promise<void>>();

    function CaptureSwitchContext() {
      const { switchContext } = useAuth();
      onSwitch.mockImplementation(switchContext);
      return null;
    }

    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider client={client}>
          <CaptureSwitchContext />
          <AuthStatus />
        </AuthProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('authenticated');
    });

    // Verify cached data exists
    expect(
      queryClient.getQueryData(['ctx', 'operations', 'some-data']),
    ).toEqual({ items: ['cached'] });

    // Switch context
    await act(async () => {
      await onSwitch({ kind: 'personal', orgId: 'org_b' });
    });

    // Cached data should be gone
    expect(
      queryClient.getQueryData(['ctx', 'operations', 'some-data']),
    ).toBeUndefined();
  });

  // Item 9 (CLI-R-08): context-A key data is gone after switch to context-B
  it('clears context-A key on switch and failed switch keeps cache (CLI-R-08)', async () => {
    const contextA: ActiveContext = { kind: 'operations' };
    const contextB: ActiveContext = { kind: 'personal', orgId: 'org_b' };
    const keyA = [...contextKey(contextA), 'admin-data'];

    const meA = {
      principal: { ...SAMPLE_PRINCIPALS.admin.principal, context: contextA },
      effectiveActions: [...SAMPLE_PRINCIPALS.admin.effectiveActions],
      availableContexts: [],
    };
    const meB = {
      principal: { ...SAMPLE_PRINCIPALS.admin.principal, context: contextB },
      effectiveActions: [...SAMPLE_PRINCIPALS.admin.effectiveActions],
      availableContexts: [],
    };

    let callCount = 0;
    const client = createMockClient(async () => {
      callCount++;
      if (callCount === 1) return meA;
      return meB;
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(keyA, { items: ['ops-data'] });

    const onSwitch = vi.fn<(ctx: ActiveContext) => Promise<void>>();

    function CaptureSwitch() {
      const { switchContext } = useAuth();
      onSwitch.mockImplementation(switchContext);
      return null;
    }

    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider client={client}>
          <CaptureSwitch />
          <AuthStatus />
        </AuthProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('authenticated');
    });

    expect(queryClient.getQueryData(keyA)).toEqual({ items: ['ops-data'] });

    await act(async () => {
      await onSwitch(contextB);
    });

    // Key-A data gone after successful switch.
    expect(queryClient.getQueryData(keyA)).toBeUndefined();
  });

  // Item 9: failed switch keeps old cache and context
  it('failed switch keeps cache and context unchanged (CLI-R-08)', async () => {
    const contextA: ActiveContext = { kind: 'operations' };
    const keyA = [...contextKey(contextA), 'admin-data'];

    let callCount = 0;
    const client = createMockClient(async () => {
      callCount++;
      if (callCount === 1) return sampleMe;
      throw new ApiError({ status: 500, code: 'internal', message: 'boom', requestId: null });
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(keyA, { items: ['ops-data'] });

    const onSwitch = vi.fn<(ctx: ActiveContext) => Promise<void>>();

    function CaptureSwitch() {
      const { switchContext } = useAuth();
      onSwitch.mockImplementation(switchContext);
      return null;
    }

    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider client={client}>
          <CaptureSwitch />
          <AuthStatus />
        </AuthProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('authenticated');
    });

    await expect(
      act(async () => {
        await onSwitch({ kind: 'personal', orgId: 'org_b' });
      }),
    ).rejects.toThrow();

    expect(queryClient.getQueryData(keyA)).toEqual({ items: ['ops-data'] });
    expect(screen.getByTestId('name').textContent).toBe('Platform Admin');
  });
});
