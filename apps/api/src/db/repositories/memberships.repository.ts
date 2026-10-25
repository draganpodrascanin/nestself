/**
 * MembershipsRepository — membership rows (T-1.16). Methods are added by the
 * members feature; keep Drizzle query builders here, not in services.
 */
import { Injectable } from '@nestjs/common';
import { and, asc, eq, gt, ilike, inArray, isNull, or } from 'drizzle-orm';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { DbService, type DbExecutor } from '../db.service.js';
import { memberships, orgUnitClosure } from '../schema/index.js';
import { users } from '../schema/index.js';

export type MembershipRow = typeof memberships.$inferSelect;
export type NewMembership = typeof memberships.$inferInsert;

export interface MemberListOptions {
  orgId: string;
  limit: number;
  cursor?: string;
  orgUnitId?: string;
  status?: 'INVITED' | 'ACTIVE' | 'ENDED';
  search?: string;
}

export interface MemberListItem {
  membershipId: string;
  userId: string;
  displayName: string;
  email: string;
  orgUnitId: string | null;
  costCenterUnitId: string | null;
  lineManagerUserId: string | null;
  status: 'INVITED' | 'ACTIVE' | 'ENDED';
  startDate: Date;
  endDate: Date | null;
}

@Injectable()
export class MembershipsRepository {
  constructor(private readonly dbs: DbService) {}

  protected exec(tx?: DbExecutor): DbExecutor {
    return tx ?? this.dbs.db;
  }

  /** Find a membership by id, scoped to an organization. */
  async findByIdAndOrg(
    membershipId: string,
    orgId: string,
    tx?: DbExecutor,
  ): Promise<MembershipRow | null> {
    const [row] = await this.exec(tx)
      .select()
      .from(memberships)
      .where(and(eq(memberships.id, membershipId), eq(memberships.orgId, orgId)));
    return row ?? null;
  }

  /** End a membership: set status, endDate, endedReason. */
  async endMembership(
    membershipId: string,
    endDate: Date,
    endedReason: string,
    tx?: DbExecutor,
  ): Promise<MembershipRow | null> {
    const [row] = await this.exec(tx)
      .update(memberships)
      .set({ status: 'ENDED', endDate, endedReason })
      .where(
        and(
          eq(memberships.id, membershipId),
          // Only end non-ended memberships (idempotency guard at DB level).
          isNull(memberships.endDate),
        ),
      )
      .returning();
    return row ?? null;
  }

  /** List memberships for a user. */
  async findByUserId(userId: string, tx?: DbExecutor): Promise<MembershipRow[]> {
    return this.exec(tx)
      .select()
      .from(memberships)
      .where(eq(memberships.userId, userId));
  }

  /**
   * Find an ACTIVE membership for a user in an organization.
   * Used for validation (e.g. checking lineManagerUserId).
   */
  async findActiveByUserAndOrg(
    userId: string,
    orgId: string,
    tx?: DbExecutor,
  ): Promise<MembershipRow | null> {
    const [row] = await this.exec(tx)
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, userId),
          eq(memberships.orgId, orgId),
          eq(memberships.status, 'ACTIVE'),
        ),
      );
    return row ?? null;
  }

  /**
   * List members joined with users, with cursor pagination and filters.
   * Cursor is the last membership id (stable ordering by id).
   */
  async listMembers(
    opts: MemberListOptions,
    tx?: DbExecutor,
  ): Promise<MemberListItem[]> {
    const conditions = [eq(memberships.orgId, opts.orgId)];

    if (opts.status) {
      conditions.push(eq(memberships.status, opts.status));
    }

    if (opts.cursor) {
      conditions.push(gt(memberships.id, opts.cursor));
    }

    if (opts.search) {
      const pattern = `${opts.search}%`;
      conditions.push(
        or(
          ilike(users.displayName, pattern),
          ilike(users.email, pattern),
        )!,
      );
    }

    // When orgUnitId is set, include descendants via closure table
    if (opts.orgUnitId) {
      const descendantIds = this.exec(tx)
        .select({ id: orgUnitClosure.descendantId })
        .from(orgUnitClosure)
        .where(eq(orgUnitClosure.ancestorId, opts.orgUnitId));

      conditions.push(inArray(memberships.orgUnitId, descendantIds));
    }

    const rows = await this.exec(tx)
      .select({
        membershipId: memberships.id,
        userId: memberships.userId,
        displayName: users.displayName,
        email: users.email,
        orgUnitId: memberships.orgUnitId,
        costCenterUnitId: memberships.costCenterUnitId,
        lineManagerUserId: memberships.lineManagerUserId,
        status: memberships.status,
        startDate: memberships.startDate,
        endDate: memberships.endDate,
      })
      .from(memberships)
      .innerJoin(users, eq(memberships.userId, users.id))
      .where(and(...conditions))
      .orderBy(asc(memberships.id))
      .limit(opts.limit + 1); // fetch one extra to detect next page

    return rows as MemberListItem[];
  }

  /** Display name and email of a member, for the member item an update returns. */
  async findMemberContact(
    userId: string,
    tx?: DbExecutor,
  ): Promise<{ displayName: string; email: string } | null> {
    const [row] = await this.exec(tx)
      .select({ displayName: users.displayName, email: users.email })
      .from(users)
      .where(eq(users.id, userId));
    return row ?? null;
  }

  /** Update mutable fields on a membership. */
  async updateMembership(
    membershipId: string,
    orgId: string,
    values: Partial<Pick<NewMembership, 'orgUnitId' | 'costCenterUnitId' | 'lineManagerUserId'>>,
    tx?: DbExecutor,
  ): Promise<MembershipRow | null> {
    const [row] = await this.exec(tx)
      .update(memberships)
      .set(values)
      .where(and(eq(memberships.id, membershipId), eq(memberships.orgId, orgId)))
      .returning();
    return row ?? null;
  }
}
