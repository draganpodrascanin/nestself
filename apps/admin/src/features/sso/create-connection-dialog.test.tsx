import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UserEvent } from '@testing-library/user-event';
import type { QueryClient } from '@tanstack/react-query';
import type { OpsAdminApi } from '@nestself/api-client';
import { CreateConnectionDialog } from './create-connection-dialog';
import { ORG_ID, apiError, choose, makeAuth, organization, renderOps, t } from '../organizations/ops-test-harness';
import type { AuthContextValue } from '../../auth';
import { ssoApi, ssoConnection } from './sso-test-harness';

const SECRET = 's3cret-value';
const ORGANIZATION = t('admin:sso.create.organization');

function renderDialog(opts: { opsApi?: OpsAdminApi; auth?: AuthContextValue } = {}) {
  const onOpenChange = vi.fn();
  const result = renderOps((opsApi) => <CreateConnectionDialog open onOpenChange={onOpenChange} opsApi={opsApi} />, {
    opsApi: opts.opsApi ?? ssoApi(),
    ...(opts.auth ? { auth: opts.auth } : {}),
  });
  return { ...result, onOpenChange };
}

const openDialog = () => screen.findByRole('dialog', { name: t('admin:sso.create.title') });
const field = (dialog: HTMLElement, key: string) => within(dialog).getByLabelText(t(key), { exact: false });
const submit = (user: UserEvent, dialog: HTMLElement) =>
  user.click(within(dialog).getByRole('button', { name: t('admin:sso.create.submit') }));
const claimSwitch = (dialog: HTMLElement) =>
  within(dialog).getByRole('switch', { name: t('admin:sso.create.oidcClaimRequired') });

async function fillSaml(user: UserEvent, dialog: HTMLElement) {
  await choose(user, ORGANIZATION, 'Example d.o.o.');
  await user.type(field(dialog, 'admin:sso.create.slug'), 'acme');
  await user.type(field(dialog, 'admin:sso.create.metadataUrl'), 'https://idp.acme.test/metadata');
}

async function fillOidc(user: UserEvent, dialog: HTMLElement, secret: string | null = SECRET) {
  await choose(user, ORGANIZATION, 'Example d.o.o.');
  await user.type(field(dialog, 'admin:sso.create.slug'), 'acme');
  await user.click(within(dialog).getByRole('radio', { name: t('admin:sso.protocols.OIDC') }));
  await user.type(field(dialog, 'admin:sso.create.oidcIssuer'), 'https://login.acme.test');
  await user.type(field(dialog, 'admin:sso.create.oidcClientId'), 'client-9');
  if (secret) await user.type(field(dialog, 'admin:sso.create.oidcClientSecret'), secret);
}

/** Mutations still holding a request that carried `secret`: the mutation cache is where a settled request lingers. */
const mutationsHolding = (queryClient: QueryClient, secret: string) =>
  queryClient
    .getMutationCache()
    .getAll()
    .filter((m) => JSON.stringify(m.state.variables ?? null).includes(secret));

