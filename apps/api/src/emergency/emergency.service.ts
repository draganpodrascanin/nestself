/**
 * EmergencyService: the emergency access lifecycle and its single-record
 * reads (T-2.5, section 4.7, API-R-26, CONF-R-08..10).
 *
 * - A request stores a pending row: provisional `grantedAt = now` and
 *   `expiresAt = now + durationMinutes`, no approver. Pending rows never
 *   count as active (`findActiveEmergencyAccess` requires an approver).
 * - Approval must come from a different user (403 `self_approval_denied`)
 *   and restarts the window: `grantedAt = approvedAt = now`,
 *   `expiresAt = now + min(durationMinutes, 240)`. One pino `warn` line with
 *   `action: 'emergency_access.approved'` feeds the CloudWatch metric filter.
 * - Denial deletes the pending row; revocation sets `revokedAt`.
 * - A read names the emergency access record and one conversation or
 *   intake record. The caller's own access record answers first (unknown or
 *   someone else's: 404; not active: 403 `emergency_not_active`), before any
 *   record is looked up; then the record (404) and whether the access covers
 *   it (404, like a missing one). Neither the state of the access nor its
 *   scope lets a caller probe record ids. Then the engine decides
 *   (`records.read.emergency`, expiry and scope evaluated from the database
 *   row on every request). Every read is audited as `emergency_access.used`
 *   with identifiers only, never content; a refused one as `access.denied`.
 *
 * Every write is audited and invalidates the requester's principal caches.
 */
import { Injectable, Logger } from '@nestjs/common';
import {
  EMERGENCY_ACCESS_MAX_MINUTES,
  type EmergencyAccessCreateRequest,
  type EmergencyAccessListResponse,
  type EmergencyAccessResponse,
  type EmergencyRecordResponse,
  type EmergencyRecordType,
  type Principal,
  type Resource,
} from '@nestself/contracts';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import {
  AuthorizationRepository,
  type EmergencyAccessFilter,
  type EmergencyAccessRow,
} from '../db/repositories/authorization.repository.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ProfessionalRepository } from '../db/repositories/professional.repository.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { AuthorizationService } from '../authz/authorization.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { AuditWriter, type AuditEventInput } from '../audit/audit-writer.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { PrincipalLoader } from '../principal/principal-loader.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { DbService } from '../db/db.service.js';
import { assertOperationsSession } from '../authz/resolvers.js';
import { ApiHttpException } from '../common/api-error.js';
import {
  confidentialResource,
  toConversationView,
  toIntakeView,
  type ConversationView,
  type IntakeView,
} from '../professional/professional-records.js';

/** Audit details keep at most this much of the written purpose (4.8 catalogue). */
const AUDITED_PURPOSE_LENGTH = 500;

const MINUTE_MS = 60_000;

function notFound(): ApiHttpException {
  return new ApiHttpException({ status: 404, code: 'not_found', message: 'Resource not found' });
}

function notPending(): ApiHttpException {
  return new ApiHttpException({
    status: 409,
    code: 'conflict',
    message: 'The emergency access request is no longer pending',
  });
}

function notActive(status: 403 | 409): ApiHttpException {
  return new ApiHttpException({
    status,
    code: 'emergency_not_active',
    message: 'The emergency access record is not active',
  });
}

function isActive(row: EmergencyAccessRow, now: Date): boolean {
  return row.approvedByUserId != null && row.revokedAt == null && row.expiresAt > now;
}

/** Same rule as the engine's `matchesEmergencyScope`: CASE → resource id, USER_RECORDS → owner. */
function covers(row: EmergencyAccessRow, resource: Resource): boolean {
  return row.scopeKind === 'CASE' ? resource.id === row.scopeId : resource.ownerId === row.scopeId;
}

