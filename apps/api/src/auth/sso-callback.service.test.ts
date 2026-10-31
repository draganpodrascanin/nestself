/**
 * SsoCallbackService unit tests with the real fake identity provider, the
 * in-memory key-value store and repository fakes: start, every callback
 * resolution path of D-04, Review Focus 1, 2 and 4, the test flag.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Logger } from '@nestjs/common';
import { FakeIdentityProvider } from '../identity/fake-identity-provider.js';
import { MemoryKeyValueStore } from '../redis/memory-key-value-store.js';
import { pkceKey } from '../redis/redis-keys.js';
import { SsoCallbackService, pkceChallenge, sameEmail } from './sso-callback.service.js';
import { InvitationMembershipActivator } from '../invitations/invitation-membership-activator.js';

const PROVIDER = 'org-acme-saml';
const API = 'http://api.test';
/** Each surface's flow runs on that surface's origin (apiOriginForSurface). */
const CALLBACK = 'http://ws.test/api/auth/sso/callback';
const ADMIN_CALLBACK = 'http://admin.test/api/auth/sso/callback';
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

/**
 * What `findExternalIdentity` returns for the known federated user: the
 * identity was bound through `conn_1` (the connection of `setup()`), as
 * `linkIdentity` records it.
 */
function boundIdentity(overrides: { userId?: string; ssoConnectionId?: string | null } = {}) {
  return { userId: 'user_known', ssoConnectionId: 'conn_1', ...overrides };
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
    findDomainByName: vi.fn(async (domain: string) =>
      opts.domainVerified === false || domain !== 'acme.example'
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
  // The known user of path 1 belongs to the connection's organization.
  const memberships = {
    findByUserId: vi.fn(async (userId: string) =>
      userId === 'user_known' ? [{ userId, orgId: 'org_sample', status: 'ACTIVE' }] : [],
    ),
  };
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
    audit as never, principalLoader as never, identity as never, config as never, memberships as never,
  );
  return { service, idp, store, dbs, sso, identities, invitations, memberships, authz, audit, principalLoader, identity, tx };
}

type Ctx = ReturnType<typeof setup>;

/** Run start, then mint a code as the fake authorize route would. */
async function startAndAuthorize(
  ctx: Ctx,
  user: { subject?: string; email?: string; emailVerified?: boolean } = {},
  query: { surface?: 'workspace' | 'admin'; returnPath?: string; test?: string } = {},
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
  // As the fake authorize hop does: bound to the redirect URI the flow sent.
  const code = ctx.idp.issueAuthorizationCode(
    PROVIDER, subject, url.searchParams.get('code_challenge')!, url.searchParams.get('redirect_uri')!,
  );
  return { state, code, url, nonce: started.browserNonce! };
}

const TEST_NONCE = 't'.repeat(43);

/** What `POST /ops/sso-connections/:id/test` stores. */
async function issueTestNonce(ctx: Ctx, connectionId = 'conn_1', nonce = TEST_NONCE): Promise<string> {
  await ctx.store.set(`sso_test:${nonce}`, JSON.stringify({ connectionId }), { ttlSeconds: 900 });
  return nonce;
}

function auditActions(ctx: Ctx): string[] {
  return ctx.audit.record.mock.calls.map((c) => (c[0] as { action: string }).action);
}

function allAuditDetails(ctx: Ctx): string {
  return JSON.stringify(ctx.audit.record.mock.calls.map((c) => c[0]));
}

/** Each audit action with whether it was written through the binding transaction. */
function auditTransactions(ctx: Ctx): Array<[string, boolean]> {
  return (ctx.audit.record.mock.calls as unknown as Array<[{ action: string }, { tx?: unknown }?]>).map(
    ([event, opts]) => [event.action, opts?.tx === ctx.tx],
  );
}

