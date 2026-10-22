/**
 * ContextLoader -- builds an AuthorizationContext from Principal + Resource.
 *
 * @see 4.6.1, T-1.6
 */
import { Inject, Injectable, forwardRef } from '@nestjs/common';
 
import {
  PrincipalLoader,
  type LoadedPrincipal,
} from '../principal/principal-loader.js';
 
import { AuthorizationRepository } from '../db/repositories/authorization.repository.js';
import type {
  Principal,
  Resource,
  AuthorizationContext,
  EmergencyAccessInput,
} from '@nestself/contracts';
import { CONFIDENTIAL_ACTIONS } from '@nestself/contracts';

@Injectable()
export class ContextLoader {
  constructor(
    @Inject(forwardRef(() => PrincipalLoader)) private readonly principalLoader: PrincipalLoader,
    @Inject(forwardRef(() => AuthorizationRepository)) private readonly authzRepo: AuthorizationRepository,
  ) {}

  /**
   * Build the full AuthorizationContext for an authorize() call.
   */
  async build(
    principal: Principal,
    resource: Resource,
    opts?: { action?: string; loadedPrincipal?: LoadedPrincipal },
  ): Promise<AuthorizationContext> {
    const now = new Date();
    const loaded =
      opts?.loadedPrincipal ??
      (await this.principalLoader.load(principal.userId));

    const orgId = resource.orgId ?? 'platform';
    const grants = await this.principalLoader.loadGrants(
      principal.userId,
      orgId,
    );
    const assignments = await this.principalLoader.loadAssignments(
      principal.userId,
    );

    // Load ancestor ids from org tree
    let ancestorIds: string[] = [];
    let orgSelfApprovalAllowed = false;
    let organizationTimezone = 'UTC';

    if (resource.orgId) {
      const tree = await this.principalLoader.loadOrgTree(resource.orgId);
      if (tree) {
        // If resource has orgUnitId, get its ancestors (ancestor-or-self)
        if (resource.orgUnitId) {
          ancestorIds = await this.authzRepo.findAncestorIds(resource.orgUnitId);
        }
        orgSelfApprovalAllowed = tree.selfApprovalAllowed;
        organizationTimezone = tree.timezone;
      }
    }

    // Emergency access: load from DB only for confidential actions (never cached, AUTHZ-R-46)
    let emergencyAccess: EmergencyAccessInput[] | undefined;
    if (
      opts?.action &&
      CONFIDENTIAL_ACTIONS.includes(
        opts.action as (typeof CONFIDENTIAL_ACTIONS)[number],
      )
    ) {
      const rows = await this.authzRepo.findActiveEmergencyAccess(principal.userId, now);
      emergencyAccess = rows.map((r) => ({
        id: r.id,
        userId: r.userId,
        scopeKind: r.scopeKind as EmergencyAccessInput['scopeKind'],
        scopeId: r.scopeId,
        grantedAt: r.grantedAt,
        expiresAt: r.expiresAt,
        revokedAt: r.revokedAt,
      }));
    }

    return {
      now,
      isDeactivated: loaded?.isDeactivated ?? false,
      isSuspended: loaded?.isSuspended ?? false,
      grants,
      assignments,
      ancestorIds,
      orgSelfApprovalAllowed,
      organizationTimezone,
      emergencyAccess,
    };
  }
}
