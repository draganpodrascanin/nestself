import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import i18next from 'i18next';
import type { Resource } from 'i18next';
import { resourcesFor } from '@nestself/i18n';
import { SAMPLE_PRINCIPALS } from '@nestself/sample-data';
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

function renderStepUp(onResult: (ok: boolean) => void) {
  const requestFn = vi.fn((path: unknown) => {
    if (path === '/api/auth/step-up/start') {
      return Promise.resolve({ method: 'email_otp', challengeToken: 'challenge-1', ssoStartUrl: null });
    }
    if (path === '/api/auth/step-up/verify') return Promise.resolve(undefined);
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
});
