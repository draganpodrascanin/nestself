import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import {
  createRouter,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  RouterProvider,
  Outlet,
} from '@tanstack/react-router';
import { resourcesFor } from '@nestself/i18n';
import type { Resource } from 'i18next';
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
const auth = vi.hoisted(() => ({ refreshPrincipal: vi.fn(async () => {}) }));
vi.mock('../auth-context', () => ({ useAuth: () => auth }));

const testI18n = i18next.createInstance();
void testI18n.use(initReactI18next).init({
  lng: 'en',
  resources: resourcesFor(['common', 'workspace', 'auth']) as Resource,
  interpolation: { escapeValue: false },
  returnNull: false,
});

function I18nWrapper({ children }: { children: React.ReactNode }) {
  return <I18nextProvider i18n={testI18n}>{children}</I18nextProvider>;
}

function makeAuthApi(overrides: Partial<AuthApi> = {}): AuthApi {
  return {
    discover: vi.fn(),
    emailOtpStart: vi.fn(),
    emailOtpVerify: vi.fn(),
    password: vi.fn(),
    totpVerify: vi.fn(),
    totpEnrolStart: vi.fn(),
    totpEnrolConfirm: vi.fn(),
    newPassword: vi.fn(),
    me: vi.fn(),
    signOut: vi.fn(),
    switchContext: vi.fn(),
    sessions: vi.fn(),
    sessionRevoke: vi.fn(),
    stepUpStart: vi.fn(),
    stepUpVerify: vi.fn(),
    invitationPreview: vi.fn(),
    invitationAccept: vi.fn(),
    passwordResetStart: vi.fn(),
    passwordResetConfirm: vi.fn(),
    ...overrides,
  } as unknown as AuthApi;
}

function renderInRouter(component: React.ReactNode) {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <>{component}</>,
  });
  const catchAll = createRoute({
    getParentRoute: () => rootRoute,
    path: '$',
    component: () => null,
  });
  const tree = rootRoute.addChildren([indexRoute, catchAll]);
  const router = createRouter({
    routeTree: tree,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });

  return {
    router,
    ...render(
      <I18nextProvider i18n={testI18n}>
        <RouterProvider router={router} />
      </I18nextProvider>,
    ),
  };
}

/* ------------------------------------------------------------------ */
/* IdentifierScreen                                                    */
/* ------------------------------------------------------------------ */

describe('IdentifierScreen', () => {
  const user = userEvent.setup();

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders the sign-in heading and email field', () => {
    render(
      <I18nWrapper>
        <IdentifierScreen onSubmit={vi.fn()} error={null} />
      </I18nWrapper>,
    );

    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
  });

  it('shows validation error for empty email', async () => {
    render(
      <I18nWrapper>
        <IdentifierScreen onSubmit={vi.fn()} error={null} />
      </I18nWrapper>,
    );

    await user.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  it('shows validation error for email without @', async () => {
    render(
      <I18nWrapper>
        <IdentifierScreen onSubmit={vi.fn()} error={null} />
      </I18nWrapper>,
    );

    await user.type(screen.getByRole('textbox'), 'notanemail');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  it('calls onSubmit with trimmed email for valid input', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <I18nWrapper>
        <IdentifierScreen onSubmit={onSubmit} error={null} />
      </I18nWrapper>,
    );

    await user.type(screen.getByRole('textbox'), '  test@example.com  ');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith('test@example.com');
    });
  });

  it('shows external error from props', () => {
    render(
      <I18nWrapper>
        <IdentifierScreen onSubmit={vi.fn()} error="Something went wrong." />
      </I18nWrapper>,
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Something went wrong.')).toBeInTheDocument();
  });

  it('has autocomplete="email" and type="email"', () => {
    render(
      <I18nWrapper>
        <IdentifierScreen onSubmit={vi.fn()} error={null} />
      </I18nWrapper>,
    );

    const input = screen.getByRole('textbox');
    expect(input).toHaveAttribute('autocomplete', 'email');
    expect(input).toHaveAttribute('type', 'email');
  });
});

