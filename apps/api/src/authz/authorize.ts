/**
 * The authorization decision engine.
 *
 * A hand-built, pure TypeScript function that evaluates grants,
 * assignments and conditions against a resolved principal.
 * It performs no I/O during evaluation — all data is pre-loaded.
 *
 * The single internal `evaluate()` function is shared by both
 * `authorize()` (no trace) and `explain()` (with trace) so the two
 * can never disagree (AUTHZ-R-42).
 *
 * @see Section 4.5 of auth-strategy.md
 * Satisfies AUTHZ-R-30, AUTHZ-R-31, AUTHZ-R-32, AUTHZ-R-33, AUTHZ-R-46.
 */
import type {
  Action,
  Principal,
  Resource,
  AuthorizationContext,
  Decision,
  GrantInput,
} from '@nestself/contracts';
import {
  CONFIDENTIAL_ACTIONS,
  APPROVAL_ACTIONS,
} from '@nestself/contracts';
import { isContextValid } from './context.js';
import { matchesScope, ADMINISTRATIVE_SCOPE_TYPES } from './scope.js';
import { evaluateConditions } from './conditions.js';
import { validateDelegation } from './delegation.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deny(reason: string, explanation: string[]): Decision {
  return {
    allowed: false,
    grantIds: [],
    assignmentIds: [],
    denialReason: reason,
    explanation,
  };
}

function allow(
  grantIds: string[],
  assignmentIds: string[],
  explanation: string[],
): Decision {
  return {
    allowed: true,
    grantIds,
    assignmentIds,
    denialReason: null,
    explanation,
  };
}

