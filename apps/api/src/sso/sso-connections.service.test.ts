/**
 * SsoConnectionsService unit tests: lifecycle transitions (3.4.1), domain
 * verification (3.4.4), provider registration and audit details. The
 * repository is an in-memory stand-in; the identity provider is the real
 * in-memory fake.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Principal, SsoConnectionCreateRequest } from '@nestself/contracts';
import { ApiHttpException } from '../common/api-error.js';
import type { AuditEventInput } from '../audit/audit-writer.js';
import { IdentityResolutionService } from '../auth/identity-resolution.service.js';
import type {
  SsoConnectionPatch,
  SsoConnectionRow,
  SsoConnectionWithDomains,
  SsoDomainRow,
} from '../db/repositories/sso.repository.js';
import { FakeIdentityProvider } from '../identity/fake-identity-provider.js';
import { IdentityProviderError } from '../identity/identity-provider.service.js';
import { FakeDnsTxtResolver } from './dns-txt-resolver.js';
import { SsoConnectionsService } from './sso-connections.service.js';

const ACTOR = { userId: 'user_nikola', sessionId: 'sess_1' } as Principal;
const ORG = 'org_sample';
const TX = { tx: 'scoped' };
const SP = { entityId: 'urn:amazon:cognito:sp:pool', acsUrl: 'https://auth.example/saml2/idpresponse' };

class MemoryRepo {
  connections = new Map<string, SsoConnectionRow>();
  domains = new Map<string, SsoDomainRow>();
  private seq = 0;

  private withDomains(row: SsoConnectionRow): SsoConnectionWithDomains {
    return { ...row, domains: [...this.domains.values()].filter((d) => d.connectionId === row.id) };
  }

  listConnections = vi.fn(async (filter: { orgId?: string }) =>
    [...this.connections.values()].filter((c) => !filter.orgId || c.orgId === filter.orgId).map((c) => this.withDomains(c)),
  );
  findConnection = vi.fn(async (id: string) => {
    const row = this.connections.get(id);
    return row ? this.withDomains(row) : null;
  });
  findConnectionByProviderName = vi.fn(
    async (name: string) => [...this.connections.values()].find((c) => c.cognitoProviderName === name) ?? null,
  );
  createConnection = vi.fn(async (input: Partial<SsoConnectionRow>) => {
    const row = {
      id: `sso_${++this.seq}`,
      status: 'DRAFT',
      metadataUrl: null,
      metadataXml: null,
      oidcIssuer: null,
      oidcClientId: null,
      attributeMapping: null,
      idpInitiatedAllowed: false,
      jitProvisioning: false,
      defaultOrgUnitId: null,
      certificateExpiresAt: null,
      lastTestedAt: null,
      createdAt: new Date(),
      ...input,
    } as SsoConnectionRow;
    this.connections.set(row.id, row);
    return row;
  });
  updateConnection = vi.fn(
    async (id: string, patch: SsoConnectionPatch, _tx?: unknown, opts: { fromStatus?: string } = {}) => {
    const row = this.connections.get(id);
    if (!row || (opts.fromStatus && row.status !== opts.fromStatus)) return null;
    const next = { ...row, ...patch };
    this.connections.set(id, next);
    return next;
  },
  );
  findDomainByName = vi.fn(async (domain: string) => [...this.domains.values()].find((d) => d.domain === domain) ?? null);
  addDomain = vi.fn(async (input: { connectionId: string; domain: string; verificationToken: string }) => {
    const row = { id: `ssod_${++this.seq}`, verifiedAt: null, ...input };
    this.domains.set(row.id, row);
    return row;
  });
  findDomain = vi.fn(async (connectionId: string, domainId: string) => {
    const row = this.domains.get(domainId);
    return row && row.connectionId === connectionId ? row : null;
  });
  markDomainVerified = vi.fn(async (id: string, at: Date) => {
    const row = { ...this.domains.get(id)!, verifiedAt: at };
    this.domains.set(id, row);
    return row;
  });
}

function setup() {
  const repo = new MemoryRepo();
  const organizations = { findById: vi.fn(async (id: string) => (id === ORG ? { id } : null)) };
  const orgUnits = {
    findByIdAndOrg: vi.fn(async (unitId: string, orgId: string) => (unitId === 'ou_root' && orgId === ORG ? { id: unitId } : null)),
  };
  const idp = new FakeIdentityProvider();
  vi.spyOn(idp, 'createProvider');
  vi.spyOn(idp, 'updateProvider');
  vi.spyOn(idp, 'deleteProvider');
  // mapIdpError uses none of the service's collaborators.
  const identity = Object.create(IdentityResolutionService.prototype) as IdentityResolutionService;
  const events: AuditEventInput[] = [];
  const audit = { record: vi.fn(async (e: AuditEventInput) => void events.push(e)) };
  const dns = new FakeDnsTxtResolver();
  const db = { withOrgScope: vi.fn(async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn(TX)) };
  const service = new SsoConnectionsService(
    db as never,
    repo as never,
    organizations as never,
    orgUnits as never,
    idp,
    identity,
    audit as never,
    dns,
    { apiPublicUrl: 'http://api.test', spMetadata: SP },
  );
  return { repo, idp, events, dns, db, service };
}

const SAML: SsoConnectionCreateRequest = {
  orgId: ORG,
  slug: 'acme',
  protocol: 'SAML',
  metadataUrl: 'https://idp.acme.example/metadata',
  idpInitiatedAllowed: false,
  jitProvisioning: false,
};

async function expectApiError(promise: Promise<unknown>, status: number, code: string): Promise<ApiHttpException> {
  const err = await promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ApiHttpException);
  expect((err as ApiHttpException).getStatus()).toBe(status);
  expect((err as ApiHttpException).code).toBe(code);
  return err as ApiHttpException;
}

type Ctx = ReturnType<typeof setup>;

/** A connection with one verified domain, in the given status. */
async function connectionIn(ctx: Ctx, status: 'DRAFT' | 'TESTING' | 'ACTIVE' | 'SUSPENDED', lastTestedAt: Date | null = null) {
  const created = await ctx.service.create(SAML, ACTOR);
  const domain = await ctx.service.addDomain(created.id, 'acme.example', ACTOR);
  await ctx.repo.markDomainVerified(domain.id, new Date());
  if (status !== 'DRAFT') await ctx.idp.createProvider({ name: created.cognitoProviderName, protocol: 'SAML', metadataUrl: SAML.metadataUrl, attributeMapping: {} });
  await ctx.repo.updateConnection(created.id, { status, lastTestedAt });
  vi.mocked(ctx.idp.createProvider).mockClear();
  ctx.events.length = 0;
  return created;
}