describe('SsoCallbackService', () => {
  beforeEach(() => vi.restoreAllMocks());

  describe('start (API-R-06)', () => {
    it('stores the PKCE record under pkce:{state} and redirects to the authorize URL with an S256 challenge', async () => {
      const ctx = setup();
      const res = await ctx.service.start({ connection: PROVIDER, surface: 'admin', returnPath: '/people' }, META);
      const url = new URL(res.location);
      expect(url.origin + url.pathname).toBe('http://admin.test/api/auth/sso/_fake/authorize');
      expect(url.searchParams.get('connection')).toBe(PROVIDER);
      expect(url.searchParams.get('redirect_uri')).toBe(ADMIN_CALLBACK);
      const state = url.searchParams.get('state')!;
      expect(Buffer.from(state, 'base64url')).toHaveLength(32);
      const raw = await ctx.store.get(pkceKey(state));
      const record = JSON.parse(raw!);
      expect(record).toMatchObject({ surface: 'admin', returnPath: '/people', connection: PROVIDER, testNonce: null });
      expect(url.searchParams.get('code_challenge')).toBe(pkceChallenge(record.verifier));
      expect(await ctx.store.ttl(pkceKey(state))).toBeGreaterThan(590);
    });

    it.each([
      ['workspace', CALLBACK],
      ['admin', ADMIN_CALLBACK],
    ] as const)('sends the %s origin callback as redirect_uri (the session cookie lands on that host)', async (surface, callback) => {
      const ctx = setup();
      const res = await ctx.service.start({ connection: PROVIDER, surface }, META);
      const url = new URL(res.location);
      expect(url.searchParams.get('redirect_uri')).toBe(callback);
      expect(url.searchParams.get('redirect_uri')).not.toContain(API);
    });

    it.each([
      ['workspace', CALLBACK, 'http://ws.test/'],
      ['admin', ADMIN_CALLBACK, 'http://admin.test/'],
    ] as const)('exchanges a %s code with the same redirect_uri it sent (Cognito validates it)', async (surface, callback, landing) => {
      const ctx = setup();
      ctx.identities.findExternalIdentity.mockResolvedValue(boundIdentity());
      const exchange = vi.spyOn(ctx.idp, 'exchangeAuthorizationCode');
      const { state, code, url, nonce } = await startAndAuthorize(ctx, {}, { surface });
      const res = await ctx.service.callback({ code, state }, META, nonce);
      expect(exchange).toHaveBeenCalledWith(expect.objectContaining({ redirectUri: callback }));
      expect(exchange.mock.calls[0]![0].redirectUri).toBe(url.searchParams.get('redirect_uri'));
      expect(res.location).toBe(landing);
      expect(res.session).toBeDefined();
    });

    it('sends an unknown connection to the neutral sign-in error with one debug line and no audit row', async () => {
      // The row would name no tenant, and rotating connection values (one
      // throttle bucket each) would let one client write rows without bound.
      const ctx = setup({ conn: null });
      const debug = vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => {});
      const res = await ctx.service.start({ connection: 'org-nope-saml', surface: 'workspace' }, META);
      expect(res).toEqual({ location: 'http://ws.test/sign-in?reason=sso_denied' });
      expect(ctx.audit.record).not.toHaveBeenCalled();
      expect(debug).toHaveBeenCalledTimes(1);
      expect(String(debug.mock.calls[0]![0])).toContain('org-nope-saml');
    });

    it.each([
      ['SUSPENDED', connection({ status: 'SUSPENDED' })],
      ['DRAFT', connection({ status: 'DRAFT' })],
      ['TESTING without the test flag', connection({ status: 'TESTING' })],
    ])('sends a %s connection to the neutral sign-in error and audits it for its organization', async (_label, conn) => {
      const ctx = setup({ conn });
      const res = await ctx.service.start({ connection: PROVIDER, surface: 'workspace' }, META);
      expect(res).toEqual({ location: 'http://ws.test/sign-in?reason=sso_denied' });
      expect(ctx.audit.record).toHaveBeenCalledTimes(1);
      expect(ctx.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'auth.sign_in.failed',
          orgId: 'org_sample',
          recordId: PROVIDER,
          details: { reason: 'sso_connection' },
        }),
      );
    });

    it('lets a staff test sign-in start on a TESTING connection with the issued nonce', async () => {
      const ctx = setup({ conn: connection({ status: 'TESTING' }) });
      const res = await ctx.service.start({ connection: PROVIDER, surface: 'workspace', test: await issueTestNonce(ctx) }, META);
      expect(res.location).toContain('/api/auth/sso/_fake/authorize?');
    });

    it.each([
      ['an unknown nonce', async (_ctx: Ctx) => TEST_NONCE],
      ['a nonce issued for another connection', async (ctx: Ctx) => issueTestNonce(ctx, 'conn_other')],
    ])('refuses a TESTING start with %s', async (_label, nonceFor) => {
      const ctx = setup({ conn: connection({ status: 'TESTING' }) });
      const res = await ctx.service.start({ connection: PROVIDER, surface: 'workspace', test: await nonceFor(ctx) }, META);
      expect(res).toEqual({ location: 'http://ws.test/sign-in?reason=sso_denied' });
      expect(ctx.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'auth.sign_in.failed', orgId: 'org_sample', details: { reason: 'sso_connection' } }),
      );
    });

    it('sets a browser-binding nonce whose hash (not the nonce) is in the record', async () => {
      const ctx = setup();
      const res = await ctx.service.start({ connection: PROVIDER, surface: 'workspace' }, META);
      expect(res.browserNonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const state = new URL(res.location).searchParams.get('state')!;
      const raw = (await ctx.store.get(pkceKey(state)))!;
      expect(raw).not.toContain(res.browserNonce!);
      expect(JSON.parse(raw).browserNonceHash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('callback: state (Review Focus 1)', () => {
    it('answers a never-issued state with the neutral redirect and audits auth.sign_in.failed', async () => {
      const ctx = setup();
      const res = await ctx.service.callback({ code: 'x', state: 'never-issued' }, META, null);
      expect(res).toEqual({ location: 'http://ws.test/sign-in?reason=sso_denied' });
      expect(ctx.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'auth.sign_in.failed', details: { reason: 'sso_state' } }),
      );
      expect(ctx.identity.resolveIdentityAndCreateSession).not.toHaveBeenCalled();
    });

    it('answers only once auth.sign_in.failed is written, so the row exists when the redirect leaves', async () => {
      const ctx = setup();
      let release!: () => void;
      ctx.audit.record.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
      let answered = false;
      const pending = ctx.service.callback({ code: 'x', state: 'never-issued' }, META, null).then((res) => {
        answered = true;
        return res;
      });
      await new Promise((resolve) => setImmediate(resolve));
      expect(ctx.audit.record).toHaveBeenCalledTimes(1);
      expect(answered).toBe(false);
      release();
      expect(await pending).toEqual({ location: 'http://ws.test/sign-in?reason=sso_denied' });
    });

    it('still redirects when the auth.sign_in.failed write fails', async () => {
      const ctx = setup();
      ctx.audit.record.mockRejectedValueOnce(new Error('db down'));
      const res = await ctx.service.callback({ code: 'x', state: 'never-issued' }, META, null);
      expect(res).toEqual({ location: 'http://ws.test/sign-in?reason=sso_denied' });
    });

    it('answers a replayed state the same way: the record was consumed', async () => {
      const ctx = setup();
      ctx.identities.findExternalIdentity.mockResolvedValue(boundIdentity());
      const { state, code, url, nonce } = await startAndAuthorize(ctx);
      const first = await ctx.service.callback({ code, state }, META, nonce);
      expect(first.session).toBeDefined();
      // Even with a fresh, valid code the consumed state is gone.
      const fresh = ctx.idp.issueAuthorizationCode(PROVIDER, 'idp-subject-1', url.searchParams.get('code_challenge')!, CALLBACK);
      const second = await ctx.service.callback({ code: fresh, state }, META, nonce);
      expect(second).toEqual({ location: 'http://ws.test/sign-in?reason=sso_denied' });
      expect(ctx.identity.resolveIdentityAndCreateSession).toHaveBeenCalledTimes(1);
    });

    it('denies when the IdP returned an error instead of a code', async () => {
      const ctx = setup();
      const { state, nonce } = await startAndAuthorize(ctx, {}, { surface: 'admin' });
      const res = await ctx.service.callback({ error: 'access_denied', state }, META, nonce);
      expect(res.location).toBe('http://admin.test/sign-in?reason=sso_denied');
    });

    it('denies when the code exchange fails (wrong verifier, used code)', async () => {
      const ctx = setup();
      const { state, nonce } = await startAndAuthorize(ctx);
      const res = await ctx.service.callback({ code: 'not-a-code', state }, META, nonce);
      expect(res.location).toBe('http://ws.test/sign-in?reason=sso_denied');
      expect(auditActions(ctx)).toContain('auth.sign_in.failed');
    });

    it('never puts the code, verifier, state or tokens into an audit row', async () => {
      const ctx = setup();
      const { state, code, nonce } = await startAndAuthorize(ctx);
      const record = JSON.parse((await ctx.store.get(pkceKey(state)))!);
      await ctx.service.callback({ code, state }, META, nonce);
      await ctx.service.callback({ code, state }, META, nonce);
      const dump = allAuditDetails(ctx);
      expect(dump).not.toContain(code);
      expect(dump).not.toContain(state);
      expect(dump).not.toContain(record.verifier);
    });
  });

  describe('callback: existing identity', () => {
    it('signs in with sso + second factor and redirects to the return path', async () => {
      const ctx = setup();
      ctx.identities.findExternalIdentity.mockResolvedValue(boundIdentity());
      const { state, code, nonce } = await startAndAuthorize(ctx, {}, { returnPath: '/people?x=1' });
      const res = await ctx.service.callback({ code, state }, META, nonce);
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
      ctx.identities.findExternalIdentity.mockResolvedValue(boundIdentity());
      const { state, code, nonce } = await startAndAuthorize(ctx);
      ctx.sso.findConnectionByProviderName.mockResolvedValue(connection({ status: 'SUSPENDED' }));
      const res = await ctx.service.callback({ code, state }, META, nonce);
      expect(res.session).toBeDefined();
      expect(res.location).toBe('http://ws.test/');
    });

    it('signs in through a connection reset to DRAFT (path 1 does not depend on the status)', async () => {
      const ctx = setup();
      ctx.identities.findExternalIdentity.mockResolvedValue(boundIdentity());
      const { state, code, nonce } = await startAndAuthorize(ctx);
      ctx.sso.findConnectionByProviderName.mockResolvedValue(connection({ status: 'DRAFT' }));
      const res = await ctx.service.callback({ code, state }, META, nonce);
      expect(res.session).toBeDefined();
      expect(res.location).toBe('http://ws.test/');
    });

    it('denies an existing identity whose user has no membership in the connection organization (provider name reused)', async () => {
      const ctx = setup();
      // The pool user and its sub came from org A's provider of the same name.
      ctx.identities.findExternalIdentity.mockResolvedValue(boundIdentity({ userId: 'user_of_org_a' }));
      ctx.memberships.findByUserId.mockResolvedValue([{ userId: 'user_of_org_a', orgId: 'org_a', status: 'ACTIVE' }] as never);
      const deleteUser = vi.spyOn(ctx.idp, 'deleteUser');
      const { state, code, nonce } = await startAndAuthorize(ctx);
      const res = await ctx.service.callback({ code, state }, META, nonce);
      expect(res).toEqual({ location: 'http://ws.test/sign-in?reason=sso_denied' });
      expect(res.session).toBeUndefined();
      expect(ctx.identity.resolveIdentityAndCreateSession).not.toHaveBeenCalled();
      expect(deleteUser).not.toHaveBeenCalled();
      expect(ctx.memberships.findByUserId).toHaveBeenCalledWith('user_of_org_a');
      expect(ctx.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'auth.sign_in.failed',
          orgId: 'org_sample',
          details: { reason: 'sso_provider_mismatch' },
        }),
      );
    });

    it.each([
      ['another connection', 'conn_other'],
      ['no connection (a null binding)', null],
    ])(
      'denies an identity bound through %s even with an ACTIVE membership in the connection organization',
      async (_label, ssoConnectionId) => {
        const ctx = setup();
        // user_known is an ACTIVE member of org_sample, which owns conn_1; the binding was made elsewhere.
        ctx.identities.findExternalIdentity.mockResolvedValue(boundIdentity({ ssoConnectionId }));
        ctx.memberships.findByUserId.mockResolvedValue([{ userId: 'user_known', orgId: 'org_sample', status: 'ACTIVE' }] as never);
        const deleteUser = vi.spyOn(ctx.idp, 'deleteUser');
        const { state, code, nonce } = await startAndAuthorize(ctx);
        const res = await ctx.service.callback({ code, state }, META, nonce);
        expect(res).toEqual({ location: 'http://ws.test/sign-in?reason=sso_denied' });
        expect(res.session).toBeUndefined();
        expect(ctx.identity.resolveIdentityAndCreateSession).not.toHaveBeenCalled();
        // Not an orphan: the pool user stays.
        expect(deleteUser).not.toHaveBeenCalled();
        expect(ctx.audit.record).toHaveBeenCalledWith(
          expect.objectContaining({
            action: 'auth.sign_in.failed',
            orgId: 'org_sample',
            details: { reason: 'sso_provider_mismatch' },
          }),
        );
      },
    );

    it.each(['INVITED', 'ENDED'])(
      'denies an existing identity whose membership in the connection organization is %s (path 1 needs ACTIVE)',
      async (status) => {
        const ctx = setup();
        ctx.identities.findExternalIdentity.mockResolvedValue(boundIdentity());
        ctx.memberships.findByUserId.mockResolvedValue([{ userId: 'user_known', orgId: 'org_sample', status }] as never);
        const { state, code, nonce } = await startAndAuthorize(ctx);
        const res = await ctx.service.callback({ code, state }, META, nonce);
        expect(res).toEqual({ location: 'http://ws.test/sign-in?reason=sso_denied' });
        expect(ctx.identity.resolveIdentityAndCreateSession).not.toHaveBeenCalled();
        expect(ctx.audit.record).toHaveBeenCalledWith(
          expect.objectContaining({ action: 'auth.sign_in.failed', details: { reason: 'sso_provider_mismatch' } }),
        );
      },
    );

    it('denies an existing identity when no connection owns the provider name any more', async () => {
      const ctx = setup();
      ctx.identities.findExternalIdentity.mockResolvedValue(boundIdentity());
      const { state, code, nonce } = await startAndAuthorize(ctx);
      ctx.sso.findConnectionByProviderName.mockResolvedValue(null);
      const res = await ctx.service.callback({ code, state }, META, nonce);
      expect(res).toEqual({ location: 'http://ws.test/sign-in?reason=sso_denied' });
      expect(ctx.identity.resolveIdentityAndCreateSession).not.toHaveBeenCalled();
    });

    it('redirects neutrally when session creation is refused (suspended user)', async () => {
      const ctx = setup();
      ctx.identities.findExternalIdentity.mockResolvedValue(boundIdentity());
      ctx.identity.resolveIdentityAndCreateSession.mockRejectedValue(new Error('suspended'));
      const { state, code, nonce } = await startAndAuthorize(ctx);
      const res = await ctx.service.callback({ code, state }, META, nonce);
      expect(res).toEqual({ location: 'http://ws.test/sign-in?reason=sso_denied' });
    });
  });

  describe('callback: pending invitation', () => {
    it('binds, activates the membership, accepts the invitation and audits identity.linked + invitation.accepted', async () => {
      const ctx = setup();
      ctx.invitations.findPendingByEmailAndOrg.mockResolvedValue(invitation());
      const { state, code, nonce } = await startAndAuthorize(ctx, { email: 'New@Acme.example' });
      const res = await ctx.service.callback({ code, state }, META, nonce);

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

    it('links the identity to the connection it was bound through', async () => {
      const ctx = setup();
      ctx.invitations.findPendingByEmailAndOrg.mockResolvedValue(invitation());
      const { state, code, nonce } = await startAndAuthorize(ctx);
      await ctx.service.callback({ code, state }, META, nonce);
      expect(ctx.identities.createExternalIdentity).toHaveBeenCalledWith(
        expect.objectContaining({ provider: `cognito:${PROVIDER}`, ssoConnectionId: 'conn_1' }),
        ctx.tx,
      );
    });

    it('writes the binding audit rows in the binding transaction and invitation.accepted after it', async () => {
      const ctx = setup();
      ctx.invitations.findPendingByEmailAndOrg.mockResolvedValue(invitation());
      const { state, code, nonce } = await startAndAuthorize(ctx);
      await ctx.service.callback({ code, state }, META, nonce);
      expect(auditTransactions(ctx)).toEqual([
        ['user.created', true],
        ['identity.linked', true],
        ['membership.activated', true],
        ['invitation.accepted', false],
      ]);
    });

    it('reuses an existing user with the same email', async () => {
      const ctx = setup();
      ctx.invitations.findPendingByEmailAndOrg.mockResolvedValue(invitation());
      ctx.identities.findUserByEmail.mockResolvedValue({ id: 'user_existing' });
      const { state, code, nonce } = await startAndAuthorize(ctx);
      await ctx.service.callback({ code, state }, META, nonce);
      expect(ctx.identities.createUser).not.toHaveBeenCalled();
      expect(ctx.invitations.accept).toHaveBeenCalledWith('inv_1', expect.any(Date), 'user_existing', ctx.tx);
    });

    it('does not bind an invitation of another organization (Review Focus 2)', async () => {
      const ctx = setup();
      // Even if a lookup returned one, an invitation outside the connection's org never binds.
      ctx.invitations.findPendingByEmailAndOrg.mockResolvedValue(invitation({ orgId: 'org_other' }));
      const deleteUser = vi.spyOn(ctx.idp, 'deleteUser');
      const { state, code, nonce } = await startAndAuthorize(ctx);
      const res = await ctx.service.callback({ code, state }, META, nonce);
      expect(res).toEqual({ location: 'http://ws.test/sign-in?reason=sso_denied' });
      expect(ctx.invitations.accept).not.toHaveBeenCalled();
      expect(deleteUser).toHaveBeenCalledWith(`${PROVIDER}_idp-subject-1`);
      expect(auditActions(ctx)).toContain('identity.denied');
    });

    it('does not bind when the invitation email differs', async () => {
      const ctx = setup();
      ctx.invitations.findPendingByEmailAndOrg.mockResolvedValue(invitation({ email: 'other@acme.example' }));
      const { state, code, nonce } = await startAndAuthorize(ctx);
      const res = await ctx.service.callback({ code, state }, META, nonce);
      expect(res.location).toContain('reason=sso_denied');
    });

    it('denies neutrally when the binding transaction fails', async () => {
      const ctx = setup();
      ctx.invitations.findPendingByEmailAndOrg.mockResolvedValue(invitation());
      ctx.identities.createExternalIdentity.mockRejectedValue(Object.assign(new Error('dup'), { code: '23505' }));
      const { state, code, nonce } = await startAndAuthorize(ctx);
      const res = await ctx.service.callback({ code, state }, META, nonce);
      expect(res).toEqual({ location: 'http://ws.test/sign-in?reason=sso_denied' });
      expect(ctx.identity.resolveIdentityAndCreateSession).not.toHaveBeenCalled();
    });
  });

  describe('callback: JIT', () => {
    it('creates user, ACTIVE membership in the default unit with the employee grant, identity; audits identity.created + identity.linked', async () => {
      const ctx = setup({ conn: connection({ jitProvisioning: true }) });
      const { state, code, nonce } = await startAndAuthorize(ctx);
      const res = await ctx.service.callback({ code, state }, META, nonce);
      expect(res.session).toBeDefined();
      const values = ctx.tx.insert.mock.results[0]!.value.values as ReturnType<typeof vi.fn>;
      expect(values).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user_new', orgId: 'org_sample', orgUnitId: 'unit_1', status: 'ACTIVE' }));
      expect(ctx.authz.createGrant).toHaveBeenCalledWith(expect.objectContaining({ templateKey: 'employee', scopeOrgId: 'org_sample' }), ctx.tx);
      expect(auditActions(ctx)).toEqual(expect.arrayContaining(['identity.created', 'identity.linked', 'membership.activated']));
      expect(ctx.invitations.accept).not.toHaveBeenCalled();
    });

    it('links the JIT identity to the connection that provisioned it', async () => {
      const ctx = setup({ conn: connection({ jitProvisioning: true }) });
      const { state, code, nonce } = await startAndAuthorize(ctx);
      await ctx.service.callback({ code, state }, META, nonce);
      expect(ctx.identities.createExternalIdentity).toHaveBeenCalledWith(
        expect.objectContaining({ provider: `cognito:${PROVIDER}`, ssoConnectionId: 'conn_1' }),
        ctx.tx,
      );
    });

    it('writes every JIT audit row in the binding transaction', async () => {
      const ctx = setup({ conn: connection({ jitProvisioning: true }) });
      const { state, code, nonce } = await startAndAuthorize(ctx);
      await ctx.service.callback({ code, state }, META, nonce);
      expect(auditTransactions(ctx)).toEqual([
        ['user.created', true],
        ['identity.created', true],
        ['identity.linked', true],
        ['membership.activated', true],
      ]);
    });

    it('does not provision when the domain is not verified for this connection', async () => {
      const ctx = setup({ conn: connection({ jitProvisioning: true }), domainConnectionId: 'conn_other' });
      const { state, code, nonce } = await startAndAuthorize(ctx);
      const res = await ctx.service.callback({ code, state }, META, nonce);
      // The connection does not vouch for the address: the neutral denial.
      expect(res).toEqual({ location: 'http://ws.test/sign-in?reason=sso_denied' });
      expect(ctx.identities.createExternalIdentity).not.toHaveBeenCalled();
    });

    it('denies, deletes the orphan and audits identity.denied with JIT off and no invitation', async () => {
      const ctx = setup();
      const deleteUser = vi.spyOn(ctx.idp, 'deleteUser');
      const { state, code, nonce } = await startAndAuthorize(ctx);
      const res = await ctx.service.callback({ code, state }, META, nonce);
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
      const { state, code, nonce } = await startAndAuthorize(ctx, { emailVerified: false });
      const res = await ctx.service.callback({ code, state }, META, nonce);
      expect(res.location).toBe('http://ws.test/sign-in?reason=sso_email_unverified&email=new%40acme.example');
      expect(res.session).toBeUndefined();
      expect(ctx.dbs.withOrgScope).not.toHaveBeenCalled();
      expect(deleteUser).toHaveBeenCalled();
    });

    it('SAML: an unverified claim is inferred verified when the domain is verified for the connection', async () => {
      const ctx = setup({ conn: connection({ protocol: 'SAML' }) });
      ctx.invitations.findPendingByEmailAndOrg.mockResolvedValue(invitation());
      const { state, code, nonce } = await startAndAuthorize(ctx, { emailVerified: false });
      const res = await ctx.service.callback({ code, state }, META, nonce);
      expect(res.session).toBeDefined();
    });

    it('SAML: no inference when the domain is not verified for it (neutral sso_denied)', async () => {
      const ctx = setup({ conn: connection({ protocol: 'SAML' }), domainVerified: false });
      ctx.invitations.findPendingByEmailAndOrg.mockResolvedValue(invitation());
      const { state, code, nonce } = await startAndAuthorize(ctx, { emailVerified: false });
      const res = await ctx.service.callback({ code, state }, META, nonce);
      expect(res).toEqual({ location: 'http://ws.test/sign-in?reason=sso_denied' });
      expect(ctx.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'identity.denied', details: expect.objectContaining({ reason: 'email_off_domain' }) }),
      );
    });

    it('OIDC: an unverified email on an off-domain address is the neutral sso_denied, not sso_email_unverified', async () => {
      const ctx = setup({ domainVerified: false });
      const { state, code, nonce } = await startAndAuthorize(ctx, { emailVerified: false });
      const res = await ctx.service.callback({ code, state }, META, nonce);
      expect(res).toEqual({ location: 'http://ws.test/sign-in?reason=sso_denied' });
    });
  });

  describe('callback: connection state for new bindings', () => {
    it('denies a new binding through a SUSPENDED connection', async () => {
      const ctx = setup();
      ctx.invitations.findPendingByEmailAndOrg.mockResolvedValue(invitation());
      const { state, code, nonce } = await startAndAuthorize(ctx);
      ctx.sso.findConnectionByProviderName.mockResolvedValue(connection({ status: 'SUSPENDED' }));
      const res = await ctx.service.callback({ code, state }, META, nonce);
      expect(res.location).toContain('reason=sso_denied');
      expect(ctx.invitations.accept).not.toHaveBeenCalled();
    });

    it('test flag on a TESTING connection: binds and sets lastTestedAt', async () => {
      const ctx = setup({ conn: connection({ status: 'TESTING' }) });
      ctx.invitations.findPendingByEmailAndOrg.mockResolvedValue(invitation());
      const { state, code, nonce } = await startAndAuthorize(ctx, {}, { test: await issueTestNonce(ctx) });
      const res = await ctx.service.callback({ code, state }, META, nonce);
      expect(res.session).toBeDefined();
      expect(ctx.sso.updateConnection).toHaveBeenCalledWith(
        'conn_1', { lastTestedAt: expect.any(Date) }, ctx.tx, { fromStatus: 'TESTING' },
      );
    });

    it('does not touch lastTestedAt without the test flag', async () => {
      const ctx = setup();
      ctx.identities.findExternalIdentity.mockResolvedValue(boundIdentity());
      const { state, code, nonce } = await startAndAuthorize(ctx);
      await ctx.service.callback({ code, state }, META, nonce);
      expect(ctx.sso.updateConnection).not.toHaveBeenCalled();
    });

    it('denies a code minted for another provider than the flow started with', async () => {
      const ctx = setup();
      await ctx.idp.createProvider({ name: 'org-other-oidc', protocol: 'OIDC', oidcIssuer: 'https://o', oidcClientId: 'c', attributeMapping: {} });
      ctx.idp.seedFederatedUsers([{ providerName: 'org-other-oidc', subject: 's2', email: 'x@other.example', emailVerified: true }]);
      const { state, url, nonce } = await startAndAuthorize(ctx);
      const code = ctx.idp.issueAuthorizationCode('org-other-oidc', 's2', url.searchParams.get('code_challenge')!, CALLBACK);
      const deleteUser = vi.spyOn(ctx.idp, 'deleteUser');
      const res = await ctx.service.callback({ code, state }, META, nonce);
      expect(res.location).toContain('reason=sso_denied');
      expect(ctx.identities.findExternalIdentity).not.toHaveBeenCalled();
      // The pool user belongs to another provider's flow: never deleted from here.
      expect(deleteUser).not.toHaveBeenCalled();
    });
  });
});

