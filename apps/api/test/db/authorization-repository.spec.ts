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

  it('listPlatformGrants filters by subject', async () => {
    const nikola = await repo.listPlatformGrants({ subjectUserId: 'user_nikola' });
    expect(nikola.map((r) => r.id)).toContain('platform_grant');
    expect(nikola.every((r) => r.subjectUserId === 'user_nikola' && r.scopeOrgId === null)).toBe(true);
    const ana = await repo.listPlatformGrants({ subjectUserId: 'user_ana' });
    expect(ana.map((r) => r.id)).not.toContain('platform_grant');
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

  describe('emergency access', () => {
    const now = new Date('2026-10-24T10:00:00.000Z');
    const minutes = (n: number): Date => new Date(now.getTime() + n * 60_000);
    const request = {
      userId: 'user_nikola',
      purpose: 'Safeguarding concern raised by the assigned expert',
      scopeKind: 'CASE' as const,
      scopeId: 'case_sample',
      requestedDurationMinutes: 30,
      grantedAt: now,
      expiresAt: minutes(30),
    };

    it('findActiveEmergencyAccess ignores a pending request and returns it once approved', async () => {
      const pending = await repo.createEmergencyRequest(request);
      expect(pending.approvedByUserId).toBeNull();
      expect(pending.approvedAt).toBeNull();
      expect(pending.requestedDurationMinutes).toBe(30);

      const before = await repo.findActiveEmergencyAccess('user_nikola', now);
      expect(before.map((r) => r.id)).not.toContain(pending.id);

      const approved = await repo.approveEmergencyAccess(pending.id, 'user_dragan', now, minutes(30));
      expect(approved?.approvedByUserId).toBe('user_dragan');
      expect(approved?.approvedAt?.toISOString()).toBe(now.toISOString());

      const after = await repo.findActiveEmergencyAccess('user_nikola', now);
      expect(after.map((r) => r.id)).toContain(pending.id);
      expect(await repo.findActiveEmergencyAccess('user_nikola', minutes(31))).toEqual([]);

      // A second approval of the same row changes nothing.
      expect(await repo.approveEmergencyAccess(pending.id, 'user_ivana', now, minutes(30))).toBeNull();
      await repo.revokeEmergencyAccess(pending.id, 'user_dragan', now);
    });

    it('deleteEmergencyRequest removes a pending request but never an approved one', async () => {
      const pending = await repo.createEmergencyRequest(request);
      expect(await repo.deleteEmergencyRequest(pending.id)).toBe(true);
      expect(await repo.findEmergencyAccess(pending.id)).toBeNull();

      const other = await repo.createEmergencyRequest(request);
      await repo.approveEmergencyAccess(other.id, 'user_dragan', now, minutes(30));
      expect(await repo.deleteEmergencyRequest(other.id)).toBe(false);
      expect((await repo.findEmergencyAccess(other.id))?.id).toBe(other.id);
      await repo.revokeEmergencyAccess(other.id, 'user_dragan', now);
    });

    it('revokeEmergencyAccess sets revokedAt once and drops the row from the active set', async () => {
      const row = await repo.createEmergencyRequest(request);
      await repo.approveEmergencyAccess(row.id, 'user_dragan', now, minutes(30));
      const revoked = await repo.revokeEmergencyAccess(row.id, 'user_dragan', minutes(5));
      expect(revoked?.revokedAt?.toISOString()).toBe(minutes(5).toISOString());
      expect(revoked?.revokedByUserId).toBe('user_dragan');
      expect(await repo.revokeEmergencyAccess(row.id, 'user_dragan', minutes(6))).toBeNull();
      expect((await repo.findActiveEmergencyAccess('user_nikola', now)).map((r) => r.id)).not.toContain(row.id);
    });

    it('findExpiredApprovedEmergencyAccess returns approved, unrevoked, expired rows only', async () => {
      const expired = await repo.createEmergencyRequest({ ...request, userId: 'user_ana' });
      await repo.approveEmergencyAccess(expired.id, 'user_dragan', minutes(-60), minutes(-30));
      const pendingExpired = await repo.createEmergencyRequest({ ...request, userId: 'user_ana', expiresAt: minutes(-30) });
      const live = await repo.createEmergencyRequest({ ...request, userId: 'user_ana' });
      await repo.approveEmergencyAccess(live.id, 'user_dragan', now, minutes(30));

      const ids = (await repo.findExpiredApprovedEmergencyAccess(now)).map((r) => r.id);
      expect(ids).toContain(expired.id);
      expect(ids).not.toContain(pendingExpired.id);
      expect(ids).not.toContain(live.id);

      await repo.revokeEmergencyAccess(expired.id, null, now);
      expect((await repo.findExpiredApprovedEmergencyAccess(now)).map((r) => r.id)).not.toContain(expired.id);
    });

    it('listEmergencyAccess returns every state, newest first, optionally per requester', async () => {
      const all = await repo.listEmergencyAccess({});
      expect(all.length).toBeGreaterThan(0);
      const times = all.map((r) => r.grantedAt.getTime());
      expect([...times].sort((a, b) => b - a)).toEqual(times);
      const anas = await repo.listEmergencyAccess({ userId: 'user_ana' });
      expect(anas.length).toBeGreaterThan(0);
      expect(anas.every((r) => r.userId === 'user_ana')).toBe(true);
    });
  });
});
