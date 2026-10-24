/**
 * GrantsService — organization grant administration (T-2.1).
 *
 * Every read and write runs in the organization's tenant scope
 * (`withOrgScope`). Writes audit one `grant.*` event and invalidate the
 * affected principals for the organization. Rules live in `grant-rules.ts`.
 *
 * @see docs/tasks/auth/auth-strategy.md 4.4, 4.5.6, 4.5.10
 */
import { Inject, Injectable, forwardRef } from '@nestjs/common';
import {
  CONFIDENTIAL_ACTIONS,
  type AuthorizationContext,
  type GrantCondition,
  type GrantCreateRequest,
  type GrantDelegateRequest,
  type GrantInput,
  type GrantListResponse,
  type GrantPreviewResponse,
  type GrantResponse,
  type GrantRevokeRequest,
  type GrantUpdateRequest,
  type Principal,
} from '@nestself/contracts';
import { ApiHttpException } from '../common/api-error.js';
import { DbService, type DbExecutor } from '../db/db.service.js';
import { AuthorizationRepository, type GrantRow } from '../db/repositories/authorization.repository.js';
import { OrgUnitsRepository } from '../db/repositories/org-units.repository.js';
import { PrincipalLoader } from '../principal/principal-loader.js';
import { ContextLoader } from '../authz/context-loader.js';
import { AuditWriter, type AuditEventInput } from '../audit/audit-writer.js';
import { validateDelegation } from '../authz/delegation.js';
import { effectiveAccess } from '../authz/effective-access.js';
import {
  MAX_DELEGATION_DEPTH,
  assertOrgScopeType,
  assertWindow,
  checkDelegationBounds,
  exceedsBoundary,
  findActiveTemplate,
  mergeGrants,
  missingConditionTypes,
  missingConditions,
  validation,
  type OrgGrantScopeType,
} from './grant-rules.js';
import { parseConditions, toGrantInput, toGrantResponse } from './grant-mapper.js';

export interface GrantListFilter {
  subjectUserId?: string;
  includeRevoked?: boolean;
}

/** Placeholder id of a proposed (not yet stored) delegated grant. */
const PROPOSED_GRANT_ID = 'proposed';

@Injectable()
export class GrantsService {
  constructor(
    @Inject(forwardRef(() => DbService)) private readonly db: DbService,
    @Inject(forwardRef(() => AuthorizationRepository)) private readonly authzRepo: AuthorizationRepository,
    @Inject(forwardRef(() => OrgUnitsRepository)) private readonly orgUnits: OrgUnitsRepository,
    @Inject(forwardRef(() => PrincipalLoader)) private readonly principalLoader: PrincipalLoader,
    @Inject(forwardRef(() => ContextLoader)) private readonly contextLoader: ContextLoader,
    @Inject(forwardRef(() => AuditWriter)) private readonly audit: AuditWriter,
  ) {}

  // ── List ──────────────────────────────────────────────────────────────

  async list(orgId: string, filter: GrantListFilter): Promise<GrantListResponse> {
    const rows = await this.db.withOrgScope(orgId, (tx) =>
      this.authzRepo.listGrantsForOrg(
        orgId,
        { subjectUserId: filter.subjectUserId, includeRevoked: filter.includeRevoked },
        tx,
      ),
    );
    return { items: rows.map(toGrantResponse) };
  }

  // ── Create ────────────────────────────────────────────────────────────

  async create(orgId: string, body: GrantCreateRequest, actor: Principal): Promise<GrantResponse> {
    const template = findActiveTemplate(body.templateKey);
    if (!template) {
      throw new ApiHttpException({ status: 400, code: 'template_inactive', message: 'Template is unknown or inactive' });
    }
    if (template.workspace !== 'organization') {
      throw validation('Template is not an organization template');
    }
    const scopeType = assertOrgScopeType(body.scopeType);
    const missing = missingConditionTypes(template.requiredConditionTypes, body.conditions);
    if (missing.length > 0) throw missingConditions(missing);

    const validFrom = body.validFrom ? new Date(body.validFrom) : new Date();
    const validUntil = body.validUntil ? new Date(body.validUntil) : null;
    assertWindow(validFrom, validUntil);

    const created = await this.db.withOrgScope(orgId, async (tx) => {
      const scopeOrgUnitId = await this.resolveScopeUnit(orgId, scopeType, body.scopeOrgUnitId, tx);
      const membership = await this.authzRepo.findActiveMembership(body.subjectUserId, orgId, tx);
      if (!membership) {
        throw new ApiHttpException({
          status: 409,
          code: 'subject_not_member',
          message: 'The subject has no active membership in this organization',
        });
      }

      const row = await this.authzRepo.createGrant(
        {
          subjectUserId: body.subjectUserId,
          templateKey: template.key,
          actions: [...template.actions],
          scopeType,
          scopeOrgId: orgId,
          scopeOrgUnitId,
          includeDescendants: scopeType === 'org_unit' ? body.includeDescendants : false,
          conditions: body.conditions,
          validFrom,
          validUntil,
          parentGrantId: null,
          grantedByUserId: actor.userId,
        },
        tx,
      );

      await this.audit.record(
        grantEvent('grant.created', row, actor, orgId, {
          subjectUserId: row.subjectUserId,
          templateKey: template.key,
          scopeType,
          actionsCount: row.actions.length,
          conditionTypes: conditionTypes(body.conditions),
        }),
      );
      return row;
    });

    await this.principalLoader.invalidateUser(created.subjectUserId, [orgId]);
    return toGrantResponse(created);
  }

