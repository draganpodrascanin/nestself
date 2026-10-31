/**
 * ApprovalAuthoritiesService — who may decide requests in an organization,
 * within a scope, categories and an amount ceiling (T-2.1, D-17, MGR-04).
 *
 * Every read and write runs in the organization's tenant scope. Request
 * fields are mapped explicitly; `userId` and `orgId` never change after
 * creation. Writes audit one `approval_authority.changed` event carrying
 * the changed field names only.
 */
import { Inject, Injectable, forwardRef } from '@nestjs/common';
import type {
  ApprovalAuthorityCreateRequest,
  ApprovalAuthorityListResponse,
  ApprovalAuthorityResponse,
  ApprovalAuthorityUpdateRequest,
  Principal,
} from '@nestself/contracts';
import { ApiHttpException } from '../common/api-error.js';
import { DbService, type DbExecutor } from '../db/db.service.js';
import {
  ApprovalAuthoritiesRepository,
  type ApprovalAuthorityPatch,
  type ApprovalAuthorityRow,
} from '../db/repositories/approval-authorities.repository.js';
import { AuthorizationRepository } from '../db/repositories/authorization.repository.js';
import { OrgUnitsRepository } from '../db/repositories/org-units.repository.js';
import { AuditWriter } from '../audit/audit-writer.js';
import { assertWindow, validation } from './grant-rules.js';

const DEFAULT_CURRENCY = 'EUR';

@Injectable()
export class ApprovalAuthoritiesService {
  constructor(
    @Inject(forwardRef(() => DbService)) private readonly db: DbService,
    @Inject(forwardRef(() => ApprovalAuthoritiesRepository)) private readonly repo: ApprovalAuthoritiesRepository,
    @Inject(forwardRef(() => AuthorizationRepository)) private readonly authzRepo: AuthorizationRepository,
    @Inject(forwardRef(() => OrgUnitsRepository)) private readonly orgUnits: OrgUnitsRepository,
    @Inject(forwardRef(() => AuditWriter)) private readonly audit: AuditWriter,
  ) {}

  async list(orgId: string): Promise<ApprovalAuthorityListResponse> {
    const rows = await this.db.withOrgScope(orgId, (tx) => this.repo.list(orgId, tx));
    return { items: rows.map(toResponse) };
  }

  async create(
    orgId: string,
    body: ApprovalAuthorityCreateRequest,
    actor: Principal,
  ): Promise<ApprovalAuthorityResponse> {
    if (body.alternateUserId === body.userId) {
      throw validation('alternateUserId must differ from userId');
    }
    const validFrom = body.validFrom ? new Date(body.validFrom) : new Date();
    const validUntil = body.validUntil ? new Date(body.validUntil) : null;
    assertWindow(validFrom, validUntil);

    const created = await this.db.withOrgScope(orgId, async (tx) => {
      await this.assertActiveMember(body.userId, orgId, tx);
      if (body.alternateUserId) await this.assertActiveMember(body.alternateUserId, orgId, tx);
      const orgUnitId = body.orgUnitId ?? null;
      if (orgUnitId) await this.assertOrgUnit(orgUnitId, orgId, tx);

      const row = await this.repo.create(
        {
          userId: body.userId,
          orgId,
          orgUnitId,
          includeDescendants: orgUnitId ? body.includeDescendants : false,
          categories: body.categories,
          maxAmountMinor: body.maxAmountMinor ?? null,
          currency: body.currency ?? DEFAULT_CURRENCY,
          validFrom,
          validUntil,
          delegatedFromId: null,
          alternateUserId: body.alternateUserId ?? null,
          isConfidentialApprover: body.isConfidentialApprover,
        },
        tx,
      );
      await this.recordChange(row, actor, 'created', providedFields(body), tx);
      return row;
    });
    return toResponse(created);
  }

