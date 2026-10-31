import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UserEvent } from '@testing-library/user-event';
import type { QueryClient } from '@tanstack/react-query';
import type { OpsAdminApi } from '@nestself/api-client';
import type { SsoConnectionResponse, SsoConnectionStatus } from '@nestself/contracts';
import { EditConnectionDialog } from './edit-connection-dialog';
import { apiError, makeAuth, renderOps, t } from '../organizations/ops-test-harness';
import type { AuthContextValue } from '../../auth';
import { oidcConnection, ssoApi, ssoConnection } from './sso-test-harness';

const SECRET = 'rotated-secret-value';

function renderDialog(connection: SsoConnectionResponse, opts: { opsApi?: OpsAdminApi; auth?: AuthContextValue } = {}) {
  const onOpenChange = vi.fn();
  const result = renderOps(
    (opsApi) => <EditConnectionDialog open onOpenChange={onOpenChange} connection={connection} opsApi={opsApi} />,
    { opsApi: opts.opsApi ?? ssoApi(), ...(opts.auth ? { auth: opts.auth } : {}) },
  );
  return { ...result, onOpenChange };
}

const openDialog = () => screen.findByRole('dialog', { name: t('admin:sso.edit.title') });
const field = (dialog: HTMLElement, key: string) => within(dialog).getByLabelText(t(key), { exact: false });
const radio = (dialog: HTMLElement, protocol: 'SAML' | 'OIDC') =>
  within(dialog).getByRole('radio', { name: t(`admin:sso.protocols.${protocol}`) });
const claimSwitch = (dialog: HTMLElement) =>
  within(dialog).getByRole('switch', { name: t('admin:sso.create.oidcClaimRequired') });
const save = (user: UserEvent, dialog: HTMLElement) =>
  user.click(within(dialog).getByRole('button', { name: t('admin:sso.edit.submit') }));

const mutationsHolding = (queryClient: QueryClient, secret: string) =>
  queryClient
    .getMutationCache()
    .getAll()
    .filter((m) => JSON.stringify(m.state.variables ?? null).includes(secret));

