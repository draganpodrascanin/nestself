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
  Workspace,
} from '@nestself/contracts';
import { ACTION_LIST, PERMISSION_TEMPLATES } from '@nestself/contracts';
import { authorize } from './authorize.js';

// ---------------------------------------------------------------------------
// Template-workspace lookup (used by context-scoped filtering)
// ---------------------------------------------------------------------------

const TEMPLATE_WORKSPACE = new Map<string, Workspace>(
  PERMISSION_TEMPLATES.map((t) => [t.key, t.workspace]),
);

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

// ---------------------------------------------------------------------------
// Context-scoped effective actions (Defect 2, T-C1.02)
// ---------------------------------------------------------------------------

/**
 * Return the effective actions filtered by the principal's active context
 * workspace:
 *
 * - **personal**: exclude grants whose template workspace is `'organization'`
 * - **organization**: include all grants (no workspace filter)
 * - **expert**: include only grants from `'expert'` workspace templates
 * - **operations**: include only grants from `'operations'` workspace templates
 *
 * One helper used by session-endpoints, identity-resolution and profile.
 */
export function contextScopedEffectiveActions(
  principal: Principal,
  ctx: AuthorizationContext,
): Action[] {
  const kind = principal.context.kind;
  let filteredGrants = ctx.grants;

  if (kind === 'personal') {
    filteredGrants = ctx.grants.filter((g) => {
      const ws = g.templateKey ? TEMPLATE_WORKSPACE.get(g.templateKey) : undefined;
      return ws !== 'organization';
    });
  } else if (kind === 'expert') {
    filteredGrants = ctx.grants.filter((g) => {
      const ws = g.templateKey ? TEMPLATE_WORKSPACE.get(g.templateKey) : undefined;
      return ws === 'expert';
    });
  } else if (kind === 'operations') {
    filteredGrants = ctx.grants.filter((g) => {
      const ws = g.templateKey ? TEMPLATE_WORKSPACE.get(g.templateKey) : undefined;
      return ws === 'operations';
    });
  }
  // organization: no filtering — all grants visible

  return effectiveActions(principal, { ...ctx, grants: filteredGrants });
}
