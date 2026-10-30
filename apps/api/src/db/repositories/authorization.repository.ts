/**
 * AuthorizationRepository — grants, assignments, org tree, emergency access
 * and expert credentials: everything the principal loader and the
 * authorization context need from Postgres.
 */
import { Injectable } from '@nestjs/common';
import { and, desc, eq, gt, inArray, isNotNull, isNull, lte, notExists, or, sql, type SQL } from 'drizzle-orm';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { DbService, type DbExecutor } from '../db.service.js';
import {
  assignments,
  emergencyAccess,
  expertCredentials,
  grants,
  memberships,
  organizations,
  orgUnitClosure,
  orgUnits,
} from '../schema/index.js';

export type GrantRow = typeof grants.$inferSelect;
export type AssignmentRow = typeof assignments.$inferSelect;
export type EmergencyAccessRow = typeof emergencyAccess.$inferSelect;

/** A pending emergency access request: provisional window, no approver yet. */
export interface NewEmergencyRequest {
  userId: string;
  purpose: string;
  scopeKind: EmergencyAccessRow['scopeKind'];
  scopeId: string;
  requestedDurationMinutes: number;
  grantedAt: Date;
  expiresAt: Date;
}

export interface EmergencyAccessFilter {
  userId?: string;
}

/** Who revoked a grant, when, and why; written to every revoked row. */
export interface RevocationInput {
  at: Date;
  byUserId: string | null;
  reason: string;
}

export interface OrgSettings {
  selfApprovalAllowed: boolean;
  timezone: string;
  status: string;
}

@Injectable()
export class AuthorizationRepository {
  constructor(private readonly dbs: DbService) {}

  private exec(tx?: DbExecutor): DbExecutor {
    return tx ?? this.dbs.db;
  }

  /** Distinct template keys of the user's active (unrevoked, unexpired) grants. */
  async findActiveGrantTemplateKeys(userId: string, now: Date, tx?: DbExecutor): Promise<string[]> {
    const rows = await this.exec(tx)
      .selectDistinct({ templateKey: grants.templateKey })
      .from(grants)
      .where(
        and(
          eq(grants.subjectUserId, userId),
          isNull(grants.revokedAt),
          or(isNull(grants.validUntil), gt(grants.validUntil, now)),
        ),
      );
    return rows.map((r) => r.templateKey).filter((k): k is string => k != null);
  }

  /**
   * Unrevoked grants relevant to an organization context: those scoped to the
   * organization plus platform-wide and own-scoped grants (`scopeOrgId` null).
   */
  async findGrantsForOrg(userId: string, orgId: string, tx?: DbExecutor): Promise<GrantRow[]> {
    return this.exec(tx)
      .select()
      .from(grants)
      .where(
        and(
          eq(grants.subjectUserId, userId),
          isNull(grants.revokedAt),
          or(isNull(grants.scopeOrgId), eq(grants.scopeOrgId, orgId)),
        ),
      );
  }

  /** Unrevoked grants scoped to one organization (for membership end, AUTHZ). */
  async findActiveGrantsScopedToOrg(userId: string, orgId: string, tx?: DbExecutor): Promise<GrantRow[]> {
    return this.exec(tx)
      .select()
      .from(grants)
      .where(
        and(eq(grants.subjectUserId, userId), eq(grants.scopeOrgId, orgId), isNull(grants.revokedAt)),
      );
  }

  /** Unrevoked grants delegated from any of the given parent grants. */
  async findActiveChildGrants(parentGrantIds: string[], tx?: DbExecutor): Promise<GrantRow[]> {
    if (parentGrantIds.length === 0) return [];
    return this.exec(tx)
      .select()
      .from(grants)
      .where(and(inArray(grants.parentGrantId, parentGrantIds), isNull(grants.revokedAt)));
  }

  /**
   * Revoke the given grants that are still unrevoked. Returns the ids this
   * call actually revoked (already-revoked rows are left untouched).
   */
  async revokeGrants(
    grantIds: string[],
    revoked: RevocationInput,
    tx?: DbExecutor,
  ): Promise<string[]> {
    if (grantIds.length === 0) return [];
    const rows = await this.exec(tx)
      .update(grants)
      .set({ revokedAt: revoked.at, revokedByUserId: revoked.byUserId, revokedReason: revoked.reason })
      .where(and(inArray(grants.id, grantIds), isNull(grants.revokedAt)))
      .returning({ id: grants.id });
    return rows.map((r) => r.id);
  }

