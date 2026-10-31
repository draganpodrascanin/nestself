/**
 * SsoBindScreen: the confirm-email step of a federated sign-in whose address
 * the organisation's identity provider did not confirm (SSO-R-08). The same
 * file runs in the workspace and the admin app.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { StrictMode } from 'react';
import { act, render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import i18next from 'i18next';
import type { Resource } from 'i18next';
import { resourcesFor } from '@nestself/i18n';
import { ApiError } from '@nestself/api-client';
import type { AuthApi } from '@nestself/api-client';
import { EMAIL_OTP_MAX_LENGTH, EMAIL_OTP_MIN_LENGTH } from '@nestself/contracts';
import { SsoBindScreen } from './sso-bind-screen';

const testI18n = i18next.createInstance();
void testI18n.use(initReactI18next).init({
  lng: 'en',
  resources: resourcesFor(['common', 'auth']) as Resource,
  interpolation: { escapeValue: false },
  returnNull: false,
});
const t = (key: string, options?: Record<string, unknown>) => testI18n.t(key, options);

const HANDLE = 'h'.repeat(43);
const VALID_CODE = '1'.repeat(EMAIL_OTP_MAX_LENGTH);
const INSTRUCTIONS = "Your organisation's sign-in did not confirm m***@acme.example. Enter the code we sent there.";

function apiError(status: number, code: string, details?: Record<string, unknown>): ApiError {
  return new ApiError({ status, code, message: `English ${code}`, requestId: null, details });
}

function makeAuthApi(overrides: Partial<AuthApi> = {}): AuthApi {
  return {
    ssoBindStart: vi.fn().mockResolvedValue({ challengeToken: 'challenge-1', emailMasked: 'm***@acme.example' }),
    ssoBindResend: vi.fn().mockResolvedValue({ emailMasked: 'm***@acme.example' }),
    ssoBindVerify: vi.fn().mockResolvedValue({ returnPath: '/people' }),
    ...overrides,
  } as unknown as AuthApi;
}

/** A promise the test settles itself. */
function pending<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function renderScreen(authApi: AuthApi, onSuccess = vi.fn().mockResolvedValue(undefined)) {
  render(
    <StrictMode>
      <I18nextProvider i18n={testI18n}>
        <SsoBindScreen handle={HANDLE} authApi={authApi} onSuccess={onSuccess} />
      </I18nextProvider>
    </StrictMode>,
  );
  return { onSuccess };
}

const codeInput = () => screen.getByLabelText(new RegExp(t('auth:otp.codeLabel')));
const confirmButton = () => screen.getByRole('button', { name: t('auth:ssoBind.submit') });
const resendButton = () => screen.getByRole('button', { name: t('auth:otp.resend') });

async function enterCode(code: string) {
  const user = userEvent.setup();
  const input = await screen.findByLabelText(new RegExp(t('auth:otp.codeLabel')));
  await user.clear(input);
  await user.type(input, code);
  await user.click(confirmButton());
  return user;
}

/** Fake-timer helpers: flush the promises a click started, and let the countdown run. */
async function settle() {
  await act(async () => {});
}

function secondsPass(seconds: number) {
  for (let i = 0; i < seconds; i++) {
    act(() => {
      vi.advanceTimersByTime(1000);
    });
  }
}