function isAssignmentCurrent(
  a: { startAt: Date; endAt: Date | null },
  now: Date,
): boolean {
  if (a.startAt > now) return false;
  if (a.endAt != null && a.endAt <= now) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Assignment-scoped grant resolution
// ---------------------------------------------------------------------------

/**
 * Scope types that require a matching assignment.
 */
const ASSIGNMENT_SCOPE_KINDS: ReadonlyMap<string, string> = new Map([
  ['assigned_clients', 'CLIENT'],
  ['assigned_queues', 'QUEUE'],
  ['assigned_cases', 'CASE'],
  ['assigned_practice', 'PRACTICE_GROUP'],
  ['assigned_collections', 'COLLECTION'],
]);

// ---------------------------------------------------------------------------
// evaluate() — the single source of truth
// ---------------------------------------------------------------------------

/**
 * Internal evaluator shared by `authorize()` and `explain()`.
 *
 * When `trace` is provided, human-readable step strings are pushed
 * onto it; when `undefined`, tracing is skipped (zero overhead).
 *
 * Satisfies AUTHZ-R-30, AUTHZ-R-31, AUTHZ-R-32, AUTHZ-R-33, AUTHZ-R-42, AUTHZ-R-46.
 */
export function evaluate(
  principal: Principal,
  action: Action,
  resource: Resource,
  ctx: AuthorizationContext,
  trace?: string[],
): Decision {
  // -----------------------------------------------------------------------
  // Step 1: User state
  // -----------------------------------------------------------------------
  if (ctx.isDeactivated) {
    trace?.push('Step 1: user is deactivated — denied');
    return deny('user_deactivated', trace ?? []);
  }
  if (ctx.isSuspended) {
    trace?.push('Step 1: user is suspended — denied');
    return deny('user_suspended', trace ?? []);
  }
  trace?.push('Step 1: user state is active');

  // -----------------------------------------------------------------------
  // Step 2: Context validity
  // -----------------------------------------------------------------------
  if (!isContextValid(principal, ctx)) {
    trace?.push('Step 2: context is invalid — denied');
    return deny('invalid_context', trace ?? []);
  }
  trace?.push(`Step 2: context ${principal.context.kind} is valid`);

  // -----------------------------------------------------------------------
  // Step 3: Confidential-domain hard deny
  // -----------------------------------------------------------------------
  const isConfidentialAction = (CONFIDENTIAL_ACTIONS as readonly string[]).includes(action);
  const isConfidentialResource = resource.isConfidential === true;

  if (isConfidentialResource && !isConfidentialAction) {
    trace?.push(`Step 3: action ${action} is not a confidential-domain action — denied`);
    return deny('confidential_domain_denied', trace ?? []);
  }

  // Step 3b: Emergency access validation
  if (action === 'records.read.emergency' && isConfidentialResource) {
    const emergencyRecords = ctx.emergencyAccess ?? [];
    const match = emergencyRecords.find(
      (ea) =>
        ea.revokedAt == null &&
        matchesEmergencyScope(ea, resource),
    );
    if (match == null) {
      trace?.push('Step 3b: no matching emergency access record — denied');
      return deny('no_emergency_access', trace ?? []);
    }
    if (match.expiresAt <= ctx.now) {
      trace?.push('Step 3b: emergency access has expired — denied');
      return deny('emergency_access_expired', trace ?? []);
    }
    trace?.push('Step 3b: emergency access is valid — allowed');
    return allow([], [], trace ?? []);
  }

  if (isConfidentialResource) {
    trace?.push(`Step 3: confidential resource, action ${action} is restricted — proceeding`);
  } else {
    trace?.push('Step 3: resource is not confidential — skipped');
  }

  // -----------------------------------------------------------------------
  // Step 4: Assignment check for restricted actions
  // -----------------------------------------------------------------------
  const collectedAssignmentIds: string[] = [];

  if (isConfidentialAction && isConfidentialResource) {
    // Restricted actions on confidential resources need assignment-based paths
    // conversation.participate uses 'own' scope — no assignment needed
    if (action === 'conversation.read.assigned' || action === 'notes.read.supervision') {
      const requiredKinds =
        action === 'notes.read.supervision'
          ? ['SUPERVISION']
          : ['CASE', 'SUPERVISION'];
      const matchingAssignment = ctx.assignments.find(
        (a) =>
          requiredKinds.includes(a.kind) &&
          a.targetId === resource.id &&
          isAssignmentCurrent(a, ctx.now),
      );
      if (matchingAssignment == null) {
        trace?.push(`Step 4: no matching assignment for restricted action ${action} — denied`);
        return deny('no_matching_assignment', trace ?? []);
      }
      collectedAssignmentIds.push(matchingAssignment.id);
      trace?.push(`Step 4: assignment ${matchingAssignment.id} matches for ${action}`);
    }
  }

  // -----------------------------------------------------------------------
  // Step 5: Grant matching
  // -----------------------------------------------------------------------
  const matchedGrantIds: string[] = [];
  let delegationFailureReason: string | null = null;

  for (const grant of ctx.grants) {
    // 5d. Revocation check
    if (grant.revokedAt != null) {
      trace?.push(`Step 5: grant ${grant.id} is revoked — skipped`);
      continue;
    }

    // 5c. Validity window
    if (grant.validFrom != null && grant.validFrom > ctx.now) {
      trace?.push(`Step 5c: grant ${grant.id} has not started — skipped`);
      continue;
    }
    if (grant.validUntil != null && grant.validUntil <= ctx.now) {
      trace?.push(`Step 5c: grant ${grant.id} has expired — skipped`);
      continue;
    }

    // 5a. Action match
    if (!grant.actions.includes(action)) continue;

    // For confidential resources, exclude grants with administrative scope.
    // Exception: assigned_practice is allowed for notes.read.supervision
    // (clinical supervision path per 4.7.3).
    if (
      isConfidentialResource &&
      (ADMINISTRATIVE_SCOPE_TYPES as readonly string[]).includes(grant.scopeType)
    ) {
      const isSupervisedAccess =
        action === 'notes.read.supervision' &&
        grant.scopeType === 'assigned_practice';
      if (!isSupervisedAccess) {
        trace?.push(
          `Step 5: grant ${grant.id} has administrative scope ${grant.scopeType} on confidential resource — skipped`,
        );
        continue;
      }
    }

    // 5a. Scope resolution
    if (!matchesScope(grant, resource, principal, ctx)) {
      trace?.push(`Step 5a: grant ${grant.id} scope ${grant.scopeType} does not match — skipped`);
      continue;
    }

    // Check assignment for assignment-scoped grants
    const requiredAssignmentKind = ASSIGNMENT_SCOPE_KINDS.get(grant.scopeType);
    if (requiredAssignmentKind != null) {
      const matchingAssignment = findMatchingAssignment(
        ctx,
        requiredAssignmentKind,
        grant,
        resource,
      );
      if (matchingAssignment == null) continue;
      if (!collectedAssignmentIds.includes(matchingAssignment.id)) {
        collectedAssignmentIds.push(matchingAssignment.id);
      }
    }

    // 5b. Conditions
    if (!evaluateConditions(grant.conditions, resource, ctx, action)) {
      trace?.push(`Step 5b: grant ${grant.id} conditions not met — skipped`);
      continue;
    }

    // Step 7: Delegation envelope validation
    const delegation = validateDelegation(grant, ctx);
    if (!delegation.valid) {
      // Track the specific reason so the decision reports it when no
      // grants match, rather than the generic no_matching_grant.
      delegationFailureReason = delegation.reason;
      trace?.push(`Step 7: grant ${grant.id} delegation invalid: ${delegation.reason} — skipped`);
      continue;
    }

    trace?.push(`Step 5: grant ${grant.id} matches action ${action} with scope ${grant.scopeType}`);
    matchedGrantIds.push(grant.id);
  }

  // -----------------------------------------------------------------------
  // Step 6: Self-approval rule
  // -----------------------------------------------------------------------
  if (
    (APPROVAL_ACTIONS as readonly string[]).includes(action) &&
    ctx.requesterId != null &&
    ctx.requesterId === principal.userId &&
    !ctx.orgSelfApprovalAllowed
  ) {
    trace?.push('Step 6: self-approval denied');
    return deny('self_approval_denied', trace ?? []);
  }
  trace?.push('Step 6: self-approval check passed');

  // -----------------------------------------------------------------------
  // Step 8: Decision
  // -----------------------------------------------------------------------
  if (matchedGrantIds.length > 0) {
    trace?.push(`Step 8: ${matchedGrantIds.length} grant(s) matched — allowed`);
    return allow(matchedGrantIds, collectedAssignmentIds, trace ?? []);
  }

  // When a grant matched action/scope/conditions but failed delegation,
  // report the delegation-specific reason instead of the generic fallback.
  if (delegationFailureReason != null) {
    trace?.push(`Step 8: delegation failure: ${delegationFailureReason} — denied`);
    return deny(delegationFailureReason, trace ?? []);
  }

  trace?.push('Step 8: no matching grant — denied');
  return deny('no_matching_grant', trace ?? []);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Evaluate whether `principal` may perform `action` on `resource`.
 *
 * The function is synchronous and pure (AUTHZ-R-30: no I/O, no
 * `Date.now()`; uses `ctx.now`). The nine evaluation steps follow the
 * exact order of 4.5.3.
 *
 * Satisfies AUTHZ-R-30, AUTHZ-R-31, AUTHZ-R-32, AUTHZ-R-33, AUTHZ-R-46.
 */
export function authorize(
  principal: Principal,
  action: Action,
  resource: Resource,
  ctx: AuthorizationContext,
): Decision {
  return evaluate(principal, action, resource, ctx);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function matchesEmergencyScope(
  ea: { scopeKind: 'CASE' | 'USER_RECORDS'; scopeId: string },
  resource: Resource,
): boolean {
  if (ea.scopeKind === 'CASE') {
    return resource.id != null && resource.id === ea.scopeId;
  }
  if (ea.scopeKind === 'USER_RECORDS') {
    return resource.ownerId != null && resource.ownerId === ea.scopeId;
  }
  return false;
}

function findMatchingAssignment(
  ctx: AuthorizationContext,
  requiredKind: string,
  _grant: GrantInput,
  resource: Resource,
): { id: string } | undefined {
  // SUPPORT_CASE assignments resolve through CASE scope (4.4 support_operator).
  const matchesKind = (assignmentKind: string): boolean => {
    if (assignmentKind === requiredKind) return true;
    if (requiredKind === 'CASE' && assignmentKind === 'SUPPORT_CASE') return true;
    return false;
  };
  return ctx.assignments.find(
    (a) =>
      matchesKind(a.kind) &&
      isAssignmentCurrent(a, ctx.now) &&
      matchesAssignmentTarget(a, requiredKind, resource),
  );
}

function matchesAssignmentTarget(
  assignment: { targetId: string },
  kind: string,
  resource: Resource,
): boolean {
  switch (kind) {
    case 'CLIENT':
      return assignment.targetId === resource.orgId;
    case 'QUEUE':
      return assignment.targetId === resource.queueId;
    case 'CASE':
      return assignment.targetId === resource.id;
    case 'PRACTICE_GROUP':
      return assignment.targetId === resource.practiceGroupId;
    case 'COLLECTION':
      return assignment.targetId === resource.collectionId;
    default:
      return false;
  }
}
