import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
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
const t = (key: string) => testI18n.t(key);

const VALID_CODE = '1'.repeat(EMAIL_OTP_MAX_LENGTH);

function apiError(status: number, code: string, details?: Record<string, unknown>): ApiError {
  return new ApiError({ status, code, message: `English ${code}`, requestId: null, details });
}

function makeAuthApi(overrides: Partial<AuthApi> = {}): AuthApi {
  return {
    stepUpStart: vi.fn().mockResolvedValue({
      method: 'email_otp',
      challengeToken: 'challenge-1',
      ssoStartUrl: null,
    }),
    stepUpVerify: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as AuthApi;
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

async function enterCode(code: string) {
  const user = userEvent.setup();
  const input = await screen.findByLabelText(new RegExp(t('auth:stepUp.codeLabel')));
  await user.type(input, code);
  await user.click(screen.getByRole('button', { name: t('auth:stepUp.submit') }));
  return user;
}

describe('StepUpDialog', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders the step-up title and starts a challenge on open', async () => {
    const authApi = makeAuthApi();
    renderDialog(authApi);

    expect(await screen.findByRole('dialog', { name: t('auth:stepUp.title') })).toBeInTheDocument();
    await waitFor(() => expect(authApi.stepUpStart).toHaveBeenCalledTimes(1));
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

  it('shows the invalid-code message in the summary and on the field for a wrong code', async () => {
    const authApi = makeAuthApi({
      stepUpVerify: vi.fn().mockRejectedValue(apiError(401, 'invalid_code')),
    });
    const { onVerified } = renderDialog(authApi);
    await waitFor(() => expect(authApi.stepUpStart).toHaveBeenCalled());

    await enterCode(VALID_CODE);

    const message = t('auth:error.invalidCode');
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(message));
    expect(screen.getByLabelText(new RegExp(t('auth:stepUp.codeLabel')))).toHaveAccessibleDescription(
      message,
    );
    expect(screen.queryByText('English invalid_code')).not.toBeInTheDocument();
    expect(onVerified).not.toHaveBeenCalled();
  });

  it('asks for a new code after a wrong code instead of re-sending the consumed challenge', async () => {
    const authApi = makeAuthApi({
      stepUpVerify: vi.fn().mockRejectedValueOnce(apiError(401, 'invalid_code')),
    });
    renderDialog(authApi);
    await waitFor(() => expect(authApi.stepUpStart).toHaveBeenCalled());

    const user = await enterCode(VALID_CODE);
    await screen.findAllByText(t('auth:error.invalidCode'));
    await user.click(screen.getByRole('button', { name: t('auth:stepUp.submit') }));

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

  it('shows the expired-challenge message for invalid_challenge', async () => {
    const authApi = makeAuthApi({
      stepUpVerify: vi.fn().mockRejectedValue(apiError(401, 'invalid_challenge')),
    });
    renderDialog(authApi);
    await waitFor(() => expect(authApi.stepUpStart).toHaveBeenCalled());

    await enterCode(VALID_CODE);

    expect(await screen.findAllByText(t('auth:error.challengeExpired'))).not.toHaveLength(0);
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

  it('shows the unavailable message when the account cannot step up', async () => {
    const authApi = makeAuthApi({
      stepUpStart: vi.fn().mockRejectedValue(apiError(403, 'forbidden')),
    });
    renderDialog(authApi);

    expect(await screen.findAllByText(t('auth:stepUp.unavailable'))).not.toHaveLength(0);
  });

  it('sends a new code on resend and verifies against the new challenge', async () => {
    const stepUpStart = vi
      .fn()
      .mockResolvedValueOnce({ method: 'email_otp', challengeToken: 'challenge-1', ssoStartUrl: null })
      .mockResolvedValueOnce({ method: 'email_otp', challengeToken: 'challenge-2', ssoStartUrl: null });
    const authApi = makeAuthApi({ stepUpStart });
    const { onVerified } = renderDialog(authApi);
    await waitFor(() => expect(stepUpStart).toHaveBeenCalledTimes(1));

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: t('auth:stepUp.resend') }));
    await waitFor(() => expect(stepUpStart).toHaveBeenCalledTimes(2));

    await enterCode(VALID_CODE);

    await waitFor(() => expect(onVerified).toHaveBeenCalled());
    expect(authApi.stepUpVerify).toHaveBeenCalledWith('challenge-2', VALID_CODE);
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
