/**
 * OrgUnitsRepository — org-unit tree and closure rows. Methods are added by
 * the org-units feature; keep Drizzle query builders here, not in services.
 */
import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { DbService, type DbExecutor } from '../db.service.js';
import { orgUnits, orgUnitClosure } from '../schema/index.js';

export type OrgUnitRow = typeof orgUnits.$inferSelect;
export type NewOrgUnit = typeof orgUnits.$inferInsert;
export type ClosureRow = typeof orgUnitClosure.$inferSelect;

@Injectable()
export class OrgUnitsRepository {
  constructor(private readonly dbs: DbService) {}

  protected exec(tx?: DbExecutor): DbExecutor {
    return tx ?? this.dbs.db;
  }

  // ── Queries ──────────────────────────────────────────────────────────────

  /** Find a unit by id, scoped to an organization. */
  async findByIdAndOrg(
    unitId: string,
    orgId: string,
    tx?: DbExecutor,
  ): Promise<OrgUnitRow | null> {
    const [row] = await this.exec(tx)
      .select()
      .from(orgUnits)
      .where(and(eq(orgUnits.id, unitId), eq(orgUnits.orgId, orgId)));
    return row ?? null;
  }

  /**
   * List all org units for an organization, ordered by depth then name.
   * Depth is derived from the closure table (self-referencing row has depth 0;
   * the depth from root is the max depth where the node is the descendant).
   */
  async listByOrg(
    orgId: string,
    includeArchived: boolean,
    tx?: DbExecutor,
  ): Promise<(OrgUnitRow & { depth: number })[]> {
    const depthSq = this.exec(tx)
      .select({
        descendantId: orgUnitClosure.descendantId,
        depth: sql<number>`max(${orgUnitClosure.depth})`.as('depth'),
      })
      .from(orgUnitClosure)
      .groupBy(orgUnitClosure.descendantId)
      .as('depth_sq');

    const conditions = [eq(orgUnits.orgId, orgId)];
    if (!includeArchived) {
      conditions.push(isNull(orgUnits.archivedAt));
    }

    const rows = await this.exec(tx)
      .select({
        id: orgUnits.id,
        orgId: orgUnits.orgId,
        parentId: orgUnits.parentId,
        kind: orgUnits.kind,
        name: orgUnits.name,
        costCenterCode: orgUnits.costCenterCode,
        archivedAt: orgUnits.archivedAt,
        createdAt: orgUnits.createdAt,
        depth: depthSq.depth,
      })
      .from(orgUnits)
      .innerJoin(depthSq, eq(orgUnits.id, depthSq.descendantId))
      .where(and(...conditions))
      .orderBy(asc(depthSq.depth), asc(orgUnits.name));

    return rows as (OrgUnitRow & { depth: number })[];
  }

  /** Insert a new org unit. */
  async create(values: NewOrgUnit, tx?: DbExecutor): Promise<OrgUnitRow> {
    const [row] = await this.exec(tx)
      .insert(orgUnits)
      .values(values)
      .returning();
    return row!;
  }

  /** Update an org unit's mutable fields. */
  async update(
    unitId: string,
    orgId: string,
    values: Partial<Pick<NewOrgUnit, 'name' | 'costCenterCode' | 'parentId'>>,
    tx?: DbExecutor,
  ): Promise<OrgUnitRow | null> {
    const [row] = await this.exec(tx)
      .update(orgUnits)
      .set(values)
      .where(and(eq(orgUnits.id, unitId), eq(orgUnits.orgId, orgId)))
      .returning();
    return row ?? null;
  }

  // ── Closure operations ──────────────────────────────────────────────────

  /** Fetch all closure rows for an organization (via orgUnits join). */
  async closureRowsByOrg(
    orgId: string,
    tx?: DbExecutor,
  ): Promise<ClosureRow[]> {
    return this.exec(tx)
      .select({
        ancestorId: orgUnitClosure.ancestorId,
        descendantId: orgUnitClosure.descendantId,
        depth: orgUnitClosure.depth,
      })
      .from(orgUnitClosure)
      .innerJoin(orgUnits, eq(orgUnitClosure.ancestorId, orgUnits.id))
      .where(eq(orgUnits.orgId, orgId));
  }

  /** Insert closure rows (batch). */
  async insertClosureRows(
    rows: Array<{ ancestorId: string; descendantId: string; depth: number }>,
    tx?: DbExecutor,
  ): Promise<void> {
    if (rows.length === 0) return;
    await this.exec(tx).insert(orgUnitClosure).values(rows);
  }

  /** Delete closure rows where descendant is in `subtreeIds` and ancestor is NOT in `subtreeIds`. */
  async deleteExternalClosureRows(
    subtreeNodeIds: string[],
    tx?: DbExecutor,
  ): Promise<void> {
    if (subtreeNodeIds.length === 0) return;
    await this.exec(tx)
      .delete(orgUnitClosure)
      .where(
        and(
          inArray(orgUnitClosure.descendantId, subtreeNodeIds),
          sql`${orgUnitClosure.ancestorId} NOT IN (${sql.join(
            subtreeNodeIds.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        ),
      );
  }
}