  /**
   * Revoke the root grants and every unrevoked descendant delegated from
   * them. Roots get the caller's reason; descendants get `parent_revoked`
   * (same `at` and `byUserId`), matching the nightly orphan sweep. `roots` lists the roots this
   * call revoked; `children` every descendant it revoked, breadth first.
   * Run inside the root grants' tenant scope (`withOrgScope(orgId)`) or the
   * system context; descendants of an org grant share its organization.
   */
  async revokeGrantTree(
    rootIds: string[],
    revoked: RevocationInput,
    tx?: DbExecutor,
  ): Promise<{ roots: string[]; children: string[] }> {
    const roots = await this.revokeGrants(rootIds, revoked, tx);
    const children: string[] = [];
    // Revoked rows drop out of findActiveChildGrants, so the walk terminates
    // even on a malformed (cyclic) parent chain.
    let parents = rootIds;
    while (parents.length > 0) {
      const next = await this.findActiveChildGrants(parents, tx);
      if (next.length === 0) break;
      const revokedIds = await this.revokeGrants(
        next.map((g) => g.id),
        { ...revoked, reason: 'parent_revoked' },
        tx,
      );
      children.push(...revokedIds);
      parents = revokedIds;
    }
    return { roots, children };
  }

  // ── Grant administration (auth phase 2) ───────────────────────────────

  /** One grant by id, or null when absent or hidden by the tenant scope. */
  async findGrantById(id: string, tx?: DbExecutor): Promise<GrantRow | null> {
    const [row] = await this.exec(tx).select().from(grants).where(eq(grants.id, id));
    return row ?? null;
  }

  /**
   * Grants scoped to one organization (`scope_org_id = orgId`), newest
   * first; unrevoked only unless `includeRevoked`. Run inside
   * `withOrgScope(orgId)`.
   */
  async listGrantsForOrg(
    orgId: string,
    filter: { subjectUserId?: string; includeRevoked?: boolean },
    tx?: DbExecutor,
  ): Promise<GrantRow[]> {
    const where: SQL[] = [eq(grants.scopeOrgId, orgId)];
    if (filter.subjectUserId) where.push(eq(grants.subjectUserId, filter.subjectUserId));
    if (!filter.includeRevoked) where.push(isNull(grants.revokedAt));
    return this.exec(tx)
      .select()
      .from(grants)
      .where(and(...where))
      .orderBy(desc(grants.grantedAt), desc(grants.id));
  }

  /**
   * Platform-wide and own-scoped grants (`scope_org_id IS NULL`), newest
   * first; unrevoked only unless `includeRevoked`, optionally one subject's.
   * Visible in every scope; the system context is the natural caller.
   */
  async listPlatformGrants(
    filter: { subjectUserId?: string; includeRevoked?: boolean },
    tx?: DbExecutor,
  ): Promise<GrantRow[]> {
    const where: SQL[] = [isNull(grants.scopeOrgId)];
    if (filter.subjectUserId) where.push(eq(grants.subjectUserId, filter.subjectUserId));
    if (!filter.includeRevoked) where.push(isNull(grants.revokedAt));
    return this.exec(tx)
      .select()
      .from(grants)
      .where(and(...where))
      .orderBy(desc(grants.grantedAt), desc(grants.id));
  }

  /**
   * Adjust a grant's conditions or validity window; omitted fields are kept.
   * Throws when the grant is absent or hidden by the tenant scope, so run it
   * in the grant's scope (`withOrgScope(orgId)` for org grants).
   */
  async updateGrant(
    id: string,
    patch: { conditions?: unknown[]; validFrom?: Date; validUntil?: Date | null },
    tx?: DbExecutor,
  ): Promise<GrantRow> {
    const set: Partial<typeof grants.$inferInsert> = {};
    if (patch.conditions !== undefined) set.conditions = patch.conditions;
    if (patch.validFrom !== undefined) set.validFrom = patch.validFrom;
    if (patch.validUntil !== undefined) set.validUntil = patch.validUntil;
    if (Object.keys(set).length === 0) {
      const existing = await this.findGrantById(id, tx);
      if (!existing) throw new Error(`Grant ${id} not found`);
      return existing;
    }
    const [row] = await this.exec(tx).update(grants).set(set).where(eq(grants.id, id)).returning();
    if (!row) throw new Error(`Grant ${id} not found`);
    return row;
  }