/* ------------------------------------------------------------------ */
/* OtpScreen                                                           */
/* ------------------------------------------------------------------ */

describe('OtpScreen', () => {
  const user = userEvent.setup();

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  function renderOtp(overrides: Partial<Parameters<typeof OtpScreen>[0]> = {}) {
    return render(
      <I18nWrapper>
        <OtpScreen
          email="test@example.com"
          challengeToken="tok_123"
          authApi={makeAuthApi()}
          onSuccess={vi.fn()}
          onError={vi.fn()}
          onBack={vi.fn()}
          {...overrides}
        />
      </I18nWrapper>,
    );
  }

  it('renders the OTP heading and shows email', () => {
    renderOtp();

    expect(screen.getByRole('heading', { name: 'Check your email' })).toBeInTheDocument();
    expect(screen.getByText(/test@example.com/)).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('has inputMode="numeric" and autocomplete="one-time-code"', () => {
    renderOtp();

    const input = screen.getByRole('textbox');
    expect(input).toHaveAttribute('inputmode', 'numeric');
    expect(input).toHaveAttribute('autocomplete', 'one-time-code');
  });

  it('shows error for code shorter than 6 digits', async () => {
    renderOtp();

    await user.type(screen.getByRole('textbox'), '123');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  it('calls authApi.emailOtpVerify with the token and code', async () => {
    const verifyFn = vi.fn().mockResolvedValue({});
    const onSuccess = vi.fn().mockResolvedValue(undefined);

    renderOtp({
      authApi: makeAuthApi({ emailOtpVerify: verifyFn }),
      onSuccess,
    });

    await user.type(screen.getByRole('textbox'), '654321');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    await waitFor(() => {
      expect(verifyFn).toHaveBeenCalledWith('tok_123', '654321');
    });
  });

  // CLAUDE.md "Error states must be visible in the UI": onError alone used to
  // swallow every verify failure, so a wrong code showed nothing but a console 401.
  it('shows external error from props', () => {
    renderOtp({ error: 'That code has expired or was already used. Request a new one.' });

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(
      screen.getAllByText('That code has expired or was already used. Request a new one.').length,
    ).toBeGreaterThan(0);
  });

  it('renders the parent error even when the local validation error is empty', async () => {
    const emailOtpVerify = vi.fn().mockRejectedValue(new Error('boom'));
    const onError = vi.fn();
    renderOtp({
      authApi: makeAuthApi({ emailOtpVerify }),
      onError,
      error: 'The code you entered is not valid.',
    });

    await user.type(screen.getByRole('textbox'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(screen.getAllByText('The code you entered is not valid.').length).toBeGreaterThan(0);
  });

  // Cognito EMAIL_OTP codes are eight digits; a six-digit cap silently truncated
  // the real code and produced a CodeMismatchException.
  it('accepts an eight digit code and submits it whole', async () => {
    const emailOtpVerify = vi.fn().mockResolvedValue(undefined);
    renderOtp({ authApi: makeAuthApi({ emailOtpVerify }) });

    const input = screen.getByRole('textbox');
    await user.type(input, '63822125');
    expect(input).toHaveValue('63822125');

    await user.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(emailOtpVerify).toHaveBeenCalledWith('tok_123', '63822125'));
  });

  it('has aria-live="polite" on the resend countdown', () => {
    renderOtp();

    const liveRegion = document.querySelector('[aria-live="polite"]');
    expect(liveRegion).not.toBeNull();
  });

  it('back button calls onBack', async () => {
    const onBack = vi.fn();
    renderOtp({ onBack });

    await user.click(screen.getByRole('button', { name: /back/i }));
    expect(onBack).toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* PasswordScreen (needs router for <Link>)                            */
/* ------------------------------------------------------------------ */

describe('PasswordScreen', () => {
  const user = userEvent.setup();

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  function renderPassword(
    overrides: Partial<{
      email: string;
      authApi: AuthApi;
      onSuccess: () => Promise<void>;
      onChallengeRequired: (step: string, challengeToken: string) => void;
      onError: (err: unknown) => void;
      error: string | null;
      onBack: () => void;
    }> = {},
  ) {
    const props = {
      email: 'test@example.com',
      authApi: makeAuthApi(),
      onSuccess: vi.fn().mockResolvedValue(undefined) as () => Promise<void>,
      onChallengeRequired: vi.fn(),
      onError: vi.fn(),
      error: null as string | null,
      onBack: vi.fn(),
      ...overrides,
    };

    renderInRouter(<PasswordScreen {...props} />);
    return props;
  }

  it('renders password heading and shows email', async () => {
    renderPassword();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Enter your password' })).toBeInTheDocument();
    });
    expect(screen.getByText('test@example.com')).toBeInTheDocument();
  });

  it('has autocomplete="current-password" and type="password"', async () => {
    renderPassword();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Enter your password' })).toBeInTheDocument();
    });

    const form = document.querySelector('form')!;
    const pwInput = form.querySelector('input[name="password"]')!;
    expect(pwInput).toHaveAttribute('autocomplete', 'current-password');
    expect(pwInput).toHaveAttribute('type', 'password');
  });

  it('calls onChallengeRequired when password returns a challenge', async () => {
    const passwordFn = vi.fn().mockResolvedValue({
      step: 'totp',
      challengeToken: 'tok_totp_456',
    });
    const props = renderPassword({
      authApi: makeAuthApi({ password: passwordFn }),
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Enter your password' })).toBeInTheDocument();
    });

    const form = document.querySelector('form')!;
    const pwInput = form.querySelector('input[name="password"]') as HTMLInputElement;
    await user.type(pwInput, 'MyPassword123!');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(props.onChallengeRequired).toHaveBeenCalledWith('totp', 'tok_totp_456');
    });
  });

  it('calls onSuccess when password returns a principal', async () => {
    const passwordFn = vi.fn().mockResolvedValue({ principal: {} });
    const props = renderPassword({
      authApi: makeAuthApi({ password: passwordFn }),
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Enter your password' })).toBeInTheDocument();
    });

    const form = document.querySelector('form')!;
    const pwInput = form.querySelector('input[name="password"]') as HTMLInputElement;
    await user.type(pwInput, 'MyPassword123!');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(props.onSuccess).toHaveBeenCalled();
    });
  });

  it('shows error from props', async () => {
    renderPassword({ error: 'The email or password is not correct.' });

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.getByText('The email or password is not correct.')).toBeInTheDocument();
  });

  it('has a forgot-password link', async () => {
    renderPassword();

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /forgot password/i })).toBeInTheDocument();
    });
  });
});

