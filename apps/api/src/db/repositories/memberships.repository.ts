/**
 * MembershipsRepository — membership rows (T-1.16). Methods are added by the
 * members feature; keep Drizzle query builders here, not in services.
 */
import { Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { DbService, type DbExecutor } from '../db.service.js';
import { memberships } from '../schema/index.js';

export type MembershipRow = typeof memberships.$inferSelect;
export type NewMembership = typeof memberships.$inferInsert;

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
}
