/**
 * AuthorizationRepository — grants, assignments, org tree, emergency access
 * and expert credentials: everything the principal loader and the
 * authorization context need from Postgres.
 */
import { Injectable } from '@nestjs/common';
import { and, eq, gt, inArray, isNull, lte, or } from 'drizzle-orm';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { DbService, type DbExecutor } from '../db.service.js';
import {
  assignments,
  emergencyAccess,
  expertCredentials,
  grants,
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
