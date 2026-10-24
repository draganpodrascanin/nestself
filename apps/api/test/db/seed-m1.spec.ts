/**
 * M1 seed (T-C1.14): second organization, acceptance people, sample articles
 * and the publications of the availability demo.
 *
 * Runs against TEST_DATABASE_URL. Skipped when it is unset.
 */
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  SAMPLE_ACCEPTANCE_ROLES,
  SAMPLE_CONTENT_RESOURCES,
  SAMPLE_ORG,
  SAMPLE_ORG_B,
  acceptanceScaleEmployees,
} from '@nestself/sample-data';
import { seed } from '../../src/db/seed/seed-lib.js';
import { withOrgScope, type Database } from '../../src/db/db.service.js';
import {
  contentPublications,
  contentVariants,
  memberships,
  orgContentCapabilities,
  organizations,
} from '../../src/db/schema/index.js';
import { AvailabilityService } from '../../src/library/availability/availability.service.js';
import type { AvailabilityContext } from '../../src/library/availability/availability-context.js';
import { connectAsAppRole, resetTestDatabase, type TestDatabase } from './test-database.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const NOW = new Date('2026-10-25T12:00:00Z');

const resourceOf = (scenario: string) => {
  const found = SAMPLE_CONTENT_RESOURCES.find((r) => r.scenario === scenario);
  if (!found) throw new Error(`no sample article for ${scenario}`);
  return found;
};