  /**
   * Number of `parent_grant_id` hops from the grant to its root (root = 0).
   * Run in the grant's tenant scope; a parent hidden by the scope or deleted
   * ends the chain.
   */
  async delegationDepth(grantId: string, tx?: DbExecutor): Promise<number> {
    const result = await this.exec(tx).execute<{ depth: number }>(sql`
      with recursive chain(id, parent_grant_id, depth) as (
        select ${grants.id}, ${grants.parentGrantId}, 0
        from ${grants} where ${grants.id} = ${grantId}
        union all
        select g.id, g.parent_grant_id, chain.depth + 1
        from ${grants} as g join chain on g.id = chain.parent_grant_id
        where chain.depth < 64
      )
      select coalesce(max(depth), 0)::int as depth from chain
    `);
    return Number(result.rows[0]?.depth ?? 0);
  }

  /**
   * Every ancestor grant reachable through `parent_grant_id` from the given
   * (delegated) grants, revoked or not: the engine decides what a revoked or
   * expired ancestor means. The given grants themselves are returned only
   * when one is an ancestor of another. Same walk as `delegationDepth`: a
   * parent hidden by the tenant scope or deleted ends its chain.
   */
  async findDelegationAncestors(grantIds: string[], tx?: DbExecutor): Promise<GrantRow[]> {
    if (grantIds.length === 0) return [];
    const seeds = sql.join(grantIds.map((id) => sql`${id}`), sql`, `);
    const result = await this.exec(tx).execute<{ id: string }>(sql`
      with recursive chain(id, parent_grant_id, hops) as (
        select parent.id, parent.parent_grant_id, 1
        from ${grants} as child join ${grants} as parent on parent.id = child.parent_grant_id
        where child.id in (${seeds})
        union all
        select g.id, g.parent_grant_id, chain.hops + 1
        from ${grants} as g join chain on g.id = chain.parent_grant_id
        where chain.hops < 64
      )
      select distinct id from chain
    `);
    const ids = result.rows.map((r) => r.id);
    if (ids.length === 0) return [];
    return this.exec(tx).select().from(grants).where(inArray(grants.id, ids));
  }

  /**
   * Every grant delegated, directly or not, from the given grants, revoked
   * or not (a tree revoked a moment ago still names its delegatees). A given
   * grant is included only when it descends from another given grant (callers
   * pass a whole revoked tree). A child hidden by the tenant scope ends its
   * branch; the system context sees every branch.
   */
  async findDelegationDescendants(grantIds: string[], tx?: DbExecutor): Promise<GrantRow[]> {
    if (grantIds.length === 0) return [];
    const seeds = sql.join(grantIds.map((id) => sql`${id}`), sql`, `);
    const result = await this.exec(tx).execute<{ id: string }>(sql`
      with recursive tree(id, hops) as (
        select g.id, 1 from ${grants} as g where g.parent_grant_id in (${seeds})
        union all
        select g.id, tree.hops + 1
        from ${grants} as g join tree on g.parent_grant_id = tree.id
        where tree.hops < 64
      )
      select distinct id from tree
    `);
    const ids = result.rows.map((r) => r.id);
    if (ids.length === 0) return [];
    return this.exec(tx).select().from(grants).where(inArray(grants.id, ids));
  }

  /**
   * Unrevoked `employer_owner` grants of the organization that have not
   * expired at `now` (including ones that start later), oldest first. Takes
   * a transaction-scoped advisory lock on the organization's ownership
   * first, so concurrent owner writes for one organization serialise until
   * the caller's transaction ends. Run inside `withOrgScope(orgId)`.
   */
  async findActiveOwnerGrants(orgId: string, now: Date, tx?: DbExecutor): Promise<GrantRow[]> {
    const exec = this.exec(tx);
    await exec.execute(sql`select pg_advisory_xact_lock(hashtext(${`employer_owner:${orgId}`}))`);
    return exec
      .select()
      .from(grants)
      .where(
        and(
          eq(grants.scopeOrgId, orgId),
          eq(grants.templateKey, 'employer_owner'),
          isNull(grants.revokedAt),
          or(isNull(grants.validUntil), gt(grants.validUntil, now)),
        ),
      )
      .orderBy(grants.grantedAt, grants.id);
  }

  /**
   * Move the unrevoked direct children of `fromGrantId` under `toGrantId`
   * (ownership transfer); returns the updated rows. Revoked children keep
   * their history. Run inside the grants' `withOrgScope(orgId)`.
   */
  async reparentActiveChildren(fromGrantId: string, toGrantId: string, tx?: DbExecutor): Promise<GrantRow[]> {
    return this.exec(tx)
      .update(grants)
      .set({ parentGrantId: toGrantId })
      .where(and(eq(grants.parentGrantId, fromGrantId), isNull(grants.revokedAt)))
      .returning();
  }

