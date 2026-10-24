/**
 * Grant row mappers: API response and engine input.
 */
import {
  GrantConditionSchema,
  type GrantCondition,
  type GrantInput,
  type GrantResponse,
} from '@nestself/contracts';
import type { GrantRow } from '../db/repositories/authorization.repository.js';

/** Stored conditions parsed through `GrantConditionSchema`; null means none. */
export function parseConditions(raw: unknown[] | null): GrantCondition[] {
  return (raw ?? []).map((c) => GrantConditionSchema.parse(c));
}

export function toGrantResponse(row: GrantRow): GrantResponse {
  return {
    id: row.id,
    subjectUserId: row.subjectUserId,
    templateKey: row.templateKey,
    actions: [...row.actions],
    scopeType: row.scopeType as GrantResponse['scopeType'],
    scopeOrgId: row.scopeOrgId,
    scopeOrgUnitId: row.scopeOrgUnitId,
    includeDescendants: row.includeDescendants,
    conditions: parseConditions(row.conditions),
    validFrom: row.validFrom.toISOString(),
    validUntil: row.validUntil?.toISOString() ?? null,
    parentGrantId: row.parentGrantId,
    grantedByUserId: row.grantedByUserId,
    grantedAt: row.grantedAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}

/** The engine's view of a stored grant (same shape as `PrincipalLoader.loadGrants`). */
export function toGrantInput(row: GrantRow): GrantInput {
  return {
    id: row.id,
    subjectUserId: row.subjectUserId,
    templateKey: row.templateKey ?? '',
    actions: row.actions,
    scopeType: row.scopeType as GrantInput['scopeType'],
    scopeOrgId: row.scopeOrgId,
    scopeOrgUnitId: row.scopeOrgUnitId,
    includeDescendants: row.includeDescendants,
    scopeRefKind: row.scopeRefKind,
    scopeRefId: row.scopeRefId,
    conditions: parseConditions(row.conditions),
    validFrom: row.validFrom,
    validUntil: row.validUntil,
    delegationEnvelope: row.delegationEnvelope as GrantInput['delegationEnvelope'],
    parentGrantId: row.parentGrantId,
    revokedAt: row.revokedAt,
  };
}
