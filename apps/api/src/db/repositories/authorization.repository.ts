/**
 * AuthorizationRepository — grants, assignments, org tree, emergency access
 * and expert credentials: everything the principal loader and the
 * authorization context need from Postgres.
 */
import { Injectable } from '@nestjs/common';
import { and, eq, gt, inArray, isNotNull, isNull, lte, notExists, or, sql } from 'drizzle-orm';
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

  async revokeGrants(
    grantIds: string[],
    revoked: { at: Date; byUserId: string | null; reason: string },
    tx?: DbExecutor,
  ): Promise<void> {
    if (grantIds.length === 0) return;
    await this.exec(tx)
      .update(grants)
      .set({ revokedAt: revoked.at, revokedByUserId: revoked.byUserId, revokedReason: revoked.reason })
      .where(and(inArray(grants.id, grantIds), isNull(grants.revokedAt)));
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

  /** Emergency access records that are unrevoked and unexpired at `now` (never cached, AUTHZ-R-46). */
  async findActiveEmergencyAccess(userId: string, now: Date, tx?: DbExecutor): Promise<EmergencyAccessRow[]> {
    return this.exec(tx)
      .select()
      .from(emergencyAccess)
      .where(
        and(
          eq(emergencyAccess.userId, userId),
          isNull(emergencyAccess.revokedAt),
          gt(emergencyAccess.expiresAt, now),
        ),
      );
  }

  /**
   * Distinct (scopeOrgId, templateKey) pairs for active grants scoped to one
   * of the given organizations. Used by `computeAvailableContexts` to decide
   * which orgs get an `organization` context entry (Ruling B, T-C1.02).
   */
  async findActiveOrgGrantTemplateKeys(
    userId: string,
    orgIds: string[],
    now: Date,
    tx?: DbExecutor,
  ): Promise<Array<{ orgId: string; templateKey: string }>> {
    if (orgIds.length === 0) return [];
    const rows = await this.exec(tx)
      .selectDistinct({
        orgId: grants.scopeOrgId,
        templateKey: grants.templateKey,
      })
      .from(grants)
      .where(
        and(
          eq(grants.subjectUserId, userId),
          isNull(grants.revokedAt),
          inArray(grants.scopeOrgId, orgIds),
          or(isNull(grants.validFrom), lte(grants.validFrom, now)),
          or(isNull(grants.validUntil), gt(grants.validUntil, now)),
        ),
      );
    return rows
      .filter((r): r is { orgId: string; templateKey: string } => r.orgId != null && r.templateKey != null);
  }

  /** Organization names keyed by orgId (Ruling B, T-C1.02). */
  async findOrgNames(orgIds: string[], tx?: DbExecutor): Promise<Map<string, string>> {
    if (orgIds.length === 0) return new Map();
    const rows = await this.exec(tx)
      .select({ id: organizations.id, name: organizations.name })
      .from(organizations)
      .where(inArray(organizations.id, orgIds));
    return new Map(rows.map((r) => [r.id, r.name]));
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