/* ------------------------------------------------------------------ */
/* CLIENT-R-09: neutral copy                                           */
/* ------------------------------------------------------------------ */

describe('CLIENT-R-09: neutral copy', () => {
  afterEach(() => {
    cleanup();
  });

  it('identifier screen never mentions registration status', () => {
    render(
      <I18nWrapper>
        <IdentifierScreen onSubmit={vi.fn()} error={null} />
      </I18nWrapper>,
    );

    const html = document.body.innerHTML.toLowerCase();
    expect(html).not.toContain('not registered');
    expect(html).not.toContain('no account');
    expect(html).not.toContain('not found');
  });
});

/* ------------------------------------------------------------------ */
/* Locale leak detection                                               */
/* ------------------------------------------------------------------ */

describe('locale leak detection', () => {
  afterEach(() => {
    cleanup();
  });

  it('identifier screen does not render raw i18n keys', () => {
    render(
      <I18nWrapper>
        <IdentifierScreen onSubmit={vi.fn()} error={null} />
      </I18nWrapper>,
    );

    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/signIn\.\w/);
    expect(text).not.toMatch(/error\.\w/);
    expect(text).not.toMatch(/common:form\.\w/);
  });

  it('OTP screen does not render raw i18n keys', () => {
    render(
      <I18nWrapper>
        <OtpScreen
          email="test@example.com"
          challengeToken="tok_123"
          authApi={makeAuthApi()}
          onSuccess={vi.fn()}
          onError={vi.fn()}
          onBack={vi.fn()}
        />
      </I18nWrapper>,
    );

    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/otp\.\w/);
    expect(text).not.toMatch(/error\.\w/);
    expect(text).not.toMatch(/common:form\.\w/);
  });

  it('password screen does not render raw i18n keys', async () => {
    renderInRouter(
      <PasswordScreen
        email="test@example.com"
        authApi={makeAuthApi()}
        onSuccess={vi.fn().mockResolvedValue(undefined)}
        onChallengeRequired={vi.fn()}
        onError={vi.fn()}
        error={null}
        onBack={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Enter your password' })).toBeInTheDocument();
    });

    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/password\.\w/);
    expect(text).not.toMatch(/error\.\w/);
    expect(text).not.toMatch(/common:form\.\w/);
  });
});