  // ── Update ────────────────────────────────────────────────────────────

  async update(
    orgId: string,
    grantId: string,
    body: GrantUpdateRequest,
    actor: Principal,
  ): Promise<GrantResponse> {
    const updated = await this.db.withOrgScope(orgId, async (tx) => {
      const grant = await this.findActiveOrgGrant(grantId, orgId, tx);

      const patch: { conditions?: GrantCondition[]; validFrom?: Date; validUntil?: Date } = {};
      if (body.conditions !== undefined) patch.conditions = body.conditions;
      if (body.validFrom !== undefined) patch.validFrom = new Date(body.validFrom);
      if (body.validUntil !== undefined) patch.validUntil = new Date(body.validUntil);

      assertWindow(patch.validFrom ?? grant.validFrom, patch.validUntil ?? grant.validUntil);

      if (patch.conditions) {
        const template = grant.templateKey ? findActiveTemplate(grant.templateKey) : null;
        if (template) {
          const missing = missingConditionTypes(template.requiredConditionTypes, patch.conditions);
          if (missing.length > 0) throw missingConditions(missing);
        }
        if (grant.parentGrantId) {
          await this.assertWithinParent(grant, patch.conditions, tx);
        }
      }

      const row = await this.authzRepo.updateGrant(grantId, patch, tx);
      await this.audit.record(
        grantEvent('grant.adjusted', row, actor, orgId, {
          subjectUserId: row.subjectUserId,
          templateKey: row.templateKey,
          scopeType: row.scopeType,
          actionsCount: row.actions.length,
          changedFields: Object.keys(patch),
          conditionTypes: conditionTypes(parseConditions(row.conditions)),
        }),
      );
      return row;
    });

    await this.principalLoader.invalidateUser(updated.subjectUserId, [orgId]);
    return toGrantResponse(updated);
  }

  // ── Revoke ────────────────────────────────────────────────────────────

  async revoke(
    orgId: string,
    grantId: string,
    body: GrantRevokeRequest,
    actor: Principal,
  ): Promise<GrantResponse> {
    const { root, subjects } = await this.db.withOrgScope(orgId, async (tx) => {
      const grant = await this.findActiveOrgGrant(grantId, orgId, tx);
      const { children } = await this.authzRepo.revokeGrantTree(
        [grant.id],
        { at: new Date(), byUserId: actor.userId, reason: body.reason },
        tx,
      );

      const subjectIds = new Set<string>([grant.subjectUserId]);
      for (const childId of children) {
        const child = await this.authzRepo.findGrantById(childId, tx);
        if (child) subjectIds.add(child.subjectUserId);
      }

      const revoked = (await this.authzRepo.findGrantById(grant.id, tx)) ?? grant;
      await this.audit.record(
        grantEvent('grant.revoked', revoked, actor, orgId, {
          subjectUserId: revoked.subjectUserId,
          templateKey: revoked.templateKey,
          scopeType: revoked.scopeType,
          actionsCount: revoked.actions.length,
          reason: body.reason,
          revokedDescendants: children.length,
        }),
      );
      for (const childId of children) {
        await this.audit.record({
          action: 'grant.delegation_revoked',
          actorUserId: actor.userId,
          actorKind: 'USER',
          orgId,
          recordType: 'grant',
          recordId: childId,
          result: 'ALLOWED',
          details: { reason: 'parent_revoked', rootGrantId: grant.id },
        });
      }
      return { root: revoked, subjects: [...subjectIds] };
    });

    for (const userId of subjects) {
      await this.principalLoader.invalidateUser(userId, [orgId]);
    }
    return toGrantResponse(root);
  }

  // ── Delegate ──────────────────────────────────────────────────────────

