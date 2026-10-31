import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { OpsAdminApi } from '@nestself/api-client';
import type { SsoConnectionResponse, SsoConnectionStatus } from '@nestself/contracts';
import { ConnectionDetail } from './connection-detail';
import { apiError, renderOps, t } from '../organizations/ops-test-harness';
import { START_URL, ssoApi, ssoConnection, ssoDomain } from './sso-test-harness';

const NEXT_START_URL = 'http://localhost:4000/api/auth/sso/start?connection=org-c1-saml&surface=workspace&testNonce=def';

const connectionIn = (status: SsoConnectionStatus) =>
  ssoConnection('c1', { status, cognitoProviderName: 'org-c1-saml', domains: [ssoDomain('d1', 'acme.example', true)] });

function renderDetail(connection: SsoConnectionResponse, opts: { opsApi?: OpsAdminApi; sampleMode?: boolean } = {}) {
  const onClose = vi.fn();
  const result = renderOps(
    (opsApi) => (
      <ConnectionDetail
        connection={connection}
        organizationName="Example d.o.o."
        opsApi={opsApi}
        sampleMode={opts.sampleMode ?? false}
        onClose={onClose}
      />
    ),
    { opsApi: opts.opsApi ?? ssoApi() },
  );
  return { ...result, onClose };
}

const detail = () => screen.findByTestId('sso-detail-c1');
const button = (scope: HTMLElement, key: string) => within(scope).getByRole('button', { name: t(key) });
const testLink = (scope: HTMLElement) => within(scope).getByRole('link', { name: t('admin:sso.actions.testLink') });

let openSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
});
afterEach(() => {
  openSpy.mockRestore();
});

