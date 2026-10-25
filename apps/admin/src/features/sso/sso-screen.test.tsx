import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UserEvent } from '@testing-library/user-event';
import type { SsoConnectionResponse, SsoDomainResponse } from '@nestself/contracts';
import { SAMPLE_SSO_CONNECTIONS } from '@nestself/sample-data';
import { SsoScreen } from './sso-screen';
import { ORG_ID, STAFF_ACTIONS, apiError, choose, makeAuth, makeOpsApi, renderOps, t } from '../organizations/ops-test-harness';
import type { RenderOpts } from '../organizations/ops-test-harness';

const START_URL = 'http://localhost:4000/api/auth/sso/start?connection=org-draft-saml&surface=workspace&testNonce=abc';

function domain(id: string, name: string, verified: boolean): SsoDomainResponse {
  return {
    id,
    domain: name,
    verifiedAt: verified ? '2026-10-20T10:00:00.000Z' : null,
    txtRecordName: `_nestself-verify.${name}`,
    txtRecordValue: `nestself-domain-verification=token-${id}`,
  };
}

function connection(id: string, overrides: Partial<SsoConnectionResponse> = {}): SsoConnectionResponse {
  return {
    id,
    orgId: ORG_ID,
    protocol: 'SAML',
    cognitoProviderName: `org-${id}-saml`,
    status: 'DRAFT',
    metadataUrl: 'https://idp.example.test/metadata',
    oidcIssuer: null,
    oidcClientId: null,
    idpInitiatedAllowed: false,
    jitProvisioning: false,
    defaultOrgUnitId: null,
    certificateExpiresAt: null,
    lastTestedAt: null,
    domains: [],
    spMetadata: { entityId: 'urn:amazon:cognito:sp:eu-central-1_TEST', acsUrl: 'https://auth.example.test/saml2/idpresponse' },
    ...overrides,
  };
}

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

function ssoApi(overrides: Record<string, unknown> = {}) {
  return makeOpsApi({
    listSsoConnections: vi.fn().mockResolvedValue({ items: ALL }),
    createSsoConnection: vi.fn().mockResolvedValue(connection('new')),
    updateSsoConnection: vi.fn().mockResolvedValue(ACTIVE),
    addSsoDomain: vi.fn().mockResolvedValue(domain('d_new', 'new.example.test', false)),
    verifySsoDomain: vi.fn().mockResolvedValue(domain('d_pending', 'pending.example.test', true)),
    testSsoConnection: vi.fn().mockResolvedValue({ startUrl: START_URL }),
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
        defaultOrgUnitId: 'unit_1',
      }),
    );
  });

  it.each([
    [apiError(409, 'conflict'), 'admin:sso.errors.conflictProviderName'],
    [apiError(422, 'validation', { field: 'slug' }), 'admin:sso.errors.fieldSlug'],
    [apiError(422, 'validation', { field: 'defaultOrgUnitId' }), 'admin:sso.errors.fieldDefaultOrgUnit'],
    [apiError(422, 'validation', { field: 'idpInitiatedAllowed' }), 'admin:sso.errors.fieldIdpInitiated'],
    [apiError(422, 'validation'), 'admin:sso.errors.idpRefused'],
  ])('renders a refused create (%s) in the dialog', async (err, key) => {
    const user = userEvent.setup();
    renderScreen({ opsApi: ssoApi({ createSsoConnection: vi.fn().mockRejectedValue(err) }) });
    const dialog = await openCreate(user);
    await fillSaml(user, dialog);
    await submitCreate(user, dialog);
    expect(await within(dialog).findAllByText(t(key))).not.toHaveLength(0);
    expect(within(dialog).queryByText(/English/)).not.toBeInTheDocument();
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

  it('starts a test sign-in in a new tab without an opener and explains the single-use link', async () => {
    const user = userEvent.setup();
    const { opsApi } = renderScreen();
    const detail = await openDetail(user, DRAFT.id);
    await user.click(within(detail).getByRole('button', { name: t('admin:sso.actions.test') }));
    await waitFor(() => expect(opsApi.testSsoConnection).toHaveBeenCalledWith(DRAFT.id));
    expect(openSpy).toHaveBeenCalledWith(START_URL, '_blank', 'noopener,noreferrer');
    expect(await within(detail).findByText(t('admin:sso.actions.testNote'))).toBeInTheDocument();
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
  });
});
