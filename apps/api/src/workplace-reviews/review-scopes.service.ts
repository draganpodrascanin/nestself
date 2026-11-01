/**
 * ReviewScopesService: the coordinator's versioned offer and the approver's
 * decision (spec REV-05; ADR 0002 D-EL-04). Sending a scope supersedes the
 * earlier sent ones; accepting binds that immutable version, checks the
 * approver's authority through the engine (the guard, with the scope's
 * amount as the resource amount), creates the engagement once and converts
 * the request. No charge, reservation or funding entry is created.
 */
import { Injectable } from '@nestjs/common';
import { ACTIVE_REVIEW_REQUEST_STATUSES, type Principal, type ReviewEngagementResponse, type ReviewRequestOpsResponse, type ReviewScopeCreateRequest } from '@nestself/contracts';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { AuditWriter } from '../audit/audit-writer.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { DbService } from '../db/db.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ReviewEngagementsService } from './review-engagements.service.js';
import { conflict, notFound, validationError } from './review-errors.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ReviewNotifier } from './review-notifier.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ReviewRequestsService } from './review-requests.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { WorkplaceReviewsRepository } from './workplace-reviews.repository.js';

@Injectable()
export class ReviewScopesService {
  constructor(
    private readonly dbs: DbService,
    private readonly repo: WorkplaceReviewsRepository,
    private readonly requests: ReviewRequestsService,
    private readonly engagements: ReviewEngagementsService,
    private readonly audit: AuditWriter,
    private readonly notifier: ReviewNotifier,
  ) {}

  /** The coordinator sends a scope: a new version, the earlier sent ones superseded, the request `scoped`. */
  async send(requestId: string, body: ReviewScopeCreateRequest, actor: Principal, now = new Date()): Promise<ReviewRequestOpsResponse> {
    const request = await this.repo.findRequest(requestId);
    if (!request) throw notFound();
    if (!ACTIVE_REVIEW_REQUEST_STATUSES.includes(request.status)) throw conflict('invalid_state', 'The request is not open');
    const validUntil = new Date(body.validUntil);
    if (validUntil.getTime() <= now.getTime()) throw validationError('The scope must stay valid for a while', 'validUntil');
    const service = await this.repo.findService(body.serviceId);
    if (!service || !service.isActive) throw validationError('Unknown service', 'serviceId');
    const created = await this.dbs.withOrgScope(request.orgId, async (tx) => {
      const locked = await this.repo.lockRequest(requestId, tx);
      if (!locked || !ACTIVE_REVIEW_REQUEST_STATUSES.includes(locked.status)) throw conflict('invalid_state', 'The request is not open');
      const version = await this.repo.nextScopeVersion(requestId, tx);
      const scope = await this.repo.insertScope(
        {
          orgId: request.orgId,
          requestId,
          version,
          serviceId: service.id,
          title: body.title,
          deliverables: body.deliverables,
          participants: body.participants,
          priceMinor: body.priceMinor,
          currency: body.currency,
          taxNote: body.taxNote ?? null,
          termsVersion: body.termsVersion,
          validUntil,
          cancellationPolicy: body.cancellationPolicy,
          status: 'sent',
          sentAt: now,
          createdByUserId: actor.userId,
        },
        tx,
      );
      await this.repo.supersedeSentScopes(requestId, scope.id, tx);
      await this.repo.updateRequest(requestId, { status: 'scoped', coordinatorUserId: actor.userId }, tx);
      await this.audit.record(
        {
          action: 'workplace_review.scope_sent',
          actorUserId: actor.userId,
          actorKind: 'USER',
          orgId: request.orgId,
          recordType: 'review_scope',
          recordId: scope.id,
          result: 'ALLOWED',
          details: { requestId, version, priceMinor: body.priceMinor, currency: body.currency, serviceKey: service.key, validUntil: validUntil.toISOString() },
        },
        { tx },
      );
      return scope;
    });
    await this.notifier.scopeSent(request.orgId, requestId, request.requesterUserId, created.validUntil);
    return this.requests.getOps(requestId);
  }

  /**
   * The approver accepts the sent, still valid version: it binds, the
   * engagement is created once (a replay returns the same one), the request
   * converts. The authority check happened in the guard against the scope's
   * amount; this records the financial decision.
   */
  async accept(orgId: string, scopeId: string, principal: Principal, now = new Date()): Promise<ReviewEngagementResponse> {
    const engagement = await this.dbs.withOrgScope(orgId, async (tx) => {
      const scope = await this.repo.lockScope(scopeId, tx);
      if (!scope || scope.orgId !== orgId) throw notFound();
      const request = await this.repo.lockRequest(scope.requestId, tx);
      if (!request) throw notFound();
      const existing = await this.repo.findEngagementByRequest(request.id, tx);
      if (existing && existing.scopeId === scope.id) return existing;
      if (scope.status !== 'sent') throw conflict('scope_not_sent', 'Only a sent scope can be accepted', { status: scope.status });
      if (scope.validUntil.getTime() <= now.getTime()) {
        await this.repo.updateScope(scope.id, { status: 'expired' }, tx);
        throw conflict('quote_expired', 'The scope is no longer valid');
      }
      if (existing) throw conflict('invalid_state', 'The request already has an engagement');
      await this.repo.updateScope(scope.id, { status: 'accepted', acceptedAt: now, acceptedByUserId: principal.userId }, tx);
      const created = await this.repo.insertEngagement(
        { orgId, requestId: request.id, scopeId: scope.id, coordinatorUserId: request.coordinatorUserId, status: 'accepted' },
        tx,
      );
      await this.repo.updateRequest(request.id, { status: 'converted', engagementId: created.id }, tx);
      await this.audit.record(
        {
          action: 'workplace_review.scope_accepted',
          actorUserId: principal.userId,
          actorKind: 'USER',
          orgId,
          recordType: 'review_scope',
          recordId: scope.id,
          result: 'ALLOWED',
          details: { requestId: request.id, version: scope.version, priceMinor: scope.priceMinor, currency: scope.currency, termsVersion: scope.termsVersion },
        },
        { tx },
      );
      await this.audit.record(
        {
          action: 'workplace_review.engagement_created',
          actorUserId: principal.userId,
          actorKind: 'USER',
          orgId,
          recordType: 'review_engagement',
          recordId: created.id,
          result: 'ALLOWED',
          details: { requestId: request.id, scopeId: scope.id },
        },
        { tx },
      );
      return created;
    });
    return this.engagements.response(engagement, now);
  }

  async reject(orgId: string, scopeId: string, principal: Principal, now = new Date()): Promise<ReviewRequestOpsResponse | void> {
    await this.dbs.withOrgScope(orgId, async (tx) => {
      const scope = await this.repo.lockScope(scopeId, tx);
      if (!scope || scope.orgId !== orgId) throw notFound();
      if (scope.status !== 'sent') throw conflict('scope_not_sent', 'Only a sent scope can be rejected', { status: scope.status });
      await this.repo.updateScope(scope.id, { status: 'rejected', rejectedAt: now }, tx);
      const request = await this.repo.lockRequest(scope.requestId, tx);
      if (request && request.status === 'scoped') await this.repo.updateRequest(request.id, { status: 'in_review' }, tx);
      await this.audit.record(
        {
          action: 'workplace_review.scope_rejected',
          actorUserId: principal.userId,
          actorKind: 'USER',
          orgId,
          recordType: 'review_scope',
          recordId: scope.id,
          result: 'ALLOWED',
          details: { requestId: scope.requestId, version: scope.version },
        },
        { tx },
      );
    });
  }
}
