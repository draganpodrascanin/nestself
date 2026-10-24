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
import { DbService } from '../db/db.service.js';
import { MembershipsRepository } from '../db/repositories/memberships.repository.js';
import { AuthorizationRepository } from '../db/repositories/authorization.repository.js';
import { AuditWriter, type AuditEventInput } from '../audit/audit-writer.js';
import { AccessRevocationService } from '../auth/access-revocation.service.js';

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
        // Revoke the direct grants and every delegation descending from them.
        const { roots, children } = await this.authzRepo.revokeGrantTree(
          directGrants.map((g) => g.id),
          { at: now, byUserId: actorUserId, reason: 'membership_ended' },
          tx,
        );
        allRevokedIds.push(...roots, ...children);

        const delegated = new Set(directGrants.filter((g) => g.parentGrantId).map((g) => g.id));
        for (const id of roots) {
          auditEvents.push(
            this.grantRevokedEvent(id, delegated.has(id), actorUserId, orgId, membershipId),
          );
        }
        for (const id of children) {
          auditEvents.push(this.grantRevokedEvent(id, true, actorUserId, orgId, membershipId));
        }
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

  /** Audit event for one grant revoked because its subject's membership ended. */
  private grantRevokedEvent(
    grantId: string,
    isDelegation: boolean,
    actorUserId: string,
    orgId: string,
    membershipId: string,
  ): AuditEventInput {
    return {
      action: isDelegation ? 'grant.delegation_revoked' : 'grant.revoked',
      actorUserId,
      actorKind: 'USER',
      orgId,
      recordType: 'grant',
      recordId: grantId,
      result: 'ALLOWED',
      details: { reason: 'membership_ended', membershipId },
    };
  }
}
