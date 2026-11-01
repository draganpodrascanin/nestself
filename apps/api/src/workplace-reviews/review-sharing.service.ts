/**
 * ReviewSharingService: the employer's sharing decision and the reviewer's
 * aggregate pack (spec REV-04; ADR 0002). The pack is built from the
 * persisted protected cells through the same disclosure mapper as the
 * employer's heatmap, for the granted snapshots and cohorts only, and needs
 * both the reviewer's assignment and an active grant. Revocation stops new
 * access and claims nothing about copies already made.
 */
import { Injectable } from '@nestjs/common';
import type { Principal, ReviewEngagementResponse, ReviewPackResponse, ReviewSharingGrantRequest } from '@nestself/contracts';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { AuditWriter } from '../audit/audit-writer.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { DbService } from '../db/db.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ListeningRepository } from '../listening/listening.repository.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ReportsService } from '../listening/reports.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ReviewEngagementsService } from './review-engagements.service.js';
import { conflict, notFound } from './review-errors.js';
import { grantActive, toSharingGrantView } from './review-views.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { WorkplaceReviewsRepository } from './workplace-reviews.repository.js';

@Injectable()
export class ReviewSharingService {
  constructor(
    private readonly dbs: DbService,
    private readonly repo: WorkplaceReviewsRepository,
    private readonly listening: ListeningRepository,
    private readonly reports: ReportsService,
    private readonly engagements: ReviewEngagementsService,
    private readonly audit: AuditWriter,
  ) {}

  async grant(orgId: string, engagementId: string, body: ReviewSharingGrantRequest, principal: Principal, now = new Date()): Promise<ReviewEngagementResponse> {
    const engagement = await this.engagements.inOrg(orgId, engagementId);
    if (engagement.status === 'canceled' || engagement.status === 'completed') throw conflict('invalid_state', 'The engagement is closed');
    await this.dbs.withOrgScope(orgId, async (tx) => {
      for (const snapshotId of body.snapshotIds) {
        const snapshot = await this.listening.findSnapshot(snapshotId, tx);
        if (!snapshot || snapshot.orgId !== orgId) throw conflict('snapshot_not_found', 'A referenced result does not belong to this organization', { snapshotId });
      }
      const grant = await this.repo.insertSharingGrant(
        {
          orgId,
          engagementId,
          snapshotIds: [...body.snapshotIds],
          cohortKeys: [...body.cohortKeys],
          grantedByUserId: principal.userId,
          validUntil: body.validUntil ? new Date(body.validUntil) : null,
        },
        tx,
      );
      await this.audit.record(
        {
          action: 'workplace_review.sharing_granted',
          actorUserId: principal.userId,
          actorKind: 'USER',
          orgId,
          recordType: 'review_sharing_grant',
          recordId: grant.id,
          result: 'ALLOWED',
          details: { engagementId, snapshotIds: body.snapshotIds, cohortKeys: body.cohortKeys, validUntil: body.validUntil ?? null },
        },
        { tx },
      );
    });
    return this.engagements.response(engagement, now);
  }

  async revoke(orgId: string, engagementId: string, grantId: string, principal: Principal, now = new Date()): Promise<ReviewEngagementResponse> {
    const engagement = await this.engagements.inOrg(orgId, engagementId);
    await this.dbs.withOrgScope(orgId, async (tx) => {
      const grant = await this.repo.findSharingGrant(grantId, tx);
      if (!grant || grant.engagementId !== engagementId) throw notFound();
      if (grant.revokedAt) return;
      await this.repo.revokeSharingGrant(grantId, principal.userId, now, tx);
      await this.audit.record(
        {
          action: 'workplace_review.sharing_revoked',
          actorUserId: principal.userId,
          actorKind: 'USER',
          orgId,
          recordType: 'review_sharing_grant',
          recordId: grantId,
          result: 'ALLOWED',
          details: { engagementId },
        },
        { tx },
      );
    });
    return this.engagements.response(engagement, now);
  }

  /** The reviewer's pack: the granted snapshots as the employer's heatmap shows them, suppression included. */
  async pack(principal: Principal, engagementId: string, now = new Date()): Promise<ReviewPackResponse> {
    const engagement = await this.engagements.forReviewer(principal, engagementId);
    const pack = await this.dbs.withOrgScope(engagement.orgId, async (tx) => {
      const grants = (await this.repo.listSharingGrants(engagementId, tx)).filter((g) => grantActive(g, now));
      if (grants.length === 0) throw conflict('sharing_revoked', 'The organization has not shared results with this engagement, or withdrew the sharing');
      const snapshotIds = [...new Set(grants.flatMap((g) => g.snapshotIds))];
      const cohortKeys = new Set(grants.flatMap((g) => g.cohortKeys));
      const units = await this.listening.findUnits(engagement.orgId, tx);
      const snapshots: ReviewPackResponse['snapshots'] = [];
      for (const snapshotId of snapshotIds) {
        const snapshot = await this.listening.findSnapshot(snapshotId, tx);
        if (!snapshot || snapshot.orgId !== engagement.orgId) continue;
        const [cells, cycle] = await Promise.all([this.listening.findCells(snapshotId, tx), this.listening.findCycle(snapshot.cycleId, tx)]);
        if (!cycle) continue;
        const questionnaire = await this.listening.findQuestionnaire(cycle.questionnaireVersionId, tx);
        snapshots.push({
          snapshotId,
          cycleOpensAt: cycle.opensAt.toISOString(),
          cycleClosesAt: cycle.closesAt.toISOString(),
          questionnaireVersion: questionnaire?.version ?? 0,
          rows: this.reports.heatmapRows(cells, units).filter((r) => cohortKeys.has(r.cohortKey)),
        });
      }
      return { engagementId, grants: grants.map((g) => toSharingGrantView(g, now)), snapshots };
    });
    await this.audit.record({
      action: 'workplace_review.pack_read',
      actorUserId: principal.userId,
      actorKind: 'USER',
      orgId: engagement.orgId,
      recordType: 'review_engagement',
      recordId: engagementId,
      result: 'ALLOWED',
      details: { snapshotIds: pack.snapshots.map((s) => s.snapshotId) },
    });
    return pack;
  }
}
