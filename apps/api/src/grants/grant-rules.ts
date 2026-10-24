/**
 * Grant administration rules (T-2.1): template lookup, the scope types the
 * organization endpoints accept, required condition types, the parent-grant
 * bound for delegation (AUTHZ-R-37) and the API errors these rules raise.
 *
 * The bound applies when the parent grant carries no `delegationEnvelope`:
 * the parent grant itself is then the envelope. `validateDelegation` (the
 * engine check) still runs after these rules.
 */
import { ApiHttpException } from '../common/api-error.js';
import {
  PERMISSION_TEMPLATES,
  type GrantCondition,
  type GrantInput,
  type PermissionTemplateDefinition,
  type ScopeType,
} from '@nestself/contracts';

/** Scope types the `/orgs/:orgId/grants` endpoints accept. */
export const ORG_GRANT_SCOPE_TYPES = ['organization', 'org_unit'] as const;
export type OrgGrantScopeType = (typeof ORG_GRANT_SCOPE_TYPES)[number];

/** Maximum delegation chain depth (root = 0). [AUTHZ-R-38] */
export const MAX_DELEGATION_DEPTH = 3;

/** Why a delegation exceeds its parent grant; carried in `details.reason`. */
export type DelegationBoundReason =
  | 'actions_exceed_parent'
  | 'scope_exceeds_parent'
  | 'spending_ceiling_exceeds_parent'
  | 'categories_exceed_parent';

/** The active template with that key, or null when unknown or inactive. */
export function findActiveTemplate(
  key: string,
  templates: readonly PermissionTemplateDefinition[] = PERMISSION_TEMPLATES,
): PermissionTemplateDefinition | null {
  const template = templates.find((t) => t.key === key);
  return template?.isActive ? template : null;
}

export function isOrgScopeType(scopeType: ScopeType): scopeType is OrgGrantScopeType {
  return (ORG_GRANT_SCOPE_TYPES as readonly string[]).includes(scopeType);
}

/** Required condition types absent from `conditions`, in template order. */
export function missingConditionTypes(
  required: readonly GrantCondition['type'][],
  conditions: readonly GrantCondition[],
): GrantCondition['type'][] {
  const present = new Set(conditions.map((c) => c.type));
  return required.filter((type) => !present.has(type));
}

/**
 * Check a proposed delegated grant against its parent grant.
 *
 * `childAncestorIds` are the ancestor-or-self ids of the proposed grant's
 * org unit (empty for organization scope). Returns the violated rule or
 * null when the proposal stays within the parent.
 */
export function checkDelegationBounds(
  parent: GrantInput,
  proposed: GrantInput,
  childAncestorIds: readonly string[],
): DelegationBoundReason | null {
  if (proposed.actions.some((a) => !parent.actions.includes(a))) {
    return 'actions_exceed_parent';
  }
  if (!scopeWithinParent(parent, proposed, childAncestorIds)) {
    return 'scope_exceeds_parent';
  }
  if (!ceilingsWithinParent(parent.conditions, proposed.conditions)) {
    return 'spending_ceiling_exceeds_parent';
  }
  if (!categoriesWithinParent(parent.conditions, proposed.conditions)) {
    return 'categories_exceed_parent';
  }
  return null;
}

function scopeWithinParent(
  parent: GrantInput,
  proposed: GrantInput,
  childAncestorIds: readonly string[],
): boolean {
  if (parent.scopeType === 'organization') {
    // Any org unit of the organization; the caller has checked the unit
    // belongs to the organization.
    return proposed.scopeType === 'organization' || proposed.scopeType === 'org_unit';
  }
  if (parent.scopeType !== 'org_unit' || parent.scopeOrgUnitId == null) return false;
  if (proposed.scopeType !== 'org_unit' || proposed.scopeOrgUnitId == null) return false;

  if (!parent.includeDescendants) {
    return proposed.scopeOrgUnitId === parent.scopeOrgUnitId && !proposed.includeDescendants;
  }
  return (
    proposed.scopeOrgUnitId === parent.scopeOrgUnitId ||
    childAncestorIds.includes(parent.scopeOrgUnitId)
  );
}

type Ceiling = Extract<GrantCondition, { type: 'spending_ceiling' }>;
type Categories = Extract<GrantCondition, { type: 'categories' }>;

/** Every parent ceiling needs a child ceiling in the same currency that is not higher. */
function ceilingsWithinParent(
  parentConditions: readonly GrantCondition[],
  childConditions: readonly GrantCondition[],
): boolean {
  const parentCeilings = parentConditions.filter((c): c is Ceiling => c.type === 'spending_ceiling');
  const childCeilings = childConditions.filter((c): c is Ceiling => c.type === 'spending_ceiling');
  return parentCeilings.every((p) =>
    childCeilings.some((c) => c.currency === p.currency && c.amountMinor <= p.amountMinor),
  );
}

/** When the parent limits categories, the child must limit them to a subset. */
function categoriesWithinParent(
  parentConditions: readonly GrantCondition[],
  childConditions: readonly GrantCondition[],
): boolean {
  const parentCategories = parentConditions.filter((c): c is Categories => c.type === 'categories');
  if (parentCategories.length === 0) return true;
  const allowed = new Set(parentCategories.flatMap((c) => c.allowed));
  const childCategories = childConditions.filter((c): c is Categories => c.type === 'categories');
  return (
    childCategories.length > 0 &&
    childCategories.every((c) => c.allowed.every((category) => allowed.has(category)))
  );
}

// ── Validation errors ───────────────────────────────────────────────────

export function validation(message: string): ApiHttpException {
  return new ApiHttpException({ status: 400, code: 'validation', message });
}

export function missingConditions(missing: GrantCondition['type'][]): ApiHttpException {
  return new ApiHttpException({
    status: 400,
    code: 'missing_conditions',
    message: 'The template requires further conditions',
    details: { missing },
  });
}

export function exceedsBoundary(reason: string): ApiHttpException {
  return new ApiHttpException({
    status: 403,
    code: 'delegation_exceeds_boundary',
    message: 'The delegation exceeds the delegator boundary',
    details: { reason },
  });
}

export function assertOrgScopeType(scopeType: ScopeType): OrgGrantScopeType {
  if (!isOrgScopeType(scopeType)) throw validation('scopeType must be organization or org_unit');
  return scopeType;
}

export function assertWindow(validFrom: Date, validUntil: Date | null): void {
  if (validUntil && validUntil <= validFrom) throw validation('validUntil must be after validFrom');
}

/** Cached grants overlaid with DB rows of the same id. */
export function mergeGrants(cached: readonly GrantInput[], fromDb: readonly GrantInput[]): GrantInput[] {
  const byId = new Map(cached.map((g) => [g.id, g]));
  for (const g of fromDb) byId.set(g.id, g);
  return [...byId.values()];
}
