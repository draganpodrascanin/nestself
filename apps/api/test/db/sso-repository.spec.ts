/**
 * SsoRepository against a real PostgreSQL database, connected as the
 * non-superuser app role so that row-level security applies (auth phase 3,
 * Task 3).
 *
 * Runs against TEST_DATABASE_URL. Skipped when it is unset.
 */
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { withOrgScope, type DbService } from '../../src/db/db.service.js';
import { seed } from '../../src/db/seed/seed-lib.js';
import { organizations } from '../../src/db/schema/index.js';
import { SsoRepository, isUniqueViolation } from '../../src/db/repositories/sso.repository.js';
import { connectAsAppRole, resetTestDatabase, type TestDatabase } from './test-database.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const shouldRun = !!TEST_DB_URL;

const ORG = 'org_sample';
const OTHER = 'org_ssorepo_other';

describe.skipIf(!shouldRun)('SsoRepository (db)', () => {
  let owner: TestDatabase;
  let app: TestDatabase;
  let dbs: DbService;
  let repo: SsoRepository;

  beforeAll(async () => {
    owner = await resetTestDatabase(TEST_DB_URL!, 'ssorepo');
    await seed(owner.db);
    await owner.db.insert(organizations).values({ id: OTHER, name: 'Other SSO Org', slug: 'other-sso' });
    app = await connectAsAppRole(owner);
    dbs = {
      db: app.db,
      withOrgScope: <T>(orgId: string, fn: Parameters<typeof withOrgScope<T>>[2]) =>
        withOrgScope(app.db, orgId, fn),
    } as unknown as DbService;
    repo = new SsoRepository(dbs);
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await owner?.close();
  });

  let acmeId: string;
  let otherId: string;

  it('createConnection inserts a DRAFT connection; findConnection returns it with no domains', async () => {
    const created = await repo.createConnection({
      orgId: ORG,
      protocol: 'SAML',
      cognitoProviderName: 'org-acme-saml',
      metadataUrl: 'https://idp.acme.example/metadata',
    });
    acmeId = created.id;
    expect(created).toMatchObject({ status: 'DRAFT', idpInitiatedAllowed: false, jitProvisioning: false, lastTestedAt: null });
    const found = await repo.findConnection(acmeId);
    expect(found?.cognitoProviderName).toBe('org-acme-saml');
    expect(found?.domains).toEqual([]);
    expect(await repo.findConnection('missing')).toBeNull();
    expect((await repo.findConnectionByProviderName('org-acme-saml'))?.id).toBe(acmeId);
    expect(await repo.findConnectionByProviderName('org-none-saml')).toBeNull();
  });

  it('a duplicate cognitoProviderName is a unique violation', async () => {
    const err = await repo
      .createConnection({ orgId: OTHER, protocol: 'SAML', cognitoProviderName: 'org-acme-saml' })
      .catch((e: unknown) => e);
    expect(isUniqueViolation(err)).toBe(true);
    otherId = (await repo.createConnection({ orgId: OTHER, protocol: 'OIDC', cognitoProviderName: 'org-other-oidc' })).id;
  });

  it('listConnections filters by organization and includes domains', async () => {
    expect((await repo.listConnections({})).map((c) => c.id)).toEqual([acmeId, otherId]);
    expect((await repo.listConnections({ orgId: OTHER })).map((c) => c.id)).toEqual([otherId]);
  });

  it('addDomain lowercases; the domain is unique across connections', async () => {
    const d = await repo.addDomain({ connectionId: acmeId, domain: ' Acme.Example ', verificationToken: 'a'.repeat(32) });
    expect(d).toMatchObject({ domain: 'acme.example', verifiedAt: null });
    const dup = await repo
      .addDomain({ connectionId: otherId, domain: 'acme.example', verificationToken: 'b'.repeat(32) })
      .catch((e: unknown) => e);
    expect(isUniqueViolation(dup)).toBe(true);
    expect((await repo.findDomainByName('ACME.example'))?.id).toBe(d.id);
    expect(await repo.findDomain(acmeId, d.id)).toMatchObject({ id: d.id });
    expect(await repo.findDomain(otherId, d.id)).toBeNull();
    expect((await repo.findConnection(acmeId))?.domains.map((x) => x.domain)).toEqual(['acme.example']);
  });

  it('findActiveConnectionForDomain needs a verified domain and an ACTIVE connection', async () => {
    const d = (await repo.findDomainByName('acme.example'))!;
    expect(await repo.findActiveConnectionForDomain('acme.example')).toBeNull();
    await repo.markDomainVerified(d.id, new Date('2026-10-25T10:00:00Z'));
    expect(await repo.findActiveConnectionForDomain('acme.example')).toBeNull();
    await repo.updateConnection(acmeId, { status: 'ACTIVE', lastTestedAt: new Date('2026-10-25T11:00:00Z') });
    expect((await repo.findActiveConnectionForDomain(' ACME.example'))?.id).toBe(acmeId);
    await repo.updateConnection(acmeId, { status: 'SUSPENDED' });
    expect(await repo.findActiveConnectionForDomain('acme.example')).toBeNull();
    await repo.updateConnection(acmeId, { status: 'ACTIVE' });
  });

  it('updateConnection returns the row, or null for an unknown id', async () => {
    const updated = await repo.updateConnection(acmeId, { jitProvisioning: true, metadataXml: '<x/>' });
    expect(updated).toMatchObject({ jitProvisioning: true, metadataXml: '<x/>' });
    expect(await repo.updateConnection('missing', { jitProvisioning: true })).toBeNull();
    expect((await repo.updateConnection(acmeId, {}))?.id).toBe(acmeId);
  });

  it('listActiveConnectionsWithCertificates returns ACTIVE connections with an expiry only', async () => {
    expect(await repo.listActiveConnectionsWithCertificates()).toEqual([]);
    await repo.updateConnection(acmeId, { certificateExpiresAt: new Date('2027-01-01T00:00:00Z') });
    await repo.updateConnection(otherId, { certificateExpiresAt: new Date('2027-01-01T00:00:00Z') });
    expect((await repo.listActiveConnectionsWithCertificates()).map((c) => c.id)).toEqual([acmeId]);
  });

  it('updateConnection with fromStatus only applies while the status still matches', async () => {
    expect(await repo.updateConnection(otherId, { status: 'TESTING' }, undefined, { fromStatus: 'ACTIVE' })).toBeNull();
    expect((await repo.findConnection(otherId))?.status).toBe('DRAFT');
    expect((await repo.updateConnection(otherId, { status: 'TESTING' }, undefined, { fromStatus: 'DRAFT' }))?.status).toBe('TESTING');
    await repo.updateConnection(otherId, { status: 'DRAFT' });
  });

  it('a write scoped to one organization cannot create a domain for another organization connection', async () => {
    const err = await dbs
      .withOrgScope(ORG, (tx) =>
        repo.addDomain({ connectionId: otherId, domain: 'other-tenant.example', verificationToken: 'c'.repeat(32) }, tx),
      )
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(String((err as { cause?: { message?: string } }).cause?.message ?? (err as Error).message)).toMatch(/row-level security/);
    expect(await repo.findDomainByName('other-tenant.example')).toBeNull();
    // A scoped update of another tenant's connection touches no row.
    await dbs.withOrgScope(ORG, async (tx) => {
      expect(await repo.updateConnection(otherId, { jitProvisioning: true }, tx)).toBeNull();
    });
    // The connection's own scope may write.
    const own = await dbs.withOrgScope(OTHER, (tx) =>
      repo.addDomain({ connectionId: otherId, domain: 'other-tenant.example', verificationToken: 'c'.repeat(32) }, tx),
    );
    expect(own.domain).toBe('other-tenant.example');
  });

  it('row-level security hides another tenant connections and domains', async () => {
    await dbs.withOrgScope(OTHER, async (tx) => {
      expect(await repo.findConnection(acmeId, tx)).toBeNull();
      expect(await repo.findDomainByName('acme.example', tx)).toBeNull();
      expect((await repo.listConnections({}, tx)).map((c) => c.id)).toEqual([otherId]);
    });
    await dbs.withOrgScope(ORG, async (tx) => {
      expect((await repo.findConnection(acmeId, tx))?.domains).toHaveLength(1);
    });
  });
});
