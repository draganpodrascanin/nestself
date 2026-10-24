import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import i18next from 'i18next';
import type { Resource } from 'i18next';
import {
  createRouter,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  RouterProvider,
  Outlet,
} from '@tanstack/react-router';
import { resourcesFor } from '@nestself/i18n';
import { ApiError } from '@nestself/api-client';
import type { AuthApi } from '@nestself/api-client';

import { IdentifierScreen } from './identifier-screen';
import { OtpScreen } from './otp-screen';
import { PasswordScreen } from './password-screen';
import { TotpScreen } from './totp-screen';
import { TotpEnrolScreen } from './totp-enrol-screen';
import { NewPasswordScreen } from './new-password-screen';
import { SignInPage } from './sign-in-page';

// SignInPage builds its own AuthApi (the sample one under test); hand it ours.
const pageApi = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('./sample-auth-api', () => ({ createSampleAuthApi: () => pageApi.current }));
vi.mock('../auth-context', () => ({
  useAuth: () => ({ refreshPrincipal: vi.fn(), switchContext: vi.fn() }),
}));

const testI18n = i18next.createInstance();
void testI18n.use(initReactI18next).init({
  lng: 'en',
  resources: resourcesFor(['common', 'admin', 'auth']) as Resource,
  interpolation: { escapeValue: false },
  returnNull: false,
});

function makeAuthApi(overrides: Record<string, unknown> = {}): AuthApi {
  return {
    discover: vi.fn(),
    emailOtpStart: vi.fn(),
    emailOtpVerify: vi.fn(),
    password: vi.fn(),
    challenge: vi.fn(),
    totpEnrol: vi.fn(() => new Promise(() => {})),
    me: vi.fn(),
    ...overrides,
  } as unknown as AuthApi;
}

function withI18n(node: React.ReactNode) {
  return <I18nextProvider i18n={testI18n}>{node}</I18nextProvider>;
}

function renderInRouter(component: React.ReactNode) {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <>{component}</>,
  });
  const catchAll = createRoute({ getParentRoute: () => rootRoute, path: '$', component: () => null });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, catchAll]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  return render(withI18n(<RouterProvider router={router} />));
}

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  await testI18n.changeLanguage('en');
});

describe('SignInPage', () => {
  const user = userEvent.setup();

  async function submitEmail(api: AuthApi) {
    pageApi.current = api;
    renderInRouter(<SignInPage />);
    await user.type(await screen.findByRole('textbox'), 'staff@example.com');
    await user.click(screen.getByRole('button', { name: testI18n.t('auth:signIn.submit') }));
  }

  // CLAUDE.md error-state rule 4: an unknown code renders error.unknown, never the API's English.
  it('renders error.unknown, not the raw API message, for an unmapped error code', async () => {
    await submitEmail(
      makeAuthApi({
        discover: vi.fn().mockRejectedValue(
          new ApiError({ status: 500, code: 'something_new', message: 'Raw developer message', requestId: null }),
        ),
      }),
    );

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getAllByText(testI18n.t('auth:error.unknown')).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Raw developer message/)).not.toBeInTheDocument();
  });

  it('renders the network copy when the API cannot be reached', async () => {
    await submitEmail(
      makeAuthApi({
        discover: vi.fn().mockRejectedValue(
          new ApiError({ status: 0, code: 'network', message: 'Failed to fetch', requestId: null }),
        ),
      }),
    );

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getAllByText(testI18n.t('auth:error.network')).length).toBeGreaterThan(0);
  });

  it('asks for the code email in the language the screen is shown in', async () => {
    await testI18n.changeLanguage('sr-Latn');
    const emailOtpStart = vi.fn().mockResolvedValue({ challengeToken: 'tok', codeDeliveryMedium: 'EMAIL' });
    await submitEmail(
      makeAuthApi({
        discover: vi.fn().mockResolvedValue({ method: 'email_otp', ssoStartUrl: null, connection: null }),
        emailOtpStart,
      }),
    );

    await waitFor(() => expect(emailOtpStart).toHaveBeenCalledWith('staff@example.com', 'sr-Latn'));
  });
});

describe('OtpScreen resend', () => {
  it('requests the new code in the current language', async () => {
    vi.useFakeTimers();
    await testI18n.changeLanguage('hu');
    const emailOtpStart = vi.fn().mockResolvedValue({ challengeToken: 'tok_2', codeDeliveryMedium: 'EMAIL' });
    render(
      withI18n(
        <OtpScreen
          email="staff@example.com"
          challengeToken="tok_1"
          authApi={makeAuthApi({ emailOtpStart })}
          onSuccess={vi.fn()}
          onError={vi.fn()}
          onBack={vi.fn()}
        />,
      ),
    );

    for (let i = 0; i < 60; i++) {
      act(() => {
        vi.advanceTimersByTime(1000);
      });
    }
    fireEvent.click(screen.getByRole('button', { name: testI18n.t('auth:otp.resend') }));
    await act(async () => {});

    expect(emailOtpStart).toHaveBeenCalledWith('staff@example.com', 'hu');
  });
});

describe('error summary links focus the field they name', () => {
  const user = userEvent.setup();

  async function clickSummaryLinkAndExpectFocus(fieldSelector: string) {
    const alert = await screen.findByRole('alert');
    await user.click(alert.querySelector('a')!);
    const field = document.querySelector(fieldSelector);
    expect(field).not.toBeNull();
    expect(field!.tagName).toBe('INPUT');
    expect(document.activeElement).toBe(field);
  }

  const api = makeAuthApi();

  it('identifier screen', async () => {
    render(withI18n(<IdentifierScreen onSubmit={vi.fn()} error="Broken." />));
    await clickSummaryLinkAndExpectFocus('input[name="email"]');
  });

  it('OTP screen', async () => {
    render(
      withI18n(
        <OtpScreen
          email="staff@example.com"
          challengeToken="tok"
          authApi={api}
          onSuccess={vi.fn()}
          onError={vi.fn()}
          error="Broken."
          onBack={vi.fn()}
        />,
      ),
    );
    await clickSummaryLinkAndExpectFocus('#otp-code-input');
  });

  it('password screen', async () => {
    renderInRouter(
      <PasswordScreen
        email="staff@example.com"
        authApi={api}
        onSuccess={vi.fn()}
        onChallengeRequired={vi.fn()}
        onError={vi.fn()}
        error="Broken."
        onBack={vi.fn()}
      />,
    );
    await clickSummaryLinkAndExpectFocus('#password-input');
  });

  it('TOTP screen', async () => {
    render(withI18n(<TotpScreen challengeToken="tok" authApi={api} onSuccess={vi.fn()} onError={vi.fn()} error="Broken." />));
    await clickSummaryLinkAndExpectFocus('#totp-code-input');
  });

  it('authenticator enrolment screen', async () => {
    render(withI18n(<TotpEnrolScreen challengeToken="tok" authApi={api} onSuccess={vi.fn()} onError={vi.fn()} error="Broken." />));
    await clickSummaryLinkAndExpectFocus('#totp-enrol-code-input');
  });

  it('new password screen', async () => {
    render(
      withI18n(
        <NewPasswordScreen
          challengeToken="tok"
          authApi={api}
          onChallengeRequired={vi.fn()}
          onSuccess={vi.fn()}
          onError={vi.fn()}
          error="Broken."
        />,
      ),
    );
    await clickSummaryLinkAndExpectFocus('#new-password-input');
  });
});
