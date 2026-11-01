/**
 * ReviewRequestsService: the employer's request and the coordinator's triage
 * (spec REV-02, REV-03; ADR 0002). A request binds the published snapshots it
 * was raised from, the requested scope, the terms and notice versions and
 * the sharing decision; one active request per reporting scope. Submitting
 * creates no charge and no engagement.
 */
import { Injectable } from '@nestjs/common';
import {
  type Principal,
  type ReviewCancelRequest,
  type ReviewInformationRequest,
  type ReviewQueueResponse,
  type ReviewRequestCreateRequest,
  type ReviewRequestListResponse,
  type ReviewRequestOpsResponse,
  type ReviewRequestResponse,
  type ReviewServicesResponse,
  type ReviewTriageRequest,
} from '@nestself/contracts';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { AuditWriter } from '../audit/audit-writer.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { DbService, type DbExecutor } from '../db/db.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { AuthorizationRepository } from '../db/repositories/authorization.repository.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ListeningConfigurationService } from '../listening/listening-configuration.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ListeningRepository } from '../listening/listening.repository.js';
import { conflict, notFound, validationError } from './review-errors.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ReviewNotifier } from './review-notifier.js';
import { toQueueItem, toRequestOps, toRequestResponse, toServiceView } from './review-views.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { WorkplaceReviewsRepository, type RequestRow } from './workplace-reviews.repository.js';

const TRIAGEABLE = ['submitted', 'needs_information', 'in_review'] as const;
const CANCELABLE = ['submitted', 'needs_information', 'in_review', 'scoped'] as const;

function isUniqueViolation(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string } } | undefined)?.cause ?? (error as { code?: string } | undefined);
  return cause?.code === '23505';
}

@Injectable()
export class ReviewRequestsService {
  constructor(
    private readonly dbs: DbService,
    private readonly repo: WorkplaceReviewsRepository,
    private readonly listening: ListeningRepository,
    private readonly configuration: ListeningConfigurationService,
    private readonly authzRepo: AuthorizationRepository,
    private readonly audit: AuditWriter,
    private readonly notifier: ReviewNotifier,
  ) {}

  async services(orgId: string, now = new Date()): Promise<ReviewServicesResponse> {
    const [enabled, rows] = await Promise.all([this.configuration.isEnabled(orgId, 'workplaceReviews', now), this.repo.listServices()]);
    return { workplaceReviewsEnabled: enabled, items: rows.map(toServiceView) };
  }

  /** The platform catalogue for the coordinator's scope form (OPS-02); the entitlement is the client's, so it is not evaluated here. */
  async catalogue(): Promise<ReviewServicesResponse> {
    const rows = await this.repo.listServices();
    return { workplaceReviewsEnabled: true, items: rows.map(toServiceView) };
  }

  async create(orgId: string, body: ReviewRequestCreateRequest, principal: Principal, now = new Date()): Promise<ReviewRequestResponse> {
    if (!(await this.configuration.isEnabled(orgId, 'workplaceReviews', now))) {
      throw conflict('workplace_reviews_disabled', 'Workplace reviews are not enabled for this organization');
    }
    const row = await this.dbs.withOrgScope(orgId, async (tx) => {
      const existing = await this.repo.findActiveRequest(orgId, body.scopeCohortKey, tx);
      if (existing) throw conflict('active_request_exists', 'A request for this scope is already active', { requestId: existing.id });
      for (const snapshotId of body.snapshotIds) {
        const snapshot = await this.listening.findSnapshot(snapshotId, tx);
        if (!snapshot || snapshot.orgId !== orgId) throw conflict('snapshot_not_found', 'A referenced result does not belong to this organization', { snapshotId });
      }
      if (body.serviceId) {
        const service = await this.repo.findService(body.serviceId, tx);
        if (!service || !service.isActive) throw validationError('Unknown service', 'serviceId');
      }
      let created: RequestRow;
      try {
        created = await this.repo.insertRequest(
          {
            orgId,
            requesterUserId: principal.userId,
            snapshotIds: [...body.snapshotIds],
            scopeCohortKey: body.scopeCohortKey,
            dimensionKeys: [...body.dimensionKeys],
            serviceId: body.serviceId ?? null,
            context: body.context ?? null,
            shareAggregates: body.shareAggregates,
            termsVersion: body.termsVersion,
            noticeVersion: body.noticeVersion,
            status: 'submitted',
          },
          tx,
        );
      } catch (error) {
        // The partial unique index is the second line behind the check above (two requests racing).
        if (isUniqueViolation(error)) throw conflict('active_request_exists', 'A request for this scope is already active');
        throw error;
      }
      await this.audit.record(
        {
          action: 'workplace_review.requested',
          actorUserId: principal.userId,
          actorKind: 'USER',
          orgId,
          recordType: 'review_request',
          recordId: created.id,
          result: 'ALLOWED',
          details: {
            scopeCohortKey: body.scopeCohortKey,
            dimensionKeys: body.dimensionKeys,
            snapshotCount: body.snapshotIds.length,
            serviceId: body.serviceId ?? null,
            shareAggregates: body.shareAggregates,
            termsVersion: body.termsVersion,
          },
        },
        { tx },
      );
      return created;
    });
    return toRequestResponse(row, [], new Map());
  }

  async list(orgId: string): Promise<ReviewRequestListResponse> {
    return this.dbs.withOrgScope(orgId, async (tx) => {
      const rows = await this.repo.listRequests(orgId, tx);
      const scopes = await this.repo.listScopesOfRequests(
        rows.map((r) => r.id),
        tx,
      );
      const names = await this.repo.displayNames(
        rows.map((r) => r.coordinatorUserId),
        tx,
      );
      return { items: rows.map((r) => toRequestResponse(r, scopes.filter((s) => s.requestId === r.id), names)) };
    });
  }

