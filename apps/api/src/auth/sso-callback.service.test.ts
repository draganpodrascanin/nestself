/**
 * SsoCallbackService unit tests with the real fake identity provider, the
 * in-memory key-value store and repository fakes: start, every callback
 * resolution path of D-04, Review Focus 1, 2 and 4, the test flag.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FakeIdentityProvider } from '../identity/fake-identity-provider.js';
import { MemoryKeyValueStore } from '../redis/memory-key-value-store.js';
import { pkceKey } from '../redis/redis-keys.js';
import { SsoCallbackService, pkceChallenge, sameEmail } from './sso-callback.service.js';
import { InvitationMembershipActivator } from '../invitations/invitation-membership-activator.js';

const PROVIDER = 'org-acme-saml';
const API = 'http://api.test';
const CALLBACK = `${API}/api/auth/sso/callback`;
const META = { ip: '127.0.0.1', userAgent: 'vitest' };

type Conn = {
  id: string;
  orgId: string;
  cognitoProviderName: string;
  protocol: 'SAML' | 'OIDC';
  status: 'DRAFT' | 'TESTING' | 'ACTIVE' | 'SUSPENDED';
  jitProvisioning: boolean;
  defaultOrgUnitId: string | null;
};

function connection(overrides: Partial<Conn> = {}): Conn {
  return {
    id: 'conn_1',
    orgId: 'org_sample',
    cognitoProviderName: PROVIDER,
    protocol: 'OIDC',
    status: 'ACTIVE',
    jitProvisioning: false,
    defaultOrgUnitId: 'unit_1',
    ...overrides,
  };
}

function invitation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inv_1',
    email: 'new@acme.example',
    orgId: 'org_sample',
    orgUnitId: 'unit_2',
    templateKey: 'employee',
    invitedByUserId: 'user_ivana',
    acceptedAt: null,
    revokedAt: null,
    ...overrides,
  };
}

function setup(opts: { conn?: Conn | null; domainVerified?: boolean; domainConnectionId?: string } = {}) {
  const conn = opts.conn === undefined ? connection() : opts.conn;
  const idp = new FakeIdentityProvider({ apiPublicUrl: API });
  void idp.createProvider({ name: PROVIDER, protocol: 'OIDC', oidcIssuer: 'https://idp', oidcClientId: 'c', attributeMapping: {} });
  const store = new MemoryKeyValueStore();
  const tx = {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 'membership_1' }]) }),
    }),
  };
  const dbs = { withOrgScope: vi.fn(async (_org: string, fn: (t: unknown) => Promise<unknown>) => fn(tx)) };
  const sso = {
    findConnectionByProviderName: vi.fn().mockResolvedValue(conn),
    findDomainByName: vi.fn().mockResolvedValue(
      opts.domainVerified === false
        ? null
        : { connectionId: opts.domainConnectionId ?? 'conn_1', verifiedAt: new Date(), domain: 'acme.example' },
    ),
    updateConnection: vi.fn().mockResolvedValue({}),
  };
  const identities = {
    findExternalIdentity: vi.fn().mockResolvedValue(null),
    findUserByEmail: vi.fn().mockResolvedValue(null),
    createUser: vi.fn().mockResolvedValue({ id: 'user_new' }),
    createExternalIdentity: vi.fn().mockResolvedValue({}),
  };
  const invitations = {
    findPendingByEmailAndOrg: vi.fn().mockResolvedValue(null),
    accept: vi.fn().mockResolvedValue({}),
  };
  const memberships = { findByUserId: vi.fn().mockResolvedValue([]) };
  const authz = { createGrant: vi.fn().mockResolvedValue({}), findActiveOwnerGrants: vi.fn().mockResolvedValue([]) };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const activator = new InvitationMembershipActivator(
    invitations as never, memberships as never, authz as never, audit as never,
  );
  const principalLoader = { invalidateUser: vi.fn().mockResolvedValue(undefined) };
  const identity = {
    resolveIdentityAndCreateSession: vi.fn().mockResolvedValue({
      sessionId: 'sess_1', csrfToken: 'csrf_1', absoluteExpiresAt: new Date('2026-11-01'),
    }),
  };
  const config = {
    get: vi.fn((key: string, fallback?: string) =>
      ({ API_PUBLIC_URL: API, WORKSPACE_URL: 'http://ws.test/', ADMIN_URL: 'http://admin.test', AUTH_MODE: 'stub' })[key] ?? fallback),
  };
  const service = new SsoCallbackService(
    idp, store, dbs as never, sso as never, identities as never, invitations as never, activator,
    audit as never, principalLoader as never, identity as never, config as never,
  );
  return { service, idp, store, dbs, sso, identities, invitations, memberships, authz, audit, principalLoader, identity, tx };
}

type Ctx = ReturnType<typeof setup>;

/** Run start, then mint a code as the fake authorize route would. */
async function startAndAuthorize(
  ctx: Ctx,
  user: { subject?: string; email?: string; emailVerified?: boolean } = {},
  query: { surface?: 'workspace' | 'admin'; returnPath?: string; test?: '1' } = {},
) {
  const subject = user.subject ?? 'idp-subject-1';
  ctx.idp.seedFederatedUsers([
    { providerName: PROVIDER, subject, email: user.email ?? 'new@acme.example', emailVerified: user.emailVerified ?? true },
  ]);
  const started = await ctx.service.start(
    { connection: PROVIDER, surface: query.surface ?? 'workspace', ...(query.returnPath ? { returnPath: query.returnPath } : {}), ...(query.test ? { test: query.test } : {}) },
    META,
  );
  const url = new URL(started.location);
  const state = url.searchParams.get('state')!;
  const code = ctx.idp.issueAuthorizationCode(PROVIDER, subject, url.searchParams.get('code_challenge')!, CALLBACK);
  return { state, code, url };
}

