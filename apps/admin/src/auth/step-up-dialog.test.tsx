import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import i18next from 'i18next';
import type { Resource } from 'i18next';
import { resourcesFor } from '@nestself/i18n';
import { ApiError } from '@nestself/api-client';
import type { AuthApi } from '@nestself/api-client';
import { EMAIL_OTP_MAX_LENGTH, EMAIL_OTP_MIN_LENGTH } from '@nestself/contracts';
import { StepUpDialog } from './step-up-dialog';

const testI18n = i18next.createInstance();
void testI18n.use(initReactI18next).init({
  lng: 'en',
  resources: resourcesFor(['common', 'admin', 'auth']) as Resource,
  interpolation: { escapeValue: false },
  returnNull: false,
});
const t = (key: string, options?: Record<string, unknown>) => testI18n.t(key, options);

const VALID_CODE = '1'.repeat(EMAIL_OTP_MAX_LENGTH);

function apiError(status: number, code: string, details?: Record<string, unknown>): ApiError {
  return new ApiError({ status, code, message: `English ${code}`, requestId: null, details });
}

function challenge(challengeToken: string, emailMasked: string | null = null) {
  return { method: 'email_otp' as const, challengeToken, ssoStartUrl: null, emailMasked };
}

function makeAuthApi(overrides: Partial<AuthApi> = {}): AuthApi {
  return {
    stepUpStart: vi.fn().mockResolvedValue(challenge('challenge-1')),
    stepUpResend: vi.fn().mockResolvedValue(challenge('challenge-2')),
    stepUpVerify: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as AuthApi;
}

/** A promise the test settles (or never settles) itself. */
function pending<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function renderDialog(authApi: AuthApi, handlers: { onVerified?: () => void; onCancel?: () => void } = {}) {
  const onVerified = handlers.onVerified ?? vi.fn();
  const onCancel = handlers.onCancel ?? vi.fn();
  render(
    <I18nextProvider i18n={testI18n}>
      <StepUpDialog open authApi={authApi} onVerified={onVerified} onCancel={onCancel} />
    </I18nextProvider>,
  );
  return { onVerified, onCancel };
}

const codeInput = () => screen.getByLabelText(new RegExp(t('auth:stepUp.codeLabel')));
const resendButton = () => screen.getByRole('button', { name: t('auth:stepUp.resend') });
const verifyButton = () => screen.getByRole('button', { name: t('auth:stepUp.submit') });

async function enterCode(code: string) {
  const user = userEvent.setup();
  const input = await screen.findByLabelText(new RegExp(t('auth:stepUp.codeLabel')));
  await user.clear(input);
  await user.type(input, code);
  await user.click(verifyButton());
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

describe('StepUpDialog', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders the step-up title and starts a challenge on open', async () => {
    const authApi = makeAuthApi();
    renderDialog(authApi);

    expect(await screen.findByRole('dialog', { name: t('auth:stepUp.title') })).toBeInTheDocument();
    await waitFor(() => expect(authApi.stepUpStart).toHaveBeenCalledTimes(1));
  });

  it('shows the masked address', async () => {
    renderDialog(makeAuthApi({ stepUpStart: vi.fn().mockResolvedValue(challenge('challenge-1', 'i***@acme.example')) }));

    expect(
      await screen.findByText('We sent a verification code to i***@acme.example. Enter it to continue.'),
    ).toBeInTheDocument();
  });

  it('without a masked address the description stays general', async () => {
    const authApi = makeAuthApi();
    renderDialog(authApi);
    await waitFor(() => expect(authApi.stepUpStart).toHaveBeenCalled());

    expect(screen.getByText(t('auth:stepUp.description'))).toBeInTheDocument();
  });

  it('uses the shared email OTP length bounds on the code field', async () => {
    renderDialog(makeAuthApi());
    const input = await screen.findByLabelText(new RegExp(t('auth:stepUp.codeLabel')));
    expect(input).toHaveAttribute('maxLength', String(EMAIL_OTP_MAX_LENGTH));
    const min: number = EMAIL_OTP_MIN_LENGTH;
    const expectedPattern =
      min === EMAIL_OTP_MAX_LENGTH
        ? `[0-9]{${EMAIL_OTP_MAX_LENGTH}}`
        : `[0-9]{${EMAIL_OTP_MIN_LENGTH},${EMAIL_OTP_MAX_LENGTH}}`;
    expect(input).toHaveAttribute('pattern', expectedPattern);
  });

  it('verifies the code against the started challenge and calls onVerified', async () => {
    const authApi = makeAuthApi();
    const { onVerified } = renderDialog(authApi);
    await waitFor(() => expect(authApi.stepUpStart).toHaveBeenCalled());

    await enterCode(VALID_CODE);

    await waitFor(() => expect(onVerified).toHaveBeenCalledTimes(1));
    expect(authApi.stepUpVerify).toHaveBeenCalledWith('challenge-1', VALID_CODE);
  });

  it('accepts a code of the shortest allowed length', async () => {
    const authApi = makeAuthApi();
    const { onVerified } = renderDialog(authApi);
    await waitFor(() => expect(authApi.stepUpStart).toHaveBeenCalled());

    await enterCode('1'.repeat(EMAIL_OTP_MIN_LENGTH));

    await waitFor(() => expect(onVerified).toHaveBeenCalledTimes(1));
    expect(authApi.stepUpVerify).toHaveBeenCalledWith('challenge-1', '1'.repeat(EMAIL_OTP_MIN_LENGTH));
  });

  it('shows the invalid-code message in the summary and on the field for a wrong code', async () => {
    const authApi = makeAuthApi({
      stepUpVerify: vi.fn().mockRejectedValue(apiError(401, 'invalid_code')),
    });
    const { onVerified } = renderDialog(authApi);
    await waitFor(() => expect(authApi.stepUpStart).toHaveBeenCalled());

    await enterCode(VALID_CODE);

    const message = t('auth:error.invalidCode');
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(message));
    expect(codeInput()).toHaveAccessibleDescription(message);
    expect(screen.queryByText('English invalid_code')).not.toBeInTheDocument();
    expect(onVerified).not.toHaveBeenCalled();
  });

  it('keeps the challenge after one wrong code', async () => {
    const authApi = makeAuthApi({
      stepUpVerify: vi.fn().mockRejectedValueOnce(apiError(401, 'invalid_code')).mockResolvedValue(undefined),
    });
    const { onVerified } = renderDialog(authApi);
    await waitFor(() => expect(authApi.stepUpStart).toHaveBeenCalled());

    await enterCode('2'.repeat(EMAIL_OTP_MAX_LENGTH));
    await screen.findAllByText(t('auth:error.invalidCode'));
    await enterCode(VALID_CODE);

    await waitFor(() => expect(onVerified).toHaveBeenCalledTimes(1));
    expect(authApi.stepUpVerify).toHaveBeenNthCalledWith(2, 'challenge-1', VALID_CODE);
    expect(authApi.stepUpStart).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['invalid_challenge', 401, 'auth:error.challengeExpired'],
    ['expired_code', 401, 'auth:error.challengeExpired'],
    ['too_many_attempts', 429, 'auth:lockout.body'],
  ])('drops the challenge on %s and offers a new one at once', async (code, status, messageKey) => {
    const authApi = makeAuthApi({
      stepUpVerify: vi.fn().mockRejectedValue(apiError(status, code)),
      stepUpStart: vi
        .fn()
        .mockResolvedValueOnce(challenge('challenge-1'))
        .mockResolvedValueOnce(challenge('challenge-new')),
    });
    renderDialog(authApi);
    await waitFor(() => expect(authApi.stepUpStart).toHaveBeenCalledTimes(1));

    const user = await enterCode(VALID_CODE);
    expect(await screen.findAllByText(t(messageKey))).not.toHaveLength(0);

    // The countdown no longer applies: "Send a new code" starts a new challenge, it does not resend.
    expect(resendButton()).toBeEnabled();
    await user.click(resendButton());
    await waitFor(() => expect(authApi.stepUpStart).toHaveBeenCalledTimes(2));
    expect(authApi.stepUpResend).not.toHaveBeenCalled();
  });

  it('after a dropped challenge, Verify asks for a new code without calling the API', async () => {
    const authApi = makeAuthApi({
      stepUpVerify: vi.fn().mockRejectedValue(apiError(401, 'invalid_challenge')),
    });
    renderDialog(authApi);
    await waitFor(() => expect(authApi.stepUpStart).toHaveBeenCalled());

    const user = await enterCode(VALID_CODE);
    await screen.findAllByText(t('auth:error.challengeExpired'));
    await user.click(verifyButton());

    expect(await screen.findAllByText(t('auth:error.challengeExpired'))).not.toHaveLength(0);
    expect(authApi.stepUpVerify).toHaveBeenCalledTimes(1);
  });

  it('rejects a too-short code locally without calling the API', async () => {
    const authApi = makeAuthApi();
    renderDialog(authApi);
    await waitFor(() => expect(authApi.stepUpStart).toHaveBeenCalled());

    await enterCode('1'.repeat(EMAIL_OTP_MIN_LENGTH - 1));

    expect(await screen.findAllByText(t('auth:error.invalidCode'))).not.toHaveLength(0);
    expect(authApi.stepUpVerify).not.toHaveBeenCalled();
  });

  it('shows the lockout message when rate limited', async () => {
    const authApi = makeAuthApi({
      stepUpVerify: vi.fn().mockRejectedValue(apiError(429, 'rate_limited')),
    });
    renderDialog(authApi);
    await waitFor(() => expect(authApi.stepUpStart).toHaveBeenCalled());

    await enterCode(VALID_CODE);

    expect(await screen.findAllByText(t('auth:lockout.body'))).not.toHaveLength(0);
  });

  it('shows the network message when the server cannot be reached', async () => {
    const authApi = makeAuthApi({
      stepUpVerify: vi.fn().mockRejectedValue(apiError(0, 'network')),
    });
    renderDialog(authApi);
    await waitFor(() => expect(authApi.stepUpStart).toHaveBeenCalled());

    await enterCode(VALID_CODE);

    expect(await screen.findAllByText(t('auth:error.network'))).not.toHaveLength(0);
  });

  it('falls back to the unknown-error copy for an unmapped code', async () => {
    const authApi = makeAuthApi({
      stepUpVerify: vi.fn().mockRejectedValue(apiError(500, 'internal_error')),
    });
    renderDialog(authApi);
    await waitFor(() => expect(authApi.stepUpStart).toHaveBeenCalled());

    await enterCode(VALID_CODE);

    expect(await screen.findAllByText(t('auth:error.unknown'))).not.toHaveLength(0);
    expect(screen.queryByText('English internal_error')).not.toBeInTheDocument();
  });

  it('step_up_unavailable renders the unavailable copy', async () => {
    renderDialog(makeAuthApi({ stepUpStart: vi.fn().mockRejectedValue(apiError(403, 'step_up_unavailable')) }));

    expect(
      await screen.findAllByText('Verification is not available for your account. Ask your administrator.'),
    ).not.toHaveLength(0);
    expect(screen.queryByText('English step_up_unavailable')).not.toBeInTheDocument();
  });

  it('a mail that could not be sent (503 unavailable) renders the service copy', async () => {
    renderDialog(makeAuthApi({ stepUpStart: vi.fn().mockRejectedValue(apiError(503, 'unavailable')) }));

    expect(await screen.findAllByText(t('auth:error.unavailable'))).not.toHaveLength(0);
  });

  it('resend is disabled for 60 seconds after the code was sent', async () => {
    vi.useFakeTimers();
    renderDialog(makeAuthApi());
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

  it('resend asks for a new code for the challenge, restarts the countdown and verifies against the answer', async () => {
    vi.useFakeTimers();
    const authApi = makeAuthApi({
      stepUpResend: vi.fn().mockResolvedValue(challenge('challenge-2', 'i***@acme.example')),
    });
    const { onVerified } = renderDialog(authApi);
    await settle();
    secondsPass(60);

    fireEvent.click(resendButton());
    await settle();

    expect(authApi.stepUpResend).toHaveBeenCalledWith('challenge-1');
    expect(authApi.stepUpStart).toHaveBeenCalledTimes(1);
    expect(resendButton()).toBeDisabled();
    expect(screen.getByText('We sent a verification code to i***@acme.example. Enter it to continue.')).toBeInTheDocument();

    fireEvent.change(codeInput(), { target: { value: VALID_CODE } });
    fireEvent.click(verifyButton());
    await settle();

    expect(authApi.stepUpVerify).toHaveBeenCalledWith('challenge-2', VALID_CODE);
    expect(onVerified).toHaveBeenCalledTimes(1);
  });

  it('a resend refused with rate_limited shows how long to wait and keeps the challenge', async () => {
    vi.useFakeTimers();
    const authApi = makeAuthApi({
      stepUpResend: vi.fn().mockRejectedValue(apiError(429, 'rate_limited', { retryAfter: 30 })),
    });
    const { onVerified } = renderDialog(authApi);
    await settle();
    secondsPass(60);

    fireEvent.click(resendButton());
    await settle();

    expect(screen.getAllByText(t('auth:lockout.retryAfter', { minutes: 1 }))).not.toHaveLength(0);
    fireEvent.change(codeInput(), { target: { value: VALID_CODE } });
    fireEvent.click(verifyButton());
    await settle();
    expect(authApi.stepUpVerify).toHaveBeenCalledWith('challenge-1', VALID_CODE);
    expect(onVerified).toHaveBeenCalledTimes(1);
  });

  it('a resend refused with rate_limited counts down from retryAfter before offering it again', async () => {
    vi.useFakeTimers();
    renderDialog(
      makeAuthApi({ stepUpResend: vi.fn().mockRejectedValue(apiError(429, 'rate_limited', { retryAfter: 30 })) }),
    );
    await settle();
    secondsPass(60);

    fireEvent.click(resendButton());
    await settle();

    expect(resendButton()).toBeDisabled();
    expect(screen.getByText(t('auth:otp.resendCountdown', { seconds: 30 }))).toBeInTheDocument();
    secondsPass(29);
    expect(resendButton()).toBeDisabled();
    secondsPass(1);
    expect(resendButton()).toBeEnabled();
  });

  it('does not start twice when the button is clicked twice quickly', async () => {
    const second = pending<ReturnType<typeof challenge>>();
    const stepUpStart = vi
      .fn()
      .mockRejectedValueOnce(apiError(0, 'network'))
      .mockReturnValueOnce(second.promise);
    renderDialog(makeAuthApi({ stepUpStart }));
    await screen.findAllByText(t('auth:error.network'));

    const user = userEvent.setup();
    await user.dblClick(resendButton());

    await waitFor(() => expect(stepUpStart).toHaveBeenCalledTimes(2));
    await act(async () => {
      second.resolve(challenge('challenge-2'));
    });
    expect(stepUpStart).toHaveBeenCalledTimes(2);
  });

  it('Verify is disabled while a resend is in flight', async () => {
    vi.useFakeTimers();
    const resend = pending<ReturnType<typeof challenge>>();
    const authApi = makeAuthApi({ stepUpResend: vi.fn().mockReturnValue(resend.promise) });
    renderDialog(authApi);
    await settle();
    secondsPass(60);

    fireEvent.click(resendButton());
    await settle();

    expect(verifyButton()).toBeDisabled();
    fireEvent.change(codeInput(), { target: { value: VALID_CODE } });
    fireEvent.submit(verifyButton().closest('form')!);
    await settle();
    expect(authApi.stepUpVerify).not.toHaveBeenCalled();

    await act(async () => {
      resend.resolve(challenge('challenge-2'));
    });
    expect(verifyButton()).toBeEnabled();
  });

  it('Cancel is disabled while verifying, and so is resend', async () => {
    vi.useFakeTimers();
    const verify = pending<undefined>();
    const authApi = makeAuthApi({ stepUpVerify: vi.fn().mockReturnValue(verify.promise) });
    const { onCancel, onVerified } = renderDialog(authApi);
    await settle();
    secondsPass(60);
    expect(resendButton()).toBeEnabled();

    fireEvent.change(codeInput(), { target: { value: VALID_CODE } });
    fireEvent.click(verifyButton());
    await settle();

    const cancel = screen.getByRole('button', { name: t('auth:stepUp.cancel') });
    expect(cancel).toBeDisabled();
    expect(resendButton()).toBeDisabled();
    fireEvent.click(cancel);
    expect(onCancel).not.toHaveBeenCalled();

    await act(async () => {
      verify.resolve(undefined);
    });
    expect(onVerified).toHaveBeenCalledTimes(1);
  });

  it('reopened while a verify of the previous opening is in flight, it starts a new challenge and ignores the old answer', async () => {
    const firstVerify = pending<undefined>();
    const stepUpVerify = vi.fn().mockReturnValueOnce(firstVerify.promise).mockResolvedValue(undefined);
    const stepUpStart = vi
      .fn()
      .mockResolvedValueOnce(challenge('challenge-1'))
      .mockResolvedValueOnce(challenge('challenge-2'));
    const authApi = makeAuthApi({ stepUpStart, stepUpVerify });
    const onVerified = vi.fn();
    const dialog = (open: boolean) => (
      <I18nextProvider i18n={testI18n}>
        <StepUpDialog open={open} authApi={authApi} onVerified={onVerified} onCancel={vi.fn()} />
      </I18nextProvider>
    );
    const { rerender } = render(dialog(true));
    await waitFor(() => expect(stepUpStart).toHaveBeenCalledTimes(1));
    await enterCode(VALID_CODE);
    await waitFor(() => expect(stepUpVerify).toHaveBeenCalledTimes(1));

    // Closed (the dialog's close button stays available during a verify) and opened again.
    rerender(dialog(false));
    rerender(dialog(true));
    await waitFor(() => expect(stepUpStart).toHaveBeenCalledTimes(2));

    // The first verify answers late: it belongs to the closed opening.
    await act(async () => {
      firstVerify.resolve(undefined);
    });
    expect(onVerified).not.toHaveBeenCalled();

    await enterCode(VALID_CODE);
    await waitFor(() => expect(onVerified).toHaveBeenCalledTimes(1));
    expect(stepUpVerify).toHaveBeenLastCalledWith('challenge-2', VALID_CODE);
  });

  it('calls onCancel from the cancel button', async () => {
    const authApi = makeAuthApi();
    const { onCancel, onVerified } = renderDialog(authApi);
    await waitFor(() => expect(authApi.stepUpStart).toHaveBeenCalled());

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: t('auth:stepUp.cancel') }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onVerified).not.toHaveBeenCalled();
  });
});