  async update(
    orgId: string,
    id: string,
    body: ApprovalAuthorityUpdateRequest,
    actor: Principal,
  ): Promise<ApprovalAuthorityResponse> {
    const updated = await this.db.withOrgScope(orgId, async (tx) => {
      const existing = await this.repo.findById(id, tx);
      if (!existing || existing.orgId !== orgId) {
        throw new ApiHttpException({ status: 404, code: 'not_found', message: 'Approval authority not found' });
      }

      // Explicit mapping: userId, orgId, orgUnitId and delegatedFromId never change here.
      const patch: ApprovalAuthorityPatch = {};
      if (body.categories !== undefined) patch.categories = body.categories;
      if (body.maxAmountMinor !== undefined) patch.maxAmountMinor = body.maxAmountMinor;
      if (body.currency !== undefined) patch.currency = body.currency;
      if (body.validFrom !== undefined) patch.validFrom = new Date(body.validFrom);
      if (body.validUntil !== undefined) patch.validUntil = new Date(body.validUntil);
      if (body.alternateUserId !== undefined) patch.alternateUserId = body.alternateUserId;
      if (body.isConfidentialApprover !== undefined) patch.isConfidentialApprover = body.isConfidentialApprover;

      const changedFields = Object.keys(patch);
      if (changedFields.length === 0) return existing;

      if (patch.alternateUserId != null) {
        if (patch.alternateUserId === existing.userId) {
          throw validation('alternateUserId must differ from userId');
        }
        await this.assertActiveMember(patch.alternateUserId, orgId, tx);
      }
      assertWindow(patch.validFrom ?? existing.validFrom, patch.validUntil ?? existing.validUntil);

      const row = await this.repo.update(id, patch, tx);
      await this.recordChange(row, actor, 'updated', changedFields, tx);
      return row;
    });
    return toResponse(updated);
  }

  private async assertActiveMember(userId: string, orgId: string, tx: DbExecutor): Promise<void> {
    const membership = await this.authzRepo.findActiveMembership(userId, orgId, tx);
    if (!membership) {
      throw new ApiHttpException({
        status: 409,
        code: 'subject_not_member',
        message: 'The user has no active membership in this organization',
      });
    }
  }

  private async assertOrgUnit(orgUnitId: string, orgId: string, tx: DbExecutor): Promise<void> {
    const unit = await this.orgUnits.findByIdAndOrg(orgUnitId, orgId, tx);
    if (!unit) {
      throw new ApiHttpException({ status: 404, code: 'not_found', message: 'Org unit not found in this organization' });
    }
  }

  /** Audit the write inside its transaction: the row commits or rolls back with it. */
  private async recordChange(
    row: ApprovalAuthorityRow,
    actor: Principal,
    operation: 'created' | 'updated',
    changedFields: string[],
    tx: DbExecutor,
  ): Promise<void> {
    await this.audit.record(
      {
        action: 'approval_authority.changed',
        actorUserId: actor.userId,
        actorKind: 'USER',
        orgId: row.orgId,
        recordType: 'approval_authority',
        recordId: row.id,
        result: 'ALLOWED',
        details: { operation, subjectUserId: row.userId, changedFields },
      },
      { tx },
    );
  }
}

/** Field names present in a create request (audit carries names, never values). */
function providedFields(body: ApprovalAuthorityCreateRequest): string[] {
  return Object.entries(body)
    .filter(([, value]) => value !== undefined)
    .map(([key]) => key);
}

function toResponse(row: ApprovalAuthorityRow): ApprovalAuthorityResponse {
  return {
    id: row.id,
    userId: row.userId,
    orgId: row.orgId,
    orgUnitId: row.orgUnitId,
    includeDescendants: row.includeDescendants,
    categories: [...(row.categories ?? [])],
    maxAmountMinor: row.maxAmountMinor,
    currency: row.currency,
    validFrom: row.validFrom.toISOString(),
    validUntil: row.validUntil?.toISOString() ?? null,
    delegatedFromId: row.delegatedFromId,
    alternateUserId: row.alternateUserId,
    isConfidentialApprover: row.isConfidentialApprover,
  };
}
