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
    // Delegation ancestors in ctx.grants belong to other users (see authorize()).
    if (grant.subjectUserId !== principal.userId) continue;
    if (grant.revokedAt != null) continue;
    if (grant.validFrom != null && grant.validFrom > ctx.now) continue;
    if (grant.validUntil != null && grant.validUntil <= ctx.now) continue;

    for (const action of actions) {
      if (!grant.actions.includes(action)) continue;

      const resource = syntheticResource(grant);
      const decision = authorize(principal, action as Action, resource, contextAt(grant, ctx));

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
    // Allowed when any current grant holding the action passes the engine at
    // a resource inside that grant's own scope.
    const candidates = ctx.grants.filter(
      (g) =>
        g.subjectUserId === principal.userId &&
        g.revokedAt == null &&
        g.actions.includes(action) &&
        (g.validFrom == null || g.validFrom <= ctx.now) &&
        (g.validUntil == null || g.validUntil > ctx.now),
    );
    const isAllowed = candidates.some(
      (grant) => authorize(principal, action, syntheticResource(grant), contextAt(grant, ctx)).allowed,
    );
    if (isAllowed) allowed.add(action);
  }

  return [...allowed];
}

/**
 * The context for a synthetic resource placed at the grant's own org unit:
 * that unit is its own ancestor (AUTHZ-R-09), so descendant-scoped grants
 * match. The runtime loader only fills `ancestorIds` for a real resource.
 */
function contextAt(grant: GrantInput, ctx: AuthorizationContext): AuthorizationContext {
  if (grant.scopeOrgUnitId == null || ctx.ancestorIds.includes(grant.scopeOrgUnitId)) return ctx;
  return { ...ctx, ancestorIds: [...ctx.ancestorIds, grant.scopeOrgUnitId] };
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