describe('ConnectionDetail test sign-in', () => {
  it('renders the link as an anchor for staff to open themselves and does not call window.open', async () => {
    const user = userEvent.setup();
    const { opsApi } = renderDetail(connectionIn('TESTING'));
    const scope = await detail();

    await user.click(button(scope, 'admin:sso.actions.test'));

    const link = await within(scope).findByRole('link', { name: t('admin:sso.actions.testLink') });
    expect(opsApi.testSsoConnection).toHaveBeenCalledWith('c1');
    expect(link).toHaveAttribute('href', START_URL);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('says the link is single use and valid for 15 minutes', async () => {
    const user = userEvent.setup();
    renderDetail(connectionIn('DRAFT'));
    const scope = await detail();

    await user.click(button(scope, 'admin:sso.actions.test'));

    expect(await within(scope).findByText(t('admin:sso.actions.testLinkNote'))).toBeInTheDocument();
    expect(t('admin:sso.actions.testLinkNote')).toBe('Single use, valid 15 minutes.');
  });

  it('can be copied instead of opened', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderDetail(connectionIn('TESTING'));
    const scope = await detail();
    await user.click(button(scope, 'admin:sso.actions.test'));
    await within(scope).findByRole('link', { name: t('admin:sso.actions.testLink') });

    await user.click(
      within(scope).getByRole('button', { name: t('admin:sso.copy.label', { label: t('admin:sso.actions.testLinkLabel') }) }),
    );

    expect(writeText).toHaveBeenCalledWith(START_URL);
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('mints another link on New test link and shows only that one', async () => {
    const user = userEvent.setup();
    const testSsoConnection = vi
      .fn()
      .mockResolvedValueOnce({ startUrl: START_URL })
      .mockResolvedValueOnce({ startUrl: NEXT_START_URL });
    renderDetail(connectionIn('TESTING'), { opsApi: ssoApi({ testSsoConnection }) });
    const scope = await detail();
    await user.click(button(scope, 'admin:sso.actions.test'));
    await within(scope).findByRole('link', { name: t('admin:sso.actions.testLink') });

    await user.click(button(scope, 'admin:sso.actions.newTestLink'));

    await waitFor(() => expect(testLink(scope)).toHaveAttribute('href', NEXT_START_URL));
    expect(testSsoConnection).toHaveBeenCalledTimes(2);
    expect(document.querySelector(`a[href="${START_URL}"]`)).toBeNull();
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('does not offer New test link before a link was minted', async () => {
    renderDetail(connectionIn('TESTING'));
    const scope = await detail();
    expect(within(scope).queryByRole('button', { name: t('admin:sso.actions.newTestLink') })).not.toBeInTheDocument();
  });

  it('keeps the single-use link out of the mutation state', async () => {
    const user = userEvent.setup();
    const { queryClient } = renderDetail(connectionIn('TESTING'));
    const scope = await detail();

    await user.click(button(scope, 'admin:sso.actions.test'));
    await within(scope).findByRole('link', { name: t('admin:sso.actions.testLink') });

    await waitFor(() =>
      expect(
        queryClient
          .getMutationCache()
          .getAll()
          .filter((m) => JSON.stringify(m.state.data ?? null).includes('testNonce')),
      ).toHaveLength(0),
    );
  });

  it.each([
    [apiError(422, 'validation', { field: 'metadataUrl', reason: 'private_address' }), 'admin:sso.errors.urlNotPublic'],
    [apiError(422, 'validation', { field: 'oidcIssuer', reason: 'host' }), 'admin:sso.errors.urlNotPublic'],
    [apiError(503, 'unavailable'), 'admin:sso.errors.unavailable'],
  ])('renders a refused test (%s) as translated copy and shows no link', async (err, key) => {
    const user = userEvent.setup();
    renderDetail(connectionIn('TESTING'), { opsApi: ssoApi({ testSsoConnection: vi.fn().mockRejectedValue(err) }) });
    const scope = await detail();

    await user.click(button(scope, 'admin:sso.actions.test'));

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(t(key))).toBeInTheDocument();
    expect(within(alert).queryByText(/English/)).not.toBeInTheDocument();
    expect(within(scope).queryByRole('link', { name: t('admin:sso.actions.testLink') })).not.toBeInTheDocument();
    expect(openSpy).not.toHaveBeenCalled();
  });
});

describe('ConnectionDetail reset to draft', () => {
  it.each<SsoConnectionStatus>(['DRAFT', 'ACTIVE', 'SUSPENDED'])('is not offered on a %s connection', async (status) => {
    renderDetail(connectionIn(status));
    const scope = await detail();
    expect(within(scope).queryByRole('button', { name: t('admin:sso.actions.reset') })).not.toBeInTheDocument();
  });

  it('asks first, then PATCHes the status to DRAFT and says so', async () => {
    const user = userEvent.setup();
    const { opsApi } = renderDetail(connectionIn('TESTING'));
    const scope = await detail();

    await user.click(button(scope, 'admin:sso.actions.reset'));

    const confirm = await screen.findByRole('alertdialog', { name: t('admin:sso.actions.resetTitle') });
    expect(within(confirm).getByText(t('admin:sso.actions.resetConfirm', { provider: 'org-c1-saml' }))).toBeInTheDocument();
    expect(opsApi.updateSsoConnection).not.toHaveBeenCalled();

    await user.click(within(confirm).getByRole('button', { name: t('admin:sso.actions.reset') }));

    await waitFor(() => expect(opsApi.updateSsoConnection).toHaveBeenCalledWith('c1', { status: 'DRAFT' }));
    expect(opsApi.updateSsoConnection).toHaveBeenCalledTimes(1);
    expect(await screen.findAllByText(t('admin:sso.actions.resetDone'))).not.toHaveLength(0);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  it('leaves the connection alone when the confirmation is cancelled', async () => {
    const user = userEvent.setup();
    const { opsApi } = renderDetail(connectionIn('TESTING'));
    const scope = await detail();
    await user.click(button(scope, 'admin:sso.actions.reset'));
    const confirm = await screen.findByRole('alertdialog', { name: t('admin:sso.actions.resetTitle') });

    await user.click(within(confirm).getByRole('button', { name: t('admin:sso.cancel') }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(opsApi.updateSsoConnection).not.toHaveBeenCalled();
  });

  it('keeps the confirmation open with the message when the reset is refused', async () => {
    const user = userEvent.setup();
    const updateSsoConnection = vi.fn().mockRejectedValue(apiError(409, 'sso_connection_state'));
    renderDetail(connectionIn('TESTING'), { opsApi: ssoApi({ updateSsoConnection }) });
    const scope = await detail();
    await user.click(button(scope, 'admin:sso.actions.reset'));
    const confirm = await screen.findByRole('alertdialog', { name: t('admin:sso.actions.resetTitle') });

    await user.click(within(confirm).getByRole('button', { name: t('admin:sso.actions.reset') }));

    expect(await within(confirm).findByText(t('admin:sso.errors.connectionState'))).toBeInTheDocument();
    expect(screen.getByRole('alertdialog', { name: t('admin:sso.actions.resetTitle') })).toBeInTheDocument();
    expect(within(confirm).queryByText(/English/)).not.toBeInTheDocument();
  });

  it('drops the test link, which no longer fits the provider that was deleted', async () => {
    const user = userEvent.setup();
    renderDetail(connectionIn('TESTING'));
    const scope = await detail();
    await user.click(button(scope, 'admin:sso.actions.test'));
    await within(scope).findByRole('link', { name: t('admin:sso.actions.testLink') });
    await user.click(button(scope, 'admin:sso.actions.reset'));
    const confirm = await screen.findByRole('alertdialog', { name: t('admin:sso.actions.resetTitle') });

    await user.click(within(confirm).getByRole('button', { name: t('admin:sso.actions.reset') }));

    await waitFor(() => expect(within(scope).queryByRole('link', { name: t('admin:sso.actions.testLink') })).not.toBeInTheDocument());
  });

  it('is disabled in sample mode', async () => {
    renderDetail(connectionIn('TESTING'), { sampleMode: true });
    const scope = await detail();
    expect(button(scope, 'admin:sso.actions.reset')).toBeDisabled();
  });
});
