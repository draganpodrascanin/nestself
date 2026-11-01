/**
 * ImprovementActionsService: human-authored actions from the report (spec
 * REV-08). The reviewer proposes; an employer with
 * `workplace_reviews.actions.manage` agrees, owns, completes or decides not
 * to proceed, or enters an action directly. Completion is recorded by a
 * person and changes nothing in the measurement.
 */
import { Injectable } from '@nestjs/common';
import {
  ACTIONS,
  ACTIVE_REVIEW_ENGAGEMENT_STATUSES,
  canTransitionAction,
  type ImprovementActionCreateRequest,
  type ImprovementActionUpdateRequest,
  type ImprovementActionsResponse,
  type Principal,
} from '@nestself/contracts';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { AuditWriter } from '../audit/audit-writer.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { DbService } from '../db/db.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ReviewEngagementsService } from './review-engagements.service.js';
import { conflict, notFound } from './review-errors.js';
import { toActionView } from './review-views.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { WorkplaceReviewsRepository, type ActionRow, type EngagementRow } from './workplace-reviews.repository.js';

@Injectable()
export class ImprovementActionsService {
  constructor(
    private readonly dbs: DbService,
    private readonly repo: WorkplaceReviewsRepository,
    private readonly engagements: ReviewEngagementsService,
    private readonly audit: AuditWriter,
  ) {}

  private async views(engagement: EngagementRow): Promise<ImprovementActionsResponse> {
    return this.dbs.withOrgScope(engagement.orgId, async (tx) => {
      const rows = await this.repo.listActions(engagement.id, tx);
      const names = await this.repo.displayNames(
        rows.map((a) => a.ownerUserId),
        tx,
      );
      return { items: rows.map((a) => toActionView(a, names, engagement.reviewerUserId)) };
    });
  }

  async list(orgId: string, engagementId: string): Promise<ImprovementActionsResponse> {
    return this.views(await this.engagements.inOrg(orgId, engagementId));
  }

  async listForReviewer(principal: Principal, engagementId: string): Promise<ImprovementActionsResponse> {
    return this.views(await this.engagements.forReviewer(principal, engagementId));
  }

  /** An employer's own entry starts agreed: a human chose it (spec REV-08). */
  async createByEmployer(orgId: string, engagementId: string, body: ImprovementActionCreateRequest, principal: Principal, now = new Date()): Promise<ImprovementActionsResponse> {
    const engagement = await this.engagements.inOrg(orgId, engagementId);
    await this.insert(engagement, body, principal, 'agreed', now);
    return this.views(engagement);
  }

  /** The reviewer's proposal from the report starts proposed. */
  async proposeByReviewer(principal: Principal, engagementId: string, body: ImprovementActionCreateRequest, now = new Date()): Promise<ImprovementActionsResponse> {
    const engagement = await this.engagements.forReviewer(principal, engagementId, ACTIONS['workplace_reviews.report.write']);
    await this.insert(engagement, body, principal, 'proposed', now);
    return this.views(engagement);
  }

  private async insert(engagement: EngagementRow, body: ImprovementActionCreateRequest, principal: Principal, status: 'proposed' | 'agreed', now: Date): Promise<ActionRow> {
    if (!ACTIVE_REVIEW_ENGAGEMENT_STATUSES.includes(engagement.status)) throw conflict('invalid_state', 'The engagement is closed');
    return this.dbs.withOrgScope(engagement.orgId, async (tx) => {
      if (body.reportVersionId) {
        const version = await this.repo.findReportVersion(body.reportVersionId, tx);
        if (!version || version.engagementId !== engagement.id) throw notFound();
      }
      const row = await this.repo.insertAction(
        {
          orgId: engagement.orgId,
          engagementId: engagement.id,
          reportVersionId: body.reportVersionId ?? null,
          dimensionKey: body.dimensionKey ?? null,
          title: body.title,
          description: body.description,
          ownerUserId: body.ownerUserId ?? null,
          dueDate: body.dueDate ? new Date(body.dueDate) : null,
          intendedCheck: body.intendedCheck,
          status,
          proposedByUserId: principal.userId,
          agreedByUserId: status === 'agreed' ? principal.userId : null,
          agreedAt: status === 'agreed' ? now : null,
        },
        tx,
      );
      await this.audit.record(
        {
          action: 'workplace_review.action_created',
          actorUserId: principal.userId,
          actorKind: 'USER',
          orgId: engagement.orgId,
          recordType: 'improvement_action',
          recordId: row.id,
          result: 'ALLOWED',
          details: { engagementId: engagement.id, status, dimensionKey: body.dimensionKey ?? null, hasOwner: body.ownerUserId !== undefined },
        },
        { tx },
      );
      return row;
    });
  }

  async update(orgId: string, engagementId: string, actionId: string, body: ImprovementActionUpdateRequest, principal: Principal, now = new Date()): Promise<ImprovementActionsResponse> {
    const engagement = await this.engagements.inOrg(orgId, engagementId);
    await this.dbs.withOrgScope(orgId, async (tx) => {
      const locked = await this.repo.lockAction(actionId, tx);
      if (!locked || locked.engagementId !== engagementId) throw notFound();
      const patch: Partial<ActionRow> = {};
      if (body.ownerUserId !== undefined) patch.ownerUserId = body.ownerUserId;
      if (body.dueDate !== undefined) patch.dueDate = body.dueDate ? new Date(body.dueDate) : null;
      if (body.status !== undefined && body.status !== locked.status) {
        if (!canTransitionAction(locked.status, body.status)) throw conflict('invalid_state', `An action cannot move from ${locked.status} to ${body.status}`, { from: locked.status, to: body.status });
        patch.status = body.status;
        if (body.status === 'agreed') {
          patch.agreedByUserId = principal.userId;
          patch.agreedAt = now;
        }
        if (body.status === 'completed') {
          patch.completedByUserId = principal.userId;
          patch.completedAt = now;
        }
        if (body.status === 'not_proceeding') patch.notProceedingReason = body.notProceedingReason ?? null;
      } else if (body.notProceedingReason !== undefined && locked.status === 'not_proceeding') {
        patch.notProceedingReason = body.notProceedingReason;
      }
      const next = await this.repo.updateAction(actionId, patch, tx);
      await this.audit.record(
        {
          action: 'workplace_review.action_updated',
          actorUserId: principal.userId,
          actorKind: 'USER',
          orgId,
          recordType: 'improvement_action',
          recordId: actionId,
          result: 'ALLOWED',
          details: { engagementId, fromStatus: locked.status, toStatus: next.status, fields: Object.keys(patch) },
        },
        { tx },
      );
    });
    return this.views(engagement);
  }
}