describe.skipIf(!TEST_DB_URL)('M1 seed', () => {
  let owner: TestDatabase;
  let app: TestDatabase;
  let firstCounts: Record<string, number>;
  let secondCounts: Record<string, number>;
  const svc = new AvailabilityService();

  beforeAll(async () => {
    owner = await resetTestDatabase(TEST_DB_URL!, 'seedm1');
    app = await connectAsAppRole(owner);
    firstCounts = await seed(owner.db);
    secondCounts = await seed(owner.db);
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await owner?.close();
  });

  /** A reader context for a user's ACTIVE membership in an organization. */
  async function readerContext(userId: string, orgId: string): Promise<AvailabilityContext> {
    const [membership] = await owner.db
      .select()
      .from(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.orgId, orgId)));
    if (!membership) throw new Error(`${userId} has no membership in ${orgId}`);
    const { rows } = await owner.pool.query<{ ancestor_id: string }>(
      `SELECT ancestor_id FROM org_unit_closure WHERE descendant_id = $1 ORDER BY depth`,
      [membership.orgUnitId],
    );
    return {
      kind: 'reader',
      userId,
      orgId,
      membershipId: membership.id,
      orgUnitIds: rows.map((r) => r.ancestor_id),
      capabilities: ['library'],
      readerLocale: 'en',
      now: NOW,
    };
  }

  async function availableResources(ctx: AvailabilityContext): Promise<string[]> {
    const rows = await withOrgScope(app.db as Database, ctx.orgId, (tx) =>
      svc.availablePublications(ctx, tx),
    );
    return rows.map((r) => r.contentResourceId).sort();
  }

  it('seeding twice yields identical counts', () => {
    expect(secondCounts).toEqual(firstCounts);
    expect(firstCounts.contentResources).toBe(SAMPLE_CONTENT_RESOURCES.length);
    expect(firstCounts.contentVariants).toBe(SAMPLE_CONTENT_RESOURCES.length * 3);
    expect(firstCounts.contentRevisions).toBe(SAMPLE_CONTENT_RESOURCES.length * 3);
    expect(firstCounts.contentPublications).toBe(SAMPLE_CONTENT_RESOURCES.length * 3);
  });

  it('creates organization B with its units, closure rows and the library capability', async () => {
    const [org] = await owner.db.select().from(organizations).where(eq(organizations.id, SAMPLE_ORG_B.id));
    expect(org?.status).toBe('ACTIVE');
    const caps = await owner.db
      .select()
      .from(orgContentCapabilities)
      .where(eq(orgContentCapabilities.orgId, SAMPLE_ORG_B.id));
    expect(caps.map((c) => c.capability)).toEqual(['library']);
    const { rows } = await owner.pool.query(
      `SELECT count(*)::int AS n FROM org_unit_closure WHERE descendant_id = 'ou_b_team_support'`,
    );
    expect(rows[0].n).toBe(3);
  });

  it('gives the two-membership person ACTIVE memberships in both organizations', async () => {
    const rows = await owner.db
      .select()
      .from(memberships)
      .where(eq(memberships.userId, SAMPLE_ACCEPTANCE_ROLES.multiOrgEmployee));
    expect(rows.map((r) => [r.orgId, r.status]).sort()).toEqual([
      [SAMPLE_ORG.id, 'ACTIVE'],
      [SAMPLE_ORG_B.id, 'ACTIVE'],
    ]);
    const { rows: grantRows } = await owner.pool.query<{ scope_org_id: string }>(
      `SELECT scope_org_id FROM grants WHERE subject_user_id = $1 AND template_key = 'employee' ORDER BY scope_org_id`,
      [SAMPLE_ACCEPTANCE_ROLES.multiOrgEmployee],
    );
    expect(grantRows.map((g) => g.scope_org_id)).toEqual([SAMPLE_ORG.id, SAMPLE_ORG_B.id]);
  });

  it('seeds one publication of each kind per variant', async () => {
    const rows = await owner.db.select().from(contentPublications);
    const byScenario = (scenario: string) => {
      const variantIds = resourceOf(scenario).variants.map((v) => v.id);
      return rows.filter((p) => variantIds.includes(p.contentVariantId));
    };
    for (const p of byScenario('all_eligible')) expect(p.state).toBe('live');
    for (const p of byScenario('org_a')) expect(p.state).toBe('live');
    for (const p of byScenario('future')) {
      expect(p.state).toBe('scheduled');
      expect(p.startsAt.getTime()).toBeGreaterThan(NOW.getTime());
    }
    for (const p of byScenario('withdrawn')) {
      expect(p.state).toBe('withdrawn');
      expect(p.withdrawnAt).not.toBeNull();
    }
    for (const p of rows) {
      expect(p.publishedByUserId).toBe(SAMPLE_ACCEPTANCE_ROLES.publisher);
      expect(p.approvalHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('approves every revision with the reviewer', async () => {
    const { rows } = await owner.pool.query<{ state: string; approved_by_user_id: string; approval_hash: string }>(
      `SELECT state, approved_by_user_id, approval_hash FROM content_revisions`,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.state).toBe('approved');
      expect(r.approved_by_user_id).toBe(SAMPLE_ACCEPTANCE_ROLES.reviewer);
      expect(r.approval_hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('stores only the authored locales', async () => {
    const rows = await owner.db.select({ locale: contentVariants.locale }).from(contentVariants);
    expect(new Set(rows.map((r) => r.locale))).toEqual(new Set(['sr-Latn', 'hu', 'en']));
  });

  it('shows Employee A the org-A article and the all-eligible ones', async () => {
    const ctx = await readerContext(SAMPLE_ACCEPTANCE_ROLES.employeeA, SAMPLE_ORG.id);
    const available = await availableResources(ctx);
    const expected = SAMPLE_CONTENT_RESOURCES.filter((r) => r.scenario === 'all_eligible' || r.scenario === 'org_a')
      .map((r) => r.id)
      .sort();
    expect(available).toEqual(expected);
  });

  it('shows Employee B only the all-eligible articles', async () => {
    const ctx = await readerContext(SAMPLE_ACCEPTANCE_ROLES.employeeB, SAMPLE_ORG_B.id);
    const available = await availableResources(ctx);
    expect(available).toEqual(
      SAMPLE_CONTENT_RESOURCES.filter((r) => r.scenario === 'all_eligible').map((r) => r.id).sort(),
    );
  });

  it('never shows the future or the withdrawn article, in any organization', async () => {
    const hidden = [resourceOf('future').id, resourceOf('withdrawn').id];
    for (const [userId, orgId] of [
      [SAMPLE_ACCEPTANCE_ROLES.employeeA, SAMPLE_ORG.id],
      [SAMPLE_ACCEPTANCE_ROLES.employeeB, SAMPLE_ORG_B.id],
      [SAMPLE_ACCEPTANCE_ROLES.multiOrgEmployee, SAMPLE_ORG.id],
      [SAMPLE_ACCEPTANCE_ROLES.multiOrgEmployee, SAMPLE_ORG_B.id],
    ] as const) {
      const available = await availableResources(await readerContext(userId, orgId));
      for (const id of hidden) expect(available).not.toContain(id);
    }
  });

  it('shows the two-membership person the org-A article only in organization A', async () => {
    const orgA = await availableResources(await readerContext(SAMPLE_ACCEPTANCE_ROLES.multiOrgEmployee, SAMPLE_ORG.id));
    const orgB = await availableResources(await readerContext(SAMPLE_ACCEPTANCE_ROLES.multiOrgEmployee, SAMPLE_ORG_B.id));
    const orgOnly = resourceOf('org_a').id;
    expect(orgA).toContain(orgOnly);
    expect(orgB).not.toContain(orgOnly);
  });

  it('seeds the generated acceptance employees only on request, and idempotently', async () => {
    const scaled = await resetTestDatabase(TEST_DB_URL!, 'seedm1scale');
    try {
      const base = await seed(scaled.db);
      const first = await seed(scaled.db, { seedAcceptanceScale: true });
      const second = await seed(scaled.db, { seedAcceptanceScale: true });
      expect(second).toEqual(first);
      expect(first.memberships! - base.memberships!).toBe(acceptanceScaleEmployees().length);
      const { rows } = await scaled.pool.query<{ org_id: string; n: number }>(
        `SELECT org_id, count(DISTINCT user_id)::int AS n FROM memberships WHERE status = 'ACTIVE' GROUP BY org_id`,
      );
      const byOrg = Object.fromEntries(rows.map((r) => [r.org_id, r.n]));
      expect(byOrg[SAMPLE_ORG.id]).toBe(30);
      expect(byOrg[SAMPLE_ORG_B.id]).toBe(12);
    } finally {
      await scaled.close();
    }
  }, 180_000);
});