describe('SsoBindScreen', () => {
  afterEach(async () => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    await testI18n.changeLanguage('en');
  });

  it('asks for the code once on mount, even under StrictMode, and names the masked address', async () => {
    const authApi = makeAuthApi();
    renderScreen(authApi);

    expect(screen.getByRole('heading', { level: 1, name: 'Confirm your email address' })).toBeInTheDocument();
    expect(await screen.findByText(INSTRUCTIONS)).toBeInTheDocument();
    expect(authApi.ssoBindStart).toHaveBeenCalledTimes(1);
    expect(authApi.ssoBindStart).toHaveBeenCalledWith(HANDLE, 'en');
  });

  it('asks for the code email in the language the screen is shown in', async () => {
    await testI18n.changeLanguage('hu');
    const authApi = makeAuthApi();
    renderScreen(authApi);
    await waitFor(() => expect(authApi.ssoBindStart).toHaveBeenCalledWith(HANDLE, 'hu'));
  });

  it('the code field is the one-time code field with the shared length bounds', async () => {
    renderScreen(makeAuthApi());
    const input = await screen.findByLabelText(new RegExp(t('auth:otp.codeLabel')));
    expect(input).toHaveAttribute('autocomplete', 'one-time-code');
    expect(input).toHaveAttribute('inputmode', 'numeric');
    expect(input).toHaveAttribute('maxLength', String(EMAIL_OTP_MAX_LENGTH));
  });

  it('verifies the code against the started challenge and continues to the returned path', async () => {
    const authApi = makeAuthApi();
    const { onSuccess } = renderScreen(authApi);
    await screen.findByText(INSTRUCTIONS);

    await enterCode(VALID_CODE);

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith('/people'));
    expect(authApi.ssoBindVerify).toHaveBeenCalledWith('challenge-1', VALID_CODE);
  });

  it('accepts a code of the shortest allowed length', async () => {
    const authApi = makeAuthApi();
    const { onSuccess } = renderScreen(authApi);
    await screen.findByText(INSTRUCTIONS);

    await enterCode('1'.repeat(EMAIL_OTP_MIN_LENGTH));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(authApi.ssoBindVerify).toHaveBeenCalledWith('challenge-1', '1'.repeat(EMAIL_OTP_MIN_LENGTH));
  });

  it('rejects a too-short code locally without calling the API', async () => {
    const authApi = makeAuthApi();
    renderScreen(authApi);
    await screen.findByText(INSTRUCTIONS);

    await enterCode('1'.repeat(EMAIL_OTP_MIN_LENGTH - 1));

    expect(await screen.findAllByText(t('auth:error.invalidCode'))).not.toHaveLength(0);
    expect(authApi.ssoBindVerify).not.toHaveBeenCalled();
  });

  it('shows error.ssoDenied on 403 sso_denied and offers only the way back to sign-in', async () => {
    const { onSuccess } = renderScreen(makeAuthApi({ ssoBindVerify: vi.fn().mockRejectedValue(apiError(403, 'sso_denied')) }));
    await screen.findByText(INSTRUCTIONS);

    await enterCode(VALID_CODE);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(t('auth:error.ssoDenied'));
    expect(screen.queryByText('English sso_denied')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: t('auth:ssoBind.backToSignIn') })).toHaveAttribute('href', '/sign-in');
    expect(screen.queryByLabelText(new RegExp(t('auth:otp.codeLabel')))).not.toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it.each([400, 401])('shows error.ssoBindExpired on %s invalid_challenge from start, with a link back to /sign-in', async (status) => {
    renderScreen(makeAuthApi({ ssoBindStart: vi.fn().mockRejectedValue(apiError(status, 'invalid_challenge')) }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('This confirmation link has expired. Sign in again.');
    expect(screen.getByRole('link', { name: t('auth:ssoBind.backToSignIn') })).toHaveAttribute('href', '/sign-in');
    expect(screen.queryByLabelText(new RegExp(t('auth:otp.codeLabel')))).not.toBeInTheDocument();
    expect(screen.queryByText('English invalid_challenge')).not.toBeInTheDocument();
  });

  it('the summary link of an ended step moves focus to the way back', async () => {
    renderScreen(makeAuthApi({ ssoBindStart: vi.fn().mockRejectedValue(apiError(400, 'invalid_challenge')) }));
    const alert = await screen.findByRole('alert');
    fireEvent.click(alert.querySelector('a')!);
    expect(screen.getByRole('link', { name: t('auth:ssoBind.backToSignIn') })).toHaveFocus();
  });

  it('a wrong code shows error.invalidCode on the field and keeps the challenge', async () => {
    const authApi = makeAuthApi({
      ssoBindVerify: vi.fn().mockRejectedValueOnce(apiError(401, 'invalid_code')).mockResolvedValue({ returnPath: '/' }),
    });
    const { onSuccess } = renderScreen(authApi);
    await screen.findByText(INSTRUCTIONS);

    await enterCode('2'.repeat(EMAIL_OTP_MAX_LENGTH));
    const message = t('auth:error.invalidCode');
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(message));
    expect(codeInput()).toHaveAccessibleDescription(message);

    await enterCode(VALID_CODE);
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith('/'));
    expect(authApi.ssoBindVerify).toHaveBeenNthCalledWith(2, 'challenge-1', VALID_CODE);
    expect(authApi.ssoBindStart).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['invalid_challenge', 401, 'auth:error.challengeExpired'],
    ['expired_code', 401, 'auth:error.challengeExpired'],
    ['too_many_attempts', 429, 'auth:lockout.body'],
  ])('drops the challenge on %s and asks for a new code at once', async (code, status, messageKey) => {
    const authApi = makeAuthApi({
      ssoBindVerify: vi.fn().mockRejectedValue(apiError(status, code)),
      ssoBindStart: vi
        .fn()
        .mockResolvedValueOnce({ challengeToken: 'challenge-1', emailMasked: 'm***@acme.example' })
        .mockResolvedValueOnce({ challengeToken: 'challenge-2', emailMasked: 'm***@acme.example' }),
    });
    renderScreen(authApi);
    await screen.findByText(INSTRUCTIONS);

    const user = await enterCode(VALID_CODE);
    expect(await screen.findAllByText(t(messageKey))).not.toHaveLength(0);

    // The countdown no longer applies: the button starts a new challenge from the same handle.
    expect(resendButton()).toBeEnabled();
    await user.click(resendButton());
    await waitFor(() => expect(authApi.ssoBindStart).toHaveBeenCalledTimes(2));
    expect(authApi.ssoBindResend).not.toHaveBeenCalled();
  });

  it.each([
    [apiError(0, 'network'), 'auth:error.network'],
    [apiError(503, 'unavailable'), 'auth:error.unavailable'],
    [apiError(500, 'internal_error'), 'auth:error.unknown'],
  ])('maps a failed verify (%s) to translated copy, never the API message', async (err, messageKey) => {
    renderScreen(makeAuthApi({ ssoBindVerify: vi.fn().mockRejectedValue(err) }));
    await screen.findByText(INSTRUCTIONS);

    await enterCode(VALID_CODE);

    expect(await screen.findAllByText(t(messageKey))).not.toHaveLength(0);
    expect(screen.queryByText(`English ${err.code}`)).not.toBeInTheDocument();
  });

  it('a code mail that could not be sent (503) is shown, and the button asks again', async () => {
    const authApi = makeAuthApi({
      ssoBindStart: vi
        .fn()
        .mockRejectedValueOnce(apiError(503, 'unavailable'))
        .mockResolvedValueOnce({ challengeToken: 'challenge-1', emailMasked: 'm***@acme.example' }),
    });
    renderScreen(authApi);

    expect(await screen.findAllByText(t('auth:error.unavailable'))).not.toHaveLength(0);
    const user = userEvent.setup();
    await user.click(resendButton());
    expect(await screen.findByText(INSTRUCTIONS)).toBeInTheDocument();
    expect(authApi.ssoBindStart).toHaveBeenCalledTimes(2);
  });

  it('resend is disabled for 60 seconds after the code was sent', async () => {
    vi.useFakeTimers();
    renderScreen(makeAuthApi());
    await settle();

    expect(resendButton()).toBeDisabled();
    expect(screen.getByText(t('auth:otp.resendCountdown', { seconds: 60 }))).toBeInTheDocument();

    secondsPass(59);
    expect(resendButton()).toBeDisabled();
    expect(screen.getByText(t('auth:otp.resendCountdown', { seconds: 1 }))).toBeInTheDocument();

    secondsPass(1);
    expect(resendButton()).toBeEnabled();
    expect(screen.queryByText(t('auth:otp.resendCountdown', { seconds: 0 }))).not.toBeInTheDocument();
  });

  it('resend asks for a new code for the same challenge in the screen language and restarts the countdown', async () => {
    vi.useFakeTimers();
    const authApi = makeAuthApi();
    const { onSuccess } = renderScreen(authApi);
    await settle();
    secondsPass(60);

    fireEvent.click(resendButton());
    await settle();

    expect(authApi.ssoBindResend).toHaveBeenCalledWith('challenge-1', 'en');
    expect(authApi.ssoBindStart).toHaveBeenCalledTimes(1);
    expect(resendButton()).toBeDisabled();
    expect(screen.getByText(t('auth:otp.resendCountdown', { seconds: 60 }))).toBeInTheDocument();

    fireEvent.change(codeInput(), { target: { value: VALID_CODE } });
    fireEvent.click(confirmButton());
    await settle();
    expect(authApi.ssoBindVerify).toHaveBeenCalledWith('challenge-1', VALID_CODE);
    expect(onSuccess).toHaveBeenCalledWith('/people');
  });

  it('a resend refused with rate_limited counts down from retryAfter and keeps the challenge', async () => {
    vi.useFakeTimers();
    const authApi = makeAuthApi({
      ssoBindResend: vi.fn().mockRejectedValue(apiError(429, 'rate_limited', { retryAfter: 30 })),
    });
    renderScreen(authApi);
    await settle();
    secondsPass(60);

    fireEvent.click(resendButton());
    await settle();

    expect(screen.getAllByText(t('auth:lockout.retryAfter', { minutes: 1 }))).not.toHaveLength(0);
    expect(resendButton()).toBeDisabled();
    expect(screen.getByText(t('auth:otp.resendCountdown', { seconds: 30 }))).toBeInTheDocument();
    secondsPass(30);
    expect(resendButton()).toBeEnabled();

    fireEvent.change(codeInput(), { target: { value: VALID_CODE } });
    fireEvent.click(confirmButton());
    await settle();
    expect(authApi.ssoBindVerify).toHaveBeenCalledWith('challenge-1', VALID_CODE);
  });

  it('Confirm is disabled while a resend is in flight', async () => {
    vi.useFakeTimers();
    const resend = pending<{ emailMasked: string }>();
    const authApi = makeAuthApi({ ssoBindResend: vi.fn().mockReturnValue(resend.promise) });
    renderScreen(authApi);
    await settle();
    secondsPass(60);

    fireEvent.click(resendButton());
    await settle();

    expect(confirmButton()).toBeDisabled();
    fireEvent.change(codeInput(), { target: { value: VALID_CODE } });
    fireEvent.submit(confirmButton().closest('form')!);
    await settle();
    expect(authApi.ssoBindVerify).not.toHaveBeenCalled();

    await act(async () => {
      resend.resolve({ emailMasked: 'm***@acme.example' });
    });
    expect(confirmButton()).toBeEnabled();
  });

  it('resend is disabled while a code is being verified', async () => {
    vi.useFakeTimers();
    const verify = pending<{ returnPath: string }>();
    renderScreen(makeAuthApi({ ssoBindVerify: vi.fn().mockReturnValue(verify.promise) }));
    await settle();
    secondsPass(60);
    expect(resendButton()).toBeEnabled();

    fireEvent.change(codeInput(), { target: { value: VALID_CODE } });
    fireEvent.click(confirmButton());
    await settle();

    expect(resendButton()).toBeDisabled();
    await act(async () => {
      verify.resolve({ returnPath: '/' });
    });
  });
});
