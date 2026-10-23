/**
 * AuthorizationService -- service-layer authorization checks.
 *
 * @see 4.6.1, T-1.6
 */
import { Injectable } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ContextLoader } from './context-loader.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { AuditWriter } from '../audit/audit-writer.js';
import { authorize } from './authorize.js';
import { effectiveActions } from './effective-access.js';
import { ApiHttpException } from '../common/api-error.js';
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
  ) {}

  /**
   * Check authorization and throw on denial.
   * Service-layer equivalent of the AuthorizationGuard.
   */
  async require(
    principal: Principal,
    action: Action,
    resource: Resource,
  ): Promise<void> {
    const ctx = await this.contextLoader.build(principal, resource, { action });
    const decision = authorize(principal, action, resource, ctx);

    if (!decision.allowed) {
      const hasVisibility = this.hasOrgVisibility(principal, resource);

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

      if (!hasVisibility) {
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
  }

  /**
   * Compute the effective actions for a principal's current context.
   * Used by GET /auth/me.
   */
  async effectiveActions(principal: Principal): Promise<string[]> {
    const orgId =
      principal.context.kind === 'organization'
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