export function toEmergencyAccessResponse(row: EmergencyAccessRow): EmergencyAccessResponse {
  return {
    id: row.id,
    userId: row.userId,
    approvedByUserId: row.approvedByUserId,
    purpose: row.purpose,
    scopeKind: row.scopeKind,
    scopeId: row.scopeId,
    durationMinutes: row.requestedDurationMinutes,
    grantedAt: row.grantedAt.toISOString(),
    approvedAt: row.approvedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}

function lifecycleEvent(
  action: 'emergency_access.requested' | 'emergency_access.approved' | 'emergency_access.denied' | 'emergency_access.revoked',
  row: EmergencyAccessRow,
  actor: Principal,
  details: Record<string, unknown>,
): AuditEventInput {
  return {
    action,
    actorUserId: actor.userId,
    actorKind: 'USER',
    recordType: 'emergency_access',
    recordId: row.id,
    result: 'ALLOWED',
    sessionId: actor.sessionId ?? null,
    details,
  };
}

@Injectable()
export class EmergencyService {
  private readonly logger = new Logger(EmergencyService.name);

  constructor(
    private readonly authzRepo: AuthorizationRepository,
    private readonly professional: ProfessionalRepository,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditWriter,
    private readonly principals: PrincipalLoader,
    private readonly db: DbService,
  ) {}

  async list(filter: EmergencyAccessFilter): Promise<EmergencyAccessListResponse> {
    const rows = await this.authzRepo.listEmergencyAccess(filter);
    return { items: rows.map(toEmergencyAccessResponse) };
  }

  async request(body: EmergencyAccessCreateRequest, actor: Principal): Promise<EmergencyAccessResponse> {
    const now = new Date();
    const row = await this.db.withTransaction(async (tx) => {
      const created = await this.authzRepo.createEmergencyRequest(
        {
          userId: actor.userId,
          purpose: body.purpose,
          scopeKind: body.scopeKind,
          scopeId: body.scopeId,
          requestedDurationMinutes: body.durationMinutes,
          grantedAt: now,
          expiresAt: new Date(now.getTime() + body.durationMinutes * MINUTE_MS),
        },
        tx,
      );
      await this.audit.record(
        lifecycleEvent('emergency_access.requested', created, actor, {
          purpose: body.purpose.slice(0, AUDITED_PURPOSE_LENGTH),
          scopeKind: created.scopeKind,
          scopeId: created.scopeId,
          durationMinutes: created.requestedDurationMinutes,
        }),
        { tx },
      );
      return created;
    });
    await this.principals.invalidateUser(row.userId);
    return toEmergencyAccessResponse(row);
  }

  async approve(id: string, approver: Principal): Promise<EmergencyAccessResponse> {
    const pending = await this.authzRepo.findEmergencyAccess(id);
    if (!pending) throw notFound();
    if (pending.userId === approver.userId) {
      await this.audit.record({
        action: 'access.denied',
        actorUserId: approver.userId,
        actorKind: 'USER',
        recordType: 'emergency_access',
        recordId: pending.id,
        result: 'DENIED',
        sessionId: approver.sessionId ?? null,
        details: { actionAttempted: 'access.emergency.approve', reason: 'self_approval_denied' },
      });
      throw new ApiHttpException({
        status: 403,
        code: 'self_approval_denied',
        message: 'Emergency access must be approved by a different user',
      });
    }
    if (pending.approvedByUserId != null || pending.revokedAt != null) throw notPending();

    const now = new Date();
    const window = Math.min(pending.requestedDurationMinutes, EMERGENCY_ACCESS_MAX_MINUTES);
    const expiresAt = new Date(now.getTime() + window * MINUTE_MS);
    const row = await this.db.withTransaction(async (tx) => {
      const approved = await this.authzRepo.approveEmergencyAccess(id, approver.userId, now, expiresAt, tx);
      if (!approved) throw notPending();
      await this.audit.record(
        lifecycleEvent('emergency_access.approved', approved, approver, {
          requesterUserId: approved.userId,
          scopeKind: approved.scopeKind,
          scopeId: approved.scopeId,
          durationMinutes: window,
          expiresAt: approved.expiresAt.toISOString(),
        }),
        { tx },
      );
      return approved;
    });
    // The CloudWatch metric filter matches `$.action` on this line (OPS alarm on every activation).
    this.logger.warn({ action: 'emergency_access.approved', emergencyAccessId: row.id }, 'Emergency access approved');
    await this.principals.invalidateUser(row.userId);
    return toEmergencyAccessResponse(row);
  }

  async deny(id: string, approver: Principal): Promise<void> {
    const pending = await this.authzRepo.findEmergencyAccess(id);
    if (!pending) throw notFound();
    if (pending.approvedByUserId != null || pending.revokedAt != null) throw notPending();

    await this.db.withTransaction(async (tx) => {
      if (!(await this.authzRepo.deleteEmergencyRequest(id, tx))) throw notPending();
      await this.audit.record(
        lifecycleEvent('emergency_access.denied', pending, approver, {
          requesterUserId: pending.userId,
          scopeKind: pending.scopeKind,
          scopeId: pending.scopeId,
        }),
        { tx },
      );
    });
    await this.principals.invalidateUser(pending.userId);
  }

  async revoke(id: string, actor: Principal): Promise<EmergencyAccessResponse> {
    const current = await this.authzRepo.findEmergencyAccess(id);
    if (!current) throw notFound();
    const now = new Date();
    if (!isActive(current, now)) throw notActive(409);

    const row = await this.db.withTransaction(async (tx) => {
      const revoked = await this.authzRepo.revokeEmergencyAccess(id, actor.userId, now, tx);
      if (!revoked) throw notActive(409);
      await this.audit.record(
        lifecycleEvent('emergency_access.revoked', revoked, actor, {
          requesterUserId: revoked.userId,
          scopeKind: revoked.scopeKind,
          scopeId: revoked.scopeId,
        }),
        { tx },
      );
      return revoked;
    });
    await this.principals.invalidateUser(row.userId);
    return toEmergencyAccessResponse(row);
  }

  /**
   * One restricted record under the caller's own emergency access record.
   * There is deliberately no list or bulk variant (CONF-R-09).
   *
   * The order is the point: the access record is checked before the record is
   * looked up, and the record is checked against the access before the engine
   * sees it. A pending, revoked or expired access therefore answers the same
   * for every id, and a record outside the scope answers like a missing one;
   * a "forbidden" for an existing record would confirm that it exists.
   */
  async readRecord(
    principal: Principal,
    emergencyAccessId: string,
    recordType: EmergencyRecordType,
    recordId: string,
  ): Promise<EmergencyRecordResponse> {
    assertOperationsSession(principal);
    const access = await this.authzRepo.findEmergencyAccess(emergencyAccessId);
    if (!access || access.userId !== principal.userId) throw notFound();
    if (!isActive(access, new Date())) {
      await this.auditDeniedRead(principal, access, 'emergency_not_active', recordType, recordId);
      throw notActive(403);
    }

    const { resource, content } =
      recordType === 'conversation'
        ? await this.loadConversation(recordId)
        : await this.loadIntake(recordId);
    if (!covers(access, resource)) {
      await this.auditDeniedRead(principal, access, 'outside_emergency_scope', recordType, recordId, resource.orgId);
      throw notFound();
    }

    // The engine evaluates approval, expiry, revocation and scope from the
    // database row (never the sweeper alone, AUTHZ-R-46).
    await this.authz.require(principal, 'records.read.emergency', resource);

    const body = await content();
    await this.audit.record({
      action: 'emergency_access.used',
      actorUserId: principal.userId,
      actorKind: 'USER',
      orgId: resource.orgId ?? null,
      recordType: 'emergency_access',
      recordId: access.id,
      result: 'ALLOWED',
      sessionId: principal.sessionId ?? null,
      details: { emergencyAccessId: access.id, recordType, recordId },
    });
    return { emergencyAccessId: access.id, recordType, recordId, content: body };
  }

  /**
   * A read the named access does not allow is a denial like any other:
   * `access.denied` with identifiers only, never content. These refusals are
   * answered before the engine is asked, so the row the engine writes for a
   * denial (which they used to get) is written here. `orgId` is known only
   * once the record was loaded.
   */
  private async auditDeniedRead(
    principal: Principal,
    access: EmergencyAccessRow,
    reason: 'emergency_not_active' | 'outside_emergency_scope',
    recordType: EmergencyRecordType,
    recordId: string,
    orgId?: string,
  ): Promise<void> {
    await this.audit.record({
      action: 'access.denied',
      actorUserId: principal.userId,
      actorKind: 'USER',
      orgId: orgId ?? null,
      recordType: 'emergency_access',
      recordId: access.id,
      result: 'DENIED',
      sessionId: principal.sessionId ?? null,
      details: { actionAttempted: 'records.read.emergency', reason, emergencyAccessId: access.id, recordType, recordId },
    });
  }

  /** The row decides the resource; content is read only after authorization. */
  private async loadConversation(
    id: string,
  ): Promise<{ resource: Resource; content: () => Promise<ConversationView> }> {
    const row = await this.professional.findConversation(id);
    if (!row) throw notFound();
    return {
      resource: confidentialResource('conversation', row),
      content: async () => toConversationView(row, await this.professional.listMessages(row.id)),
    };
  }

  private async loadIntake(id: string): Promise<{ resource: Resource; content: () => Promise<IntakeView> }> {
    const row = await this.professional.findIntake(id);
    if (!row) throw notFound();
    return { resource: confidentialResource('intake', row), content: () => Promise.resolve(toIntakeView(row)) };
  }
}