describe('SsoCallbackService review fixes', () => {
  describe('browser binding (login CSRF)', () => {
    it.each([
      ['without the cookie', null],
      ['with another browser\'s cookie', 'x'.repeat(43)],
    ])('denies a callback %s and never exchanges the code', async (_label, cookie) => {
      const ctx = setup();
      ctx.identities.findExternalIdentity.mockResolvedValue(boundIdentity());
      const exchange = vi.spyOn(ctx.idp, 'exchangeAuthorizationCode');
      const { state, code } = await startAndAuthorize(ctx);
      const res = await ctx.service.callback({ code, state }, META, cookie);
      expect(res).toEqual({ location: 'http://ws.test/sign-in?reason=sso_denied' });
      expect(exchange).not.toHaveBeenCalled();
      expect(ctx.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'auth.sign_in.failed', details: { reason: 'sso_browser' } }),
      );
      expect(allAuditDetails(ctx)).not.toContain(cookie ?? '\u0000');
    });
  });

  describe('verified domain rule for new bindings', () => {
    it('OIDC: email_verified true for an off-domain address binds nothing (neutral sso_denied)', async () => {
      const ctx = setup();
      ctx.invitations.findPendingByEmailAndOrg.mockResolvedValue(invitation({ email: 'victim@othermail.com' }));
      ctx.identities.findUserByEmail.mockResolvedValue({ id: 'user_victim' });
      const deleteUser = vi.spyOn(ctx.idp, 'deleteUser');
      const { state, code, nonce } = await startAndAuthorize(ctx, { email: 'victim@othermail.com', emailVerified: true });
      const res = await ctx.service.callback({ code, state }, META, nonce);
      expect(res).toEqual({ location: 'http://ws.test/sign-in?reason=sso_denied' });
      expect(ctx.dbs.withOrgScope).not.toHaveBeenCalled();
      expect(ctx.identities.createExternalIdentity).not.toHaveBeenCalled();
      expect(ctx.identity.resolveIdentityAndCreateSession).not.toHaveBeenCalled();
      expect(deleteUser).toHaveBeenCalled();
    });

    it('SAML: an off-domain address is not inferred verified', async () => {
      const ctx = setup({ conn: connection({ protocol: 'SAML', jitProvisioning: true }) });
      const { state, code, nonce } = await startAndAuthorize(ctx, { email: 'victim@othermail.com', emailVerified: true });
      const res = await ctx.service.callback({ code, state }, META, nonce);
      expect(res).toEqual({ location: 'http://ws.test/sign-in?reason=sso_denied' });
      expect(ctx.identities.createExternalIdentity).not.toHaveBeenCalled();
    });

    it('an existing identity with an off-domain address still signs in', async () => {
      const ctx = setup();
      ctx.identities.findExternalIdentity.mockResolvedValue(boundIdentity());
      const { state, code, nonce } = await startAndAuthorize(ctx, { email: 'someone@othermail.com' });
      const res = await ctx.service.callback({ code, state }, META, nonce);
      expect(res.session).toBeDefined();
    });
  });

  describe('single-use test flows', () => {
    it('the callback spends the nonce even when the sign-in is denied; lastTestedAt stays', async () => {
      const ctx = setup({ conn: connection({ status: 'TESTING' }) });
      const nonce = await issueTestNonce(ctx);
      const flow = await startAndAuthorize(ctx, {}, { test: nonce });
      const res = await ctx.service.callback({ code: flow.code, state: flow.state }, META, flow.nonce);
      expect(res.location).toContain('reason=sso_denied');
      expect(await ctx.store.get(`sso_test:${nonce}`)).toBeNull();
      expect(ctx.sso.updateConnection).not.toHaveBeenCalled();
      const again = await ctx.service.start({ connection: PROVIDER, surface: 'workspace', test: nonce }, META);
      expect(again).toEqual({ location: 'http://ws.test/sign-in?reason=sso_denied' });
    });

    it('never provisions JIT while TESTING, even on a test flow', async () => {
      const ctx = setup({ conn: connection({ status: 'TESTING', jitProvisioning: true }) });
      const flow = await startAndAuthorize(ctx, {}, { test: await issueTestNonce(ctx) });
      const res = await ctx.service.callback({ code: flow.code, state: flow.state }, META, flow.nonce);
      expect(res.location).toContain('reason=sso_denied');
      expect(ctx.identities.createExternalIdentity).not.toHaveBeenCalled();
    });

    it('an existing identity on a test flow marks the connection tested', async () => {
      const ctx = setup({ conn: connection({ status: 'TESTING' }) });
      ctx.identities.findExternalIdentity.mockResolvedValue(boundIdentity());
      const flow = await startAndAuthorize(ctx, {}, { test: await issueTestNonce(ctx) });
      const res = await ctx.service.callback({ code: flow.code, state: flow.state }, META, flow.nonce);
      expect(res.session).toBeDefined();
      expect(ctx.sso.updateConnection).toHaveBeenCalledWith('conn_1', { lastTestedAt: expect.any(Date) }, ctx.tx, { fromStatus: 'TESTING' });
    });

    it('a test flow whose nonce was spent meanwhile cannot bind on TESTING', async () => {
      const ctx = setup({ conn: connection({ status: 'TESTING' }) });
      ctx.invitations.findPendingByEmailAndOrg.mockResolvedValue(invitation());
      const nonce = await issueTestNonce(ctx);
      const flow = await startAndAuthorize(ctx, {}, { test: nonce });
      await ctx.store.del(`sso_test:${nonce}`);
      const res = await ctx.service.callback({ code: flow.code, state: flow.state }, META, flow.nonce);
      expect(res.location).toContain('reason=sso_denied');
      expect(ctx.invitations.accept).not.toHaveBeenCalled();
    });
  });
});

describe('sameEmail (SSO-R-09)', () => {
  it('compares lowercased and trimmed', () => {
    expect(sameEmail(' A@Acme.Example ', 'a@acme.example')).toBe(true);
    expect(sameEmail('a@acme.example', 'b@acme.example')).toBe(false);
  });
});
