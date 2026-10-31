/**
 * GrantsService — organization grant administration (T-2.1).
 *
 * Organization grants: every read and write runs in the organization's
 * tenant scope (`withOrgScope`). Platform grants (`scope_org_id` null, from
 * operations templates) are visible in every scope. Writes audit one
 * `grant.*` event and invalidate the affected principals. Rules live in
 * `grant-rules.ts`.
 *
 * Owner model (2026-10-24): an organization has at most one active
 * `employer_owner` grant. Every path here that writes one (create, update of
 * its window, ownership transfer) checks under a per-organization advisory
 * lock and answers a second owner with 409 `owner_exists`.
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
  type ActiveContext,
  type OwnershipTransferRequest,
  type OwnershipTransferResponse,
  type PlatformGrantCreateRequest,
  type Principal,
  type UserAccessContext,
  type UserAccessResponse,
} from '@nestself/contracts';
import { ApiHttpException } from '../common/api-error.js';
import { DbService, type DbExecutor } from '../db/db.service.js';
import { AuthorizationRepository, type GrantRow } from '../db/repositories/authorization.repository.js';
import { OrgUnitsRepository } from '../db/repositories/org-units.repository.js';
import { PrincipalLoader, type LoadedPrincipal } from '../principal/principal-loader.js';
import { ContextLoader } from '../authz/context-loader.js';
import { AuditWriter, type AuditEventInput } from '../audit/audit-writer.js';
import { validateDelegation } from '../authz/delegation.js';
import { effectiveAccess } from '../authz/effective-access.js';
import {
  MAX_DELEGATION_DEPTH,
  OWNER_TEMPLATE_KEY,
  OWNERSHIP_TRANSFERRED_REASON,
  hasStarted,
  ownerExists,
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
      if (template.key === OWNER_TEMPLATE_KEY) {
        const [current] = await this.authzRepo.findActiveOwnerGrants(orgId, new Date(), tx);
        if (current) throw ownerExists(current.subjectUserId);
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
        { tx },
      );
      return row;
    });

    await this.principalLoader.invalidateUser(created.subjectUserId, [orgId]);
    return toGrantResponse(created);
  }

  // ── Platform grants (operations) ──────────────────────────────────────

  /** Grants without an organization (`scope_org_id IS NULL`), newest first. */
  async listPlatform(filter: GrantListFilter): Promise<GrantListResponse> {
    const rows = await this.authzRepo.listPlatformGrants({
      subjectUserId: filter.subjectUserId,
      includeRevoked: filter.includeRevoked,
    });
    return { items: rows.map(toGrantResponse) };
  }

  /**
   * A grant from an operations template at the template's own scope
   * (`platform` or `assigned_*`), never tied to an organization.
   */
  async createPlatform(body: PlatformGrantCreateRequest, actor: Principal): Promise<GrantResponse> {
    const template = findActiveTemplate(body.templateKey);
    if (!template) {
      throw new ApiHttpException({ status: 400, code: 'template_inactive', message: 'Template is unknown or inactive' });
    }
    if (template.workspace !== 'operations') throw validation('Template is not an operations template');
    if (body.scopeType !== template.scopeType) {
      throw validation(`scopeType must be ${template.scopeType} for template ${template.key}`);
    }
    const missing = missingConditionTypes(template.requiredConditionTypes, body.conditions);
    if (missing.length > 0) throw missingConditions(missing);

    const validFrom = body.validFrom ? new Date(body.validFrom) : new Date();
    const validUntil = body.validUntil ? new Date(body.validUntil) : null;
    assertWindow(validFrom, validUntil);

    const subject = await this.principalLoader.load(body.subjectUserId);
    if (!subject) throw new ApiHttpException({ status: 404, code: 'not_found', message: 'User not found' });

    // The insert and its audit row share one transaction (no tenant setting:
    // the grant has no organization), so a failed audit insert rolls the
    // grant back, as on the organization path (API-R-22).
    const row = await this.db.withTransaction(async (tx) => {
      const created = await this.authzRepo.createGrant(
        {
          subjectUserId: body.subjectUserId,
          templateKey: template.key,
          actions: [...template.actions],
          scopeType: template.scopeType,
          scopeOrgId: null,
          scopeOrgUnitId: null,
          includeDescendants: false,
          conditions: body.conditions,
          validFrom,
          validUntil,
          parentGrantId: null,
          grantedByUserId: actor.userId,
        },
        tx,
      );
      await this.audit.record(
        grantEvent('grant.created', created, actor, null, {
          subjectUserId: created.subjectUserId,
          templateKey: template.key,
          scopeType: template.scopeType,
          actionsCount: created.actions.length,
          conditionTypes: conditionTypes(body.conditions),
        }),
        { tx },
      );
      return created;
    });

    await this.invalidatePlatformSubject(subject.userId);
    return toGrantResponse(row);
  }

  /**
   * Revoke a platform-scoped grant (`scope_org_id IS NULL`) and every grant
   * delegated from it. Organization grants are not visible here (404); they
   * are revoked through `/ops/orgs/:orgId/grants/:grantId/revoke`.
   */
  async revokePlatform(grantId: string, body: GrantRevokeRequest, actor: Principal): Promise<GrantResponse> {
    // Tree revocation and its audit rows share one system transaction, as in
    // createPlatform: a failed audit insert rolls the revocation back.
    const root = await this.db.withTransaction(async (tx) => {
      const grant = await this.authzRepo.findGrantById(grantId, tx);
      if (!grant || grant.scopeOrgId !== null) {
        throw new ApiHttpException({ status: 404, code: 'not_found', message: 'Grant not found' });
      }
      if (grant.revokedAt) {
        throw new ApiHttpException({ status: 409, code: 'conflict', message: 'Grant is already revoked' });
      }
      const { children } = await this.authzRepo.revokeGrantTree(
        [grant.id],
        { at: new Date(), byUserId: actor.userId, reason: body.reason },
        tx,
      );

      const revoked = (await this.authzRepo.findGrantById(grant.id, tx)) ?? grant;
      await this.audit.record(
        grantEvent('grant.revoked', revoked, actor, null, {
          subjectUserId: revoked.subjectUserId,
          templateKey: revoked.templateKey,
          scopeType: revoked.scopeType,
          actionsCount: revoked.actions.length,
          reason: body.reason,
          revokedDescendants: children.length,
        }),
        { tx },
      );
      for (const childId of children) {
        await this.audit.record(
          {
            action: 'grant.delegation_revoked',
            actorUserId: actor.userId,
            actorKind: 'USER',
            orgId: null,
            recordType: 'grant',
            recordId: childId,
            result: 'ALLOWED',
            details: { reason: 'parent_revoked', rootGrantId: grant.id },
          },
          { tx },
        );
      }
      return revoked;
    });

    await this.invalidatePlatformSubject(root.subjectUserId);
    // The delegatees of the revoked tree (their entries cache it as ancestors).
    await this.principalLoader.invalidateDelegatees([root.id]);
    return toGrantResponse(root);
  }

  /**
   * A platform grant applies in every context: drop the subject's cached
   * grants for the platform, their membership organizations and their
   * assigned CLIENT organizations.
   */
  private async invalidatePlatformSubject(userId: string): Promise<void> {
    const [subject, assignments] = await Promise.all([
      this.principalLoader.load(userId),
      this.principalLoader.loadAssignments(userId),
    ]);
    const orgIds = new Set<string>([
      'platform',
      ...(subject?.memberships ?? []).map((ms) => ms.orgId),
      ...assignments.filter((a) => a.kind === 'CLIENT').map((a) => a.targetId),
    ]);
    await this.principalLoader.invalidateUser(userId, [...orgIds]);
  }

  /**
   * Effective access of a user in each ACTIVE membership organization plus
   * the platform context (`orgId: null`). Confidential actions are dropped
   * as in the preview (AUDIT-R-02).
   */
  async userAccess(userId: string): Promise<UserAccessResponse> {
    const loaded = await this.principalLoader.load(userId);
    if (!loaded) throw new ApiHttpException({ status: 404, code: 'not_found', message: 'User not found' });

    const orgIds = loaded.memberships.filter((ms) => ms.status === 'ACTIVE').map((ms) => ms.orgId);
    const contexts: UserAccessContext[] = [];
    for (const orgId of orgIds) {
      contexts.push(await this.evaluateAccess(loaded, orgId));
    }
    contexts.push(await this.evaluateAccess(loaded, null));
    return { userId, suspended: loaded.isSuspended, contexts };
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

      // A new window could revive an expired owner grant next to the current owner.
      if (grant.templateKey === OWNER_TEMPLATE_KEY && (patch.validFrom || patch.validUntil)) {
        const others = await this.authzRepo.findActiveOwnerGrants(orgId, new Date(), tx);
        const other = others.find((g) => g.id !== grant.id);
        if (other) throw ownerExists(other.subjectUserId);
      }

      if (patch.conditions) {
        const template = grant.templateKey ? findActiveTemplate(grant.templateKey) : null;
        if (template) {
          const missing = missingConditionTypes(template.requiredConditionTypes, patch.conditions);
          if (missing.length > 0) throw missingConditions(missing);
        }
        if (grant.parentGrantId) {
          await this.assertWithinParent(grant, patch.conditions, tx);
        }
        // AUTHZ-R-37: the engine checks ancestors only for revocation and
        // validity at runtime, so the parent's new conditions must still
        // contain every active child; otherwise nothing is written.
        await this.assertChildrenWithinPatched({ ...grant, conditions: patch.conditions }, tx);
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
        { tx },
      );
      return row;
    });

    await this.principalLoader.invalidateUser(updated.subjectUserId, [orgId]);
    // Delegatees cache this grant as an ancestor of theirs (PrincipalLoader).
    await this.principalLoader.invalidateDelegatees([updated.id]);
    return toGrantResponse(updated);
  }

  // ── Revoke ────────────────────────────────────────────────────────────

  async revoke(
    orgId: string,
    grantId: string,
    body: GrantRevokeRequest,
    actor: Principal,
  ): Promise<GrantResponse> {
    const root = await this.db.withOrgScope(orgId, async (tx) => {
      const grant = await this.findActiveOrgGrant(grantId, orgId, tx);
      const { children } = await this.authzRepo.revokeGrantTree(
        [grant.id],
        { at: new Date(), byUserId: actor.userId, reason: body.reason },
        tx,
      );

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
        { tx },
      );
      for (const childId of children) {
        await this.audit.record(
          {
            action: 'grant.delegation_revoked',
            actorUserId: actor.userId,
            actorKind: 'USER',
            orgId,
            recordType: 'grant',
            recordId: childId,
            result: 'ALLOWED',
            details: { reason: 'parent_revoked', rootGrantId: grant.id },
          },
          { tx },
        );
      }
      return revoked;
    });

    await this.principalLoader.invalidateUser(root.subjectUserId, [orgId]);
    // The delegatees of the revoked tree (their entries cache it as ancestors).
    await this.principalLoader.invalidateDelegatees([root.id]);
    return toGrantResponse(root);
  }

  // ── Ownership transfer (owner model, 2026-10-24) ─────────────────────

  /**
   * Hand the organization's `employer_owner` grant to another ACTIVE member.
   *
   * Organization route: the caller must hold the current, started owner
   * grant (403 `forbidden` otherwise). Staff route (`byStaff`): no owner
   * requirement; an organization without an owner simply gets one.
   *
   * One org-scoped transaction revokes every active owner grant (reason
   * `ownership_transferred`), creates the new owner's grant from the
   * template and re-parents the old grant's active delegations to it (same
   * template and actions, so the bounds still hold). Audits `grant.revoked`
   * and `grant.created` with `details.transfer = true` (`byStaff = true` on
   * the staff route) and `grant.adjusted` (`reparented`) per moved child.
   */
  async transferOwnership(
    orgId: string,
    body: OwnershipTransferRequest,
    actor: Principal,
    options: { byStaff?: boolean } = {},
  ): Promise<OwnershipTransferResponse> {
    const byStaff = options.byStaff === true;
    const template = findActiveTemplate(OWNER_TEMPLATE_KEY);
    if (!template) {
      throw new ApiHttpException({ status: 400, code: 'template_inactive', message: 'Template is unknown or inactive' });
    }
    const now = new Date();
    const staffDetail = byStaff ? { byStaff: true } : {};

    const result = await this.db.withOrgScope(orgId, async (tx) => {
      const owners = await this.authzRepo.findActiveOwnerGrants(orgId, now, tx);
      const callerGrant = owners.find((g) => g.subjectUserId === actor.userId && hasStarted(g, now));
      if (!byStaff && !callerGrant) {
        throw new ApiHttpException({
          status: 403,
          code: 'forbidden',
          message: 'Only the current owner can transfer ownership',
        });
      }
      if (owners.some((g) => g.subjectUserId === body.newOwnerUserId)) {
        throw new ApiHttpException({
          status: 409,
          code: 'conflict',
          message: 'The user is already the owner of this organization',
        });
      }
      const membership = await this.authzRepo.findActiveMembership(body.newOwnerUserId, orgId, tx);
      if (!membership) {
        throw new ApiHttpException({
          status: 409,
          code: 'subject_not_member',
          message: 'The new owner has no active membership in this organization',
        });
      }

      // The caller's grant first, so it is the one reported as revoked.
      const previous = callerGrant ? [callerGrant, ...owners.filter((g) => g !== callerGrant)] : owners;
      const revokedIds = await this.revokeOwnerGrants(previous, actor, orgId, now, body.newOwnerUserId, staffDetail, tx);
      const previousOwner = previous[0] ?? null;

      const created = await this.authzRepo.createGrant(
        {
          subjectUserId: body.newOwnerUserId,
          templateKey: template.key,
          actions: [...template.actions],
          scopeType: 'organization',
          scopeOrgId: orgId,
          scopeOrgUnitId: null,
          includeDescendants: false,
          conditions: [],
          validFrom: now,
          validUntil: null,
          parentGrantId: null,
          grantedByUserId: actor.userId,
        },
        tx,
      );
      await this.audit.record(
        grantEvent('grant.created', created, actor, orgId, {
          subjectUserId: created.subjectUserId,
          templateKey: template.key,
          scopeType: 'organization',
          actionsCount: created.actions.length,
          conditionTypes: [],
          transfer: true,
          previousOwnerUserId: previousOwner?.subjectUserId ?? null,
          ...staffDetail,
        }),
        { tx },
      );
      const revokedPrevious = previous.filter((g) => revokedIds.includes(g.id));
      const reparented: GrantRow[] = [];
      for (const old of revokedPrevious) {
        const children = await this.authzRepo.reparentActiveChildren(old.id, created.id, tx);
        for (const child of children) {
          await this.audit.record(
            grantEvent('grant.adjusted', child, actor, orgId, {
              subjectUserId: child.subjectUserId,
              reparented: true,
              fromGrantId: old.id,
              ...staffDetail,
            }),
            { tx },
          );
        }
        reparented.push(...children);
      }
      return { previous: revokedPrevious, created, reparented };
    });

    const subjects = new Set([
      ...result.previous.map((g) => g.subjectUserId),
      result.created.subjectUserId,
      ...result.reparented.map((g) => g.subjectUserId),
    ]);
    for (const userId of subjects) {
      await this.principalLoader.invalidateUser(userId, [orgId]);
    }
    if (result.previous.length > 0) {
      // Delegatees cached the old owner grant as an ancestor of theirs; after
      // re-parenting they hang below the new grant.
      await this.principalLoader.invalidateDelegatees(result.previous.map((g) => g.id));
      await this.principalLoader.invalidateDelegatees([result.created.id]);
    }
    return {
      revokedGrantId: result.previous[0]?.id ?? null,
      createdGrant: toGrantResponse(result.created),
    };
  }

  /** Revoke owner grants (not their delegations) and audit each; returns the revoked ids. */
  private async revokeOwnerGrants(
    owners: readonly GrantRow[],
    actor: Principal,
    orgId: string,
    now: Date,
    newOwnerUserId: string,
    staffDetail: Record<string, unknown>,
    tx: DbExecutor,
  ): Promise<string[]> {
    if (owners.length === 0) return [];
    const revokedIds = await this.authzRepo.revokeGrants(
      owners.map((g) => g.id),
      { at: now, byUserId: actor.userId, reason: OWNERSHIP_TRANSFERRED_REASON },
      tx,
    );
    for (const owner of owners.filter((g) => revokedIds.includes(g.id))) {
      await this.audit.record(
        grantEvent('grant.revoked', owner, actor, orgId, {
          subjectUserId: owner.subjectUserId,
          templateKey: owner.templateKey,
          scopeType: owner.scopeType,
          actionsCount: owner.actions.length,
          reason: OWNERSHIP_TRANSFERRED_REASON,
          revokedDescendants: 0,
          transfer: true,
          newOwnerUserId,
          ...staffDetail,
        }),
        { tx },
      );
    }
    return revokedIds;
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
      // The parent grant always bounds the delegation; an envelope only adds
      // restrictions (checked by the engine below) [API-R-23, AUTHZ-R-37].
      const bound = checkDelegationBounds(parent, proposed, childAncestorIds);
      if (bound) throw exceedsBoundary(bound);

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
        delegatorGrants,
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
        { tx },
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

    const access = await this.evaluateAccess(loaded, orgId);
    return { userId, orgId, actions: access.actions, grantIds: access.grantIds, assignmentIds: access.assignmentIds };
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  /**
   * Run `effectiveAccess` for the subject in one organization, or in the
   * platform context when `orgId` is null. The subject's principal never
   * satisfies step-up (old snapshot, no second factor); confidential-domain
   * actions are dropped (AUDIT-R-02).
   */
  private async evaluateAccess(loaded: LoadedPrincipal, orgId: string | null): Promise<UserAccessContext> {
    const context: ActiveContext = orgId ? { kind: 'organization', orgId } : { kind: 'operations' };
    const principal: Principal = {
      userId: loaded.userId,
      displayName: loaded.displayName,
      initials: loaded.initials,
      locale: loaded.locale,
      memberships: loaded.memberships,
      staffTemplates: loaded.staffTemplates,
      expert: loaded.expert,
      context,
      auth: { method: 'sso', time: new Date(0).toISOString(), secondFactor: false, lastStepUpAt: null },
      sessionId: null,
      tokenFamily: null,
    };
    const resource = orgId ? { type: 'grant_preview', orgId } : { type: 'grant_preview' };
    const ctx = await this.contextLoader.build(principal, resource, { loadedPrincipal: loaded });

    const confidential = new Set<string>(CONFIDENTIAL_ACTIONS);
    const entries = effectiveAccess(principal, ctx).filter((e) => !confidential.has(e.action));
    return {
      orgId,
      actions: [...new Set(entries.map((e) => e.action))],
      grantIds: [...new Set(entries.map((e) => e.grantId))],
      assignmentIds: ctx.assignments.map((a) => a.id),
    };
  }

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
    const ancestorIds = grant.scopeOrgUnitId ? await this.authzRepo.findAncestorIds(grant.scopeOrgUnitId, tx) : [];
    const bound = checkDelegationBounds(parent, { ...toGrantInput(grant), conditions }, ancestorIds);
    if (bound) throw exceedsBoundary(bound);
  }

  /**
   * Refuse with 409 `conflict` when a direct active child of `patched` would
   * fall outside its bounds (`details.children` lists them). Deeper
   * descendants are bounded by their own parents, which do not change.
   */
  private async assertChildrenWithinPatched(patched: GrantRow, tx: DbExecutor): Promise<void> {
    const children = await this.authzRepo.findActiveChildGrants([patched.id], tx);
    if (children.length === 0) return;
    const parent = toGrantInput(patched);
    const offending: string[] = [];
    for (const child of children) {
      const ancestorIds = child.scopeOrgUnitId ? await this.authzRepo.findAncestorIds(child.scopeOrgUnitId, tx) : [];
      if (checkDelegationBounds(parent, toGrantInput(child), ancestorIds)) offending.push(child.id);
    }
    if (offending.length > 0) {
      throw new ApiHttpException({
        status: 409,
        code: 'conflict',
        message: 'Delegated grants would exceed the adjusted grant',
        details: { children: offending },
      });
    }
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
  orgId: string | null,
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
