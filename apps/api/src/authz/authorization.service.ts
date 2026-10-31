/**
 * AuthorizationService -- service-layer authorization checks.
 *
 * @see 4.6.1, T-1.6
 */
import { Inject, Injectable } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ContextLoader } from './context-loader.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { AuditWriter } from '../audit/audit-writer.js';
import { authorize } from './authorize.js';
import { denialCode } from './context.js';
import { effectiveActions } from './effective-access.js';
import { ApiHttpException } from '../common/api-error.js';
import { KEY_VALUE_STORE, type KeyValueStore } from '../redis/key-value-store.js';
import { assertStepUpFresh } from './step-up-freshness.js';
import type {
  Principal,
  Action,
  Resource,
} from '@nestself/contracts';

@Injectable()
export class AuthorizationService {
  constructor(
    private readonly contextLoader: ContextLoader,
    private readonly audit: AuditWriter,
    @Inject(KEY_VALUE_STORE) private readonly store: KeyValueStore,
  ) {}

  /**
   * Check authorization and throw on denial; once allowed, enforce the
   * action's step-up freshness (403 `step_up_required`).
   * Service-layer equivalent of the AuthorizationGuard.
   *
   * A denial is audited, then answered 404 `not_found` when the caller has no
   * visibility of the resource's organisation (AUTHZ-R-61) and 403 `forbidden`
   * otherwise. `denyAs: 'not_found'` answers every denial as that same 404.
   * Reads of confidential records pass it: the row is loaded before the
   * decision, so "it exists and you may not read it" would tell the caller that
   * a record exists. The audit row is the same either way (it is for staff;
   * the answer is for the caller). A stale step-up is not a denial: it stays
   * 403 `step_up_required`.
   */
  async require(
    principal: Principal,
    action: Action,
    resource: Resource,
    opts: { denyAs?: 'not_found' } = {},
  ): Promise<void> {
    const ctx = await this.contextLoader.build(principal, resource, { action });
    const decision = authorize(principal, action, resource, ctx);

    if (!decision.allowed) {
      // Context expiry mapping via shared denialCode helper (I2).
      const code = denialCode(principal, decision.denialReason ?? 'forbidden');

      if (code === 'invalid_context' || code === 'org_context_expired') {
        await this.audit.record({
          action: 'access.denied',
          actorUserId: principal.userId,
          actorKind: 'USER',
          orgId: resource.orgId ?? null,
          recordType: resource.type,
          recordId: resource.id ?? 'unknown',
          result: 'DENIED',
          details: {
            actionAttempted: action,
            resourceType: resource.type,
            resourceId: resource.id,
            reason: code,
          },
        });

        throw new ApiHttpException({
          status: 403,
          code,
          message: 'Access denied',
        });
      }

      // Non-context denials: audit the original engine reason (matches guard).
      await this.audit.record({
        action: 'access.denied',
        actorUserId: principal.userId,
        actorKind: 'USER',
        orgId: resource.orgId ?? null,
        recordType: resource.type,
        recordId: resource.id ?? 'unknown',
        result: 'DENIED',
        details: {
          actionAttempted: action,
          resourceType: resource.type,
          resourceId: resource.id,
          reason: decision.denialReason,
        },
      });

      if (opts.denyAs === 'not_found' || !this.hasOrgVisibility(principal, resource)) {
        throw new ApiHttpException({
          status: 404,
          code: 'not_found',
          message: 'Resource not found',
        });
      }

      throw new ApiHttpException({
        status: 403,
        code: 'forbidden',
        message: 'Access denied',
      });
    }

    await assertStepUpFresh(principal, action, this.store);
  }

  /**
   * Non-auditing authorization check: returns a boolean without writing
   * an audit row. Used for probing authorization in resolvers (e.g.
   * discipline ruling) where a probe failure is not a final denial.
   */
  async evaluateQuiet(
    principal: Principal,
    action: Action,
    resource: Resource,
  ): Promise<boolean> {
    const ctx = await this.contextLoader.build(principal, resource, { action });
    const decision = authorize(principal, action, resource, ctx);
    return decision.allowed;
  }

  /**
   * Pure decision for list filtering: true when `authorize()` allows the
   * action on the resource. Unlike `require()` it neither audits a denial nor
   * enforces step-up freshness, so it must only gate metadata (list rows),
   * never the content a single-record read returns.
   */
  async allows(principal: Principal, action: Action, resource: Resource): Promise<boolean> {
    const ctx = await this.contextLoader.build(principal, resource, { action });
    return authorize(principal, action, resource, ctx).allowed;
  }

  /**
   * Compute the effective actions for a principal's current context.
   * Used by GET /auth/me.
   */
  async effectiveActions(principal: Principal): Promise<string[]> {
    // C1: personal context with orgId (C-22) scopes to that org,
    // same as organization context.  Bare personal / expert / ops → platform.
    const orgId =
      'orgId' in principal.context && principal.context.orgId
        ? principal.context.orgId
        : 'platform';
    const ctx = await this.contextLoader.build(principal, {
      type: 'me',
      orgId,
    });
    return effectiveActions(principal, ctx);
  }

  /** Check whether the principal has any visibility into the resource's org. */
  private hasOrgVisibility(principal: Principal, resource: Resource): boolean {
    if (!resource.orgId) return true;
    const hasMembership = principal.memberships.some(
      (m) => m.orgId === resource.orgId && m.status === 'ACTIVE',
    );
    if (hasMembership) return true;
    if (principal.staffTemplates.length > 0) return true;
    return false;
  }
}
