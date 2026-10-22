/**
 * OrgUnitsService — org-unit tree administration (5.3).
 *
 * Handles create, update (rename/cost-center), list, and move operations
 * on the hierarchical org-unit tree. Move uses the classic closure-table
 * algorithm (Appendix A.3.2).
 *
 * CATALOGUE GAP: There is no `org_unit.created`, `org_unit.updated` or
 */
import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import type {
  OrgUnitCreateRequest,
  OrgUnitMoveRequest,
  OrgUnitResponse,
  OrgUnitUpdateRequest,
} from '@nestself/contracts';
import { ApiHttpException } from '../common/api-error.js';
import { DbService } from '../db/db.service.js';
import { OrgUnitsRepository } from '../db/repositories/org-units.repository.js';
import { CacheGateway } from '../principal/cache-gateway.js';
import { AuditWriter } from '../audit/audit-writer.js';
import {
  KEY_VALUE_STORE,
  type KeyValueStore,
} from '../redis/key-value-store.js';
import { orgTreeKey, INVALIDATE_CHANNEL } from '../redis/redis-keys.js';
import {
  closureRowsForCreate,
  closureRowsToDelete,
  closureRowsToInsert,
  subtreeIds,
} from './closure-moves.js';

@Injectable()
export class OrgUnitsService {
  private readonly logger = new Logger(OrgUnitsService.name);

  constructor(
    @Inject(forwardRef(() => DbService)) private readonly dbService: DbService,
    @Inject(forwardRef(() => OrgUnitsRepository)) private readonly repo: OrgUnitsRepository,
    @Inject(forwardRef(() => CacheGateway)) private readonly cache: CacheGateway,
    @Inject(KEY_VALUE_STORE) private readonly store: KeyValueStore,
    @Inject(forwardRef(() => AuditWriter)) private readonly audit: AuditWriter,
  ) {}

  // ── List ─────────────────────────────────────────────────────────────────

  async listUnits(
    orgId: string,
    includeArchived: boolean,
  ): Promise<{ items: OrgUnitResponse[] }> {
    const rows = await this.dbService.withOrgScope(orgId, (tx) =>
      this.repo.listByOrg(orgId, includeArchived, tx),
    );
    return {
      items: rows.map((r) => toResponse(r)),
    };
  }

  // ── Create ───────────────────────────────────────────────────────────────

  async createUnit(
    orgId: string,
    body: OrgUnitCreateRequest,
    actorUserId: string | null = null,
  ): Promise<OrgUnitResponse> {
    if (body.kind === 'COMPANY') {
      throw new ApiHttpException({
        status: 400,
        code: 'invalid_kind',
        message: 'COMPANY units cannot be created through the API',
      });
    }

    const result = await this.dbService.withOrgScope(orgId, async (tx) => {
      // Verify parent belongs to the org and is not archived.
      const parent = await this.repo.findByIdAndOrg(body.parentId, orgId, tx);
      if (!parent) {
        throw new ApiHttpException({
          status: 404,
          code: 'not_found',
          message: 'Parent unit not found in this organization',
        });
      }
      if (parent.archivedAt) {
        throw new ApiHttpException({
          status: 404,
          code: 'not_found',
          message: 'Parent unit is archived',
        });
      }

      // Insert the unit.
      const unit = await this.repo.create(
        {
          orgId,
          parentId: body.parentId,
          kind: body.kind,
          name: body.name,
          costCenterCode: body.costCenterCode ?? null,
        },
        tx,
      );

      // Build closure rows for the new node.
      const existingClosure = await this.repo.closureRowsByOrg(orgId, tx);
      const newRows = closureRowsForCreate(existingClosure, unit.id, body.parentId);
      await this.repo.insertClosureRows(newRows, tx);

      return unit;
    });

    await this.recordAudit('org_unit.created', orgId, result.id, actorUserId, {
      parentId: body.parentId,
      kind: body.kind,
    });
    await this.invalidateOrgTree(orgId);

    return toResponse(result);
  }

  // ── Update (rename / cost center) ────────────────────────────────────────