describe('EditConnectionDialog', () => {
  describe('protocol', () => {
    it('can be chosen while the connection is a draft', async () => {
      renderDialog(ssoConnection('c1'));
      const dialog = await openDialog();
      expect(radio(dialog, 'SAML')).toBeChecked();
      expect(radio(dialog, 'SAML')).not.toHaveAttribute('aria-disabled', 'true');
      expect(radio(dialog, 'OIDC')).not.toHaveAttribute('aria-disabled', 'true');
      expect(within(dialog).queryByText(t('admin:sso.edit.protocolLocked'))).not.toBeInTheDocument();
    });

    it.each<SsoConnectionStatus>(['TESTING', 'ACTIVE', 'SUSPENDED'])('is fixed, with the reason, once the connection is %s', async (status) => {
      renderDialog(ssoConnection('c1', { status }));
      const dialog = await openDialog();
      expect(radio(dialog, 'SAML')).toHaveAttribute('aria-disabled', 'true');
      expect(radio(dialog, 'OIDC')).toHaveAttribute('aria-disabled', 'true');
      expect(within(dialog).getByText(t('admin:sso.edit.protocolLocked'))).toBeInTheDocument();
    });

    it('sends the new protocol with its settings when a SAML draft becomes OIDC', async () => {
      const user = userEvent.setup();
      const { opsApi } = renderDialog(ssoConnection('c1'));
      const dialog = await openDialog();

      await user.click(radio(dialog, 'OIDC'));

      expect(within(dialog).queryByLabelText(t('admin:sso.create.metadataUrl'), { exact: false })).not.toBeInTheDocument();
      await user.type(field(dialog, 'admin:sso.create.oidcIssuer'), 'https://login.acme.test');
      await user.type(field(dialog, 'admin:sso.create.oidcClientId'), 'client-9');
      await user.type(field(dialog, 'admin:sso.edit.secretReplace'), SECRET);
      await save(user, dialog);

      await waitFor(() =>
        expect(opsApi.updateSsoConnection).toHaveBeenCalledWith('c1', {
          protocol: 'OIDC',
          oidcIssuer: 'https://login.acme.test',
          oidcClientId: 'client-9',
          oidcClientSecret: SECRET,
        }),
      );
    });

    it('sends the new protocol with its settings when an OIDC draft becomes SAML', async () => {
      const user = userEvent.setup();
      const { opsApi } = renderDialog(oidcConnection('c1'));
      const dialog = await openDialog();

      await user.click(radio(dialog, 'SAML'));

      expect(within(dialog).queryByLabelText(t('admin:sso.create.oidcIssuer'), { exact: false })).not.toBeInTheDocument();
      await user.type(field(dialog, 'admin:sso.create.metadataUrl'), 'https://idp.acme.test/metadata');
      await save(user, dialog);

      await waitFor(() =>
        expect(opsApi.updateSsoConnection).toHaveBeenCalledWith('c1', { protocol: 'SAML', metadataUrl: 'https://idp.acme.test/metadata' }),
      );
    });

    it('asks a SAML draft that becomes OIDC for the issuer and the client ID before calling the API', async () => {
      const user = userEvent.setup();
      const { opsApi } = renderDialog(ssoConnection('c1'));
      const dialog = await openDialog();

      await user.click(radio(dialog, 'OIDC'));
      await save(user, dialog);

      expect(await within(dialog).findAllByText(t('admin:sso.errors.urlInvalid'))).not.toHaveLength(0);
      expect(within(dialog).getAllByText(t('admin:sso.errors.clientIdRequired'))).not.toHaveLength(0);
      expect(opsApi.updateSsoConnection).not.toHaveBeenCalled();
    });

    it('asks an OIDC draft that becomes SAML for its metadata before calling the API', async () => {
      const user = userEvent.setup();
      const { opsApi } = renderDialog(oidcConnection('c1'));
      const dialog = await openDialog();

      await user.click(radio(dialog, 'SAML'));
      await save(user, dialog);

      expect(await within(dialog).findAllByText(t('admin:sso.errors.fieldSamlMetadata'))).not.toHaveLength(0);
      expect(opsApi.updateSsoConnection).not.toHaveBeenCalled();
    });

    it('renders a refused protocol change at the protocol field', async () => {
      const user = userEvent.setup();
      const updateSsoConnection = vi.fn().mockRejectedValue(apiError(422, 'validation', { field: 'protocol' }));
      renderDialog(oidcConnection('c1'), { opsApi: ssoApi({ updateSsoConnection }) });
      const dialog = await openDialog();
      await user.click(radio(dialog, 'SAML'));
      await user.type(field(dialog, 'admin:sso.create.metadataUrl'), 'https://idp.acme.test/metadata');

      await save(user, dialog);

      // Under the radios, and listed in the error summary with a link to them.
      expect(await within(dialog).findByText(t('admin:sso.errors.fieldProtocol'))).toBeInTheDocument();
      expect(within(dialog).getByRole('link', { name: t('admin:sso.create.protocol') })).toBeInTheDocument();
      expect(within(dialog).queryByText(/English/)).not.toBeInTheDocument();
    });

    it('renders a protocol change that another organization blocks at the protocol field', async () => {
      const user = userEvent.setup();
      const updateSsoConnection = vi
        .fn()
        .mockRejectedValue(apiError(409, 'conflict', { reason: 'provider_name_taken', field: 'protocol' }));
      renderDialog(oidcConnection('c1'), { opsApi: ssoApi({ updateSsoConnection }) });
      const dialog = await openDialog();
      await user.click(radio(dialog, 'SAML'));
      await user.type(field(dialog, 'admin:sso.create.metadataUrl'), 'https://idp.acme.test/metadata');

      await save(user, dialog);

      expect(await within(dialog).findByText(t('admin:sso.errors.conflictProviderNameReserved'))).toBeInTheDocument();
      expect(within(dialog).getByRole('link', { name: t('admin:sso.create.protocol') })).toBeInTheDocument();
    });
  });

  describe('verified email claim', () => {
    it('is offered for an OIDC connection and shows the stored value', async () => {
      renderDialog(oidcConnection('c1', { oidcEmailVerifiedClaimRequired: false }));
      const dialog = await openDialog();
      expect(claimSwitch(dialog)).not.toBeChecked();
      expect(within(dialog).getByText(t('admin:sso.create.oidcClaimRequiredHint'))).toBeInTheDocument();
    });

    it('is not offered for a SAML connection', async () => {
      renderDialog(ssoConnection('c1'));
      const dialog = await openDialog();
      expect(within(dialog).queryByRole('switch', { name: t('admin:sso.create.oidcClaimRequired') })).not.toBeInTheDocument();
    });

    it('PATCHes the flag alone, without a secret or any other field', async () => {
      const user = userEvent.setup();
      const { opsApi } = renderDialog(oidcConnection('c1'));
      const dialog = await openDialog();
      expect(claimSwitch(dialog)).toBeChecked();

      await user.click(claimSwitch(dialog));
      await save(user, dialog);

      await waitFor(() => expect(opsApi.updateSsoConnection).toHaveBeenCalledWith('c1', { oidcEmailVerifiedClaimRequired: false }));
    });

    it('turns back on with the flag alone', async () => {
      const user = userEvent.setup();
      const { opsApi } = renderDialog(oidcConnection('c1', { oidcEmailVerifiedClaimRequired: false }));
      const dialog = await openDialog();

      await user.click(claimSwitch(dialog));
      await save(user, dialog);

      await waitFor(() => expect(opsApi.updateSsoConnection).toHaveBeenCalledWith('c1', { oidcEmailVerifiedClaimRequired: true }));
    });

    it('is not sent when it was not changed', async () => {
      const user = userEvent.setup();
      const { opsApi } = renderDialog(oidcConnection('c1'));
      const dialog = await openDialog();

      await save(user, dialog);

      expect(await within(dialog).findByText(t('admin:sso.errors.nothingChanged'))).toBeInTheDocument();
      expect(opsApi.updateSsoConnection).not.toHaveBeenCalled();
    });

    it('goes with a new client secret in one request on a draft', async () => {
      const user = userEvent.setup();
      const { opsApi } = renderDialog(oidcConnection('c1'));
      const dialog = await openDialog();

      await user.type(field(dialog, 'admin:sso.edit.secretReplace'), SECRET);
      await user.click(claimSwitch(dialog));
      await save(user, dialog);

      await waitFor(() =>
        expect(opsApi.updateSsoConnection).toHaveBeenCalledWith('c1', { oidcClientSecret: SECRET, oidcEmailVerifiedClaimRequired: false }),
      );
    });
  });

  describe('write-only client secret', () => {
    it('is cleared from the form and the mutation state when the update fails', async () => {
      const user = userEvent.setup();
      const updateSsoConnection = vi.fn().mockRejectedValue(apiError(409, 'conflict'));
      const { queryClient } = renderDialog(oidcConnection('c1'), { opsApi: ssoApi({ updateSsoConnection }) });
      const dialog = await openDialog();
      await user.type(field(dialog, 'admin:sso.edit.secretReplace'), SECRET);

      await save(user, dialog);

      expect(await within(dialog).findByText(t('admin:sso.errors.conflict'))).toBeInTheDocument();
      expect(field(dialog, 'admin:sso.edit.secretReplace')).toHaveValue('');
      await waitFor(() => expect(mutationsHolding(queryClient, SECRET)).toHaveLength(0));
      expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
    });

    it('is cleared when the step-up is cancelled, and the dialog closes quietly', async () => {
      const user = userEvent.setup();
      const updateSsoConnection = vi.fn().mockRejectedValue(apiError(403, 'step_up_required'));
      const { queryClient, onOpenChange } = renderDialog(oidcConnection('c1'), {
        opsApi: ssoApi({ updateSsoConnection }),
        auth: makeAuth({ stepUp: vi.fn().mockResolvedValue(false) }),
      });
      const dialog = await openDialog();
      await user.type(field(dialog, 'admin:sso.edit.secretReplace'), SECRET);

      await save(user, dialog);

      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
      expect(field(dialog, 'admin:sso.edit.secretReplace')).toHaveValue('');
      await waitFor(() => expect(mutationsHolding(queryClient, SECRET)).toHaveLength(0));
    });

    it('is cleared after a successful update too', async () => {
      const user = userEvent.setup();
      const { queryClient, onOpenChange } = renderDialog(oidcConnection('c1'));
      const dialog = await openDialog();
      await user.type(field(dialog, 'admin:sso.edit.secretReplace'), SECRET);

      await save(user, dialog);

      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
      expect(field(dialog, 'admin:sso.edit.secretReplace')).toHaveValue('');
      await waitFor(() => expect(mutationsHolding(queryClient, SECRET)).toHaveLength(0));
    });
  });

  describe('refused addresses', () => {
    it.each(['scheme', 'host', 'private_address'])('shows the public https URL rule at the metadata URL field (%s)', async (reason) => {
      const user = userEvent.setup();
      const updateSsoConnection = vi.fn().mockRejectedValue(apiError(422, 'validation', { field: 'metadataUrl', reason }));
      renderDialog(ssoConnection('c1'), { opsApi: ssoApi({ updateSsoConnection }) });
      const dialog = await openDialog();
      const url = field(dialog, 'admin:sso.create.metadataUrl');
      await user.clear(url);
      await user.type(url, 'https://10.0.0.5/metadata');

      await save(user, dialog);

      // Once, on the field: the input is described by it.
      await within(dialog).findByText(t('admin:sso.errors.urlNotPublic'));
      expect(field(dialog, 'admin:sso.create.metadataUrl')).toHaveAccessibleDescription(t('admin:sso.errors.urlNotPublic'));
      expect(within(dialog).queryByText(/English/)).not.toBeInTheDocument();
    });

    it('shows the public https URL rule at the issuer field', async () => {
      const user = userEvent.setup();
      const updateSsoConnection = vi
        .fn()
        .mockRejectedValue(apiError(422, 'validation', { field: 'oidcIssuer', reason: 'private_address' }));
      renderDialog(oidcConnection('c1'), { opsApi: ssoApi({ updateSsoConnection }) });
      const dialog = await openDialog();
      const issuer = field(dialog, 'admin:sso.create.oidcIssuer');
      await user.clear(issuer);
      await user.type(issuer, 'https://10.0.0.5');

      await save(user, dialog);

      await within(dialog).findByText(t('admin:sso.errors.urlNotPublic'));
      expect(field(dialog, 'admin:sso.create.oidcIssuer')).toHaveAccessibleDescription(t('admin:sso.errors.urlNotPublic'));
    });

    it('says when the name resolver is down', async () => {
      const user = userEvent.setup();
      const updateSsoConnection = vi.fn().mockRejectedValue(apiError(503, 'unavailable'));
      renderDialog(ssoConnection('c1'), { opsApi: ssoApi({ updateSsoConnection }) });
      const dialog = await openDialog();
      const url = field(dialog, 'admin:sso.create.metadataUrl');
      await user.clear(url);
      await user.type(url, 'https://idp.acme.test/v2');

      await save(user, dialog);

      expect(await within(dialog).findByText(t('admin:sso.errors.unavailable'))).toBeInTheDocument();
    });
  });

  describe('a connection that has been tested', () => {
    it('warns that a provider change takes an active connection back to testing', async () => {
      renderDialog(ssoConnection('c1', { status: 'ACTIVE' }));
      const dialog = await openDialog();
      expect(within(dialog).getByText(t('admin:sso.edit.activeWarning'))).toBeInTheDocument();
      expect(within(dialog).queryByText(t('admin:sso.edit.suspendedWarning'))).not.toBeInTheDocument();
    });

    it('warns that a provider change moves a suspended connection to testing, not that it is active', async () => {
      renderDialog(ssoConnection('c1', { status: 'SUSPENDED' }));
      const dialog = await openDialog();
      expect(within(dialog).getByText(t('admin:sso.edit.suspendedWarning'))).toBeInTheDocument();
      expect(within(dialog).queryByText(t('admin:sso.edit.activeWarning'))).not.toBeInTheDocument();
    });

    it('says a suspended connection is back in testing after a provider change', async () => {
      const user = userEvent.setup();
      const updateSsoConnection = vi.fn().mockResolvedValue(ssoConnection('c1', { status: 'TESTING' }));
      renderDialog(ssoConnection('c1', { status: 'SUSPENDED' }), { opsApi: ssoApi({ updateSsoConnection }) });
      const dialog = await openDialog();
      const url = field(dialog, 'admin:sso.create.metadataUrl');
      await user.clear(url);
      await user.type(url, 'https://idp.acme.test/v2');

      await save(user, dialog);

      // A warning toast is also announced in the assertive live region.
      expect(await screen.findAllByText(t('admin:sso.edit.backToTesting'))).not.toHaveLength(0);
    });

    it('shows no warning for a testing connection or a draft', async () => {
      renderDialog(ssoConnection('c1', { status: 'TESTING' }));
      const dialog = await openDialog();
      expect(within(dialog).queryByText(t('admin:sso.edit.activeWarning'))).not.toBeInTheDocument();
      expect(within(dialog).queryByText(t('admin:sso.edit.suspendedWarning'))).not.toBeInTheDocument();
    });
  });
});
