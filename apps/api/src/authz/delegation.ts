/**
 * Delegation envelope validation.
 *
 * Validates that a delegated grant does not exceed its parent's
 * delegation envelope and that the delegation depth limit is respected.
 * Also walks the entire parent chain to verify no ancestor is missing,
 * revoked or outside its validity window.
 *
 * @see Section 4.5.6 of auth-strategy.md
 * Satisfies AUTHZ-R-37, AUTHZ-R-38.
 */
import type {
  GrantInput,
  AuthorizationContext,
} from '@nestself/contracts';

/** Maximum permitted delegation chain depth. [AUTHZ-R-38] */
const MAX_DELEGATION_DEPTH = 3;

/**
 * Validate delegation constraints for a grant.
 *
 * Returns `{ valid: true, reason: null }` when the grant is not delegated
 * or the delegation is within bounds. Returns `{ valid: false, reason }`
 * when a delegation constraint is violated.
 *
 * Satisfies AUTHZ-R-37, AUTHZ-R-38, AUTHZ-R-13.
 */
export function validateDelegation(
  grant: GrantInput,
  ctx: AuthorizationContext,
): { valid: boolean; reason: string | null } {
  // Non-delegated grants need no validation.
  if (grant.parentGrantId == null) {
    return { valid: true, reason: null };
  }

  // --- Depth check ---
  const depth = computeDelegationDepth(grant, ctx.grants);
  if (depth > MAX_DELEGATION_DEPTH) {
    return { valid: false, reason: 'delegation_depth_exceeded' };
  }

  // --- Ancestor health check ---
  // Walk the full parent chain: every ancestor must be present in
  // ctx.grants, not revoked, and within its validity window at ctx.now.
  const ancestorResult = validateAncestorChain(grant, ctx);
  if (!ancestorResult.valid) {
    return ancestorResult;
  }

  // --- Envelope check ---
  const parent = ctx.grants.find((g) => g.id === grant.parentGrantId);
  // Parent guaranteed to exist after ancestor check, but guard anyway.
  if (parent == null) {
    return { valid: false, reason: 'delegation_parent_revoked' };
  }

  if (parent.delegationEnvelope != null) {
    const envelope = parent.delegationEnvelope;

    // Actions subset
    if (envelope.actions != null) {
      const exceeds = grant.actions.some(
        (a) => !envelope.actions!.includes(a),
      );
      if (exceeds) {
        return { valid: false, reason: 'delegation_exceeds_envelope' };
      }
    }

    // Scope type
    if (
      envelope.scopeType != null &&
      grant.scopeType !== envelope.scopeType
    ) {
      return { valid: false, reason: 'delegation_exceeds_envelope' };
    }

    // Scope org unit
    if (
      envelope.scopeOrgUnitId != null &&
      grant.scopeOrgUnitId !== envelope.scopeOrgUnitId
    ) {
      // The delegated scope must be within the envelope's scope.
      // We check whether the envelope's unit is in the ancestor set,
      // meaning the delegated unit is a descendant.
      if (!ctx.ancestorIds.includes(envelope.scopeOrgUnitId)) {
        return { valid: false, reason: 'delegation_exceeds_envelope' };
      }
    }

    // Include descendants
    if (
      envelope.includeDescendants === false &&
      grant.includeDescendants === true
    ) {
      return { valid: false, reason: 'delegation_exceeds_envelope' };
    }

    // Max depth from envelope
    if (envelope.maxDepth != null && depth > envelope.maxDepth) {
      return { valid: false, reason: 'delegation_depth_exceeded' };
    }
  }

  // --- Cross-organization check ---
  if (
    grant.scopeOrgId != null &&
    parent.scopeOrgId != null &&
    grant.scopeOrgId !== parent.scopeOrgId
  ) {
    return { valid: false, reason: 'delegation_exceeds_envelope' };
  }

  return { valid: true, reason: null };
}

/**
 * Count the delegation depth for a grant by tracing parentGrantId.
 */
function computeDelegationDepth(
  grant: GrantInput,
  grants: readonly GrantInput[],
): number {
  let depth = 0;
  let currentId: string | null = grant.parentGrantId;

  while (currentId != null && depth <= MAX_DELEGATION_DEPTH + 1) {
    depth++;
    const parent = grants.find((g) => g.id === currentId);
    currentId = parent?.parentGrantId ?? null;
  }

  return depth;
}

/**
 * Walk the entire parent chain (up to MAX_DELEGATION_DEPTH levels) and
 * verify each ancestor grant is present, not revoked, and within its
 * validity window.
 */
function validateAncestorChain(
  grant: GrantInput,
  ctx: AuthorizationContext,
): { valid: boolean; reason: string | null } {
  let currentId: string | null = grant.parentGrantId;
  let steps = 0;

  while (currentId != null && steps <= MAX_DELEGATION_DEPTH) {
    steps++;
    const ancestor = ctx.grants.find((g) => g.id === currentId);

    // Missing from context — treat as revoked
    if (ancestor == null) {
      return { valid: false, reason: 'delegation_parent_revoked' };
    }
    // Revoked ancestor
    if (ancestor.revokedAt != null) {
      return { valid: false, reason: 'delegation_parent_revoked' };
    }
    // Validity window: not yet started
    if (ancestor.validFrom != null && ancestor.validFrom > ctx.now) {
      return { valid: false, reason: 'delegation_parent_expired' };
    }
    // Validity window: already expired
    if (ancestor.validUntil != null && ancestor.validUntil <= ctx.now) {
      return { valid: false, reason: 'delegation_parent_expired' };
    }

    currentId = ancestor.parentGrantId;
  }

  return { valid: true, reason: null };
}
