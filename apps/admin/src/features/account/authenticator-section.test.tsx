import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthenticatorSection } from './authenticator-section';
import {
  EMPLOYEE,
  apiError,
  makeAccountApi,
  makeAuth,
  passwordPrincipal,
  renderAccount,
  t,
} from './account-test-harness';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const setUpButton = () => screen.findByRole('button', { name: t('auth:account.authenticator.setUp') });
const codeInput = () => screen.getByLabelText(new RegExp(t('auth:account.authenticator.codeLabel')));

describe('AuthenticatorSection', () => {
  it('is not shown to email-code users', async () => {
    renderAccount(
      <>
        <p>ready</p>
        <AuthenticatorSection authApi={makeAccountApi()} sampleMode={false} />
      </>,
      makeAuth({ principal: EMPLOYEE }),
    );
    await screen.findByText('ready');
    expect(screen.queryByText(t('auth:account.authenticator.title'))).not.toBeInTheDocument();
  });

  it('shows "Authenticator enabled" when the session has a second factor', async () => {
    renderAccount(
      <AuthenticatorSection authApi={makeAccountApi()} sampleMode={false} />,
      makeAuth({ principal: passwordPrincipal(true) }),
    );
    expect(await screen.findByText(t('auth:account.authenticator.enabled'))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('auth:account.authenticator.setUp') })).not.toBeInTheDocument();
  });

  it('enrols: key and code, confirm, success state and principal reload', async () => {
    const user = userEvent.setup();
    const authApi = makeAccountApi();
    const auth = makeAuth({ principal: passwordPrincipal(false) });
    renderAccount(<AuthenticatorSection authApi={authApi} sampleMode={false} />, auth);
    await user.click(await setUpButton());
    expect(authApi.totpEnrolSignedIn).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(t('auth:totpEnrol.manualKey', { key: 'JBSWY3DPEHPK3PXP' }))).toBeInTheDocument();
    await user.type(codeInput(), '123456');
    await user.click(screen.getByRole('button', { name: t('auth:account.authenticator.confirm') }));
    await waitFor(() => expect(authApi.totpConfirm).toHaveBeenCalledWith('123456'));
    expect(await screen.findByText(t('auth:account.authenticator.success'))).toBeInTheDocument();
    expect(auth.refreshPrincipal).toHaveBeenCalled();
  });

  it('checks the code length before calling the API', async () => {
    const user = userEvent.setup();
    const authApi = makeAccountApi();
    renderAccount(
      <AuthenticatorSection authApi={authApi} sampleMode={false} />,
      makeAuth({ principal: passwordPrincipal(false) }),
    );
    await user.click(await setUpButton());
    await screen.findByText(t('auth:totpEnrol.manualKey', { key: 'JBSWY3DPEHPK3PXP' }));
    await user.type(codeInput(), '123');
    await user.click(screen.getByRole('button', { name: t('auth:account.authenticator.confirm') }));
    expect((await screen.findAllByText(t('auth:error.invalidCode'))).length).toBeGreaterThan(0);
    expect(authApi.totpConfirm).not.toHaveBeenCalled();
  });

  it.each([
    [apiError(409, 'totp_already_enrolled'), 'auth:account.errors.alreadyEnrolled'],
    [apiError(503, 'unavailable'), 'auth:error.unavailable'],
    [apiError(429, 'rate_limited'), 'auth:account.errors.rateLimited'],
    [apiError(500, 'weird'), 'auth:error.unknown'],
  ])('shows translated copy when enrolment cannot start (%o)', async (error, key) => {
    const user = userEvent.setup();
    const authApi = makeAccountApi({ totpEnrolSignedIn: vi.fn().mockRejectedValue(error) });
    renderAccount(
      <AuthenticatorSection authApi={authApi} sampleMode={false} />,
      makeAuth({ principal: passwordPrincipal(false) }),
    );
    await user.click(await setUpButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(t(key));
  });

  it.each([
    [apiError(400, 'invalid_code'), 'auth:error.invalidCode'],
    [apiError(401, 'session_required'), 'auth:error.expired'],
    [apiError(500, 'weird'), 'auth:error.unknown'],
  ])('shows translated copy when the code is refused (%o)', async (error, key) => {
    const user = userEvent.setup();
    const authApi = makeAccountApi({ totpConfirm: vi.fn().mockRejectedValue(error) });
    renderAccount(
      <AuthenticatorSection authApi={authApi} sampleMode={false} />,
      makeAuth({ principal: passwordPrincipal(false) }),
    );
    await user.click(await setUpButton());
    await screen.findByText(t('auth:totpEnrol.manualKey', { key: 'JBSWY3DPEHPK3PXP' }));
    await user.type(codeInput(), '654321');
    await user.click(screen.getByRole('button', { name: t('auth:account.authenticator.confirm') }));
    expect((await screen.findAllByText(t(key))).length).toBeGreaterThan(0);
    expect(screen.queryByText(t('auth:account.authenticator.success'))).not.toBeInTheDocument();
  });

  it('cannot start enrolment in sample mode', async () => {
    const authApi = makeAccountApi();
    renderAccount(
      <AuthenticatorSection authApi={authApi} sampleMode />,
      makeAuth({ principal: passwordPrincipal(false) }),
    );
    expect(await setUpButton()).toBeDisabled();
    expect(screen.getByText(t('auth:account.authenticator.sampleNote'))).toBeInTheDocument();
  });
});
