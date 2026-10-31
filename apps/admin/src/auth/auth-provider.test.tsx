import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, act, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import i18next from 'i18next';
import type { Resource } from 'i18next';
import { resourcesFor } from '@nestself/i18n';
import { SAMPLE_PRINCIPALS } from '@nestself/sample-data';
import { ApiError } from '@nestself/api-client';
import type { ApiClient } from '@nestself/api-client';
import { EMAIL_OTP_MAX_LENGTH } from '@nestself/contracts';
import { AuthProvider } from './auth-provider';
import { useAuth } from './auth-context';

const sampleMe = {
  principal: SAMPLE_PRINCIPALS.admin.principal,
  effectiveActions: [...SAMPLE_PRINCIPALS.admin.effectiveActions],
};

function createMockClient(requestImpl: (...args: unknown[]) => Promise<unknown>): ApiClient {
  return { request: requestImpl } as unknown as ApiClient;
}

function SessionState() {
  const { status, principal } = useAuth();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="name">{principal?.displayName ?? 'none'}</span>
    </div>
  );
}

function renderSession(client: ApiClient) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider client={client}>
        <SessionState />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

function makeApiError(status: number, code: string): ApiError {
  return new ApiError({ status, code, message: `HTTP ${status}`, requestId: null });
}

describe('AuthProvider session state', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('becomes unauthenticated on 401 from /auth/me', async () => {
    renderSession(createMockClient(() => Promise.reject(makeApiError(401, 'unauthenticated'))));

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('unauthenticated');
    });
    expect(screen.getByTestId('name').textContent).toBe('none');
  });

  it('keeps the principal and reports status error when a refresh fails with something other than 401', async () => {
    let callCount = 0;
    const client = createMockClient(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve(sampleMe);
      return Promise.reject(new Error('Server error'));
    });
    renderSession(client);
    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('authenticated');
    });

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('error');
    });
    expect(screen.getByTestId('name').textContent).toBe('Platform Admin');
  });

  it.each([
    ['an error answer', () => Promise.reject(makeApiError(500, 'internal_error'))],
    ['no connection', () => Promise.reject(makeApiError(0, 'network'))],
    ['an answer that is not a session', () => Promise.reject(makeApiError(200, 'invalid_response'))],
  ])('becomes error, not unauthenticated, when the first /auth/me fails with %s', async (_label, fail) => {
    renderSession(createMockClient(fail));

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('error');
    });
    expect(screen.getByTestId('name').textContent).toBe('none');
  });

  it('recovers when the next refresh succeeds, asking /auth/me again with a timeout', async () => {
    const requestFn = vi
      .fn<(path: string, init?: RequestInit) => Promise<unknown>>()
      .mockRejectedValueOnce(makeApiError(500, 'internal_error'))
      .mockResolvedValue(sampleMe);
    renderSession(createMockClient(requestFn as (...args: unknown[]) => Promise<unknown>));
    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('error');
    });

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('authenticated');
    });
    expect(screen.getByTestId('name').textContent).toBe('Platform Admin');
    expect(requestFn).toHaveBeenCalledTimes(2);
    expect(requestFn.mock.calls[1]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });
});

const testI18n = i18next.createInstance();
void testI18n.use(initReactI18next).init({
  lng: 'en',
  resources: resourcesFor(['common', 'admin', 'auth']) as Resource,
  interpolation: { escapeValue: false },
  returnNull: false,
});

function StepUpProbe({ onResult }: { onResult: (ok: boolean) => void }) {
  const { stepUp } = useAuth();
  return (
    <button type="button" onClick={() => void stepUp().then(onResult)}>
      do sensitive thing
    </button>
  );
}

function renderStepUp(
  onResult: (ok: boolean) => void,
  verify: () => Promise<unknown> = () => Promise.resolve(undefined),
) {
  const requestFn = vi.fn((path: unknown) => {
    if (path === '/api/auth/step-up/start') {
      return Promise.resolve({ method: 'email_otp', challengeToken: 'challenge-1', ssoStartUrl: null, emailMasked: null });
    }
    if (path === '/api/auth/step-up/verify') return verify();
    return Promise.resolve(sampleMe);
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <I18nextProvider i18n={testI18n}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider client={createMockClient(requestFn)}>
          <StepUpProbe onResult={onResult} />
        </AuthProvider>
      </QueryClientProvider>
    </I18nextProvider>,
  );
  return requestFn;
}

describe('AuthProvider stepUp()', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('opens the step-up dialog and resolves true once the code is verified', async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    const requestFn = renderStepUp(onResult);

    await user.click(screen.getByRole('button', { name: 'do sensitive thing' }));
    await screen.findByRole('dialog', { name: testI18n.t('auth:stepUp.title') });
    await waitFor(() =>
      expect(requestFn).toHaveBeenCalledWith('/api/auth/step-up/start', expect.anything()),
    );

    await user.type(
      screen.getByLabelText(new RegExp(testI18n.t('auth:stepUp.codeLabel'))),
      '1'.repeat(EMAIL_OTP_MAX_LENGTH),
    );
    await user.click(screen.getByRole('button', { name: testI18n.t('auth:stepUp.submit') }));

    await waitFor(() => expect(onResult).toHaveBeenCalledWith(true));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('resolves false and closes the dialog when the user cancels', async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    renderStepUp(onResult);

    await user.click(screen.getByRole('button', { name: 'do sensitive thing' }));
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: testI18n.t('auth:stepUp.cancel') }));

    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('a verify that completes after cancel does not close a later step-up', async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    let finishFirstVerify!: () => void;
    const verify = vi
      .fn<() => Promise<unknown>>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishFirstVerify = () => resolve(undefined);
          }),
      )
      .mockResolvedValue(undefined);
    renderStepUp(onResult, verify);
    const codeLabel = new RegExp(testI18n.t('auth:stepUp.codeLabel'));
    const submit = { name: testI18n.t('auth:stepUp.submit') };

    // First step-up: submit, then close the dialog while verify is still in
    // flight (Cancel is disabled meanwhile; the dialog's close button is not).
    await user.click(screen.getByRole('button', { name: 'do sensitive thing' }));
    await user.type(await screen.findByLabelText(codeLabel), '1'.repeat(EMAIL_OTP_MAX_LENGTH));
    await user.click(screen.getByRole('button', submit));
    await waitFor(() => expect(verify).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: testI18n.t('common:nav.close') }));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    // Second step-up opens; the stale first verify now completes.
    await user.click(screen.getByRole('button', { name: 'do sensitive thing' }));
    await screen.findByRole('dialog');
    await act(async () => {
      finishFirstVerify();
    });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(onResult).toHaveBeenCalledTimes(1);

    // The second step-up still resolves on its own verification.
    await user.type(screen.getByLabelText(codeLabel), '1'.repeat(EMAIL_OTP_MAX_LENGTH));
    await user.click(screen.getByRole('button', submit));
    await waitFor(() => expect(onResult).toHaveBeenLastCalledWith(true));
    expect(onResult).toHaveBeenCalledTimes(2);
  });
});
