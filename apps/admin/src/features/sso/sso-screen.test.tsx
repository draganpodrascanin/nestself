import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UserEvent } from '@testing-library/user-event';
import { SAMPLE_SSO_CONNECTIONS } from '@nestself/sample-data';
import { SsoScreen } from './sso-screen';
import { ORG_ID, STAFF_ACTIONS, apiError, choose, makeAuth, organization, renderOps, t } from '../organizations/ops-test-harness';
import type { RenderOpts } from '../organizations/ops-test-harness';
import { START_URL, ssoApi as harnessApi, ssoConnection as connection, ssoDomain as domain } from './sso-test-harness';

const DRAFT = connection('draft', { domains: [domain('d_pending', 'pending.example.test', false), domain('d_ok', 'ok.example.test', true)] });
const TESTING = connection('testing', { status: 'TESTING', domains: [domain('d_t', 'testing.example.test', true)] });
const ACTIVE = connection('active', {
  status: 'ACTIVE',
  lastTestedAt: '2026-10-21T09:00:00.000Z',
  certificateExpiresAt: '2027-03-01T00:00:00.000Z',
  domains: [domain('d_a', 'active.example.test', true)],
});
const SUSPENDED = connection('suspended', {
  status: 'SUSPENDED',
  protocol: 'OIDC',
  cognitoProviderName: 'org-suspended-oidc',
  metadataUrl: null,
  oidcIssuer: 'https://login.example.test',
  oidcClientId: 'client-1',
  lastTestedAt: '2026-10-21T09:00:00.000Z',
  domains: [domain('d_s', 'suspended.example.test', true)],
});
const ALL = [DRAFT, TESTING, ACTIVE, SUSPENDED];

/** The screen tests list all four connections and answer activations and edits with the matching row. */
function ssoApi(overrides: Record<string, unknown> = {}) {
  return harnessApi({
    listSsoConnections: vi.fn().mockResolvedValue({ items: ALL }),
    updateSsoConnection: vi.fn().mockResolvedValue(ACTIVE),
    activateSsoConnection: vi.fn().mockResolvedValue({ ...TESTING, status: 'ACTIVE' }),
    ...overrides,
  });
}

const renderScreen = (opts: RenderOpts = {}) =>
  renderOps((opsApi, sampleMode) => <SsoScreen opsApi={opsApi} sampleMode={sampleMode} />, {
    opsApi: opts.opsApi ?? ssoApi(),
    ...(opts.auth ? { auth: opts.auth } : {}),
    ...(opts.sampleMode !== undefined ? { sampleMode: opts.sampleMode } : {}),
  });

const rowOf = (id: string) => screen.findByTestId(`sso-row-${id}`);

async function openDetail(user: UserEvent, id: string) {
  const row = await rowOf(id);
  await user.click(within(row).getByRole('button', { name: t('admin:sso.details') }));
  return screen.findByTestId(`sso-detail-${id}`);
}

const actionAlert = () => screen.findByRole('alert');

let openSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
});
afterEach(() => {
  openSpy.mockRestore();
});

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

