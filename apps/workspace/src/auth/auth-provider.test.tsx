import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, act, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SAMPLE_PRINCIPALS } from '@nestself/sample-data';
import { ApiError } from '@nestself/api-client';
import { AuthProvider } from './auth-provider';
import { useAuth } from './auth-context';
import type { ApiClient } from '@nestself/api-client';

const sampleMe = {
  principal: SAMPLE_PRINCIPALS.employee.principal,
  effectiveActions: [...SAMPLE_PRINCIPALS.employee.effectiveActions],
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

describe('AuthProvider', () => {
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
    expect(screen.getByTestId('name').textContent).toBe('Jovan Petrović');
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

  it('keeps previous state on non-401 error', async () => {
    let callCount = 0;
    const client = createMockClient(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve(sampleMe);
      return Promise.reject(new Error('Server error'));
    });

    renderProvider(client);

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('authenticated');
    });

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('authenticated');
      expect(screen.getByTestId('name').textContent).toBe('Jovan Petrović');
    });
  });

  it('refetches on window focus', async () => {
    const requestFn = vi.fn().mockResolvedValue(sampleMe);
    const client = createMockClient(requestFn);

    renderProvider(client);

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('authenticated');
    });

    const initialCalls = requestFn.mock.calls.length;

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => {
      expect(requestFn.mock.calls.length).toBeGreaterThan(initialCalls);
    });
  });
});