describe('SsoConnectionsService', () => {
  let ctx: Ctx;
  beforeEach(() => {
    ctx = setup();
  });

  describe('create', () => {
    it('creates a DRAFT connection named org-<slug>-saml, not registered, audited', async () => {
      const res = await ctx.service.create(SAML, ACTOR);
      expect(res).toMatchObject({ status: 'DRAFT', cognitoProviderName: 'org-acme-saml', domains: [], spMetadata: SP });
      expect(ctx.idp.createProvider).not.toHaveBeenCalled();
      expect(ctx.events.map((e) => e.action)).toEqual(['sso_connection.created']);
      expect(ctx.events[0]).toMatchObject({ orgId: ORG, recordType: 'sso_connection', recordId: res.id, actorUserId: 'user_nikola' });
    });

    it('refuses a provider name longer than 20 characters with 422 validation (Review Focus 5)', async () => {
      await expectApiError(ctx.service.create({ ...SAML, slug: 'abcdefghijkl' }, ACTOR), 422, 'validation');
      expect(ctx.repo.createConnection).not.toHaveBeenCalled();
    });

    it('refuses a taken provider name with 409 conflict (Review Focus 5)', async () => {
      await ctx.service.create(SAML, ACTOR);
      await expectApiError(ctx.service.create({ ...SAML, metadataUrl: 'https://other.example/m' }, ACTOR), 409, 'conflict');
      expect(ctx.repo.createConnection).toHaveBeenCalledTimes(1);
    });

    it('refuses idpInitiatedAllowed: true with 422', async () => {
      await expectApiError(ctx.service.create({ ...SAML, idpInitiatedAllowed: true }, ACTOR), 422, 'validation');
    });

    it('404 for an unknown organization and 422 for a default unit of another organization', async () => {
      await expectApiError(ctx.service.create({ ...SAML, orgId: 'org_missing' }, ACTOR), 404, 'not_found');
      await expectApiError(ctx.service.create({ ...SAML, defaultOrgUnitId: 'ou_elsewhere' }, ACTOR), 422, 'validation');
      await expect(ctx.service.create({ ...SAML, defaultOrgUnitId: 'ou_root' }, ACTOR)).resolves.toMatchObject({
        defaultOrgUnitId: 'ou_root',
      });
    });

    it('an OIDC client secret stages the provider; the secret is in neither the response nor the audit', async () => {
      const res = await ctx.service.create(
        { ...SAML, protocol: 'OIDC', metadataUrl: undefined, oidcIssuer: 'https://login.acme.example', oidcClientId: 'client-1', oidcClientSecret: 'top-secret' },
        ACTOR,
      );
      expect(res.cognitoProviderName).toBe('org-acme-oidc');
      expect(ctx.idp.createProvider).toHaveBeenCalledWith(expect.objectContaining({ name: 'org-acme-oidc', oidcClientSecret: 'top-secret' }));
      expect(JSON.stringify(res)).not.toContain('top-secret');
      expect(JSON.stringify(ctx.events)).not.toContain('top-secret');
    });

    it('refuses a client secret on a SAML connection', async () => {
      await expectApiError(ctx.service.create({ ...SAML, oidcClientSecret: 's' }, ACTOR), 422, 'validation');
    });
  });

  describe('domains', () => {
    it('adds a domain with a 32-hex token and the TXT record; the token is not audited', async () => {
      const conn = await ctx.service.create(SAML, ACTOR);
      const d = await ctx.service.addDomain(conn.id, 'acme.example', ACTOR);
      const token = d.txtRecordValue.replace('nestself-domain-verification=', '');
      expect(token).toMatch(/^[0-9a-f]{32}$/);
      expect(d).toMatchObject({ domain: 'acme.example', verifiedAt: null, txtRecordName: '_nestself-verify.acme.example' });
      const added = ctx.events.find((e) => e.action === 'sso_domain.added')!;
      expect(added).toMatchObject({ recordType: 'sso_domain', recordId: d.id, details: { connectionId: conn.id, domain: 'acme.example' } });
      expect(JSON.stringify(ctx.events)).not.toContain(token);
    });

    it('refuses a public email domain with 422 domain_blocklisted', async () => {
      const conn = await ctx.service.create(SAML, ACTOR);
      await expectApiError(ctx.service.addDomain(conn.id, 'gmail.com', ACTOR), 422, 'domain_blocklisted');
      expect(ctx.repo.addDomain).not.toHaveBeenCalled();
    });

    it('refuses a domain attached to another connection with 409 conflict (Review Focus 3)', async () => {
      const a = await ctx.service.create(SAML, ACTOR);
      const b = await ctx.service.create({ ...SAML, slug: 'acme2' }, ACTOR);
      await ctx.service.addDomain(a.id, 'acme.example', ACTOR);
      await expectApiError(ctx.service.addDomain(b.id, 'acme.example', ACTOR), 409, 'conflict');
    });

    it('verification fails with 422 domain_unverified when the record is missing or different', async () => {
      const conn = await ctx.service.create(SAML, ACTOR);
      const d = await ctx.service.addDomain(conn.id, 'acme.example', ACTOR);
      await expectApiError(ctx.service.verifyDomain(conn.id, d.id, ACTOR), 422, 'domain_unverified');
      ctx.dns.setTxt(d.txtRecordName, ['nestself-domain-verification=00000000000000000000000000000000', 'v=spf1']);
      await expectApiError(ctx.service.verifyDomain(conn.id, d.id, ACTOR), 422, 'domain_unverified');
      expect(ctx.repo.markDomainVerified).not.toHaveBeenCalled();
    });

    it('verification succeeds on a matching record among others, sets verifiedAt and audits', async () => {
      const conn = await ctx.service.create(SAML, ACTOR);
      const d = await ctx.service.addDomain(conn.id, 'acme.example', ACTOR);
      ctx.dns.setTxt(d.txtRecordName, ['v=spf1 -all', ` ${d.txtRecordValue} `]);
      const res = await ctx.service.verifyDomain(conn.id, d.id, ACTOR);
      expect(res.verifiedAt).not.toBeNull();
      expect(ctx.events.at(-1)).toMatchObject({ action: 'sso_domain.verified', recordId: d.id });
      // Idempotent: a second call returns the verified domain without a new event.
      const count = ctx.events.length;
      await expect(ctx.service.verifyDomain(conn.id, d.id, ACTOR)).resolves.toMatchObject({ id: d.id });
      expect(ctx.events).toHaveLength(count);
    });

    it('404 for a domain of another connection', async () => {
      const a = await ctx.service.create(SAML, ACTOR);
      const b = await ctx.service.create({ ...SAML, slug: 'acme2' }, ACTOR);
      const d = await ctx.service.addDomain(a.id, 'acme.example', ACTOR);
      await expectApiError(ctx.service.verifyDomain(b.id, d.id, ACTOR), 404, 'not_found');
    });
  });

  describe('test', () => {
    it('409 sso_connection_state without a verified domain', async () => {
      const conn = await ctx.service.create(SAML, ACTOR);
      await ctx.service.addDomain(conn.id, 'acme.example', ACTOR);
      await expectApiError(ctx.service.test(conn.id, ACTOR), 409, 'sso_connection_state');
      expect(ctx.idp.createProvider).not.toHaveBeenCalled();
    });

    it('422 when the SAML metadata is missing, before any provider call', async () => {
      const conn = await connectionIn(ctx, 'DRAFT');
      await ctx.repo.updateConnection(conn.id, { metadataUrl: null });
      await expectApiError(ctx.service.test(conn.id, ACTOR), 422, 'validation');
      expect(ctx.idp.createProvider).not.toHaveBeenCalled();
      expect(ctx.repo.connections.get(conn.id)?.status).toBe('DRAFT');
    });

    it('registers the provider, moves to TESTING, returns the start URL and audits changed + tested', async () => {
      const conn = await connectionIn(ctx, 'DRAFT');
      const res = await ctx.service.test(conn.id, ACTOR);
      expect(res.startUrl).toBe('http://api.test/api/auth/sso/start?connection=org-acme-saml&surface=workspace&test=1');
      expect(await ctx.idp.listProviders()).toEqual(['org-acme-saml']);
      expect(ctx.repo.connections.get(conn.id)?.status).toBe('TESTING');
      expect(ctx.events.map((e) => [e.action, e.details])).toEqual([
        ['sso_connection.changed', { from: 'DRAFT', to: 'TESTING' }],
        ['sso_connection.tested', { cognitoProviderName: 'org-acme-saml' }],
      ]);
    });

    it('re-testing a TESTING connection updates the provider and records no status change', async () => {
      const conn = await connectionIn(ctx, 'TESTING');
      await ctx.service.test(conn.id, ACTOR);
      expect(ctx.idp.updateProvider).toHaveBeenCalledWith(expect.objectContaining({ name: 'org-acme-saml' }));
      expect(ctx.idp.createProvider).not.toHaveBeenCalled();
      expect(ctx.events.map((e) => e.action)).toEqual(['sso_connection.tested']);
    });

    it('an OIDC connection without a staged secret is refused with 422', async () => {
      const conn = await ctx.service.create(
        { ...SAML, protocol: 'OIDC', metadataUrl: undefined, oidcIssuer: 'https://login.acme.example', oidcClientId: 'c' },
        ACTOR,
      );
      const d = await ctx.service.addDomain(conn.id, 'acme.example', ACTOR);
      await ctx.repo.markDomainVerified(d.id, new Date());
      await expectApiError(ctx.service.test(conn.id, ACTOR), 422, 'validation');
    });

    it('409 for an ACTIVE connection', async () => {
      const conn = await connectionIn(ctx, 'ACTIVE', new Date());
      await expectApiError(ctx.service.test(conn.id, ACTOR), 409, 'sso_connection_state');
    });

    it('maps an identity provider refusal to 422 and an outage to 503', async () => {
      const conn = await connectionIn(ctx, 'DRAFT');
      vi.mocked(ctx.idp.createProvider).mockRejectedValueOnce(new IdentityProviderError('bad metadata', 'not_authorized'));
      await expectApiError(ctx.service.test(conn.id, ACTOR), 422, 'validation');
      vi.mocked(ctx.idp.createProvider).mockRejectedValueOnce(new IdentityProviderError('down', 'unavailable', true));
      await expectApiError(ctx.service.test(conn.id, ACTOR), 503, 'unavailable');
      expect(ctx.repo.connections.get(conn.id)?.status).toBe('DRAFT');
    });
  });

  describe('activate', () => {
    it('409 unless TESTING', async () => {
      const conn = await connectionIn(ctx, 'DRAFT');
      await expectApiError(ctx.service.activate(conn.id, ACTOR), 409, 'sso_connection_state');
    });

    it('409 while lastTestedAt is null (SSO-R-01)', async () => {
      const conn = await connectionIn(ctx, 'TESTING');
      await expectApiError(ctx.service.activate(conn.id, ACTOR), 409, 'sso_connection_state');
    });

    it('activates a tested connection and audits changed + activated', async () => {
      const conn = await connectionIn(ctx, 'TESTING', new Date());
      const res = await ctx.service.activate(conn.id, ACTOR);
      expect(res.status).toBe('ACTIVE');
      expect(ctx.events.map((e) => [e.action, e.details])).toEqual([
        ['sso_connection.changed', { from: 'TESTING', to: 'ACTIVE' }],
        ['sso_connection.activated', { from: 'TESTING' }],
      ]);
    });
  });

  describe('update', () => {
    it('suspends an ACTIVE connection and reactivates it, auditing every change', async () => {
      const conn = await connectionIn(ctx, 'ACTIVE', new Date());
      await expect(ctx.service.update(conn.id, { status: 'SUSPENDED' }, ACTOR)).resolves.toMatchObject({ status: 'SUSPENDED' });
      await expect(ctx.service.update(conn.id, { status: 'ACTIVE' }, ACTOR)).resolves.toMatchObject({ status: 'ACTIVE' });
      const changed = ctx.events.filter((e) => e.action === 'sso_connection.changed').map((e) => e.details);
      expect(changed).toEqual([
        { from: 'ACTIVE', to: 'SUSPENDED' },
        { from: 'SUSPENDED', to: 'ACTIVE' },
      ]);
      expect(ctx.events.map((e) => e.action)).toContain('sso_connection.deactivated');
      expect(ctx.idp.deleteProvider).not.toHaveBeenCalled();
    });

    it.each([
      ['TESTING', 'SUSPENDED'],
      ['DRAFT', 'SUSPENDED'],
      ['TESTING', 'ACTIVE'],
      ['DRAFT', 'ACTIVE'],
      ['ACTIVE', 'DRAFT'],
      ['SUSPENDED', 'DRAFT'],
    ] as const)('refuses %s -> %s with 409 sso_connection_state', async (from, to) => {
      const conn = await connectionIn(ctx, from, new Date());
      await expectApiError(ctx.service.update(conn.id, { status: to }, ACTOR), 409, 'sso_connection_state');
      expect(ctx.repo.connections.get(conn.id)?.status).toBe(from);
    });

    it('resets TESTING to DRAFT and removes the provider', async () => {
      const conn = await connectionIn(ctx, 'TESTING');
      await expect(ctx.service.update(conn.id, { status: 'DRAFT' }, ACTOR)).resolves.toMatchObject({ status: 'DRAFT' });
      expect(ctx.idp.deleteProvider).toHaveBeenCalledWith('org-acme-saml');
      expect(await ctx.idp.listProviders()).toEqual([]);
      expect(ctx.events.find((e) => e.action === 'sso_connection.changed')?.details).toEqual({ from: 'TESTING', to: 'DRAFT' });
    });

    it('refuses a protocol change after TESTING with 422 (SSO-R-03)', async () => {
      const conn = await connectionIn(ctx, 'TESTING');
      await expectApiError(ctx.service.update(conn.id, { protocol: 'OIDC' }, ACTOR), 422, 'validation');
    });

    it('a protocol change in DRAFT renames the provider', async () => {
      const conn = await ctx.service.create(SAML, ACTOR);
      const res = await ctx.service.update(conn.id, { protocol: 'OIDC', oidcIssuer: 'https://login.acme.example', oidcClientId: 'c' }, ACTOR);
      expect(res).toMatchObject({ protocol: 'OIDC', cognitoProviderName: 'org-acme-oidc' });
    });

    it('refuses idpInitiatedAllowed: true with 422', async () => {
      const conn = await ctx.service.create(SAML, ACTOR);
      await expectApiError(ctx.service.update(conn.id, { idpInitiatedAllowed: true }, ACTOR), 422, 'validation');
    });

    it('metadata changes reach a registered provider; a DRAFT one is only stored', async () => {
      const draft = await ctx.service.create({ ...SAML, slug: 'draft' }, ACTOR);
      await ctx.service.update(draft.id, { metadataUrl: 'https://idp.acme.example/v2' }, ACTOR);
      expect(ctx.idp.updateProvider).not.toHaveBeenCalled();

      const conn = await connectionIn(ctx, 'ACTIVE', new Date());
      await ctx.service.update(conn.id, { metadataUrl: 'https://idp.acme.example/v3', jitProvisioning: true }, ACTOR);
      expect(ctx.idp.updateProvider).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'org-acme-saml', metadataUrl: 'https://idp.acme.example/v3' }),
      );
      expect(ctx.events.at(-1)).toMatchObject({ action: 'sso_connection.updated', details: { fields: ['metadataUrl', 'jitProvisioning'] } });
    });

    it('clearing the metadata of a registered connection is refused with 422 and nothing changes', async () => {
      const conn = await connectionIn(ctx, 'TESTING');
      await expectApiError(ctx.service.update(conn.id, { metadataUrl: null }, ACTOR), 422, 'validation');
      expect(ctx.repo.connections.get(conn.id)?.metadataUrl).toBe(SAML.metadataUrl);
    });

    it('404 for an unknown connection', async () => {
      await expectApiError(ctx.service.update('sso_missing', { jitProvisioning: true }, ACTOR), 404, 'not_found');
    });
  });

  describe('tenant scope, conditional transitions and lastTestedAt (SSO-R-01)', () => {
    it('every write runs in the connection organization scope with its transaction', async () => {
      const conn = await connectionIn(ctx, 'TESTING', new Date());
      await ctx.service.activate(conn.id, ACTOR);
      expect(ctx.db.withOrgScope).toHaveBeenCalled();
      for (const call of ctx.db.withOrgScope.mock.calls) expect(call[0]).toBe(ORG);
      expect(ctx.repo.createConnection).toHaveBeenCalledWith(expect.anything(), TX);
      expect(ctx.repo.addDomain).toHaveBeenCalledWith(expect.anything(), TX);
      expect(ctx.repo.updateConnection).toHaveBeenLastCalledWith(conn.id, { status: 'ACTIVE' }, TX, { fromStatus: 'TESTING' });
    });

    it('a status that changed meanwhile answers 409 and records nothing', async () => {
      const conn = await connectionIn(ctx, 'ACTIVE', new Date());
      ctx.repo.updateConnection.mockResolvedValueOnce(null);
      await expectApiError(ctx.service.update(conn.id, { status: 'SUSPENDED' }, ACTOR), 409, 'sso_connection_state');
      expect(ctx.events).toEqual([]);
    });

    it('a reset to DRAFT clears lastTestedAt', async () => {
      const conn = await connectionIn(ctx, 'TESTING', new Date());
      const res = await ctx.service.update(conn.id, { status: 'DRAFT' }, ACTOR);
      expect(res.lastTestedAt).toBeNull();
    });

    it('a provider change while TESTING clears lastTestedAt; other fields keep it', async () => {
      const conn = await connectionIn(ctx, 'TESTING', new Date());
      expect((await ctx.service.update(conn.id, { jitProvisioning: true }, ACTOR)).lastTestedAt).not.toBeNull();
      expect((await ctx.service.update(conn.id, { metadataUrl: 'https://idp.acme.example/v9' }, ACTOR)).lastTestedAt).toBeNull();
      await expectApiError(ctx.service.activate(conn.id, ACTOR), 409, 'sso_connection_state');
    });

    it('every test clears lastTestedAt', async () => {
      const conn = await connectionIn(ctx, 'TESTING', new Date());
      await ctx.service.test(conn.id, ACTOR);
      expect(ctx.repo.connections.get(conn.id)?.lastTestedAt).toBeNull();
      await expectApiError(ctx.service.activate(conn.id, ACTOR), 409, 'sso_connection_state');
    });

    it('a reset to DRAFT carrying a client secret is refused with 422', async () => {
      const conn = await ctx.service.create(
        { ...SAML, protocol: 'OIDC', metadataUrl: undefined, oidcIssuer: 'https://login.acme.example', oidcClientId: 'c', oidcClientSecret: 's' },
        ACTOR,
      );
      await ctx.repo.updateConnection(conn.id, { status: 'TESTING' });
      await expectApiError(ctx.service.update(conn.id, { status: 'DRAFT', oidcClientSecret: 'new' }, ACTOR), 422, 'validation');
      expect(ctx.repo.connections.get(conn.id)?.status).toBe('TESTING');
      expect(ctx.idp.deleteProvider).not.toHaveBeenCalled();
    });
  });

  it('list filters by organization and maps domains', async () => {
    const conn = await connectionIn(ctx, 'DRAFT');
    const res = await ctx.service.list({ orgId: ORG });
    expect(res.items).toHaveLength(1);
    expect(res.items[0]).toMatchObject({ id: conn.id, domains: [{ domain: 'acme.example' }] });
    expect(res.items[0]).not.toHaveProperty('metadataXml');
    expect((await ctx.service.list({ orgId: 'org_other' })).items).toEqual([]);
  });
});
