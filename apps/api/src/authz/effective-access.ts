/**
 * Effective-access preview and effective-actions list.
 *
 * Pure functions that enumerate the actions and scopes a user can exercise
 * by running the same evaluator against synthetic resources for each scope
 * in the user's grants.
 *
 * @see Section 4.5.10 of auth-strategy.md
 * Satisfies AUTHZ-R-42.
 */
import type {
  Action,
  Principal,
  AuthorizationContext,
  EffectiveAccessEntry,
  Resource,
  GrantInput,
  GrantCondition,
} from '@nestself/contracts';
import { ACTION_LIST } from '@nestself/contracts';
import { authorize } from './authorize.js';

/**
 * Enumerate the effective access entries for a principal in the current
 * context. Runs `authorize()` for each action against synthetic resources
 * derived from the principal's grants.
 *
 * AUTHZ-R-42: uses the same evaluator as runtime checks.
 */
export function effectiveAccess(
  principal: Principal,
  ctx: AuthorizationContext,
  actions: readonly Action[] = ACTION_LIST,
): EffectiveAccessEntry[] {
  const entries: EffectiveAccessEntry[] = [];

  for (const grant of ctx.grants) {
    if (grant.revokedAt != null) continue;
    if (grant.validFrom != null && grant.validFrom > ctx.now) continue;
    if (grant.validUntil != null && grant.validUntil <= ctx.now) continue;

    for (const action of actions) {
      if (!grant.actions.includes(action)) continue;

      const resource = syntheticResource(grant);
      const decision = authorize(principal, action as Action, resource, ctx);

      if (decision.allowed && decision.grantIds.includes(grant.id)) {
        entries.push({
          action: action as Action,
          scopeType: grant.scopeType,
          scopeUnitName: null,
          conditions: grant.conditions as GrantCondition[],
          validFrom: grant.validFrom?.toISOString() ?? null,
          validUntil: grant.validUntil?.toISOString() ?? null,
          grantId: grant.id,
          isDelegated: grant.parentGrantId != null,
        });
      }
    }
  }

  return entries;
}

/**
 * Return the list of actions the principal can perform in the current
 * context, de-duplicated.
 *
 * AUTHZ-R-42: uses the same evaluator as runtime checks.
 */
export function effectiveActions(
  principal: Principal,
  ctx: AuthorizationContext,
): Action[] {
  const allowed = new Set<Action>();

  for (const action of ACTION_LIST) {
    // Build a minimal resource from the first grant that contains this action
    const grant = ctx.grants.find(
      (g) =>
        g.revokedAt == null &&
        g.actions.includes(action) &&
        (g.validFrom == null || g.validFrom <= ctx.now) &&
        (g.validUntil == null || g.validUntil > ctx.now),
    );
    if (grant == null) continue;

    const resource = syntheticResource(grant);
    const decision = authorize(principal, action, resource, ctx);
    if (decision.allowed) {
      allowed.add(action);
    }
  }

  return [...allowed];
}

/**
 * Build a minimal synthetic resource that matches the grant's scope
 * so `authorize()` can evaluate it. This is scope-only: no amount,
 * category or confidential flag.
 */
function syntheticResource(grant: GrantInput): Resource {
  const resource: Resource = { type: 'synthetic' };

  if (grant.scopeOrgId != null) {
    resource.orgId = grant.scopeOrgId;
  }
  if (grant.scopeOrgUnitId != null) {
    resource.orgUnitId = grant.scopeOrgUnitId;
  }
  if (grant.scopeType === 'own') {
    resource.ownerId = grant.subjectUserId;
  }
  if (grant.scopeRefId != null && grant.scopeRefKind != null) {
    switch (grant.scopeRefKind) {
      case 'CASE':
        resource.id = grant.scopeRefId;
        break;
      case 'QUEUE':
        resource.queueId = grant.scopeRefId;
        break;
      case 'PRACTICE_GROUP':
        resource.practiceGroupId = grant.scopeRefId;
        break;
      case 'COLLECTION':
        resource.collectionId = grant.scopeRefId;
        break;
    }
  }

  return resource;
}