  /** The user's ACTIVE membership in the organization. Run inside `withOrgScope(orgId)`. */
  async findActiveMembership(
    userId: string,
    orgId: string,
    tx?: DbExecutor,
  ): Promise<{ membershipId: string; orgUnitId: string | null } | null> {
    const [row] = await this.exec(tx)
      .select({ membershipId: memberships.id, orgUnitId: memberships.orgUnitId })
      .from(memberships)
      .where(
        and(eq(memberships.userId, userId), eq(memberships.orgId, orgId), eq(memberships.status, 'ACTIVE')),
      )
      .limit(1);
    return row ?? null;
  }

  // ── Nightly reconciliation (T-2.10, D-17) ─────────────────────────────

  /** Unrevoked grants whose validity window has closed. */
  async findExpiredUnrevokedGrants(now: Date, tx?: DbExecutor): Promise<GrantRow[]> {
    return this.exec(tx)
      .select()
      .from(grants)
      .where(and(isNull(grants.revokedAt), isNotNull(grants.validUntil), lte(grants.validUntil, now)));
  }

  /** Unrevoked delegated grants whose parent grant is revoked (or gone). */
  async findOrphanedDelegations(tx?: DbExecutor): Promise<GrantRow[]> {
    const parent = sql`(select 1 from ${grants} as parent where parent.id = ${grants.parentGrantId} and parent.revoked_at is null)`;
    return this.exec(tx)
      .select()
      .from(grants)
      .where(and(isNull(grants.revokedAt), isNotNull(grants.parentGrantId), notExists(parent)));
  }