  async get(orgId: string, id: string): Promise<ReviewRequestResponse> {
    return this.dbs.withOrgScope(orgId, async (tx) => {
      const row = await this.repo.findRequest(id, tx);
      if (!row || row.orgId !== orgId) throw notFound();
      const [scopes, names] = await Promise.all([this.repo.listScopes(id, tx), this.repo.displayNames([row.coordinatorUserId], tx)]);
      return toRequestResponse(row, scopes, names);
    });
  }

  async cancel(orgId: string, id: string, body: ReviewCancelRequest, actor: Principal): Promise<ReviewRequestResponse> {
    const row = await this.dbs.withOrgScope(orgId, async (tx) => {
      const locked = await this.repo.lockRequest(id, tx);
      if (!locked || locked.orgId !== orgId) throw notFound();
      if (!(CANCELABLE as readonly string[]).includes(locked.status)) throw conflict('invalid_state', 'Only an open request can be canceled');
      for (const scope of await this.repo.listScopes(id, tx)) {
        if (scope.status === 'sent') await this.repo.updateScope(scope.id, { status: 'superseded' }, tx);
      }
      const next = await this.repo.updateRequest(id, { status: 'canceled', declineReason: body.reason ?? null }, tx);
      await this.audit.record(
        {
          action: 'workplace_review.request_canceled',
          actorUserId: actor.userId,
          actorKind: 'USER',
          orgId,
          recordType: 'review_request',
          recordId: id,
          result: 'ALLOWED',
          details: { fromStatus: locked.status, hasReason: body.reason !== undefined },
        },
        { tx },
      );
      return next;
    });
    return this.get(orgId, row.id);
  }

  async answerInformation(orgId: string, id: string, body: ReviewInformationRequest, actor: Principal): Promise<ReviewRequestResponse> {
    await this.dbs.withOrgScope(orgId, async (tx) => {
      const locked = await this.repo.lockRequest(id, tx);
      if (!locked || locked.orgId !== orgId) throw notFound();
      if (locked.status !== 'needs_information') throw conflict('invalid_state', 'No information was requested');
      await this.repo.updateRequest(id, { status: 'in_review', informationAnswer: body.answer }, tx);
      await this.audit.record(
        {
          action: 'workplace_review.triaged',
          actorUserId: actor.userId,
          actorKind: 'USER',
          orgId,
          recordType: 'review_request',
          recordId: id,
          result: 'ALLOWED',
          details: { fromStatus: locked.status, toStatus: 'in_review', by: 'requester' },
        },
        { tx },
      );
    });
    return this.get(orgId, id);
  }

  // ── Coordinator ─────────────────────────────────────────────────────────

  async queue(now = new Date()): Promise<ReviewQueueResponse> {
    const rows = await this.repo.listQueue(now);
    const [names, orgNames] = await Promise.all([
      this.repo.displayNames(rows.flatMap((r) => [r.requesterUserId, r.coordinatorUserId])),
      this.authzRepo.findOrgNames([...new Set(rows.map((r) => r.orgId))]),
    ]);
    return { items: rows.map((r) => toQueueItem(r, names, orgNames.get(r.orgId) ?? r.orgId, now)) };
  }

  async getOps(id: string): Promise<ReviewRequestOpsResponse> {
    const row = await this.repo.findRequest(id);
    if (!row) throw notFound();
    const [scopes, names, orgNames] = await Promise.all([
      this.repo.listScopes(id),
      this.repo.displayNames([row.requesterUserId, row.coordinatorUserId]),
      this.authzRepo.findOrgNames([row.orgId]),
    ]);
    return toRequestOps(row, scopes, names, orgNames.get(row.orgId) ?? row.orgId);
  }

  async triage(id: string, body: ReviewTriageRequest, actor: Principal): Promise<ReviewRequestOpsResponse> {
    const row = await this.repo.findRequest(id);
    if (!row) throw notFound();
    const updated = await this.dbs.withOrgScope(row.orgId, async (tx) => {
      const locked = await this.repo.lockRequest(id, tx);
      if (!locked || !(TRIAGEABLE as readonly string[]).includes(locked.status)) throw conflict('invalid_state', 'The request cannot be triaged in its current state');
      const next = await this.repo.updateRequest(
        id,
        {
          status: body.status,
          coordinatorUserId: actor.userId,
          informationRequest: body.status === 'needs_information' ? body.informationRequest! : locked.informationRequest,
          declineReason: body.status === 'declined' ? body.declineReason! : locked.declineReason,
        },
        tx,
      );
      await this.audit.record(
        {
          action: body.status === 'declined' ? 'workplace_review.declined' : 'workplace_review.triaged',
          actorUserId: actor.userId,
          actorKind: 'USER',
          orgId: row.orgId,
          recordType: 'review_request',
          recordId: id,
          result: 'ALLOWED',
          details: { fromStatus: locked.status, toStatus: body.status },
        },
        { tx },
      );
      return next;
    });
    await this.notifier.requestUpdate(row.orgId, id, row.requesterUserId, updated.status);
    return this.getOps(id);
  }

  /** The request in its organization's scope, for the other services. */
  async requestOf(requestId: string, tx?: DbExecutor): Promise<RequestRow> {
    const row = await this.repo.findRequest(requestId, tx);
    if (!row) throw notFound();
    return row;
  }
}
