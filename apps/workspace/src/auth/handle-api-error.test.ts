/**
 * handle-api-error unit tests (item 10, T-C1.02).
 *
 * - `org_context_expired` triggers a switch to `{ kind: 'personal' }` and a translated toast.
 * - Other error codes do NOT trigger a context switch.
 */
import { describe, it, expect, vi } from 'vitest';
import { handleApiError, type ErrorHandlerDeps } from './handle-api-error';
import { ApiError } from '@nestself/api-client';

function createDeps(overrides: Partial<ErrorHandlerDeps> = {}): ErrorHandlerDeps {
  return {
    navigate: vi.fn() as unknown as ErrorHandlerDeps['navigate'],
    queryClient: {
      cancelQueries: vi.fn(),
      clear: vi.fn(),
    } as unknown as ErrorHandlerDeps['queryClient'],
    refreshPrincipal: vi.fn(),
    switchContext: vi.fn(),
    showToast: vi.fn(),
    t: vi.fn((key: string) => `translated:${key}`),
    ...overrides,
  };
}

function makeApiError(status: number, code: string): ApiError {
  return new ApiError({ status, code, message: `HTTP ${status}`, requestId: null });
}

describe('handleApiError (item 10, T-C1.02)', () => {
  it('org_context_expired triggers switch to personal and a translated toast', () => {
    const deps = createDeps();
    handleApiError(makeApiError(403, 'org_context_expired'), deps);

    expect(deps.switchContext).toHaveBeenCalledWith({ kind: 'personal' });
    expect(deps.showToast).toHaveBeenCalledWith(
      'translated:contextSwitcher.error.org_context_expired',
    );
  });

  it('401 does NOT switch context', () => {
    const deps = createDeps();
    handleApiError(makeApiError(401, 'unauthenticated'), deps);

    expect(deps.switchContext).not.toHaveBeenCalled();
  });

  it('403 forbidden does NOT switch context', () => {
    const deps = createDeps();
    handleApiError(makeApiError(403, 'forbidden'), deps);

    expect(deps.switchContext).not.toHaveBeenCalled();
  });

  it('403 step_up_required does NOT switch context', () => {
    const deps = createDeps();
    handleApiError(makeApiError(403, 'step_up_required'), deps);

    expect(deps.switchContext).not.toHaveBeenCalled();
  });

  it('non-ApiError is ignored entirely', () => {
    const deps = createDeps();
    handleApiError(new Error('Random'), deps);

    expect(deps.switchContext).not.toHaveBeenCalled();
    expect(deps.showToast).not.toHaveBeenCalled();
  });
});