function auditActions(ctx: Ctx): string[] {
  return ctx.audit.record.mock.calls.map((c) => (c[0] as { action: string }).action);
}

function allAuditDetails(ctx: Ctx): string {
  return JSON.stringify(ctx.audit.record.mock.calls.map((c) => c[0]));
}

describe('SsoCallbackService', () => {
  beforeEach(() => vi.restoreAllMocks());

  describe('start (API-R-06)', () => {
    it('stores the PKCE record under pkce:{state} and redirects to the authorize URL with an S256 challenge', async () => {
      const ctx = setup();
      const res = await ctx.service.start({ connection: PROVIDER, surface: 'admin', returnPath: '/people' }, META);
      const url = new URL(res.location);
      expect(url.origin + url.pathname).toBe(`${API}/api/auth/sso/_fake/authorize`);
      expect(url.searchParams.get('connection')).toBe(PROVIDER);
      expect(url.searchParams.get('redirect_uri')).toBe(CALLBACK);
      const state = url.searchParams.get('state')!;
      expect(Buffer.from(state, 'base64url')).toHaveLength(32);
      const raw = await ctx.store.get(pkceKey(state));
      const record = JSON.parse(raw!);
      expect(record).toMatchObject({ surface: 'admin', returnPath: '/people', connection: PROVIDER, test: false });
      expect(url.searchParams.get('code_challenge')).toBe(pkceChallenge(record.verifier));
      expect(await ctx.store.ttl(pkceKey(state))).toBeGreaterThan(590);
    });

    it.each([
      ['unknown', null],
      ['SUSPENDED', connection({ status: 'SUSPENDED' })],
      ['DRAFT', connection({ status: 'DRAFT' })],
      ['TESTING without the test flag', connection({ status: 'TESTING' })],
    ])('sends a %s connection to the neutral sign-in error', async (_label, conn) => {
      const ctx = setup({ conn });
      const res = await ctx.service.start({ connection: PROVIDER, surface: 'workspace' }, META);
      expect(res.location).toBe('http://ws.test/sign-in?reason=sso_denied');
      expect(res.session).toBeUndefined();
    });

    it('lets a staff test sign-in start on a TESTING connection', async () => {
      const ctx = setup({ conn: connection({ status: 'TESTING' }) });
      const res = await ctx.service.start({ connection: PROVIDER, surface: 'workspace', test: '1' }, META);
      expect(res.location).toContain('/api/auth/sso/_fake/authorize?');
    });
  });

  describe('callback: state (Review Focus 1)', () => {
    it('answers a never-issued state with the neutral redirect and audits auth.sign_in.failed', async () => {
      const ctx = setup();
      const res = await ctx.service.callback({ code: 'x', state: 'never-issued' }, META);
      expect(res).toEqual({ location: 'http://ws.test/sign-in?reason=sso_denied' });
      expect(ctx.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'auth.sign_in.failed', details: { reason: 'sso_state' } }),
      );
      expect(ctx.identity.resolveIdentityAndCreateSession).not.toHaveBeenCalled();
    });

    it('answers a replayed state the same way: the record was consumed', async () => {
      const ctx = setup();
      ctx.identities.findExternalIdentity.mockResolvedValue({ userId: 'user_known' });
      const { state, code, url } = await startAndAuthorize(ctx);
      const first = await ctx.service.callback({ code, state }, META);
      expect(first.session).toBeDefined();
      // Even with a fresh, valid code the consumed state is gone.
      const fresh = ctx.idp.issueAuthorizationCode(PROVIDER, 'idp-subject-1', url.searchParams.get('code_challenge')!, CALLBACK);
      const second = await ctx.service.callback({ code: fresh, state }, META);
      expect(second).toEqual({ location: 'http://ws.test/sign-in?reason=sso_denied' });
      expect(ctx.identity.resolveIdentityAndCreateSession).toHaveBeenCalledTimes(1);
    });

    it('denies when the IdP returned an error instead of a code', async () => {
      const ctx = setup();
      const { state } = await startAndAuthorize(ctx, {}, { surface: 'admin' });
      const res = await ctx.service.callback({ error: 'access_denied', state }, META);
      expect(res.location).toBe('http://admin.test/sign-in?reason=sso_denied');
    });

    it('denies when the code exchange fails (wrong verifier, used code)', async () => {
      const ctx = setup();
      const { state } = await startAndAuthorize(ctx);
      const res = await ctx.service.callback({ code: 'not-a-code', state }, META);
      expect(res.location).toBe('http://ws.test/sign-in?reason=sso_denied');
      expect(auditActions(ctx)).toContain('auth.sign_in.failed');
    });

    it('never puts the code, verifier, state or tokens into an audit row', async () => {
      const ctx = setup();
      const { state, code } = await startAndAuthorize(ctx);
      const record = JSON.parse((await ctx.store.get(pkceKey(state)))!);
      await ctx.service.callback({ code, state }, META);
      await ctx.service.callback({ code, state }, META);
      const dump = allAuditDetails(ctx);
      expect(dump).not.toContain(code);
      expect(dump).not.toContain(state);
      expect(dump).not.toContain(record.verifier);
    });
  });

  describe('callback: existing identity', () => {
    it('signs in with sso + second factor and redirects to the return path', async () => {
      const ctx = setup();
      ctx.identities.findExternalIdentity.mockResolvedValue({ userId: 'user_known' });
      const { state, code } = await startAndAuthorize(ctx, {}, { returnPath: '/people?x=1' });
      const res = await ctx.service.callback({ code, state }, META);
      expect(res.location).toBe('http://ws.test/people?x=1');
      expect(res.session).toEqual({ sessionId: 'sess_1', csrfToken: 'csrf_1', absoluteExpiresAt: new Date('2026-11-01') });
      expect(ctx.identities.findExternalIdentity).toHaveBeenCalledWith(`cognito:${PROVIDER}`, expect.any(String));
      expect(ctx.identity.resolveIdentityAndCreateSession).toHaveBeenCalledWith(
        expect.anything(), 'new@acme.example', 'workspace', META, false, true, PROVIDER,
      );
      expect(ctx.identities.createExternalIdentity).not.toHaveBeenCalled();
    });

    it('still signs in when the connection is SUSPENDED (Review Focus 4)', async () => {
      const ctx = setup();
      ctx.identities.findExternalIdentity.mockResolvedValue({ userId: 'user_known' });
      const { state, code } = await startAndAuthorize(ctx);
      ctx.sso.findConnectionByProviderName.mockResolvedValue(connection({ status: 'SUSPENDED' }));
      const res = await ctx.service.callback({ code, state }, META);
      expect(res.session).toBeDefined();
      expect(res.location).toBe('http://ws.test/');
    });

    it('redirects neutrally when session creation is refused (suspended user)', async () => {
      const ctx = setup();
      ctx.identities.findExternalIdentity.mockResolvedValue({ userId: 'user_known' });
      ctx.identity.resolveIdentityAndCreateSession.mockRejectedValue(new Error('suspended'));
      const { state, code } = await startAndAuthorize(ctx);
      const res = await ctx.service.callback({ code, state }, META);
      expect(res).toEqual({ location: 'http://ws.test/sign-in?reason=sso_denied' });
    });
  });

  describe('callback: pending invitation', () => {
    it('binds, activates the membership, accepts the invitation and audits identity.linked + invitation.accepted', async () => {
      const ctx = setup();
      ctx.invitations.findPendingByEmailAndOrg.mockResolvedValue(invitation());
      const { state, code } = await startAndAuthorize(ctx, { email: 'New@Acme.example' });
      const res = await ctx.service.callback({ code, state }, META);

      expect(res.session).toBeDefined();
      expect(ctx.dbs.withOrgScope).toHaveBeenCalledWith('org_sample', expect.any(Function));
      expect(ctx.invitations.findPendingByEmailAndOrg).toHaveBeenCalledWith('new@acme.example', 'org_sample', expect.any(Date), ctx.tx);
      expect(ctx.identities.createExternalIdentity).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user_new', provider: `cognito:${PROVIDER}`, email: 'new@acme.example', emailVerified: true }),
        ctx.tx,
      );
      expect(ctx.tx.insert).toHaveBeenCalled();
      expect(ctx.authz.createGrant).toHaveBeenCalledWith(
        expect.objectContaining({ subjectUserId: 'user_new', templateKey: 'employee', scopeOrgId: 'org_sample', grantedByUserId: 'user_ivana' }),
        ctx.tx,
      );
      expect(ctx.invitations.accept).toHaveBeenCalledWith('inv_1', expect.any(Date), 'user_new', ctx.tx);
      expect(auditActions(ctx)).toEqual(
        expect.arrayContaining(['user.created', 'identity.linked', 'membership.activated', 'invitation.accepted']),
      );
      expect(ctx.principalLoader.invalidateUser).toHaveBeenCalledWith('user_new', ['org_sample']);
    });

    it('reuses an existing user with the same email', async () => {
      const ctx = setup();
      ctx.invitations.findPendingByEmailAndOrg.mockResolvedValue(invitation());
      ctx.identities.findUserByEmail.mockResolvedValue({ id: 'user_existing' });
      const { state, code } = await startAndAuthorize(ctx);
      await ctx.service.callback({ code, state }, META);
      expect(ctx.identities.createUser).not.toHaveBeenCalled();
      expect(ctx.invitations.accept).toHaveBeenCalledWith('inv_1', expect.any(Date), 'user_existing', ctx.tx);
    });

    it('does not bind an invitation of another organization (Review Focus 2)', async () => {
      const ctx = setup();
      // Even if a lookup returned one, an invitation outside the connection's org never binds.
      ctx.invitations.findPendingByEmailAndOrg.mockResolvedValue(invitation({ orgId: 'org_other' }));
      const deleteUser = vi.spyOn(ctx.idp, 'deleteUser');
      const { state, code } = await startAndAuthorize(ctx);
      const res = await ctx.service.callback({ code, state }, META);
      expect(res).toEqual({ location: 'http://ws.test/sign-in?reason=sso_denied' });
      expect(ctx.invitations.accept).not.toHaveBeenCalled();
      expect(deleteUser).toHaveBeenCalledWith(`${PROVIDER}_idp-subject-1`);
      expect(auditActions(ctx)).toContain('identity.denied');
    });

    it('does not bind when the invitation email differs', async () => {
      const ctx = setup();
      ctx.invitations.findPendingByEmailAndOrg.mockResolvedValue(invitation({ email: 'other@acme.example' }));
      const { state, code } = await startAndAuthorize(ctx);
      const res = await ctx.service.callback({ code, state }, META);
      expect(res.location).toContain('reason=sso_denied');
    });

    it('denies neutrally when the binding transaction fails', async () => {
      const ctx = setup();
      ctx.invitations.findPendingByEmailAndOrg.mockResolvedValue(invitation());
      ctx.identities.createExternalIdentity.mockRejectedValue(Object.assign(new Error('dup'), { code: '23505' }));
      const { state, code } = await startAndAuthorize(ctx);
      const res = await ctx.service.callback({ code, state }, META);
      expect(res).toEqual({ location: 'http://ws.test/sign-in?reason=sso_denied' });
      expect(ctx.identity.resolveIdentityAndCreateSession).not.toHaveBeenCalled();
    });
  });

  describe('callback: JIT', () => {
    it('creates user, ACTIVE membership in the default unit with the employee grant, identity; audits identity.created + identity.linked', async () => {
      const ctx = setup({ conn: connection({ jitProvisioning: true }) });
      const { state, code } = await startAndAuthorize(ctx);
      const res = await ctx.service.callback({ code, state }, META);
      expect(res.session).toBeDefined();
      const values = ctx.tx.insert.mock.results[0]!.value.values as ReturnType<typeof vi.fn>;
      expect(values).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user_new', orgId: 'org_sample', orgUnitId: 'unit_1', status: 'ACTIVE' }));
      expect(ctx.authz.createGrant).toHaveBeenCalledWith(expect.objectContaining({ templateKey: 'employee', scopeOrgId: 'org_sample' }), ctx.tx);
      expect(auditActions(ctx)).toEqual(expect.arrayContaining(['identity.created', 'identity.linked', 'membership.activated']));
      expect(ctx.invitations.accept).not.toHaveBeenCalled();
    });

    it('does not provision when the domain is not verified for this connection', async () => {
      const ctx = setup({ conn: connection({ jitProvisioning: true }), domainConnectionId: 'conn_other' });
      const { state, code } = await startAndAuthorize(ctx);
      const res = await ctx.service.callback({ code, state }, META);
      expect(res.location).toContain('reason=sso_denied');
      expect(ctx.identities.createExternalIdentity).not.toHaveBeenCalled();
    });

    it('denies, deletes the orphan and audits identity.denied with JIT off and no invitation', async () => {
      const ctx = setup();
      const deleteUser = vi.spyOn(ctx.idp, 'deleteUser');
      const { state, code } = await startAndAuthorize(ctx);
      const res = await ctx.service.callback({ code, state }, META);
      expect(res).toEqual({ location: 'http://ws.test/sign-in?reason=sso_denied' });
      expect(deleteUser).toHaveBeenCalledTimes(1);
      expect(ctx.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'identity.denied', result: 'DENIED', details: expect.objectContaining({ reason: 'no_invitation' }) }),
      );
    });
  });

  describe('callback: email verification (SSO-R-08)', () => {
    it('OIDC: an unverified email binds nothing and lands on sso_email_unverified with the email', async () => {
      const ctx = setup();
      ctx.invitations.findPendingByEmailAndOrg.mockResolvedValue(invitation());
      const deleteUser = vi.spyOn(ctx.idp, 'deleteUser');
      const { state, code } = await startAndAuthorize(ctx, { emailVerified: false });
      const res = await ctx.service.callback({ code, state }, META);
      expect(res.location).toBe('http://ws.test/sign-in?reason=sso_email_unverified&email=new%40acme.example');
      expect(res.session).toBeUndefined();
      expect(ctx.dbs.withOrgScope).not.toHaveBeenCalled();
      expect(deleteUser).toHaveBeenCalled();
    });

    it('SAML: an unverified claim is inferred verified when the domain is verified for the connection', async () => {
      const ctx = setup({ conn: connection({ protocol: 'SAML' }) });
      ctx.invitations.findPendingByEmailAndOrg.mockResolvedValue(invitation());
      const { state, code } = await startAndAuthorize(ctx, { emailVerified: false });
      const res = await ctx.service.callback({ code, state }, META);
      expect(res.session).toBeDefined();
    });

    it('SAML: no inference when the domain is not verified for it', async () => {
      const ctx = setup({ conn: connection({ protocol: 'SAML' }), domainVerified: false });
      ctx.invitations.findPendingByEmailAndOrg.mockResolvedValue(invitation());
      const { state, code } = await startAndAuthorize(ctx, { emailVerified: false });
      const res = await ctx.service.callback({ code, state }, META);
      expect(res.location).toContain('reason=sso_email_unverified');
    });
  });

  describe('callback: connection state for new bindings', () => {
    it('denies a new binding through a SUSPENDED connection', async () => {
      const ctx = setup();
      ctx.invitations.findPendingByEmailAndOrg.mockResolvedValue(invitation());
      const { state, code } = await startAndAuthorize(ctx);
      ctx.sso.findConnectionByProviderName.mockResolvedValue(connection({ status: 'SUSPENDED' }));
      const res = await ctx.service.callback({ code, state }, META);
      expect(res.location).toContain('reason=sso_denied');
      expect(ctx.invitations.accept).not.toHaveBeenCalled();
    });

    it('test flag on a TESTING connection: binds and sets lastTestedAt', async () => {
      const ctx = setup({ conn: connection({ status: 'TESTING' }) });
      ctx.invitations.findPendingByEmailAndOrg.mockResolvedValue(invitation());
      const { state, code } = await startAndAuthorize(ctx, {}, { test: '1' });
      const res = await ctx.service.callback({ code, state }, META);
      expect(res.session).toBeDefined();
      expect(ctx.sso.updateConnection).toHaveBeenCalledWith(
        'conn_1', { lastTestedAt: expect.any(Date) }, ctx.tx, { fromStatus: 'TESTING' },
      );
    });

    it('does not touch lastTestedAt without the test flag', async () => {
      const ctx = setup();
      ctx.identities.findExternalIdentity.mockResolvedValue({ userId: 'user_known' });
      const { state, code } = await startAndAuthorize(ctx);
      await ctx.service.callback({ code, state }, META);
      expect(ctx.sso.updateConnection).not.toHaveBeenCalled();
    });

    it('denies a code minted for another provider than the flow started with', async () => {
      const ctx = setup();
      await ctx.idp.createProvider({ name: 'org-other-oidc', protocol: 'OIDC', oidcIssuer: 'https://o', oidcClientId: 'c', attributeMapping: {} });
      ctx.idp.seedFederatedUsers([{ providerName: 'org-other-oidc', subject: 's2', email: 'x@other.example', emailVerified: true }]);
      const { state, url } = await startAndAuthorize(ctx);
      const code = ctx.idp.issueAuthorizationCode('org-other-oidc', 's2', url.searchParams.get('code_challenge')!, CALLBACK);
      const res = await ctx.service.callback({ code, state }, META);
      expect(res.location).toContain('reason=sso_denied');
      expect(ctx.identities.findExternalIdentity).not.toHaveBeenCalled();
    });
  });
});

describe('sameEmail (SSO-R-09)', () => {
  it('compares lowercased and trimmed', () => {
    expect(sameEmail(' A@Acme.Example ', 'a@acme.example')).toBe(true);
    expect(sameEmail('a@acme.example', 'b@acme.example')).toBe(false);
  });
});
