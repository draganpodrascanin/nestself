/**
 * One-off backfill: turn the legacy role columns (`users.platform_role`,
 * `memberships.role`) into grants before migration 0005 drops them (T-2.7).
 *
 * The legacy columns are read through raw SQL so that this module still
 * compiles once the schema no longer declares them. Idempotent: grant ids are
 * `grant_{userId}_{templateKey}`, or `grant_{userId}_{orgId}_{templateKey}`
 * when that id already holds the same template for another organization, and
 * an existing grant is never overwritten.
 */
import { eq, sql } from 'drizzle-orm';
import type { Database } from '../db.service.js';
import * as t from '../schema/index.js';
import { derivedGrantConditions, resolveSampleScope, templatesForLegacyRoles } from './seed-lib.js';

export interface BackfillResult {
  created: string[];
  skipped: string[];
}

interface Subject {
  userId: string;
  orgRole: string | null;
  platformRole: string | null;
  orgId: string | null;
  orgUnitId: string | null;
  grantedByUserId: string;
}

export async function backfillGrants(db: Database, now: Date): Promise<BackfillResult> {
  const platformUsers = await db.execute<{ id: string; platform_role: string }>(
    sql`select id, platform_role from users where platform_role is not null order by id`,
  );
  const memberships = await db.execute<{
    user_id: string;
    org_id: string;
    org_unit_id: string | null;
    role: string;
  }>(sql`
    select user_id, org_id, org_unit_id, role from memberships
    where status = 'ACTIVE'
    order by org_id, start_date, created_at, user_id
  `);

  // The first active HR admin of each organization grants its members' roles.
  const granterByOrg = new Map<string, string>();
  for (const m of memberships.rows) {
    if (m.role === 'HR_ADMIN' && !granterByOrg.has(m.org_id)) granterByOrg.set(m.org_id, m.user_id);
  }

  const subjects: Subject[] = [
    ...platformUsers.rows.map((u) => ({
      userId: u.id,
      orgRole: null,
      platformRole: u.platform_role,
      orgId: null,
      orgUnitId: null,
      grantedByUserId: u.id,
    })),
    ...memberships.rows.map((m) => ({
      userId: m.user_id,
      orgRole: m.role,
      platformRole: null,
      orgId: m.org_id,
      orgUnitId: m.org_unit_id,
      grantedByUserId: granterByOrg.get(m.org_id) ?? m.user_id,
    })),
  ];

  const result: BackfillResult = { created: [], skipped: [] };
  for (const subject of subjects) {
    for (const tmpl of templatesForLegacyRoles(subject.orgRole, subject.platformRole)) {
      const scope = resolveSampleScope(tmpl.scopeType, subject.orgId, subject.orgUnitId);
      // The seed id stays for the first organization (sample parity). A grant
      // already under that id for another organization means a second active
      // membership: its grant gets an org-suffixed id instead of being lost.
      let id = `grant_${subject.userId}_${tmpl.key}`;
      const existing = await findGrantScopeOrg(db, id);
      if (existing !== undefined && existing.scopeOrgId !== scope.scopeOrgId) {
        id = `grant_${subject.userId}_${subject.orgId ?? 'platform'}_${tmpl.key}`;
        if ((await findGrantScopeOrg(db, id)) !== undefined) {
          result.skipped.push(id);
          continue;
        }
      } else if (existing !== undefined) {
        result.skipped.push(id);
        continue;
      }

      const inserted = await db
        .insert(t.grants)
        .values({
          id,
          subjectUserId: subject.userId,
          templateKey: tmpl.key,
          actions: [...tmpl.actions],
          scopeType: tmpl.scopeType,
          ...scope,
          conditions: await derivedGrantConditions(db, tmpl, subject.userId),
          grantedByUserId: subject.grantedByUserId,
          grantedAt: now,
          validFrom: now,
        })
        .onConflictDoNothing({ target: t.grants.id })
        .returning({ id: t.grants.id });
      (inserted.length > 0 ? result.created : result.skipped).push(id);
    }
  }
  return result;
}

async function findGrantScopeOrg(
  db: Database,
  id: string,
): Promise<{ scopeOrgId: string | null } | undefined> {
  const [row] = await db
    .select({ scopeOrgId: t.grants.scopeOrgId })
    .from(t.grants)
    .where(eq(t.grants.id, id));
  return row;
}
