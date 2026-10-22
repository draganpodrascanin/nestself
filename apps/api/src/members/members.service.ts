/**
 * MembersService — membership deactivation logic (T-1.16, SESS-R-22).
 *
 * Orchestrates the membership end in a single org-scoped transaction:
 * (a) load membership, (b) set ENDED + revoke grants cascade, (c) audit,
 * (d) access revocation. Steps (b)–(d) are measured for DR-15 (< 1 s).
 */
import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import type { MemberEndRequest, MemberEndResponse } from '@nestself/contracts';
import { ApiHttpException } from '../common/api-error.js';
import { DbService, type Transaction } from '../db/db.service.js';
import { MembershipsRepository } from '../db/repositories/memberships.repository.js';
import { AuthorizationRepository } from '../db/repositories/authorization.repository.js';
import { AuditWriter, type AuditEventInput } from '../audit/audit-writer.js';
import { AccessRevocationService } from '../auth/access-revocation.service.js';

/** Maximum depth of parent → child grant cascade (SESS-R-22). */
const MAX_CASCADE_DEPTH = 3;

@Injectable()
export class MembersService {
  private readonly logger = new Logger(MembersService.name);

  constructor(
    @Inject(forwardRef(() => DbService)) private readonly dbService: DbService,
    @Inject(forwardRef(() => MembershipsRepository)) private readonly memberships: MembershipsRepository,
    @Inject(forwardRef(() => AuthorizationRepository)) private readonly authzRepo: AuthorizationRepository,
    @Inject(forwardRef(() => AuditWriter)) private readonly audit: AuditWriter,
    @Inject(forwardRef(() => AccessRevocationService)) private readonly revocation: AccessRevocationService,
  ) {}

  /**
   * End a membership and cascade-revoke all org-scoped grants (SESS-R-22).
   * Idempotent: re-ending an already-ended membership returns the existing result.
   */
  async endMembership(
    orgId: string,
    membershipId: string,
    body: MemberEndRequest,
    actorUserId: string,
  ): Promise<MemberEndResponse> {
    const start = performance.now();

    // (a) Load the membership inside an org-scoped transaction.
    const result = await this.dbService.withOrgScope(orgId, async (tx) => {
      const membership = await this.memberships.findByIdAndOrg(membershipId, orgId, tx);

      if (!membership) {
        throw new ApiHttpException({
          status: 404,
          code: 'not_found',
          message: 'Membership not found',
        });
      }

      // Idempotent: already ended → return the existing result.
      if (membership.status === 'ENDED') {
        return {
          membershipId: membership.id,
          status: 'ENDED' as const,
          endDate: membership.endDate!.toISOString(),
          endedReason: membership.endedReason as MemberEndResponse['endedReason'],
          revokedGrantIds: [] as string[],
          userId: membership.userId,
          alreadyEnded: true,
        };
      }

      const now = new Date();

      // (b) Set status ENDED.
      await this.memberships.endMembership(membershipId, now, body.reason, tx);

      // Revoke every unrevoked grant of that user scoped to this org.
      const directGrants = await this.authzRepo.findActiveGrantsScopedToOrg(
        membership.userId,
        orgId,
        tx,
      );

      const allRevokedIds: string[] = [];
      const auditEvents: AuditEventInput[] = [];

      if (directGrants.length > 0) {
        const directIds = directGrants.map((g) => g.id);
        await this.authzRepo.revokeGrants(directIds, {
          at: now,
          byUserId: actorUserId,
          reason: 'membership_ended',
        }, tx);
        allRevokedIds.push(...directIds);

        for (const g of directGrants) {
          auditEvents.push({
            action: g.parentGrantId ? 'grant.delegation_revoked' : 'grant.revoked',
            actorUserId,
            actorKind: 'USER',
            orgId,
            recordType: 'grant',
            recordId: g.id,
            result: 'ALLOWED',
            details: { reason: 'membership_ended', membershipId },
          });
        }

        // Cascade: revoke child grants (depth ≤ 3).
        await this.cascadeRevokeChildren(
          directIds,
          now,
          actorUserId,
          orgId,
          membershipId,
          allRevokedIds,
          auditEvents,
          tx,
        );
      }

      // (c) Audit: membership.ended first, then grant events.
      await this.audit.record({
        action: 'membership.ended',
        actorUserId,
        actorKind: 'USER',
        orgId,
        recordType: 'membership',
        recordId: membershipId,
        result: 'ALLOWED',
        details: {
          membershipId,
          reason: body.reason,
          revokedGrantIds: allRevokedIds,
        },
      });

      for (const evt of auditEvents) {
        await this.audit.record(evt);
      }

      return {
        membershipId: membership.id,
        status: 'ENDED' as const,
        endDate: now.toISOString(),
        endedReason: body.reason as MemberEndResponse['endedReason'],
        revokedGrantIds: allRevokedIds,
        userId: membership.userId,
        alreadyEnded: false,
      };
    });

    // (d) Access revocation (outside the transaction — SESS-R-23).
    if (!result.alreadyEnded) {
      await this.revocation.revokeAllAccess(result.userId, {
        sessionsForOrgId: orgId,
        orgIds: [orgId],
      });
    }

    const elapsed = performance.now() - start;
    this.logger.log(`endMembership completed in ${elapsed.toFixed(0)} ms`);

    return {
      membershipId: result.membershipId,
      status: result.status,
      endDate: result.endDate,
      endedReason: result.endedReason,
      revokedGrantIds: result.revokedGrantIds,
    };
  }

  /** Cascade-revoke child and grandchild grants up to MAX_CASCADE_DEPTH. */
  private async cascadeRevokeChildren(
    parentIds: string[],
    now: Date,
    actorUserId: string,
    orgId: string,
    membershipId: string,
    allRevokedIds: string[],
    auditEvents: AuditEventInput[],
    tx: Transaction,
  ): Promise<void> {
    let currentParentIds = parentIds;

    for (let depth = 1; depth <= MAX_CASCADE_DEPTH; depth++) {
      const children = await this.authzRepo.findActiveChildGrants(currentParentIds, tx);
      if (children.length === 0) break;

      const childIds = children.map((g) => g.id);
      await this.authzRepo.revokeGrants(childIds, {
        at: now,
        byUserId: actorUserId,
        reason: 'parent_revoked',
      }, tx);
      allRevokedIds.push(...childIds);

      for (const g of children) {
        auditEvents.push({
          action: 'grant.delegation_revoked',
          actorUserId,
          actorKind: 'USER',
          orgId,
          recordType: 'grant',
          recordId: g.id,
          result: 'ALLOWED',
          details: { reason: 'parent_revoked', membershipId, depth },
        });
      }

      currentParentIds = childIds;
    }
  }
}
