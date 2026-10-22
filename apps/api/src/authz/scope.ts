/**
 * Scope resolution for the authorization engine.
 *
 * Determines whether a grant's scope covers the resource being accessed.
 * Uses the pre-loaded ancestor-id set from the OrgUnitClosure table.
 *
 * @see Section 4.5.4 of auth-strategy.md
 * Satisfies AUTHZ-R-34.
 */
import type {
  GrantInput,
  Resource,
  AuthorizationContext,
  Principal,
  ScopeType,
} from '@nestself/contracts';

/**
 * Scope types that cannot reach confidential resources.
 * A grant with any of these scope types is excluded from evaluation
 * when the resource is confidential.
 * [AUTHZ-R-33, CONF-R-05, D-20]
 */
export const ADMINISTRATIVE_SCOPE_TYPES: readonly ScopeType[] = [
  'platform',
  'organization',
  'org_unit',
  'assigned_clients',
  'assigned_queues',
  'assigned_practice',
  'assigned_collections',
] as const;

/**
 * Check whether a grant's scope covers the target resource.
 *
 * The function is pure and performs no I/O. All ancestor data must be
 * pre-loaded in `ctx.ancestorIds` before calling.
 *
 * Satisfies AUTHZ-R-34.
 */
export function matchesScope(
  grant: GrantInput,
  resource: Resource,
  principal: Principal,
  ctx: AuthorizationContext,
): boolean {
  switch (grant.scopeType) {
    case 'platform':
      return true;

    case 'organization':
      return resource.orgId != null && resource.orgId === grant.scopeOrgId;

    case 'org_unit':
      if (grant.includeDescendants) {
        // The resource's org unit is a descendant-or-self of the grant's scope unit
        // when the grant's scopeOrgUnitId appears in the resource's ancestor set.
        return (
          grant.scopeOrgUnitId != null &&
          ctx.ancestorIds.includes(grant.scopeOrgUnitId)
        );
      }
      return (
        resource.orgUnitId != null &&
        resource.orgUnitId === grant.scopeOrgUnitId
      );

    case 'assigned_clients':
      return ctx.assignments.some(
        (a) => a.kind === 'CLIENT' && a.targetId === resource.orgId,
      );

    case 'assigned_queues':
      return ctx.assignments.some(
        (a) => a.kind === 'QUEUE' && a.targetId === resource.queueId,
      );

    case 'assigned_cases':
      // SUPPORT_CASE assignments also resolve through assigned_cases scope
      // (support_operator template per 4.4 and 4.2 Entity rules).
      return ctx.assignments.some(
        (a) =>
          (a.kind === 'CASE' || a.kind === 'SUPPORT_CASE') &&
          a.targetId === resource.id,
      );

    case 'assigned_practice':
      return ctx.assignments.some(
        (a) =>
          a.kind === 'PRACTICE_GROUP' &&
          a.targetId === resource.practiceGroupId,
      );

    case 'assigned_collections':
      return ctx.assignments.some(
        (a) => a.kind === 'COLLECTION' && a.targetId === resource.collectionId,
      );

    case 'own':
      return resource.ownerId != null && resource.ownerId === principal.userId;

    default:
      return false;
  }
}
