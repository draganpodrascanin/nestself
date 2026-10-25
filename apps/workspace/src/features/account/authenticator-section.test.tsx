import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, screen, waitFor } from '@testing-library/react';
import type { QueryClient } from '@tanstack/react-query';
import type { TotpEnrolResponse } from '@nestself/contracts';
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

const SECRET_URI = 'otpauth://totp/NestSelf:nikola?secret=JBSWY3DPEHPK3PXP';

/** Mutations in the cache whose result still carries the authenticator secret. */
const cachedSecrets = (queryClient: QueryClient) =>
  queryClient
    .getMutationCache()
    .getAll()
    .filter((m) => typeof m.state.data === 'object' && m.state.data !== null && 'secretUri' in m.state.data);

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

  it('drops the secret from the mutation cache on Cancel', async () => {
    const user = userEvent.setup();
    const { queryClient } = renderAccount(
      <AuthenticatorSection authApi={makeAccountApi()} sampleMode={false} />,
      makeAuth({ principal: passwordPrincipal(false) }),
    );
    await user.click(await setUpButton());
    await screen.findByText(t('auth:totpEnrol.manualKey', { key: 'JBSWY3DPEHPK3PXP' }));
    expect(cachedSecrets(queryClient)).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: t('auth:account.authenticator.cancel') }));
    expect(await setUpButton()).toBeInTheDocument();
    expect(screen.queryByText(/JBSWY3DPEHPK3PXP/)).not.toBeInTheDocument();
    await waitFor(() => expect(cachedSecrets(queryClient)).toHaveLength(0));
  });

  it('drops the secret from the mutation cache after a successful confirm', async () => {
    const user = userEvent.setup();
    const { queryClient } = renderAccount(
      <AuthenticatorSection authApi={makeAccountApi()} sampleMode={false} />,
      makeAuth({ principal: passwordPrincipal(false) }),
    );
    await user.click(await setUpButton());
    await screen.findByText(t('auth:totpEnrol.manualKey', { key: 'JBSWY3DPEHPK3PXP' }));
    await user.type(codeInput(), '123456');
    await user.click(screen.getByRole('button', { name: t('auth:account.authenticator.confirm') }));
    expect(await screen.findByText(t('auth:account.authenticator.success'))).toBeInTheDocument();
    expect(screen.queryByText(/JBSWY3DPEHPK3PXP/)).not.toBeInTheDocument();
    await waitFor(() => expect(queryClient.getMutationCache().getAll()).toHaveLength(0));
  });

  it('drops the secret from the mutation cache on unmount', async () => {
    const user = userEvent.setup();
    const { queryClient } = renderAccount(
      <AuthenticatorSection authApi={makeAccountApi()} sampleMode={false} />,
      makeAuth({ principal: passwordPrincipal(false) }),
    );
    await user.click(await setUpButton());
    await screen.findByText(t('auth:totpEnrol.manualKey', { key: 'JBSWY3DPEHPK3PXP' }));
    cleanup();
    await waitFor(() => expect(cachedSecrets(queryClient)).toHaveLength(0));
  });

  it('ignores an enrol result that arrives after Cancel', async () => {
    const user = userEvent.setup();
    let resolveEnrol!: (value: TotpEnrolResponse) => void;
    const authApi = makeAccountApi({
      totpEnrolSignedIn: vi.fn(
        () =>
          new Promise<TotpEnrolResponse>((resolve) => {
            resolveEnrol = resolve;
          }),
      ),
    });
    const { queryClient } = renderAccount(
      <AuthenticatorSection authApi={authApi} sampleMode={false} />,
      makeAuth({ principal: passwordPrincipal(false) }),
    );
    await user.click(await setUpButton());
    expect(await screen.findByText(t('auth:account.authenticator.preparing'))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('auth:account.authenticator.cancel') }));
    await act(async () => {
      resolveEnrol({ secretUri: SECRET_URI, challengeToken: null });
    });
    expect(await setUpButton()).toBeInTheDocument();
    expect(screen.queryByText(/JBSWY3DPEHPK3PXP/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(new RegExp(t('auth:account.authenticator.codeLabel')))).not.toBeInTheDocument();
    await waitFor(() => expect(cachedSecrets(queryClient)).toHaveLength(0));
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