describe('CreateConnectionDialog', () => {
  describe('organisation', () => {
    it('is found with the search field and chosen from the matches', async () => {
      const user = userEvent.setup();
      const listOrganizations = vi.fn(async (query: { search?: string }) => ({
        items: [organization('org_alpha', 'Alpha'), organization('org_gamma', 'Gamma')].filter(
          (o) => !query.search || o.name.toLowerCase().startsWith(query.search.toLowerCase()),
        ),
        nextCursor: null,
      }));
      const createSsoConnection = vi.fn().mockResolvedValue(ssoConnection('new'));
      renderDialog({ opsApi: ssoApi({ listOrganizations, createSsoConnection }) });
      const dialog = await openDialog();

      await user.type(within(dialog).getByRole('searchbox', { name: new RegExp(`^${t('admin:sso.create.organizationSearch')}`) }), 'Gam');
      await waitFor(() => expect(listOrganizations).toHaveBeenLastCalledWith({ limit: 25, search: 'Gam' }));
      await choose(user, ORGANIZATION, 'Gamma');
      await user.type(field(dialog, 'admin:sso.create.slug'), 'acme');
      await user.type(field(dialog, 'admin:sso.create.metadataUrl'), 'https://idp.acme.test/metadata');
      await submit(user, dialog);

      await waitFor(() =>
        expect(createSsoConnection).toHaveBeenCalledWith({
          orgId: 'org_gamma',
          slug: 'acme',
          protocol: 'SAML',
          metadataUrl: 'https://idp.acme.test/metadata',
          jitProvisioning: false,
        }),
      );
    });

    it('does not create the connection when Enter is pressed in the search field of a filled-in form', async () => {
      const user = userEvent.setup();
      const { opsApi } = renderDialog();
      const dialog = await openDialog();
      await fillSaml(user, dialog);

      await user.type(within(dialog).getByRole('searchbox', { name: new RegExp(`^${t('admin:sso.create.organizationSearch')}`) }), 'Ex{Enter}');

      expect(opsApi.createSsoConnection).not.toHaveBeenCalled();
    });

    it('is required', async () => {
      const user = userEvent.setup();
      const { opsApi } = renderDialog();
      const dialog = await openDialog();
      await submit(user, dialog);
      expect(await within(dialog).findAllByText(t('admin:sso.errors.organizationRequired'))).not.toHaveLength(0);
      expect(opsApi.createSsoConnection).not.toHaveBeenCalled();
    });
  });

  describe('verified email claim', () => {
    it('is offered for OIDC only, on by default, with its hint', async () => {
      const user = userEvent.setup();
      renderDialog();
      const dialog = await openDialog();
      expect(within(dialog).queryByRole('switch', { name: t('admin:sso.create.oidcClaimRequired') })).not.toBeInTheDocument();
      expect(within(dialog).queryByText(t('admin:sso.create.oidcClaimRequiredHint'))).not.toBeInTheDocument();

      await user.click(within(dialog).getByRole('radio', { name: t('admin:sso.protocols.OIDC') }));

      expect(claimSwitch(dialog)).toBeChecked();
      expect(within(dialog).getByText(t('admin:sso.create.oidcClaimRequiredHint'))).toBeInTheDocument();
    });

    it('is sent as required for an OIDC connection by default', async () => {
      const user = userEvent.setup();
      const { opsApi } = renderDialog();
      const dialog = await openDialog();
      await fillOidc(user, dialog);
      await submit(user, dialog);
      await waitFor(() =>
        expect(opsApi.createSsoConnection).toHaveBeenCalledWith({
          orgId: ORG_ID,
          slug: 'acme',
          protocol: 'OIDC',
          oidcIssuer: 'https://login.acme.test',
          oidcClientId: 'client-9',
          oidcClientSecret: SECRET,
          jitProvisioning: false,
          oidcEmailVerifiedClaimRequired: true,
        }),
      );
    });

    it('is sent turned off when staff turn it off', async () => {
      const user = userEvent.setup();
      const { opsApi } = renderDialog();
      const dialog = await openDialog();
      await fillOidc(user, dialog);
      await user.click(claimSwitch(dialog));
      expect(claimSwitch(dialog)).not.toBeChecked();
      await submit(user, dialog);
      await waitFor(() =>
        expect(opsApi.createSsoConnection).toHaveBeenCalledWith(expect.objectContaining({ protocol: 'OIDC', oidcEmailVerifiedClaimRequired: false })),
      );
    });

    it('is not sent with a SAML connection', async () => {
      const user = userEvent.setup();
      const { opsApi } = renderDialog();
      const dialog = await openDialog();
      await fillSaml(user, dialog);
      await submit(user, dialog);
      await waitFor(() => expect(opsApi.createSsoConnection).toHaveBeenCalled());
      expect(vi.mocked(opsApi.createSsoConnection).mock.calls[0]?.[0]).not.toHaveProperty('oidcEmailVerifiedClaimRequired');
    });
  });

  describe('write-only client secret', () => {
    it('is cleared from the form and the mutation state when the create fails', async () => {
      const user = userEvent.setup();
      const createSsoConnection = vi.fn().mockRejectedValue(apiError(409, 'conflict'));
      const { queryClient } = renderDialog({ opsApi: ssoApi({ createSsoConnection }) });
      const dialog = await openDialog();
      await fillOidc(user, dialog);

      await submit(user, dialog);

      expect(await within(dialog).findAllByText(t('admin:sso.errors.conflictProviderName'))).not.toHaveLength(0);
      expect(field(dialog, 'admin:sso.create.oidcClientSecret')).toHaveValue('');
      await waitFor(() => expect(mutationsHolding(queryClient, SECRET)).toHaveLength(0));
      expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
    });

    it('is cleared when the step-up is cancelled, and the dialog closes quietly', async () => {
      const user = userEvent.setup();
      const createSsoConnection = vi.fn().mockRejectedValue(apiError(403, 'step_up_required'));
      const { queryClient, onOpenChange } = renderDialog({
        opsApi: ssoApi({ createSsoConnection }),
        auth: makeAuth({ stepUp: vi.fn().mockResolvedValue(false) }),
      });
      const dialog = await openDialog();
      await fillOidc(user, dialog);

      await submit(user, dialog);

      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
      expect(field(dialog, 'admin:sso.create.oidcClientSecret')).toHaveValue('');
      await waitFor(() => expect(mutationsHolding(queryClient, SECRET)).toHaveLength(0));
    });

    it('is cleared after a successful create too', async () => {
      const user = userEvent.setup();
      const { queryClient, onOpenChange } = renderDialog();
      const dialog = await openDialog();
      await fillOidc(user, dialog);

      await submit(user, dialog);

      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
      expect(field(dialog, 'admin:sso.create.oidcClientSecret')).toHaveValue('');
      await waitFor(() => expect(mutationsHolding(queryClient, SECRET)).toHaveLength(0));
    });

    it('stays in the form when the fields fail validation, because nothing was sent', async () => {
      const user = userEvent.setup();
      const { opsApi } = renderDialog();
      const dialog = await openDialog();
      await user.click(within(dialog).getByRole('radio', { name: t('admin:sso.protocols.OIDC') }));
      await user.type(field(dialog, 'admin:sso.create.oidcClientSecret'), SECRET);

      await submit(user, dialog);

      expect(await within(dialog).findAllByText(t('admin:sso.errors.clientIdRequired'))).not.toHaveLength(0);
      expect(opsApi.createSsoConnection).not.toHaveBeenCalled();
      expect(field(dialog, 'admin:sso.create.oidcClientSecret')).toHaveValue(SECRET);
    });
  });

  describe('refused addresses', () => {
    it.each(['scheme', 'host', 'private_address'])('shows the public https URL rule at the metadata URL field (%s)', async (reason) => {
      const user = userEvent.setup();
      const createSsoConnection = vi.fn().mockRejectedValue(apiError(422, 'validation', { field: 'metadataUrl', reason }));
      renderDialog({ opsApi: ssoApi({ createSsoConnection }) });
      const dialog = await openDialog();
      await fillSaml(user, dialog);

      await submit(user, dialog);

      // Once, on the field: the input is described by it.
      await within(dialog).findByText(t('admin:sso.errors.urlNotPublic'));
      expect(field(dialog, 'admin:sso.create.metadataUrl')).toHaveAccessibleDescription(t('admin:sso.errors.urlNotPublic'));
      expect(within(dialog).queryByText(/English/)).not.toBeInTheDocument();
    });

    it('shows the public https URL rule at the issuer field', async () => {
      const user = userEvent.setup();
      const createSsoConnection = vi
        .fn()
        .mockRejectedValue(apiError(422, 'validation', { field: 'oidcIssuer', reason: 'private_address' }));
      renderDialog({ opsApi: ssoApi({ createSsoConnection }) });
      const dialog = await openDialog();
      await fillOidc(user, dialog);

      await submit(user, dialog);

      await within(dialog).findByText(t('admin:sso.errors.urlNotPublic'));
      expect(field(dialog, 'admin:sso.create.oidcIssuer')).toHaveAccessibleDescription(t('admin:sso.errors.urlNotPublic'));
    });

    it('says when the name resolver is down', async () => {
      const user = userEvent.setup();
      const createSsoConnection = vi.fn().mockRejectedValue(apiError(503, 'unavailable'));
      renderDialog({ opsApi: ssoApi({ createSsoConnection }) });
      const dialog = await openDialog();
      await fillSaml(user, dialog);

      await submit(user, dialog);

      expect(await within(dialog).findByText(t('admin:sso.errors.unavailable'))).toBeInTheDocument();
    });
  });
});
