/**
 * MembersAdminService — member listing and update (5.3).
 *
 * GET  /orgs/:orgId/members           — list with filters/pagination
 * PATCH /orgs/:orgId/members/:id      — update orgUnitId/costCenter/lineManager
 *
 * CATALOGUE GAP: There is no `membership.moved` or `membership.updated`
 */
import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import type {
  MemberListQuery,
  MemberListResponse,
  MemberUpdateRequest,
  MemberItem,
} from '@nestself/contracts';
import { ApiHttpException } from '../common/api-error.js';
import { DbService } from '../db/db.service.js';
import { MembershipsRepository } from '../db/repositories/memberships.repository.js';
import { OrgUnitsRepository } from '../db/repositories/org-units.repository.js';
import { CacheGateway } from '../principal/cache-gateway.js';
import { AuditWriter } from '../audit/audit-writer.js';
import {
  KEY_VALUE_STORE,
  type KeyValueStore,
} from '../redis/key-value-store.js';
import {
  principalKey,
  grantsKey,
  INVALIDATE_CHANNEL,
} from '../redis/redis-keys.js';

@Injectable()
export class MembersAdminService {
  private readonly logger = new Logger(MembersAdminService.name);

  constructor(
    @Inject(forwardRef(() => DbService)) private readonly dbService: DbService,
    @Inject(forwardRef(() => MembershipsRepository)) private readonly memberships: MembershipsRepository,
    @Inject(forwardRef(() => OrgUnitsRepository)) private readonly orgUnits: OrgUnitsRepository,
    @Inject(forwardRef(() => CacheGateway)) private readonly cache: CacheGateway,
    @Inject(KEY_VALUE_STORE) private readonly store: KeyValueStore,
    @Inject(forwardRef(() => AuditWriter)) private readonly audit: AuditWriter,
  ) {}

  // ── List ─────────────────────────────────────────────────────────────────

  async listMembers(
    orgId: string,
    query: MemberListQuery,
  ): Promise<MemberListResponse> {
    const rows = await this.dbService.withOrgScope(orgId, (tx) =>
      this.memberships.listMembers(
        {
          orgId,
          limit: query.limit,
          cursor: query.cursor,
          orgUnitId: query.orgUnitId,
          status: query.status,
          search: query.search,
        },
        tx,
      ),
    );

    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1]!.membershipId : null;

    return {
      items: items.map((r) => toMemberItem(r)),
      nextCursor,
    };
  }

  // ── Patch ────────────────────────────────────────────────────────────────

  async updateMember(
    orgId: string,
    membershipId: string,
    body: MemberUpdateRequest,
    actorUserId: string | null = null,
  ): Promise<MemberItem> {
    const result = await this.dbService.withOrgScope(orgId, async (tx) => {
      const membership = await this.memberships.findByIdAndOrg(
        membershipId,
        orgId,
        tx,
      );
      if (!membership) {
        throw new ApiHttpException({
          status: 404,
          code: 'not_found',
          message: 'Membership not found in this organization',
        });
      }

      const updates: Record<string, unknown> = {};

      // Validate orgUnitId.
      if (body.orgUnitId !== undefined) {
        const unit = await this.orgUnits.findByIdAndOrg(
          body.orgUnitId,
          orgId,
          tx,
        );
        if (!unit) {
          throw new ApiHttpException({
            status: 404,
            code: 'not_found',
            message: 'Org unit not found in this organization',
          });
        }
        updates.orgUnitId = body.orgUnitId;
      }

      // Validate costCenterUnitId.
      if (body.costCenterUnitId !== undefined) {
        if (body.costCenterUnitId !== null) {
          const unit = await this.orgUnits.findByIdAndOrg(
            body.costCenterUnitId,
            orgId,
            tx,
          );
          if (!unit) {
            throw new ApiHttpException({
              status: 404,
              code: 'not_found',
              message: 'Cost center unit not found in this organization',
            });
          }
        }
        updates.costCenterUnitId = body.costCenterUnitId;
      }

      // Validate lineManagerUserId.
      if (body.lineManagerUserId !== undefined) {
        if (body.lineManagerUserId !== null) {
          const active = await this.memberships.findActiveByUserAndOrg(
            body.lineManagerUserId,
            orgId,
            tx,
          );
          if (!active) {
            throw new ApiHttpException({
              status: 404,
              code: 'not_found',
              message: 'Line manager has no active membership in this organization',
            });
          }
        }
        updates.lineManagerUserId = body.lineManagerUserId;
      }

      if (Object.keys(updates).length === 0) return membership;

      const updated = await this.memberships.updateMembership(
        membershipId,
        orgId,
        updates as never,
        tx,
      );
      return updated ?? membership;
    });

    // 3.7 row 5: an org-unit change is a team move; other fields are an update.
    await this.audit.record({
      action: body.orgUnitId !== undefined ? 'membership.moved' : 'membership.updated',
      actorUserId,
      actorKind: 'USER',
      orgId,
      recordType: 'membership',
      recordId: membershipId,
      result: 'ALLOWED',
      details: { fields: Object.keys(body), orgUnitId: body.orgUnitId ?? null },
    });

    // Invalidate the member's principal cache.
    await this.invalidateMemberCache(result.userId, orgId);

    return toMemberItem({
      membershipId: result.id,
      userId: result.userId,
      displayName: '', // not available from this code path
      email: '', // not available from this code path
      orgUnitId: result.orgUnitId,
      costCenterUnitId: result.costCenterUnitId,
      lineManagerUserId: result.lineManagerUserId,
      status: result.status as 'INVITED' | 'ACTIVE' | 'ENDED',
      startDate: result.startDate,
      endDate: result.endDate,
    });
  }

  // ── Cache invalidation ──────────────────────────────────────────────────

  private async invalidateMemberCache(
    userId: string,
    orgId: string,
  ): Promise<void> {
    const keys = [principalKey(userId), grantsKey(userId, orgId)];
    await this.cache.del(...keys);
    try {
      await this.store.publish(
        INVALIDATE_CHANNEL,
        JSON.stringify({ keys, reason: 'membership_update' }),
      );
    } catch {
      this.logger.warn(`Failed to publish invalidation for user ${userId}`);
    }
  }
}

// ── Mapper ─────────────────────────────────────────────────────────────────

function toMemberItem(row: {
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
}): MemberItem {
  return {
    membershipId: row.membershipId,
    userId: row.userId,
    displayName: row.displayName,
    email: row.email,
    orgUnitId: row.orgUnitId,
    costCenterUnitId: row.costCenterUnitId,
    lineManagerUserId: row.lineManagerUserId,
    status: row.status,
    startDate: row.startDate.toISOString(),
    endDate: row.endDate?.toISOString() ?? null,
  };
}