describe('SsoScreen list', () => {
  it('shows organization, provider, protocol, status, domain counts, last test and certificate expiry', async () => {
    const { opsApi } = renderScreen();
    const draft = await rowOf(DRAFT.id);
    expect(opsApi.listSsoConnections).toHaveBeenCalled();
    expect(await within(draft).findByText('Example d.o.o.')).toBeInTheDocument();
    expect(within(draft).getByText(DRAFT.cognitoProviderName)).toBeInTheDocument();
    expect(within(draft).getByText(t('admin:sso.protocols.SAML'))).toBeInTheDocument();
    expect(within(draft).getByText(t('admin:sso.domainsCount', { verified: 1, count: 2 }))).toBeInTheDocument();
    expect(within(draft).getAllByText(t('admin:sso.never'))).toHaveLength(1);
    expect(within(draft).getByText(t('admin:sso.notKnown'))).toBeInTheDocument();

    for (const [row, status] of [[DRAFT, 'DRAFT'], [TESTING, 'TESTING'], [ACTIVE, 'ACTIVE'], [SUSPENDED, 'SUSPENDED']] as const) {
      expect(within(await rowOf(row.id)).getByText(t(`admin:sso.statuses.${status}`))).toBeInTheDocument();
    }
    expect(within(await rowOf(ACTIVE.id)).getByText(/2027/)).toBeInTheDocument();
  });

  it('reads no single organization while the loaded page names them all', async () => {
    const { opsApi } = renderScreen();
    expect(await within(await rowOf(DRAFT.id)).findByText('Example d.o.o.')).toBeInTheDocument();
    expect(opsApi.getOrganization).not.toHaveBeenCalled();
  });

  it('names an organization beyond the loaded page with one read of it, in the table and in the detail', async () => {
    const user = userEvent.setup();
    const far = connection('far', { orgId: 'org_far' });
    const getOrganization = vi.fn().mockResolvedValue(organization('org_far', 'Far Away d.o.o.'));
    const listSsoConnections = vi.fn().mockResolvedValue({ items: [DRAFT, far] });
    renderScreen({ opsApi: ssoApi({ listSsoConnections, getOrganization }) });

    expect(await within(await rowOf('far')).findByText('Far Away d.o.o.')).toBeInTheDocument();
    expect(within(await rowOf(DRAFT.id)).getByText('Example d.o.o.')).toBeInTheDocument();
    // One read, for the one organization the loaded page does not have.
    expect(getOrganization).toHaveBeenCalledTimes(1);
    expect(getOrganization).toHaveBeenCalledWith('org_far');

    const detail = await openDetail(user, 'far');
    expect(within(detail).getByText('Far Away d.o.o.')).toBeInTheDocument();
    expect(getOrganization.mock.calls.every(([id]) => id === 'org_far')).toBe(true);
  });

  it('keeps showing the id of an organization that cannot be read', async () => {
    const user = userEvent.setup();
    const far = connection('far', { orgId: 'org_far' });
    const getOrganization = vi.fn().mockRejectedValue(apiError(404, 'not_found'));
    const listSsoConnections = vi.fn().mockResolvedValue({ items: [far] });
    renderScreen({ opsApi: ssoApi({ listSsoConnections, getOrganization }) });

    const row = await rowOf('far');
    await waitFor(() => expect(getOrganization).toHaveBeenCalledWith('org_far'));
    expect(within(row).getByText('org_far')).toBeInTheDocument();
    const detail = await openDetail(user, 'far');
    expect(within(detail).getByText('org_far')).toBeInTheDocument();
  });

  it('says when there is no connection', async () => {
    renderScreen({ opsApi: ssoApi({ listSsoConnections: vi.fn().mockResolvedValue({ items: [] }) }) });
    expect(await screen.findByText(t('admin:sso.empty'))).toBeInTheDocument();
  });

  it('renders a failed load as translated copy', async () => {
    renderScreen({ opsApi: ssoApi({ listSsoConnections: vi.fn().mockRejectedValue(apiError(403, 'forbidden')) }) });
    expect(await screen.findByText(t('admin:sso.errors.forbidden'))).toBeInTheDocument();
    expect(screen.queryByText('English forbidden')).not.toBeInTheDocument();
  });

  it('shows the permission block without sso.manage and never calls the API', async () => {
    const { opsApi } = renderScreen({ auth: makeAuth({ effectiveActions: STAFF_ACTIONS.filter((a) => a !== 'sso.manage') }) });
    expect(await screen.findByText(t('common:state.permission.title'))).toBeInTheDocument();
    expect(opsApi.listSsoConnections).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

async function openCreate(user: UserEvent) {
  await screen.findByTestId(`sso-row-${DRAFT.id}`);
  await user.click(screen.getByRole('button', { name: t('admin:sso.newConnection') }));
  return screen.findByRole('dialog', { name: t('admin:sso.create.title') });
}

async function fillSaml(user: UserEvent, dialog: HTMLElement, slug = 'acme') {
  await choose(user, t('admin:sso.create.organization'), 'Example d.o.o.');
  await user.type(within(dialog).getByLabelText(t('admin:sso.create.slug'), { exact: false }), slug);
  await user.type(within(dialog).getByLabelText(t('admin:sso.create.metadataUrl'), { exact: false }), 'https://idp.acme.test/metadata');
}

const submitCreate = (user: UserEvent, dialog: HTMLElement) =>
  user.click(within(dialog).getByRole('button', { name: t('admin:sso.create.submit') }));

describe('SsoScreen create dialog', () => {
  it('validates the slug and the organization before calling the API', async () => {
    const user = userEvent.setup();
    const { opsApi } = renderScreen();
    const dialog = await openCreate(user);
    await user.type(within(dialog).getByLabelText(t('admin:sso.create.slug'), { exact: false }), 'Bad Slug!');
    await submitCreate(user, dialog);
    expect(await within(dialog).findAllByText(t('admin:sso.errors.slugPattern'))).not.toHaveLength(0);
    expect(within(dialog).getAllByText(t('admin:sso.errors.organizationRequired'))).not.toHaveLength(0);
    expect(within(dialog).getAllByText(t('admin:sso.errors.urlInvalid'))).not.toHaveLength(0);
    expect(opsApi.createSsoConnection).not.toHaveBeenCalled();
  });

  it('refuses an http: metadata URL before calling the API', async () => {
    const user = userEvent.setup();
    const { opsApi } = renderScreen();
    const dialog = await openCreate(user);
    await choose(user, t('admin:sso.create.organization'), 'Example d.o.o.');
    await user.type(within(dialog).getByLabelText(t('admin:sso.create.slug'), { exact: false }), 'acme');
    await user.type(within(dialog).getByLabelText(t('admin:sso.create.metadataUrl'), { exact: false }), 'http://idp.acme.test/metadata');
    await submitCreate(user, dialog);
    expect(await within(dialog).findAllByText(t('admin:sso.errors.urlInvalid'))).not.toHaveLength(0);
    expect(opsApi.createSsoConnection).not.toHaveBeenCalled();
  });

  it('previews the provider name from the slug and the protocol', async () => {
    const user = userEvent.setup();
    renderScreen();
    const dialog = await openCreate(user);
    await user.type(within(dialog).getByLabelText(t('admin:sso.create.slug'), { exact: false }), 'acme');
    expect(within(dialog).getByText(t('admin:sso.create.providerPreview', { name: 'org-acme-saml' }))).toBeInTheDocument();
    await user.click(within(dialog).getByRole('radio', { name: t('admin:sso.protocols.OIDC') }));
    expect(within(dialog).getByText(t('admin:sso.create.providerPreview', { name: 'org-acme-oidc' }))).toBeInTheDocument();
  });

  it('creates a SAML connection through step-up', async () => {
    const user = userEvent.setup();
    const createSsoConnection = vi.fn().mockRejectedValueOnce(apiError(403, 'step_up_required')).mockResolvedValue(connection('new'));
    const auth = makeAuth();
    const { opsApi } = renderScreen({ opsApi: ssoApi({ createSsoConnection }), auth });
    const dialog = await openCreate(user);
    await fillSaml(user, dialog);
    await submitCreate(user, dialog);
    await waitFor(() => expect(createSsoConnection).toHaveBeenCalledTimes(2));
    expect(auth.stepUp).toHaveBeenCalledTimes(1);
    expect(createSsoConnection).toHaveBeenLastCalledWith({
      orgId: ORG_ID,
      slug: 'acme',
      protocol: 'SAML',
      metadataUrl: 'https://idp.acme.test/metadata',
      jitProvisioning: false,
    });
    expect(await screen.findByText(t('admin:sso.create.success'))).toBeInTheDocument();
    await waitFor(() => expect(opsApi.listSsoConnections).toHaveBeenCalledTimes(2));
  });

  it('creates an OIDC connection with the write-only secret, JIT and a default org unit', async () => {
    const user = userEvent.setup();
    const { opsApi } = renderScreen();
    const dialog = await openCreate(user);
    await choose(user, t('admin:sso.create.organization'), 'Example d.o.o.');
    await user.type(within(dialog).getByLabelText(t('admin:sso.create.slug'), { exact: false }), 'acme');
    await user.click(within(dialog).getByRole('radio', { name: t('admin:sso.protocols.OIDC') }));
    await user.type(within(dialog).getByLabelText(t('admin:sso.create.oidcIssuer'), { exact: false }), 'https://login.acme.test');
    await user.type(within(dialog).getByLabelText(t('admin:sso.create.oidcClientId'), { exact: false }), 'client-9');
    await user.type(within(dialog).getByLabelText(t('admin:sso.create.oidcClientSecret'), { exact: false }), 's3cret');
    expect(within(dialog).queryByText(t('admin:sso.jitWarning'))).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('switch', { name: t('admin:sso.create.jit') }));
    expect(within(dialog).getByText(t('admin:sso.jitWarning'))).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(t('admin:sso.create.defaultOrgUnit'), { exact: false }), 'unit_1');
    await submitCreate(user, dialog);
    await waitFor(() =>
      expect(opsApi.createSsoConnection).toHaveBeenCalledWith({
        orgId: ORG_ID,
        slug: 'acme',
        protocol: 'OIDC',
        oidcIssuer: 'https://login.acme.test',
        oidcClientId: 'client-9',
        oidcClientSecret: 's3cret',
        jitProvisioning: true,
        oidcEmailVerifiedClaimRequired: true,
        defaultOrgUnitId: 'unit_1',
      }),
    );
  });

  it.each([
    [apiError(409, 'conflict'), 'admin:sso.errors.conflictProviderName'],
    [apiError(409, 'conflict', { reason: 'provider_name_taken', field: 'slug' }), 'admin:sso.errors.conflictProviderNameReserved'],
    [apiError(422, 'validation', { field: 'slug' }), 'admin:sso.errors.fieldSlug'],
    [apiError(422, 'validation', { field: 'defaultOrgUnitId' }), 'admin:sso.errors.fieldDefaultOrgUnit'],
    [apiError(422, 'validation', { field: 'idpInitiatedAllowed' }), 'admin:sso.errors.fieldIdpInitiated'],
    [apiError(422, 'validation'), 'admin:sso.errors.idpRefused'],
    [apiError(400, 'validation'), 'admin:sso.errors.validation'],
    [apiError(404, 'not_found'), 'admin:sso.errors.organizationNotFound'],
    [apiError(429, 'rate_limited'), 'admin:sso.errors.rateLimited'],
    [apiError(503, 'unavailable'), 'admin:sso.errors.unavailable'],
  ])('renders a refused create (%s) in the dialog', async (err, key) => {
    const user = userEvent.setup();
    renderScreen({ opsApi: ssoApi({ createSsoConnection: vi.fn().mockRejectedValue(err) }) });
    const dialog = await openCreate(user);
    await fillSaml(user, dialog);
    await submitCreate(user, dialog);
    expect(await within(dialog).findAllByText(t(key))).not.toHaveLength(0);
    expect(within(dialog).queryByText(/English/)).not.toBeInTheDocument();
  });

  it('forgets the OIDC client secret after a successful create', async () => {
    const user = userEvent.setup();
    const { opsApi } = renderScreen();
    let dialog = await openCreate(user);
    await choose(user, t('admin:sso.create.organization'), 'Example d.o.o.');
    await user.type(within(dialog).getByLabelText(t('admin:sso.create.slug'), { exact: false }), 'acme');
    await user.click(within(dialog).getByRole('radio', { name: t('admin:sso.protocols.OIDC') }));
    await user.type(within(dialog).getByLabelText(t('admin:sso.create.oidcIssuer'), { exact: false }), 'https://login.acme.test');
    await user.type(within(dialog).getByLabelText(t('admin:sso.create.oidcClientId'), { exact: false }), 'client-9');
    await user.type(within(dialog).getByLabelText(t('admin:sso.create.oidcClientSecret'), { exact: false }), 's3cret');
    await submitCreate(user, dialog);
    await waitFor(() => expect(opsApi.createSsoConnection).toHaveBeenCalled());
    await screen.findByText(t('admin:sso.create.success'));
    await waitFor(() => expect(screen.queryByDisplayValue('s3cret')).not.toBeInTheDocument());

    dialog = await openCreate(user);
    await user.click(within(dialog).getByRole('radio', { name: t('admin:sso.protocols.OIDC') }));
    expect(within(dialog).getByLabelText(t('admin:sso.create.oidcClientSecret'), { exact: false })).toHaveValue('');
  });
});

// ---------------------------------------------------------------------------
// Detail: SP metadata, domains
// ---------------------------------------------------------------------------

describe('SsoScreen connection detail', () => {
  it('shows the service provider values with copy buttons', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderScreen();
    const detail = await openDetail(user, DRAFT.id);
    expect(within(detail).getByText('urn:amazon:cognito:sp:eu-central-1_TEST')).toBeInTheDocument();
    expect(within(detail).getByText('https://auth.example.test/saml2/idpresponse')).toBeInTheDocument();
    await user.click(within(detail).getByRole('button', { name: t('admin:sso.copy.label', { label: t('admin:sso.detail.acsUrl') }) }));
    expect(writeText).toHaveBeenCalledWith('https://auth.example.test/saml2/idpresponse');
  });

  it('lists domains as verified or pending and offers Verify only on pending ones', async () => {
    const user = userEvent.setup();
    renderScreen();
    const detail = await openDetail(user, DRAFT.id);
    const pending = within(detail).getByTestId('sso-domain-d_pending');
    expect(within(pending).getByText(t('admin:sso.domains.pending'))).toBeInTheDocument();
    expect(within(pending).getByRole('button', { name: t('admin:sso.domains.verify') })).toBeInTheDocument();
    const ok = within(detail).getByTestId('sso-domain-d_ok');
    expect(within(ok).queryByRole('button', { name: t('admin:sso.domains.verify') })).not.toBeInTheDocument();
  });

  it('adds a domain and shows the TXT record to publish', async () => {
    const user = userEvent.setup();
    const { opsApi } = renderScreen();
    const detail = await openDetail(user, DRAFT.id);
    await user.click(within(detail).getByRole('button', { name: t('admin:sso.domains.add') }));
    const dialog = await screen.findByRole('dialog', { name: t('admin:sso.domains.addTitle') });
    await user.type(within(dialog).getByLabelText(t('admin:sso.domains.field'), { exact: false }), ' New.Example.Test ');
    await user.click(within(dialog).getByRole('button', { name: t('admin:sso.domains.submit') }));
    await waitFor(() => expect(opsApi.addSsoDomain).toHaveBeenCalledWith(DRAFT.id, { domain: 'new.example.test' }));
    expect(await within(dialog).findByText('_nestself-verify.new.example.test')).toBeInTheDocument();
    expect(within(dialog).getByText('nestself-domain-verification=token-d_new')).toBeInTheDocument();
    expect(within(dialog).getByText(t('admin:sso.domains.txtIntro'))).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: t('admin:sso.copy.label', { label: t('admin:sso.domains.txtValue') }) })).toBeInTheDocument();
  });

  it('refuses a malformed domain before calling the API', async () => {
    const user = userEvent.setup();
    const { opsApi } = renderScreen();
    const detail = await openDetail(user, DRAFT.id);
    await user.click(within(detail).getByRole('button', { name: t('admin:sso.domains.add') }));
    const dialog = await screen.findByRole('dialog', { name: t('admin:sso.domains.addTitle') });
    await user.type(within(dialog).getByLabelText(t('admin:sso.domains.field'), { exact: false }), 'someone@example.test');
    await user.click(within(dialog).getByRole('button', { name: t('admin:sso.domains.submit') }));
    expect(await within(dialog).findAllByText(t('admin:sso.errors.domainInvalid'))).not.toHaveLength(0);
    expect(opsApi.addSsoDomain).not.toHaveBeenCalled();
  });

  it.each([
    [apiError(422, 'domain_blocklisted'), 'admin:sso.errors.domainBlocklisted'],
    [apiError(409, 'conflict'), 'admin:sso.errors.conflictDomain'],
  ])('renders a refused domain (%s) in the dialog', async (err, key) => {
    const user = userEvent.setup();
    renderScreen({ opsApi: ssoApi({ addSsoDomain: vi.fn().mockRejectedValue(err) }) });
    const detail = await openDetail(user, DRAFT.id);
    await user.click(within(detail).getByRole('button', { name: t('admin:sso.domains.add') }));
    const dialog = await screen.findByRole('dialog', { name: t('admin:sso.domains.addTitle') });
    await user.type(within(dialog).getByLabelText(t('admin:sso.domains.field'), { exact: false }), 'gmail.com');
    await user.click(within(dialog).getByRole('button', { name: t('admin:sso.domains.submit') }));
    expect(await within(dialog).findAllByText(t(key))).not.toHaveLength(0);
  });

  it('verifies a pending domain and confirms it', async () => {
    const user = userEvent.setup();
    const { opsApi } = renderScreen();
    const detail = await openDetail(user, DRAFT.id);
    await user.click(within(within(detail).getByTestId('sso-domain-d_pending')).getByRole('button', { name: t('admin:sso.domains.verify') }));
    await waitFor(() => expect(opsApi.verifySsoDomain).toHaveBeenCalledWith(DRAFT.id, 'd_pending'));
    expect(await screen.findByText(t('admin:sso.domains.verified', { domain: 'pending.example.test' }))).toBeInTheDocument();
  });

  it.each([
    [apiError(422, 'domain_unverified'), 'admin:sso.errors.domainUnverified'],
    [apiError(422, 'domain_blocklisted'), 'admin:sso.errors.domainBlocklisted'],
  ])('shows a failed verification (%s)', async (err, key) => {
    const user = userEvent.setup();
    renderScreen({ opsApi: ssoApi({ verifySsoDomain: vi.fn().mockRejectedValue(err) }) });
    const detail = await openDetail(user, DRAFT.id);
    await user.click(within(within(detail).getByTestId('sso-domain-d_pending')).getByRole('button', { name: t('admin:sso.domains.verify') }));
    expect(within(await actionAlert()).getByText(t(key))).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Lifecycle: test, activate, suspend, reactivate, edit
// ---------------------------------------------------------------------------

describe('SsoScreen lifecycle', () => {
  it('offers the actions that fit each status', async () => {
    const user = userEvent.setup();
    renderScreen();
    const name = (key: string) => ({ name: t(`admin:sso.actions.${key}`) });

    let detail = await openDetail(user, DRAFT.id);
    expect(within(detail).getByRole('button', name('test'))).toBeInTheDocument();
    expect(within(detail).queryByRole('button', name('activate'))).not.toBeInTheDocument();
    expect(within(detail).queryByRole('button', name('suspend'))).not.toBeInTheDocument();

    detail = await openDetail(user, TESTING.id);
    expect(within(detail).getByRole('button', name('test'))).toBeInTheDocument();
    expect(within(detail).getByRole('button', name('activate'))).toBeInTheDocument();

    detail = await openDetail(user, ACTIVE.id);
    expect(within(detail).queryByRole('button', name('test'))).not.toBeInTheDocument();
    expect(within(detail).getByRole('button', name('suspend'))).toBeInTheDocument();

    detail = await openDetail(user, SUSPENDED.id);
    expect(within(detail).getByRole('button', name('reactivate'))).toBeInTheDocument();
    expect(within(detail).queryByRole('button', name('suspend'))).not.toBeInTheDocument();
  });

  it('mints a test link and shows it as an anchor, without opening a tab itself', async () => {
    const user = userEvent.setup();
    const { opsApi } = renderScreen();
    const detail = await openDetail(user, DRAFT.id);
    await user.click(within(detail).getByRole('button', { name: t('admin:sso.actions.test') }));
    await waitFor(() => expect(opsApi.testSsoConnection).toHaveBeenCalledWith(DRAFT.id));
    expect(openSpy).not.toHaveBeenCalled();
    expect(await within(detail).findByText(t('admin:sso.actions.testNote'))).toBeInTheDocument();
    expect(within(detail).getByText(t('admin:sso.actions.testLinkNote'))).toBeInTheDocument();
    const link = within(detail).getByRole('link', { name: t('admin:sso.actions.testLink') });
    expect(link).toHaveAttribute('href', START_URL);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('activates a tested connection', async () => {
    const user = userEvent.setup();
    const { opsApi } = renderScreen();
    const detail = await openDetail(user, TESTING.id);
    await user.click(within(detail).getByRole('button', { name: t('admin:sso.actions.activate') }));
    await waitFor(() => expect(opsApi.activateSsoConnection).toHaveBeenCalledWith(TESTING.id));
    expect(await screen.findByText(t('admin:sso.actions.activated'))).toBeInTheDocument();
  });

  it('suspends an active connection after confirmation', async () => {
    const user = userEvent.setup();
    const { opsApi } = renderScreen();
    const detail = await openDetail(user, ACTIVE.id);
    await user.click(within(detail).getByRole('button', { name: t('admin:sso.actions.suspend') }));
    const confirm = await screen.findByRole('alertdialog', { name: t('admin:sso.actions.suspendTitle') });
    expect(opsApi.updateSsoConnection).not.toHaveBeenCalled();
    await user.click(within(confirm).getByRole('button', { name: t('admin:sso.actions.suspend') }));
    await waitFor(() => expect(opsApi.updateSsoConnection).toHaveBeenCalledWith(ACTIVE.id, { status: 'SUSPENDED' }));
    expect(await screen.findByText(t('admin:sso.actions.suspended'))).toBeInTheDocument();
  });

  it('reactivates a suspended connection', async () => {
    const user = userEvent.setup();
    const { opsApi } = renderScreen();
    const detail = await openDetail(user, SUSPENDED.id);
    await user.click(within(detail).getByRole('button', { name: t('admin:sso.actions.reactivate') }));
    await waitFor(() => expect(opsApi.updateSsoConnection).toHaveBeenCalledWith(SUSPENDED.id, { status: 'ACTIVE' }));
    expect(await screen.findByText(t('admin:sso.actions.reactivated'))).toBeInTheDocument();
  });

  it('never shows the OIDC client secret and replaces it through Edit', async () => {
    const user = userEvent.setup();
    const { opsApi } = renderScreen();
    const detail = await openDetail(user, SUSPENDED.id);
    expect(within(detail).getByText(t('admin:sso.detail.secretWriteOnly'))).toBeInTheDocument();
    await user.click(within(detail).getByRole('button', { name: t('admin:sso.edit.open') }));
    const dialog = await screen.findByRole('dialog', { name: t('admin:sso.edit.title') });
    const secret = within(dialog).getByLabelText(t('admin:sso.edit.secretReplace'), { exact: false });
    expect(secret).toHaveValue('');
    await user.type(secret, 'rotated');
    await user.click(within(dialog).getByRole('button', { name: t('admin:sso.edit.submit') }));
    await waitFor(() => expect(opsApi.updateSsoConnection).toHaveBeenCalledWith(SUSPENDED.id, { oidcClientSecret: 'rotated' }));
    expect(await screen.findByText(t('admin:sso.edit.success'))).toBeInTheDocument();
  });

  it('warns in the edit dialog of an ACTIVE connection that provider changes take it back to testing', async () => {
    const user = userEvent.setup();
    const { opsApi } = renderScreen({
      opsApi: ssoApi({ updateSsoConnection: vi.fn().mockResolvedValue({ ...ACTIVE, status: 'TESTING', lastTestedAt: null }) }),
    });
    const detail = await openDetail(user, ACTIVE.id);
    await user.click(within(detail).getByRole('button', { name: t('admin:sso.edit.open') }));
    const dialog = await screen.findByRole('dialog', { name: t('admin:sso.edit.title') });
    expect(within(dialog).getByText(t('admin:sso.edit.activeWarning'))).toBeInTheDocument();
    const url = within(dialog).getByLabelText(t('admin:sso.create.metadataUrl'), { exact: false });
    await user.clear(url);
    await user.type(url, 'https://idp.example.test/v3');
    await user.click(within(dialog).getByRole('button', { name: t('admin:sso.edit.submit') }));
    await waitFor(() => expect(opsApi.updateSsoConnection).toHaveBeenCalledWith(ACTIVE.id, { metadataUrl: 'https://idp.example.test/v3' }));
    // A warning toast is also announced in the assertive live region.
    expect(await screen.findAllByText(t('admin:sso.edit.backToTesting'))).not.toHaveLength(0);
  });

  it('refuses an http: metadata URL in the edit dialog before calling the API', async () => {
    const user = userEvent.setup();
    const { opsApi } = renderScreen();
    const detail = await openDetail(user, DRAFT.id);
    await user.click(within(detail).getByRole('button', { name: t('admin:sso.edit.open') }));
    const dialog = await screen.findByRole('dialog', { name: t('admin:sso.edit.title') });
    const url = within(dialog).getByLabelText(t('admin:sso.create.metadataUrl'), { exact: false });
    await user.clear(url);
    await user.type(url, 'http://idp.example.test/v2');
    await user.click(within(dialog).getByRole('button', { name: t('admin:sso.edit.submit') }));
    expect(await within(dialog).findAllByText(t('admin:sso.errors.urlInvalid'))).not.toHaveLength(0);
    expect(opsApi.updateSsoConnection).not.toHaveBeenCalled();
  });

  it('shows no back-to-testing warning when editing a DRAFT connection', async () => {
    const user = userEvent.setup();
    renderScreen();
    const detail = await openDetail(user, DRAFT.id);
    await user.click(within(detail).getByRole('button', { name: t('admin:sso.edit.open') }));
    const dialog = await screen.findByRole('dialog', { name: t('admin:sso.edit.title') });
    expect(within(dialog).queryByText(t('admin:sso.edit.activeWarning'))).not.toBeInTheDocument();
  });

  it('sends only the changed fields and warns when JIT is turned on', async () => {
    const user = userEvent.setup();
    const { opsApi } = renderScreen();
    const detail = await openDetail(user, DRAFT.id);
    await user.click(within(detail).getByRole('button', { name: t('admin:sso.edit.open') }));
    const dialog = await screen.findByRole('dialog', { name: t('admin:sso.edit.title') });
    await user.click(within(dialog).getByRole('button', { name: t('admin:sso.edit.submit') }));
    expect(await within(dialog).findByText(t('admin:sso.errors.nothingChanged'))).toBeInTheDocument();
    expect(opsApi.updateSsoConnection).not.toHaveBeenCalled();

    const url = within(dialog).getByLabelText(t('admin:sso.create.metadataUrl'), { exact: false });
    await user.clear(url);
    await user.type(url, 'https://idp.example.test/v2');
    await user.click(within(dialog).getByRole('switch', { name: t('admin:sso.create.jit') }));
    expect(within(dialog).getByText(t('admin:sso.jitWarning'))).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: t('admin:sso.edit.submit') }));
    await waitFor(() =>
      expect(opsApi.updateSsoConnection).toHaveBeenCalledWith(DRAFT.id, { metadataUrl: 'https://idp.example.test/v2', jitProvisioning: true }),
    );
  });

  it('closes quietly when step-up is cancelled', async () => {
    const user = userEvent.setup();
    const activateSsoConnection = vi.fn().mockRejectedValue(apiError(403, 'step_up_required'));
    renderScreen({ opsApi: ssoApi({ activateSsoConnection }), auth: makeAuth({ stepUp: vi.fn().mockResolvedValue(false) }) });
    const detail = await openDetail(user, TESTING.id);
    await user.click(within(detail).getByRole('button', { name: t('admin:sso.actions.activate') }));
    await waitFor(() => expect(activateSsoConnection).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each([
    ['test', apiError(409, 'sso_connection_state'), 'admin:sso.errors.connectionStateTest'],
    ['test', apiError(422, 'validation', { field: 'oidcClientSecret' }), 'admin:sso.errors.fieldSecretMissing'],
    ['test', apiError(422, 'validation', { fields: ['metadataUrl', 'metadataXml'] }), 'admin:sso.errors.fieldSamlMetadata'],
    ['test', apiError(422, 'validation', { fields: ['oidcIssuer', 'oidcClientId'] }), 'admin:sso.errors.fieldOidc'],
    ['test', apiError(422, 'validation'), 'admin:sso.errors.idpRefused'],
    ['test', apiError(400, 'validation'), 'admin:sso.errors.validation'],
    ['test', apiError(503, 'unavailable'), 'admin:sso.errors.unavailable'],
    ['test', apiError(429, 'rate_limited'), 'admin:sso.errors.rateLimited'],
    ['test', apiError(404, 'not_found'), 'admin:sso.errors.notFound'],
    ['test', apiError(403, 'forbidden'), 'admin:sso.errors.forbidden'],
    ['test', apiError(500, 'internal'), 'admin:sso.errors.unknown'],
    ['activate', apiError(409, 'sso_connection_state'), 'admin:sso.errors.connectionStateActivate'],
    ['activate', apiError(409, 'conflict'), 'admin:sso.errors.conflict'],
  ])('renders a failed %s (%s) as translated copy', async (action, err, key) => {
    const user = userEvent.setup();
    const opsApi = ssoApi(
      action === 'test'
        ? { testSsoConnection: vi.fn().mockRejectedValue(err) }
        : { activateSsoConnection: vi.fn().mockRejectedValue(err) },
    );
    renderScreen({ opsApi });
    const detail = await openDetail(user, TESTING.id);
    await user.click(within(detail).getByRole('button', { name: t(`admin:sso.actions.${action}`) }));
    const alert = await actionAlert();
    expect(within(alert).getByText(t(key))).toBeInTheDocument();
    expect(within(alert).queryByText(/English/)).not.toBeInTheDocument();
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('forgets a replaced client secret after a successful edit', async () => {
    const user = userEvent.setup();
    renderScreen();
    const detail = await openDetail(user, SUSPENDED.id);
    await user.click(within(detail).getByRole('button', { name: t('admin:sso.edit.open') }));
    let dialog = await screen.findByRole('dialog', { name: t('admin:sso.edit.title') });
    await user.type(within(dialog).getByLabelText(t('admin:sso.edit.secretReplace'), { exact: false }), 'rotated');
    await user.click(within(dialog).getByRole('button', { name: t('admin:sso.edit.submit') }));
    await screen.findByText(t('admin:sso.edit.success'));
    await waitFor(() => expect(screen.queryByDisplayValue('rotated')).not.toBeInTheDocument());

    await user.click(within(detail).getByRole('button', { name: t('admin:sso.edit.open') }));
    dialog = await screen.findByRole('dialog', { name: t('admin:sso.edit.title') });
    expect(within(dialog).getByLabelText(t('admin:sso.edit.secretReplace'), { exact: false })).toHaveValue('');
  });

  it('drops the single-use start URL when the test note is dismissed', async () => {
    const user = userEvent.setup();
    renderScreen();
    const detail = await openDetail(user, DRAFT.id);
    await user.click(within(detail).getByRole('button', { name: t('admin:sso.actions.test') }));
    expect(await within(detail).findByRole('link', { name: t('admin:sso.actions.testLink') })).toHaveAttribute('href', START_URL);
    await user.click(within(detail).getByRole('button', { name: t('admin:sso.actions.testDismiss') }));
    expect(within(detail).queryByText(t('admin:sso.actions.testNote'))).not.toBeInTheDocument();
    expect(within(detail).queryByRole('link', { name: t('admin:sso.actions.testLink') })).not.toBeInTheDocument();
    expect(document.querySelector(`a[href="${START_URL}"]`)).toBeNull();
  });

  it('refreshes the list after a failed mutation', async () => {
    const user = userEvent.setup();
    const { opsApi } = renderScreen({ opsApi: ssoApi({ activateSsoConnection: vi.fn().mockRejectedValue(apiError(409, 'conflict')) }) });
    const detail = await openDetail(user, TESTING.id);
    expect(opsApi.listSsoConnections).toHaveBeenCalledTimes(1);
    await user.click(within(detail).getByRole('button', { name: t('admin:sso.actions.activate') }));
    await actionAlert();
    await waitFor(() => expect(opsApi.listSsoConnections).toHaveBeenCalledTimes(2));
  });

  it('keeps the suspend confirmation open with the message when suspending fails', async () => {
    const user = userEvent.setup();
    renderScreen({ opsApi: ssoApi({ updateSsoConnection: vi.fn().mockRejectedValue(apiError(409, 'sso_connection_state')) }) });
    const detail = await openDetail(user, ACTIVE.id);
    await user.click(within(detail).getByRole('button', { name: t('admin:sso.actions.suspend') }));
    const confirm = await screen.findByRole('alertdialog', { name: t('admin:sso.actions.suspendTitle') });
    await user.click(within(confirm).getByRole('button', { name: t('admin:sso.actions.suspend') }));
    expect(await within(confirm).findByText(t('admin:sso.errors.connectionState'))).toBeInTheDocument();
    expect(screen.getByRole('alertdialog', { name: t('admin:sso.actions.suspendTitle') })).toBeInTheDocument();
  });

  it.each([
    [apiError(409, 'sso_connection_state'), 'admin:sso.errors.connectionState'],
    [apiError(409, 'conflict'), 'admin:sso.errors.conflict'],
    [apiError(404, 'not_found'), 'admin:sso.errors.notFound'],
  ])('renders a refused reactivate (%s) as translated copy', async (err, key) => {
    const user = userEvent.setup();
    renderScreen({ opsApi: ssoApi({ updateSsoConnection: vi.fn().mockRejectedValue(err) }) });
    const detail = await openDetail(user, SUSPENDED.id);
    await user.click(within(detail).getByRole('button', { name: t('admin:sso.actions.reactivate') }));
    expect(within(await actionAlert()).getByText(t(key))).toBeInTheDocument();
  });

  it.each([
    [apiError(409, 'conflict'), 'admin:sso.errors.conflict'],
    [apiError(404, 'not_found'), 'admin:sso.errors.notFound'],
    [apiError(429, 'rate_limited'), 'admin:sso.errors.rateLimited'],
    [apiError(503, 'unavailable'), 'admin:sso.errors.unavailable'],
  ])('renders a refused edit (%s) in the dialog', async (err, key) => {
    const user = userEvent.setup();
    renderScreen({ opsApi: ssoApi({ updateSsoConnection: vi.fn().mockRejectedValue(err) }) });
    const detail = await openDetail(user, SUSPENDED.id);
    await user.click(within(detail).getByRole('button', { name: t('admin:sso.edit.open') }));
    const dialog = await screen.findByRole('dialog', { name: t('admin:sso.edit.title') });
    await user.type(within(dialog).getByLabelText(t('admin:sso.edit.secretReplace'), { exact: false }), 'x');
    await user.click(within(dialog).getByRole('button', { name: t('admin:sso.edit.submit') }));
    expect(await within(dialog).findByText(t(key))).toBeInTheDocument();
  });

  it('renders a refused status change (sso_connection_state) as translated copy', async () => {
    const user = userEvent.setup();
    renderScreen({ opsApi: ssoApi({ updateSsoConnection: vi.fn().mockRejectedValue(apiError(409, 'sso_connection_state')) }) });
    const detail = await openDetail(user, SUSPENDED.id);
    await user.click(within(detail).getByRole('button', { name: t('admin:sso.actions.reactivate') }));
    expect(within(await actionAlert()).getByText(t('admin:sso.errors.connectionState'))).toBeInTheDocument();
  });

  it('renders a refused edit (protocol, secret) in the dialog', async () => {
    const user = userEvent.setup();
    renderScreen({
      opsApi: ssoApi({
        updateSsoConnection: vi
          .fn()
          .mockRejectedValueOnce(apiError(422, 'validation', { field: 'protocol' }))
          .mockRejectedValueOnce(apiError(422, 'validation', { field: 'oidcClientSecret' })),
      }),
    });
    const detail = await openDetail(user, SUSPENDED.id);
    await user.click(within(detail).getByRole('button', { name: t('admin:sso.edit.open') }));
    const dialog = await screen.findByRole('dialog', { name: t('admin:sso.edit.title') });
    await user.type(within(dialog).getByLabelText(t('admin:sso.edit.secretReplace'), { exact: false }), 'x');
    await user.click(within(dialog).getByRole('button', { name: t('admin:sso.edit.submit') }));
    expect(await within(dialog).findAllByText(t('admin:sso.errors.fieldProtocol'))).not.toHaveLength(0);
    // The write-only secret does not survive a submit, refused or not: type it again.
    const secret = within(dialog).getByLabelText(t('admin:sso.edit.secretReplace'), { exact: false });
    await waitFor(() => expect(secret).toHaveValue(''));
    await user.type(secret, 'x');
    await user.click(within(dialog).getByRole('button', { name: t('admin:sso.edit.submit') }));
    expect(await within(dialog).findAllByText(t('admin:sso.errors.fieldSecret'))).not.toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Sample mode
// ---------------------------------------------------------------------------

describe('SsoScreen in sample mode', () => {
  it('shows the sample connections with every mutation disabled and never calls the API', async () => {
    const user = userEvent.setup();
    const opsApi = ssoApi();
    renderScreen({ opsApi, sampleMode: true });
    expect(await screen.findByText(t('admin:sso.sampleNote'))).toBeInTheDocument();
    for (const row of SAMPLE_SSO_CONNECTIONS) {
      expect(await rowOf(row.id)).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: t('admin:sso.newConnection') })).toBeDisabled();
    const detail = await openDetail(user, 'sso_sample_oidc');
    for (const key of ['admin:sso.actions.test', 'admin:sso.domains.add', 'admin:sso.domains.verify', 'admin:sso.edit.open']) {
      expect(within(detail).getByRole('button', { name: t(key) })).toBeDisabled();
    }
    expect(opsApi.listSsoConnections).not.toHaveBeenCalled();
    expect(opsApi.listOrganizations).not.toHaveBeenCalled();
    expect(opsApi.getOrganization).not.toHaveBeenCalled();
  });
});