/* ------------------------------------------------------------------ */
/* SignInPage: API errors and the code-email locale                    */
/* ------------------------------------------------------------------ */

describe('SignInPage', () => {
  const user = userEvent.setup();

  afterEach(async () => {
    cleanup();
    vi.restoreAllMocks();
    await testI18n.changeLanguage('en');
  });

  async function submitEmail(api: AuthApi) {
    pageApi.current = api;
    renderInRouter(<SignInPage />);
    await user.type(await screen.findByRole('textbox'), 'test@example.com');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
  }

  // CLAUDE.md error-state rule 4: an unknown code renders error.unknown, never the API's English.
  it('renders error.unknown, not the raw API message, for an unmapped error code', async () => {
    const discover = vi.fn().mockRejectedValue(
      new ApiError({ status: 500, code: 'something_new', message: 'Raw developer message', requestId: null }),
    );
    await submitEmail(makeAuthApi({ discover }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getAllByText('Something went wrong. Please try again.').length).toBeGreaterThan(0);
    expect(screen.queryByText(/Raw developer message/)).not.toBeInTheDocument();
  });

  it('asks for the code email in the language the screen is shown in', async () => {
    await testI18n.changeLanguage('hu');
    const emailOtpStart = vi.fn().mockResolvedValue({ challengeToken: 'tok', codeDeliveryMedium: 'EMAIL' });
    pageApi.current = makeAuthApi({
      discover: vi.fn().mockResolvedValue({ method: 'email_otp', ssoStartUrl: null, connection: null }),
      emailOtpStart,
    });
    renderInRouter(<SignInPage />);
    await user.type(await screen.findByRole('textbox'), 'test@example.com');
    await user.click(screen.getByRole('button', { name: testI18n.t('auth:signIn.submit') }));

    await waitFor(() => expect(emailOtpStart).toHaveBeenCalledWith('test@example.com', 'hu'));
  });
});

/* ------------------------------------------------------------------ */
/* OtpScreen resend                                                    */
/* ------------------------------------------------------------------ */

describe('OtpScreen resend', () => {
  afterEach(async () => {
    cleanup();
    vi.useRealTimers();
    await testI18n.changeLanguage('en');
  });

  it('requests the new code in the current language', async () => {
    vi.useFakeTimers();
    await testI18n.changeLanguage('sr-Cyrl');
    const emailOtpStart = vi.fn().mockResolvedValue({ challengeToken: 'tok_2', codeDeliveryMedium: 'EMAIL' });
    render(
      <I18nWrapper>
        <OtpScreen
          email="test@example.com"
          challengeToken="tok_123"
          authApi={makeAuthApi({ emailOtpStart })}
          onSuccess={vi.fn()}
          onError={vi.fn()}
          onBack={vi.fn()}
        />
      </I18nWrapper>,
    );

    for (let i = 0; i < 60; i++) {
      act(() => {
        vi.advanceTimersByTime(1000);
      });
    }
    fireEvent.click(screen.getByRole('button', { name: testI18n.t('auth:otp.resend') }));
    await act(async () => {});

    expect(emailOtpStart).toHaveBeenCalledWith('test@example.com', 'sr-Cyrl');
  });
});

/* ------------------------------------------------------------------ */
/* Error summary links focus their field                               */
/* ------------------------------------------------------------------ */

describe('error summary links focus the field they name', () => {
  const user = userEvent.setup();

  afterEach(() => {
    cleanup();
  });

  async function clickSummaryLinkAndExpectFocus(fieldSelector: string) {
    const alert = await screen.findByRole('alert');
    const link = alert.querySelector('a')!;
    await user.click(link);
    const field = document.querySelector(fieldSelector)!;
    expect(field).not.toBeNull();
    expect(document.activeElement).toBe(field);
    expect(field.tagName).toBe('INPUT');
  }

  it('identifier screen: the link focuses the email input', async () => {
    render(
      <I18nWrapper>
        <IdentifierScreen onSubmit={vi.fn()} error="Broken." />
      </I18nWrapper>,
    );
    await clickSummaryLinkAndExpectFocus('input[name="email"]');
  });

  it('OTP screen: the link focuses the code input', async () => {
    render(
      <I18nWrapper>
        <OtpScreen
          email="test@example.com"
          challengeToken="tok_123"
          authApi={makeAuthApi()}
          onSuccess={vi.fn()}
          onError={vi.fn()}
          error="Broken."
          onBack={vi.fn()}
        />
      </I18nWrapper>,
    );
    await clickSummaryLinkAndExpectFocus('input[autocomplete="one-time-code"]');
  });

  it('password screen: the link focuses the password input', async () => {
    renderInRouter(
      <PasswordScreen
        email="test@example.com"
        authApi={makeAuthApi()}
        onSuccess={vi.fn().mockResolvedValue(undefined)}
        onChallengeRequired={vi.fn()}
        onError={vi.fn()}
        error="Broken."
        onBack={vi.fn()}
      />,
    );
    await clickSummaryLinkAndExpectFocus('input[name="password"]');
  });

  it('TOTP screen: the link focuses the code input', async () => {
    render(
      <I18nWrapper>
        <TotpScreen challengeToken="tok" authApi={makeAuthApi()} onSuccess={vi.fn()} onError={vi.fn()} error="Broken." />
      </I18nWrapper>,
    );
    await clickSummaryLinkAndExpectFocus('#totp-code-input');
  });

  it('authenticator enrolment screen: the link focuses the code input', async () => {
    render(
      <I18nWrapper>
        <TotpEnrolScreen
          challengeToken="tok"
          authApi={makeAuthApi({ totpEnrol: vi.fn(() => new Promise(() => {})) } as Partial<AuthApi>)}
          onSuccess={vi.fn()}
          onError={vi.fn()}
          error="Broken."
        />
      </I18nWrapper>,
    );
    await clickSummaryLinkAndExpectFocus('#enrol-code-input');
  });

  it('new password screen: the link focuses the new password input', async () => {
    render(
      <I18nWrapper>
        <NewPasswordScreen
          challengeToken="tok"
          authApi={makeAuthApi()}
          onChallengeRequired={vi.fn()}
          onSuccess={vi.fn()}
          onError={vi.fn()}
          error="Broken."
        />
      </I18nWrapper>,
    );
    await clickSummaryLinkAndExpectFocus('#new-password-input');
  });
});

// API-R-07: the SSO callback sends the user back with ?reason=; the screen says why.
describe('SignInPage SSO return reasons', () => {
  const user = userEvent.setup();

  afterEach(async () => {
    cleanup();
    vi.restoreAllMocks();
    await testI18n.changeLanguage('en');
  });

  it('sso_denied: shows the translated "ask your HR administrator" copy in the error summary', async () => {
    pageApi.current = makeAuthApi();
    renderInRouter(<SignInPage reason="sso_denied" />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getAllByText(testI18n.t('auth:error.ssoDenied')).length).toBeGreaterThan(0);
  });

  it('sso_denied: the copy follows the screen language', async () => {
    await testI18n.changeLanguage('hu');
    pageApi.current = makeAuthApi();
    renderInRouter(<SignInPage reason="sso_denied" />);
    expect((await screen.findAllByText(testI18n.t('auth:error.ssoDenied'))).length).toBeGreaterThan(0);
    expect(testI18n.t('auth:error.ssoDenied')).not.toBe(testI18n.t('auth:error.ssoDenied', { lng: 'en' }));
  });

  const HANDLE = 'h'.repeat(43);

  it('sso_email_unverified with a bind handle opens the confirm-email step instead of the address field', async () => {
    const discover = vi.fn();
    const ssoBindStart = vi.fn().mockResolvedValue({ challengeToken: 'challenge-1', emailMasked: 'm***@acme.example' });
    pageApi.current = makeAuthApi({ discover, ssoBindStart });
    renderInRouter(<SignInPage reason="sso_email_unverified" bind={HANDLE} />);

    expect(await screen.findByRole('heading', { level: 1, name: 'Confirm your email address' })).toBeInTheDocument();
    expect(
      await screen.findByText("Your organisation's sign-in did not confirm m***@acme.example. Enter the code we sent there."),
    ).toBeInTheDocument();
    await waitFor(() => expect(ssoBindStart).toHaveBeenCalledWith(HANDLE, 'en'));
    expect(screen.queryByRole('textbox', { name: /Email address/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(discover).not.toHaveBeenCalled();
  });

  it('after the code, the page refreshes the principal and continues to the path the API returned', async () => {
    auth.refreshPrincipal.mockClear();
    pageApi.current = makeAuthApi({
      ssoBindStart: vi.fn().mockResolvedValue({ challengeToken: 'challenge-1', emailMasked: 'm***@acme.example' }),
      ssoBindVerify: vi.fn().mockResolvedValue({ returnPath: '/people' }),
    });
    const { router } = renderInRouter(<SignInPage reason="sso_email_unverified" bind={HANDLE} returnPath="/elsewhere" />);

    await user.type(await screen.findByLabelText(/Verification code/), '123456');
    await user.click(screen.getByRole('button', { name: testI18n.t('auth:ssoBind.submit') }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/people'));
    expect(auth.refreshPrincipal).toHaveBeenCalledTimes(1);
  });

  it('sso_email_unverified without a handle (a link from before) explains and continues with discovery', async () => {
    const discover = vi.fn().mockResolvedValue({ method: 'email_otp', ssoStartUrl: null, connection: null });
    const emailOtpStart = vi.fn().mockResolvedValue({ challengeToken: 'tok', codeDeliveryMedium: 'EMAIL' });
    pageApi.current = makeAuthApi({ discover, emailOtpStart });
    renderInRouter(<SignInPage reason="sso_email_unverified" />);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getAllByText(testI18n.t('auth:error.ssoEmailUnverified')).length).toBeGreaterThan(0);
    await user.type(screen.getByRole('textbox'), 'new@acme.example');
    await user.click(screen.getByRole('button', { name: testI18n.t('auth:signIn.submit') }));
    await waitFor(() => expect(discover).toHaveBeenCalledWith('new@acme.example'));
  });

  it('sso_rate_limited: says to wait a minute, in the error summary', async () => {
    pageApi.current = makeAuthApi();
    renderInRouter(<SignInPage reason="sso_rate_limited" />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(
      screen.getAllByText('Too many sign-in attempts from your network. Wait a minute and try again.').length,
    ).toBeGreaterThan(0);
  });
});