  async updateUnit(
    orgId: string,
    unitId: string,
    body: OrgUnitUpdateRequest,
    actorUserId: string | null = null,
  ): Promise<OrgUnitResponse> {
    const updated = await this.dbService.withOrgScope(orgId, async (tx) => {
      const existing = await this.repo.findByIdAndOrg(unitId, orgId, tx);
      if (!existing) {
        throw new ApiHttpException({
          status: 404,
          code: 'not_found',
          message: 'Unit not found in this organization',
        });
      }

      const values: Record<string, unknown> = {};
      if (body.name !== undefined) values.name = body.name;
      if (body.costCenterCode !== undefined) values.costCenterCode = body.costCenterCode;

      if (Object.keys(values).length === 0) return existing;

      const row = await this.repo.update(unitId, orgId, values as never, tx);
      return row ?? existing;
    });

    await this.recordAudit('org_unit.updated', orgId, unitId, actorUserId, {
      fields: Object.keys(body),
    });

    return toResponse(updated);
  }

  // ── Move (reparent) ──────────────────────────────────────────────────────

  async moveUnit(
    orgId: string,
    unitId: string,
    body: OrgUnitMoveRequest,
    actorUserId: string | null = null,
  ): Promise<OrgUnitResponse> {
    const result = await this.dbService.withOrgScope(orgId, async (tx) => {
      const unit = await this.repo.findByIdAndOrg(unitId, orgId, tx);
      if (!unit) {
        throw new ApiHttpException({
          status: 404,
          code: 'not_found',
          message: 'Unit not found in this organization',
        });
      }

      // Roots cannot move.
      if (unit.parentId === null) {
        throw new ApiHttpException({
          status: 400,
          code: 'root_immovable',
          message: 'A root unit cannot be moved',
        });
      }

      // New parent must be in the org and not archived.
      const newParent = await this.repo.findByIdAndOrg(body.parentId, orgId, tx);
      if (!newParent) {
        throw new ApiHttpException({
          status: 404,
          code: 'not_found',
          message: 'New parent not found in this organization',
        });
      }

      // Cycle check: newParent must not be a descendant of unitId (or unitId itself).
      const closureRows = await this.repo.closureRowsByOrg(orgId, tx);
      const subtree = subtreeIds(closureRows, unitId);
      if (subtree.has(body.parentId)) {
        throw new ApiHttpException({
          status: 400,
          code: 'cycle',
          message: 'Cannot move a unit under itself or one of its descendants',
        });
      }

      // No-op if already the parent.
      if (unit.parentId === body.parentId) {
        return unit;
      }

      // Step 1: Delete closure rows linking ancestors-outside-the-subtree
      //         to nodes-inside-the-subtree.
      const toDelete = closureRowsToDelete(closureRows, unitId);
      if (toDelete.length > 0) {
        const subtreeNodeIds = [...subtree];
        await this.repo.deleteExternalClosureRows(subtreeNodeIds, tx);
      }

      // Step 2: Insert new closure rows from newParent's ancestors to
      //         every subtree node.
      const toInsert = closureRowsToInsert(closureRows, unitId, body.parentId);
      await this.repo.insertClosureRows(toInsert, tx);

      // Step 3: Update parent_id.
      const updated = await this.repo.update(
        unitId,
        orgId,
        { parentId: body.parentId },
        tx,
      );

      return updated ?? unit;
    });

    await this.recordAudit('org_unit.moved', orgId, unitId, actorUserId, {
      newParentId: body.parentId,
    });
    await this.invalidateOrgTree(orgId);

    return toResponse(result);
  }

  private async recordAudit(
    action: 'org_unit.created' | 'org_unit.updated' | 'org_unit.moved',
    orgId: string,
    unitId: string,
    actorUserId: string | null,
    details: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.record({
      action,
      actorUserId,
      actorKind: 'USER',
      orgId,
      recordType: 'org_unit',
      recordId: unitId,
      result: 'ALLOWED',
      details,
    });
  }

  // ── Cache invalidation ──────────────────────────────────────────────────

  private async invalidateOrgTree(orgId: string): Promise<void> {
    const key = orgTreeKey(orgId);
    await this.cache.del(key);
    try {
      await this.store.publish(
        INVALIDATE_CHANNEL,
        JSON.stringify({ keys: [key], reason: 'org_tree' }),
      );
    } catch {
      this.logger.warn(`Failed to publish org_tree invalidation for ${orgId}`);
    }
  }
}

// ── Mapper ─────────────────────────────────────────────────────────────────

function toResponse(row: {
  id: string;
  orgId: string;
  parentId: string | null;
  kind: string;
  name: string;
  costCenterCode: string | null;
  archivedAt: Date | null;
}): OrgUnitResponse {
  return {
    id: row.id,
    orgId: row.orgId,
    parentId: row.parentId,
    kind: row.kind as OrgUnitResponse['kind'],
    name: row.name,
    costCenterCode: row.costCenterCode,
    archivedAt: row.archivedAt?.toISOString() ?? null,
  };
}
