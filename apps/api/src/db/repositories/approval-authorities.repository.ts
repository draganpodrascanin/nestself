/**
 * ApprovalAuthoritiesRepository — who may decide requests within a scope,
 * categories and amount ceiling [D-17, MGR-04]. The table is tenant-scoped
 * (RLS on `org_id`): call every method inside `withOrgScope(orgId)`.
 */
import { Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { DbService, type DbExecutor } from '../db.service.js';
import { approvalAuthorities } from '../schema/index.js';

export type ApprovalAuthorityRow = typeof approvalAuthorities.$inferSelect;
export type ApprovalAuthorityInsert = typeof approvalAuthorities.$inferInsert;
export type ApprovalAuthorityPatch = Partial<Omit<ApprovalAuthorityInsert, 'id' | 'orgId' | 'createdAt'>>;

@Injectable()
export class ApprovalAuthoritiesRepository {
  constructor(private readonly dbs: DbService) {}

  private exec(tx?: DbExecutor): DbExecutor {
    return tx ?? this.dbs.db;
  }

  /** The organization's approval authorities, newest first. */
  async list(orgId: string, tx?: DbExecutor): Promise<ApprovalAuthorityRow[]> {
    return this.exec(tx)
      .select()
      .from(approvalAuthorities)
      .where(eq(approvalAuthorities.orgId, orgId))
      .orderBy(desc(approvalAuthorities.createdAt), desc(approvalAuthorities.id));
  }

  /** One authority by id, or null when absent or hidden by the tenant scope. */
  async findById(id: string, tx?: DbExecutor): Promise<ApprovalAuthorityRow | null> {
    const [row] = await this.exec(tx).select().from(approvalAuthorities).where(eq(approvalAuthorities.id, id));
    return row ?? null;
  }

  async create(input: ApprovalAuthorityInsert, tx?: DbExecutor): Promise<ApprovalAuthorityRow> {
    const [row] = await this.exec(tx).insert(approvalAuthorities).values(input).returning();
    return row!;
  }

  /** Apply a partial update; throws when the authority is absent or hidden by the scope. */
  async update(id: string, patch: ApprovalAuthorityPatch, tx?: DbExecutor): Promise<ApprovalAuthorityRow> {
    const [row] = await this.exec(tx)
      .update(approvalAuthorities)
      .set(patch)
      .where(eq(approvalAuthorities.id, id))
      .returning();
    if (!row) throw new Error(`Approval authority ${id} not found`);
    return row;
  }
}