  /**
   * Unrevoked organization-scoped grants whose subject has no ACTIVE
   * membership in that organization (membership ended without the cascade).
   */
  async findGrantsWithoutActiveMembership(tx?: DbExecutor): Promise<GrantRow[]> {
    const active = this.exec(tx)
      .select({ one: sql`1` })
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, grants.subjectUserId),
          eq(memberships.orgId, grants.scopeOrgId),
          eq(memberships.status, 'ACTIVE'),
        ),
      );
    return this.exec(tx)
      .select()
      .from(grants)
      .where(and(isNull(grants.revokedAt), isNotNull(grants.scopeOrgId), notExists(active)));
  }

  async createGrant(input: typeof grants.$inferInsert, tx?: DbExecutor): Promise<GrantRow> {
    const [row] = await this.exec(tx).insert(grants).values(input).returning();
    return row!;
  }

  /** Assignments active at `now`. */
  async findActiveAssignments(userId: string, now: Date, tx?: DbExecutor): Promise<AssignmentRow[]> {
    return this.exec(tx)
      .select()
      .from(assignments)
      .where(
        and(
          eq(assignments.userId, userId),
          lte(assignments.startAt, now),
          or(isNull(assignments.endAt), gt(assignments.endAt, now)),
        ),
      );
  }

  async findOrgSettings(orgId: string, tx?: DbExecutor): Promise<OrgSettings | null> {
    const [row] = await this.exec(tx)
      .select({
        selfApprovalAllowed: organizations.selfApprovalAllowed,
        timezone: organizations.timezone,
        status: organizations.status,
      })
      .from(organizations)
      .where(eq(organizations.id, orgId));
    return row ?? null;
  }

  /** Every (ancestor, descendant) pair whose descendant belongs to the organization. */
  async findClosureForOrg(
    orgId: string,
    tx?: DbExecutor,
  ): Promise<Array<{ ancestorId: string; descendantId: string }>> {
    return this.exec(tx)
      .select({ ancestorId: orgUnitClosure.ancestorId, descendantId: orgUnitClosure.descendantId })
      .from(orgUnitClosure)
      .innerJoin(orgUnits, eq(orgUnits.id, orgUnitClosure.descendantId))
      .where(eq(orgUnits.orgId, orgId));
  }

  /** Ancestor-or-self ids of an org unit. */
  async findAncestorIds(orgUnitId: string, tx?: DbExecutor): Promise<string[]> {
    const rows = await this.exec(tx)
      .select({ ancestorId: orgUnitClosure.ancestorId })
      .from(orgUnitClosure)
      .where(eq(orgUnitClosure.descendantId, orgUnitId));
    return rows.map((r) => r.ancestorId);
  }

  /**
   * Emergency access records that are approved, unrevoked and unexpired at
   * `now` (never cached, AUTHZ-R-46). A pending request is never active.
   */
  async findActiveEmergencyAccess(userId: string, now: Date, tx?: DbExecutor): Promise<EmergencyAccessRow[]> {
    return this.exec(tx)
      .select()
      .from(emergencyAccess)
      .where(
        and(
          eq(emergencyAccess.userId, userId),
          isNotNull(emergencyAccess.approvedByUserId),
          isNull(emergencyAccess.revokedAt),
          gt(emergencyAccess.expiresAt, now),
        ),
      );
  }

  async createEmergencyRequest(values: NewEmergencyRequest, tx?: DbExecutor): Promise<EmergencyAccessRow> {
    const [row] = await this.exec(tx)
      .insert(emergencyAccess)
      .values({ ...values, approvedByUserId: null, approvedAt: null })
      .returning();
    return row!;
  }

  async findEmergencyAccess(id: string, tx?: DbExecutor): Promise<EmergencyAccessRow | null> {
    const [row] = await this.exec(tx).select().from(emergencyAccess).where(eq(emergencyAccess.id, id));
    return row ?? null;
  }

  /** Every emergency access record in any state, newest first (pending, active, expired, revoked). */
  async listEmergencyAccess(filter: EmergencyAccessFilter, tx?: DbExecutor): Promise<EmergencyAccessRow[]> {
    return this.exec(tx)
      .select()
      .from(emergencyAccess)
      .where(filter.userId ? eq(emergencyAccess.userId, filter.userId) : undefined)
      .orderBy(desc(emergencyAccess.grantedAt), desc(emergencyAccess.id));
  }

  /**
   * Approve a pending request: restarts the window at `at`. Returns null when
   * the row is missing, already approved or revoked, so two concurrent
   * approvals cannot both succeed.
   */
  async approveEmergencyAccess(
    id: string,
    approverUserId: string,
    at: Date,
    expiresAt: Date,
    tx?: DbExecutor,
  ): Promise<EmergencyAccessRow | null> {
    const [row] = await this.exec(tx)
      .update(emergencyAccess)
      .set({ approvedByUserId: approverUserId, approvedAt: at, grantedAt: at, expiresAt })
      .where(
        and(
          eq(emergencyAccess.id, id),
          isNull(emergencyAccess.approvedByUserId),
          isNull(emergencyAccess.revokedAt),
        ),
      )
      .returning();
    return row ?? null;
  }

  /** Delete a pending request (denial); an approved record is never deleted. */
  async deleteEmergencyRequest(id: string, tx?: DbExecutor): Promise<boolean> {
    const rows = await this.exec(tx)
      .delete(emergencyAccess)
      .where(and(eq(emergencyAccess.id, id), isNull(emergencyAccess.approvedByUserId)))
      .returning({ id: emergencyAccess.id });
    return rows.length > 0;
  }

  /** Set `revokedAt` once; `byUserId` null marks the expiry sweeper. Null when already revoked or missing. */
  async revokeEmergencyAccess(
    id: string,
    byUserId: string | null,
    at: Date,
    tx?: DbExecutor,
  ): Promise<EmergencyAccessRow | null> {
    const [row] = await this.exec(tx)
      .update(emergencyAccess)
      .set({ revokedAt: at, revokedByUserId: byUserId })
      .where(and(eq(emergencyAccess.id, id), isNull(emergencyAccess.revokedAt)))
      .returning();
    return row ?? null;
  }

  /** Approved, unrevoked records whose window has closed at `now` (sweeper input). */
  async findExpiredApprovedEmergencyAccess(now: Date, tx?: DbExecutor): Promise<EmergencyAccessRow[]> {
    return this.exec(tx)
      .select()
      .from(emergencyAccess)
      .where(
        and(
          isNotNull(emergencyAccess.approvedByUserId),
          isNull(emergencyAccess.revokedAt),
          lte(emergencyAccess.expiresAt, now),
        ),
      );
  }

  /** Service categories with an APPROVED, effective, unexpired credential. */
  async findApprovedCategories(expertId: string, now: Date, tx?: DbExecutor): Promise<string[]> {
    const rows = await this.exec(tx)
      .select({ serviceCategory: expertCredentials.serviceCategory })
      .from(expertCredentials)
      .where(
        and(
          eq(expertCredentials.expertId, expertId),
          eq(expertCredentials.status, 'APPROVED'),
          lte(expertCredentials.effectiveFrom, now),
          or(isNull(expertCredentials.expiresAt), gt(expertCredentials.expiresAt, now)),
        ),
      );
    return rows.map((r) => r.serviceCategory);
  }
}