  async delegate(orgId: string, body: GrantDelegateRequest, actor: Principal): Promise<GrantResponse> {
    const delegatorGrants = await this.principalLoader.loadGrants(actor.userId, orgId);

    const created = await this.db.withOrgScope(orgId, async (tx) => {
      const parentRow = await this.findOrgGrant(body.parentGrantId, orgId, tx);
      if (parentRow.subjectUserId !== actor.userId) throw exceedsBoundary('not_parent_subject');
      const parent = toGrantInput(parentRow);

      const scopeType = assertOrgScopeType(body.scopeType ?? parent.scopeType);
      const scopeOrgUnitId = await this.resolveScopeUnit(
        orgId,
        scopeType,
        body.scopeOrgUnitId ?? (scopeType === parent.scopeType ? parent.scopeOrgUnitId ?? undefined : undefined),
        tx,
      );

      const membership = await this.authzRepo.findActiveMembership(body.subjectUserId, orgId, tx);
      if (!membership) throw exceedsBoundary('subject_not_member');

      const depth = (await this.authzRepo.delegationDepth(parent.id, tx)) + 1;
      if (depth > MAX_DELEGATION_DEPTH) throw exceedsBoundary('delegation_depth_exceeded');

      const now = new Date();
      const proposed: GrantInput = {
        id: PROPOSED_GRANT_ID,
        subjectUserId: body.subjectUserId,
        templateKey: '',
        actions: body.actions,
        scopeType,
        scopeOrgId: orgId,
        scopeOrgUnitId,
        includeDescendants: scopeType === 'org_unit' ? (body.includeDescendants ?? false) : false,
        scopeRefKind: null,
        scopeRefId: null,
        conditions: body.conditions,
        validFrom: now,
        validUntil: null,
        delegationEnvelope: null,
        parentGrantId: parent.id,
        revokedAt: null,
      };

      const childAncestorIds = scopeOrgUnitId ? await this.authzRepo.findAncestorIds(scopeOrgUnitId, tx) : [];
      if (parent.delegationEnvelope == null) {
        const bound = checkDelegationBounds(parent, proposed, childAncestorIds);
        if (bound) throw exceedsBoundary(bound);
      }

      // Engine check: the delegator's grants plus the parent chain read from
      // the DB (ancestors belong to other users; DB rows beat cached copies).
      const chain = await this.loadParentChain(parentRow, tx);
      const grants = mergeGrants(delegatorGrants, chain);
      const ctx: AuthorizationContext = {
        now,
        isDeactivated: false,
        isSuspended: false,
        grants,
        assignments: [],
        ancestorIds: childAncestorIds,
        orgSelfApprovalAllowed: false,
        organizationTimezone: 'UTC',
        delegatorGrants: grants,
      };
      const engine = validateDelegation(proposed, ctx);
      if (!engine.valid) throw exceedsBoundary(engine.reason ?? 'delegation_invalid');

      const row = await this.authzRepo.createGrant(
        {
          subjectUserId: proposed.subjectUserId,
          templateKey: null,
          actions: [...proposed.actions],
          scopeType,
          scopeOrgId: orgId,
          scopeOrgUnitId,
          includeDescendants: proposed.includeDescendants,
          conditions: body.conditions,
          validFrom: now,
          validUntil: null,
          parentGrantId: parent.id,
          grantedByUserId: actor.userId,
        },
        tx,
      );
      await this.audit.record(
        grantEvent('grant.delegated', row, actor, orgId, {
          subjectUserId: row.subjectUserId,
          parentGrantId: parent.id,
          parentTemplateKey: parentRow.templateKey,
          scopeType,
          actionsCount: row.actions.length,
          conditionTypes: conditionTypes(body.conditions),
          depth,
        }),
      );
      return row;
    });

    await this.principalLoader.invalidateUser(created.subjectUserId, [orgId]);
    return toGrantResponse(created);
  }

  // ── Preview ───────────────────────────────────────────────────────────

