/**
 * AuthorizationRepository and ApprovalAuthoritiesRepository against a real
 * PostgreSQL database, connected as the non-superuser app role so that
 * row-level security applies (T4, auth phase 2).
 *
 * Runs against TEST_DATABASE_URL. Skipped when it is unset.
 */
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { inArray } from 'drizzle-orm';
import { withOrgScope, type DbService } from '../../src/db/db.service.js';
import { seed } from '../../src/db/seed/seed-lib.js';
import { grants } from '../../src/db/schema/index.js';
import { AuthorizationRepository } from '../../src/db/repositories/authorization.repository.js';
import { ApprovalAuthoritiesRepository } from '../../src/db/repositories/approval-authorities.repository.js';
import { connectAsAppRole, resetTestDatabase, type TestDatabase } from './test-database.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const shouldRun = !!TEST_DB_URL;

const ORG = 'org_sample';

describe.skipIf(!shouldRun)('AuthorizationRepository (db)', () => {
  let owner: TestDatabase;
  let app: TestDatabase;
  let dbs: DbService;
  let repo: AuthorizationRepository;
  let authorities: ApprovalAuthoritiesRepository;

  const base = {
    actions: ['budget.read'],
    scopeType: 'organization',
    scopeOrgId: ORG,
    grantedByUserId: 'user_ivana',
    validFrom: new Date('2026-01-01'),
  };

  beforeAll(async () => {
    owner = await resetTestDatabase(TEST_DB_URL!, 'authzrepo');
    await seed(owner.db);
    app = await connectAsAppRole(owner);
    dbs = {
      db: app.db,
      withOrgScope: <T>(orgId: string, fn: Parameters<typeof withOrgScope<T>>[2]) =>
        withOrgScope(app.db, orgId, fn),
    } as unknown as DbService;
    repo = new AuthorizationRepository(dbs);
    authorities = new ApprovalAuthoritiesRepository(dbs);

    await owner.db.insert(grants).values([
      { ...base, id: 'tree_root', subjectUserId: 'user_ivana', grantedAt: new Date('2026-02-01') },
      { ...base, id: 'tree_child', subjectUserId: 'user_ana', parentGrantId: 'tree_root', grantedAt: new Date('2026-02-02') },
      { ...base, id: 'tree_grandchild', subjectUserId: 'user_stefan', parentGrantId: 'tree_child', grantedAt: new Date('2026-02-03') },
      { ...base, id: 'platform_grant', subjectUserId: 'user_nikola', scopeType: 'platform', scopeOrgId: null },
    ]);
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await owner?.close();
  });

  it('findGrantById returns the row in scope and null for an unknown id', async () => {
    await dbs.withOrgScope(ORG, async (tx) => {
      expect((await repo.findGrantById('tree_child', tx))?.parentGrantId).toBe('tree_root');
      expect(await repo.findGrantById('nope', tx)).toBeNull();
    });
  });

  it('org-scoped grants are invisible from another tenant scope', async () => {
    await dbs.withOrgScope('org_other', async (tx) => {
      expect(await repo.findGrantById('tree_root', tx)).toBeNull();
      expect((await repo.findGrantById('platform_grant', tx))?.id).toBe('platform_grant');
    });
  });

  it('delegationDepth counts parent hops to the root', async () => {
    await dbs.withOrgScope(ORG, async (tx) => {
      expect(await repo.delegationDepth('tree_root', tx)).toBe(0);
      expect(await repo.delegationDepth('tree_child', tx)).toBe(1);
      expect(await repo.delegationDepth('tree_grandchild', tx)).toBe(2);
    });
  });

  it('updateGrant changes validUntil and conditions', async () => {
    const until = new Date('2027-01-01T00:00:00.000Z');
    const row = await dbs.withOrgScope(ORG, (tx) =>
      repo.updateGrant('tree_root', { validUntil: until, conditions: [{ kind: 'time_window' }] }, tx),
    );
    expect(row.validUntil?.toISOString()).toBe(until.toISOString());
    expect(row.conditions).toEqual([{ kind: 'time_window' }]);
    expect(row.validFrom.toISOString()).toBe(base.validFrom.toISOString());

    const cleared = await dbs.withOrgScope(ORG, (tx) => repo.updateGrant('tree_root', { validUntil: null }, tx));
    expect(cleared.validUntil).toBeNull();
  });

  it('listPlatformGrants returns only grants without an organization scope', async () => {
    const rows = await repo.listPlatformGrants({});
    expect(rows.map((r) => r.id)).toContain('platform_grant');
    expect(rows.every((r) => r.scopeOrgId === null)).toBe(true);
  });

  it('revokeGrantTree revokes the root with the reason and descendants as parent_revoked', async () => {
    const at = new Date('2026-10-24T10:00:00.000Z');
    const result = await dbs.withOrgScope(ORG, (tx) =>
      repo.revokeGrantTree(['tree_root'], { at, byUserId: 'user_ivana', reason: 'manual' }, tx),
    );
    expect(result.roots).toEqual(['tree_root']);
    expect(result.children.sort()).toEqual(['tree_child', 'tree_grandchild']);

    const rows = await owner.db
      .select()
      .from(grants)
      .where(inArray(grants.id, ['tree_root', 'tree_child', 'tree_grandchild']));
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.revokedAt?.toISOString()).toBe(at.toISOString());
      expect(r.revokedByUserId).toBe('user_ivana');
      expect(r.revokedReason).toBe(r.id === 'tree_root' ? 'manual' : 'parent_revoked');
    }

    // Revoking again is a no-op.
    const again = await dbs.withOrgScope(ORG, (tx) =>
      repo.revokeGrantTree(['tree_root'], { at, byUserId: 'user_ivana', reason: 'manual' }, tx),
    );
    expect(again).toEqual({ roots: [], children: [] });
  });

  it('listGrantsForOrg excludes revoked rows unless includeRevoked, newest first', async () => {
    const active = await dbs.withOrgScope(ORG, (tx) => repo.listGrantsForOrg(ORG, {}, tx));
    expect(active.length).toBeGreaterThan(0);
    expect(active.every((g) => g.revokedAt === null && g.scopeOrgId === ORG)).toBe(true);
    expect(active.map((g) => g.id)).not.toContain('tree_root');

    const all = await dbs.withOrgScope(ORG, (tx) => repo.listGrantsForOrg(ORG, { includeRevoked: true }, tx));
    const ids = all.map((g) => g.id);
    expect(ids).toEqual(expect.arrayContaining(['tree_root', 'tree_child', 'tree_grandchild']));
    expect(ids).not.toContain('platform_grant');
    for (let i = 1; i < all.length; i++) {
      expect(all[i - 1]!.grantedAt.getTime()).toBeGreaterThanOrEqual(all[i]!.grantedAt.getTime());
    }

    const ana = await dbs.withOrgScope(ORG, (tx) =>
      repo.listGrantsForOrg(ORG, { subjectUserId: 'user_ana', includeRevoked: true }, tx),
    );
    expect(ana.length).toBeGreaterThan(0);
    expect(ana.every((g) => g.subjectUserId === 'user_ana')).toBe(true);
    expect(ana.map((g) => g.id)).toContain('tree_child');
  });

  it('findActiveMembership returns the active membership and null otherwise', async () => {
    await dbs.withOrgScope(ORG, async (tx) => {
      const m = await repo.findActiveMembership('user_ana', ORG, tx);
      expect(m?.membershipId).toBeTruthy();
      expect(m).toHaveProperty('orgUnitId');
      expect(await repo.findActiveMembership('user_nobody', ORG, tx)).toBeNull();
    });
  });

  it('approval authority create, list, update round trip under withOrgScope', async () => {
    const created = await dbs.withOrgScope(ORG, (tx) =>
      authorities.create(
        {
          userId: 'user_ivana',
          orgId: ORG,
          categories: ['learning'],
          maxAmountMinor: 50_000,
          validFrom: new Date('2026-01-01'),
        },
        tx,
      ),
    );
    expect(created.id).toBeTruthy();

    const listed = await dbs.withOrgScope(ORG, (tx) => authorities.list(ORG, tx));
    expect(listed.map((a) => a.id)).toContain(created.id);
    expect(listed.every((a) => a.orgId === ORG)).toBe(true);

    const updated = await dbs.withOrgScope(ORG, (tx) =>
      authorities.update(created.id, { maxAmountMinor: 75_000, isConfidentialApprover: true }, tx),
    );
    expect(updated.maxAmountMinor).toBe(75_000);
    expect(updated.isConfidentialApprover).toBe(true);
    expect(updated.categories).toEqual(['learning']);

    const found = await dbs.withOrgScope(ORG, (tx) => authorities.findById(created.id, tx));
    expect(found?.maxAmountMinor).toBe(75_000);

    // Invisible from another tenant.
    expect(await dbs.withOrgScope('org_other', (tx) => authorities.findById(created.id, tx))).toBeNull();
  });
});
