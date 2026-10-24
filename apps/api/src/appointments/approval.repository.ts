/**
 * ApprovalRepository: the `appointment_approvals` rows, the approval
 * authorities and unit ancestry the approver selection reads, and the
 * organization settings of the follow-up flow (T-CW-1.10, D-CW-37).
 *
 * Reads without a `tx` run in system context, like the appointments
 * repository: the resolver loads an item before it knows the organization,
 * and every item is authorized before it is returned. Writes run inside
 * `DbService.withOrgScope` (RLS). `organizations` is the tenant anchor and has
 * no row-level security.
 */
import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import type { FollowUpApprovalPolicy } from '@nestself/contracts';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { DbService, type DbExecutor } from '../db/db.service.js';
import {
  appointmentApprovals,
  approvalAuthorities,
  organizations,
  orgUnitClosure,
  users,
} from '../db/schema/index.js';
import type { AuthorityCandidate, UnitAncestry } from './approval-selection.js';
import { toContractFollowUpPolicy, toDbFollowUpPolicy } from './follow-up-policy.js';

export type ApprovalRow = typeof appointmentApprovals.$inferSelect;
export type DbApprovalStatus = ApprovalRow['status'];
export type NewApproval = Omit<typeof appointmentApprovals.$inferInsert, 'status' | 'createdAt' | 'decidedAt' | 'reason'>;

/** At most this many items in the approver's list: pending ones first, then the latest decisions. */
export const APPROVAL_LIST_LIMIT = 100;

@Injectable()
export class ApprovalRepository {
  constructor(private readonly dbs: DbService) {}

  private exec(tx?: DbExecutor): DbExecutor {
    return tx ?? this.dbs.db;
  }

  async findById(id: string, tx?: DbExecutor): Promise<ApprovalRow | null> {
    const [row] = await this.exec(tx).select().from(appointmentApprovals).where(eq(appointmentApprovals.id, id));
    return row ?? null;
  }

  /** The appointment's pending item, if any (at most one: an appointment waits for one decision). */
  async findPendingByAppointment(appointmentId: string, tx?: DbExecutor): Promise<ApprovalRow | null> {
    const [row] = await this.exec(tx)
      .select()
      .from(appointmentApprovals)
      .where(and(eq(appointmentApprovals.appointmentId, appointmentId), eq(appointmentApprovals.status, 'PENDING')))
      .orderBy(desc(appointmentApprovals.createdAt))
      .limit(1);
    return row ?? null;
  }

  async insert(values: NewApproval, tx: DbExecutor): Promise<ApprovalRow> {
    const [row] = await tx.insert(appointmentApprovals).values({ ...values, status: 'PENDING' }).returning();
    return row!;
  }

  /** Moves a still-pending item to `status`; null when it is missing or no longer pending. */
  async decideFromPending(
    id: string,
    status: Exclude<DbApprovalStatus, 'PENDING'>,
    reason: string | null,
    decidedAt: Date,
    tx: DbExecutor,
  ): Promise<ApprovalRow | null> {
    const [row] = await tx
      .update(appointmentApprovals)
      .set({ status, reason, decidedAt })
      .where(and(eq(appointmentApprovals.id, id), eq(appointmentApprovals.status, 'PENDING')))
      .returning();
    return row ?? null;
  }

  /** The items `userId` approves or is the alternate for in `orgId`: pending first, then newest first. */
  async listForDecider(orgId: string, userId: string, tx?: DbExecutor): Promise<ApprovalRow[]> {
    return this.exec(tx)
      .select()
      .from(appointmentApprovals)
      .where(
        and(
          eq(appointmentApprovals.orgId, orgId),
          or(eq(appointmentApprovals.approverUserId, userId), eq(appointmentApprovals.alternateUserId, userId)),
        ),
      )
      .orderBy(
        sql`case when ${appointmentApprovals.status} = 'PENDING' then 0 else 1 end`,
        desc(appointmentApprovals.createdAt),
        asc(appointmentApprovals.id),
      )
      .limit(APPROVAL_LIST_LIMIT);
  }

  /** Every approval authority of the organization; `approval-selection.ts` filters them. */
  async authoritiesOf(orgId: string, tx?: DbExecutor): Promise<AuthorityCandidate[]> {
    return this.exec(tx)
      .select({
        id: approvalAuthorities.id,
        userId: approvalAuthorities.userId,
        orgUnitId: approvalAuthorities.orgUnitId,
        includeDescendants: approvalAuthorities.includeDescendants,
        categories: approvalAuthorities.categories,
        validFrom: approvalAuthorities.validFrom,
        validUntil: approvalAuthorities.validUntil,
        alternateUserId: approvalAuthorities.alternateUserId,
        isConfidentialApprover: approvalAuthorities.isConfidentialApprover,
        createdAt: approvalAuthorities.createdAt,
      })
      .from(approvalAuthorities)
      .where(eq(approvalAuthorities.orgId, orgId));
  }

  /** The unit and its ancestors with their depth, from `org_unit_closure`; null without a unit. */
  async ancestryOf(unitId: string | null, tx?: DbExecutor): Promise<UnitAncestry | null> {
    if (!unitId) return null;
    const rows = await this.exec(tx)
      .select({ ancestorId: orgUnitClosure.ancestorId, depth: orgUnitClosure.depth })
      .from(orgUnitClosure)
      .where(eq(orgUnitClosure.descendantId, unitId));
    const depthByAncestor = new Map(rows.map((row) => [row.ancestorId, row.depth]));
    depthByAncestor.set(unitId, 0);
    return { unitId, depthByAncestor };
  }

  /** Display names by user id. */
  async displayNamesOf(userIds: readonly string[], tx?: DbExecutor): Promise<Map<string, string>> {
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return new Map();
    const rows = await this.exec(tx)
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(inArray(users.id, ids));
    return new Map(rows.map((row) => [row.id, row.displayName]));
  }

  async selfApprovalAllowed(orgId: string, tx?: DbExecutor): Promise<boolean> {
    const [row] = await this.exec(tx)
      .select({ allowed: organizations.selfApprovalAllowed })
      .from(organizations)
      .where(eq(organizations.id, orgId));
    return row?.allowed ?? false;
  }

  /**
   * Sets the organization's follow-up policy under a row lock and returns the
   * policy it replaced; null when the organization does not exist.
   */
  async replacePolicy(orgId: string, policy: FollowUpApprovalPolicy, tx: DbExecutor): Promise<FollowUpApprovalPolicy | null> {
    const [current] = await tx
      .select({ policy: organizations.followUpApprovalPolicy })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .for('update');
    if (!current) return null;
    const previous = toContractFollowUpPolicy(current.policy);
    if (previous !== policy) {
      await tx
        .update(organizations)
        .set({ followUpApprovalPolicy: toDbFollowUpPolicy(policy) })
        .where(eq(organizations.id, orgId));
    }
    return previous;
  }
}
