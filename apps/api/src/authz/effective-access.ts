/**
 * Effective-access preview and effective-actions list.
 *
 * Pure functions that enumerate the actions and scopes a user can exercise
 * by running the same evaluator against synthetic resources for each scope
 * in the user's grants.
 *
 * "Effective" means "may hold somewhere": a grant's action counts when the
 * engine allows it at some resource inside the grant's scope. An
 * assignment-scoped grant (`assigned_cases`, `assigned_practice`,
 * `assigned_queues` and the others) without a fixed scope reference reaches
 * a resource only through an assignment, so it is evaluated at the target of
 * each of the principal's assignments, and the engine decides which
 * assignment kind the scope accepts and whether the assignment is current
 * (DEF-3). Per-resource decisions stay with `authorize()`.
 *
 * @see Section 4.5.10 of auth-strategy.md
 * Satisfies AUTHZ-R-42.
 */
import type {
  Action,
  AssignmentInput,
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
    // Delegation ancestors in ctx.grants belong to other users (see authorize()).
    if (grant.subjectUserId !== principal.userId) continue;
    if (grant.revokedAt != null) continue;
    if (grant.validFrom != null && grant.validFrom > ctx.now) continue;
    if (grant.validUntil != null && grant.validUntil <= ctx.now) continue;

    for (const action of actions) {
      if (!grant.actions.includes(action)) continue;

      const grantCtx = contextAt(grant, ctx);
      const allowedHere = candidateResources(grant, ctx).some((resource) => {
        const decision = authorize(principal, action as Action, resource, grantCtx);
        return decision.allowed && decision.grantIds.includes(grant.id);
      });

      if (allowedHere) {
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
    const isAllowed = candidates.some((grant) => {
      const grantCtx = contextAt(grant, ctx);
      return candidateResources(grant, ctx).some((resource) => authorize(principal, action, resource, grantCtx).allowed);
    });
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

// ---------------------------------------------------------------------------
// Assignment-scoped synthetic resources
// ---------------------------------------------------------------------------

/**
 * Map from assignment-scoped grant `scopeType` to the assignment kind and
 * the `Resource` field that the scope check needs populated.
 *
 * `assigned_cases` matches both CASE and SUPPORT_CASE assignments (see
 * `scope.ts:79-86`), so two kinds are listed.
 */
const ASSIGNMENT_SCOPE_MAP: ReadonlyMap<
  string,
  { kinds: readonly string[]; field: keyof Resource }
> = new Map([
  ['assigned_collections', { kinds: ['COLLECTION'], field: 'collectionId' }],
  ['assigned_clients', { kinds: ['CLIENT'], field: 'orgId' }],
  ['assigned_queues', { kinds: ['QUEUE'], field: 'queueId' }],
  ['assigned_cases', { kinds: ['CASE', 'SUPPORT_CASE'], field: 'id' }],
  ['assigned_practice', { kinds: ['PRACTICE_GROUP'], field: 'practiceGroupId' }],
]);

function isAssignmentCurrent(
  a: { startAt: Date; endAt: Date | null },
  now: Date,
): boolean {
  if (a.startAt > now) return false;
  if (a.endAt != null && a.endAt <= now) return false;
  return true;
}

/**
 * Yield the synthetic resources for a grant.
 *
 * For an assignment-scoped grant (`assigned_collections`, `assigned_clients`,
 * etc.) **without** a `scopeRefId`, the single `syntheticResource(grant)` has
 * no `collectionId` / `orgId` / etc., so `matchesScope` always fails. We fix
 * this by emitting one synthetic resource per current assignment of the
 * matching kind, each carrying the assignment's `targetId` in the field the
 * scope check inspects.
 *
 * Effective actions answer "may this user perform this action *somewhere* in
 * this context". Conditions that depend on resource attributes the synthetic
 * resource lacks (e.g. the `categories` condition, which passes when
 * `resource.category` is null) keep their current scope-only behaviour.
 */
function syntheticResources(
  grant: GrantInput,
  ctx: AuthorizationContext,
): Resource[] {
  const base = syntheticResource(grant);

  // When a scopeRefId is present the base resource already has the right
  // field set (the original path).
  if (grant.scopeRefId != null) return [base];

  const mapping = ASSIGNMENT_SCOPE_MAP.get(grant.scopeType);
  if (mapping == null) return [base];

  // Build one resource per matching, current assignment.
  const resources: Resource[] = [];
  for (const assignment of ctx.assignments) {
    if (!mapping.kinds.includes(assignment.kind)) continue;
    if (!isAssignmentCurrent(assignment, ctx.now)) continue;
    resources.push({ ...base, [mapping.field]: assignment.targetId });
  }

  // No matching assignments → the grant is genuinely ineffective.
  return resources;
}

/**
 * The synthetic resources a grant is evaluated at: its own scope, and, when
 * the grant names no fixed scope reference, the target of each of the
 * principal's assignments (DEF-3). Which assignment kind a scope accepts, and
 * whether the assignment is current, is the engine's decision
 * (`ASSIGNMENT_SCOPE_KINDS` and `matchesScope`); a target can only add the
 * field an assignment scope matches on, so it never widens any other scope.
 */
function candidateResources(grant: GrantInput, ctx: AuthorizationContext): Resource[] {
  const base = syntheticResource(grant);
  if (grant.scopeRefId != null) return [base];
  const resources = [base];
  for (const assignment of ctx.assignments) {
    const atTarget = withTarget(base, assignment.kind, assignment.targetId);
    if (atTarget) resources.push(atTarget);
  }
  return resources;
}

/**
 * The resource field through which the engine matches each assignment kind
 * (`matchesScope`, `findMatchingAssignment`): the one place this module maps
 * a kind to a field, for scope references and assignments alike. Null for a
 * kind no resource field carries (supervision, activities).
 */
function withTarget(base: Resource, kind: AssignmentInput['kind'], targetId: string): Resource | null {
  switch (kind) {
    case 'CASE':
    case 'SUPPORT_CASE':
      return { ...base, id: targetId };
    case 'QUEUE':
      return { ...base, queueId: targetId };
    case 'PRACTICE_GROUP':
      return { ...base, practiceGroupId: targetId };
    case 'COLLECTION':
      return { ...base, collectionId: targetId };
    case 'CLIENT':
      return { ...base, orgId: targetId };
    default:
      return null;
  }
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
  // A CLIENT reference never narrowed the synthetic resource; it still does not.
  if (grant.scopeRefId != null && grant.scopeRefKind != null && grant.scopeRefKind !== 'CLIENT') {
    return withTarget(resource, grant.scopeRefKind as AssignmentInput['kind'], grant.scopeRefId) ?? resource;
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