  async preview(orgId: string, userId: string, _actor: Principal): Promise<GrantPreviewResponse> {
    const membership = await this.db.withOrgScope(orgId, (tx) =>
      this.authzRepo.findActiveMembership(userId, orgId, tx),
    );
    const loaded = membership ? await this.principalLoader.load(userId) : null;
    if (!loaded) {
      throw new ApiHttpException({ status: 404, code: 'not_found', message: 'User not found in this organization' });
    }

    const principal: Principal = {
      userId: loaded.userId,
      displayName: loaded.displayName,
      initials: loaded.initials,
      locale: loaded.locale,
      memberships: loaded.memberships,
      staffTemplates: loaded.staffTemplates,
      expert: loaded.expert,
      context: { kind: 'organization', orgId },
      // A preview never satisfies step-up: old snapshot, no second factor.
      auth: { method: 'sso', time: new Date(0).toISOString(), secondFactor: false, lastStepUpAt: null },
      sessionId: null,
      tokenFamily: null,
    };
    const ctx = await this.contextLoader.build(principal, { type: 'grant_preview', orgId }, { loadedPrincipal: loaded });

    // AUDIT-R-02: confidential-domain actions never appear in a preview.
    const confidential = new Set<string>(CONFIDENTIAL_ACTIONS);
    const entries = effectiveAccess(principal, ctx).filter((e) => !confidential.has(e.action));

    return {
      userId,
      orgId,
      actions: [...new Set(entries.map((e) => e.action))],
      grantIds: [...new Set(entries.map((e) => e.grantId))],
      assignmentIds: ctx.assignments.map((a) => a.id),
    };
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  /** An organization-scoped grant of this org (platform grants are hidden here). */
  private async findOrgGrant(grantId: string, orgId: string, tx: DbExecutor): Promise<GrantRow> {
    const grant = await this.authzRepo.findGrantById(grantId, tx);
    if (!grant || grant.scopeOrgId !== orgId) {
      throw new ApiHttpException({ status: 404, code: 'not_found', message: 'Grant not found' });
    }
    return grant;
  }

  private async findActiveOrgGrant(grantId: string, orgId: string, tx: DbExecutor): Promise<GrantRow> {
    const grant = await this.findOrgGrant(grantId, orgId, tx);
    if (grant.revokedAt) {
      throw new ApiHttpException({ status: 409, code: 'conflict', message: 'Grant is already revoked' });
    }
    return grant;
  }

  /** The org unit for an `org_unit` scope (must belong to the org); null for organization scope. */
  private async resolveScopeUnit(
    orgId: string,
    scopeType: OrgGrantScopeType,
    scopeOrgUnitId: string | undefined,
    tx: DbExecutor,
  ): Promise<string | null> {
    if (scopeType === 'organization') {
      if (scopeOrgUnitId) throw validation('scopeOrgUnitId is only allowed with scopeType org_unit');
      return null;
    }
    if (!scopeOrgUnitId) throw validation('scopeOrgUnitId is required with scopeType org_unit');
    const unit = await this.orgUnits.findByIdAndOrg(scopeOrgUnitId, orgId, tx);
    if (!unit) {
      throw new ApiHttpException({ status: 404, code: 'not_found', message: 'Org unit not found in this organization' });
    }
    return scopeOrgUnitId;
  }

  /** New conditions of a delegated grant must stay within its parent. */
  private async assertWithinParent(
    grant: GrantRow,
    conditions: GrantCondition[],
    tx: DbExecutor,
  ): Promise<void> {
    const parentRow = await this.authzRepo.findGrantById(grant.parentGrantId!, tx);
    if (!parentRow) throw exceedsBoundary('delegation_parent_revoked');
    const parent = toGrantInput(parentRow);
    if (parent.delegationEnvelope != null) return;
    const ancestorIds = grant.scopeOrgUnitId ? await this.authzRepo.findAncestorIds(grant.scopeOrgUnitId, tx) : [];
    const bound = checkDelegationBounds(parent, { ...toGrantInput(grant), conditions }, ancestorIds);
    if (bound) throw exceedsBoundary(bound);
  }

  /** The parent grant and its ancestors as stored, nearest first. */
  private async loadParentChain(parent: GrantRow, tx: DbExecutor): Promise<GrantInput[]> {
    const chain: GrantInput[] = [toGrantInput(parent)];
    let nextId = parent.parentGrantId;
    while (nextId != null && chain.length <= MAX_DELEGATION_DEPTH + 1) {
      const row = await this.authzRepo.findGrantById(nextId, tx);
      if (!row) break;
      chain.push(toGrantInput(row));
      nextId = row.parentGrantId;
    }
    return chain;
  }
}

// ── Module-private helpers ──────────────────────────────────────────────

/** Condition type names only: audit details never carry condition values. */
function conditionTypes(conditions: readonly GrantCondition[]): string[] {
  return conditions.map((c) => c.type);
}

function grantEvent(
  action: 'grant.created' | 'grant.adjusted' | 'grant.revoked' | 'grant.delegated',
  row: GrantRow,
  actor: Principal,
  orgId: string,
  details: Record<string, unknown>,
): AuditEventInput {
  return {
    action,
    actorUserId: actor.userId,
    actorKind: 'USER',
    orgId,
    recordType: 'grant',
    recordId: row.id,
    result: 'ALLOWED',
    details,
  };
}
