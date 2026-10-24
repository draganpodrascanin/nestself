/**
 * Approver selection for follow-up approval items (T-CW-1.10, D-CW-37,
 * guidelines 7.4). Pure: the repository loads the organization's approval
 * authorities and the employee's unit ancestry (`org_unit_closure`), these
 * functions decide.
 *
 * An authority covers the employee when
 * - its unit is the employee's unit, or an ancestor of it with
 *   `includeDescendants`; an authority without a unit covers the whole
 *   organization (and is the only kind that covers an employee without one);
 * - its `categories` are empty or contain `consultation_follow_up`;
 * - its validity window covers now (`validFrom <= now < validUntil`);
 * - it is not a confidential approver (a follow-up item carries no category,
 *   LAW-14).
 *
 * The selected authority is the covering one closest to the employee's unit
 * (organization-wide last), then the earliest created, then by id. An
 * authority that only the employee could decide (the employee is the approver
 * and there is no other alternate) is skipped unless the organization allows
 * self-approval: it would route an item nobody may decide.
 */
import { FOLLOW_UP_APPROVAL_CATEGORY } from '@nestself/contracts';

export interface AuthorityCandidate {
  id: string;
  userId: string;
  orgUnitId: string | null;
  includeDescendants: boolean;
  categories: readonly string[];
  validFrom: Date;
  validUntil: Date | null;
  alternateUserId: string | null;
  isConfidentialApprover: boolean;
  createdAt: Date;
}

/** The employee's unit and its ancestors with their depth (0 = the unit itself). */
export interface UnitAncestry {
  unitId: string;
  depthByAncestor: ReadonlyMap<string, number>;
}

export interface SelectedApprover {
  authorityId: string;
  approverUserId: string;
  alternateUserId: string | null;
}

export interface SelectionInput {
  /** Null when the employee's membership has no unit. */
  ancestry: UnitAncestry | null;
  employeeUserId: string;
  now: Date;
  selfApprovalAllowed: boolean;
}

/** How far the authority's unit is from the employee's; null when it does not cover the employee. */
function coverageDepth(authority: AuthorityCandidate, ancestry: UnitAncestry | null): number | null {
  if (authority.orgUnitId === null) return Number.POSITIVE_INFINITY;
  if (!ancestry) return null;
  if (authority.orgUnitId === ancestry.unitId) return 0;
  if (!authority.includeDescendants) return null;
  return ancestry.depthByAncestor.get(authority.orgUnitId) ?? null;
}

function isCurrent(authority: AuthorityCandidate, now: Date): boolean {
  if (authority.validFrom.getTime() > now.getTime()) return false;
  return authority.validUntil === null || authority.validUntil.getTime() > now.getTime();
}

function coversFollowUps(authority: AuthorityCandidate): boolean {
  return authority.categories.length === 0 || authority.categories.includes(FOLLOW_UP_APPROVAL_CATEGORY);
}

/** True when the authority covers the employee's unit for follow-ups now. */
export function isAuthorityCovering(authority: AuthorityCandidate, ancestry: UnitAncestry | null, now: Date): boolean {
  return (
    !authority.isConfidentialApprover &&
    coversFollowUps(authority) &&
    isCurrent(authority, now) &&
    coverageDepth(authority, ancestry) !== null
  );
}

function alternateOf(authority: AuthorityCandidate): string | null {
  return authority.alternateUserId && authority.alternateUserId !== authority.userId ? authority.alternateUserId : null;
}

/** The approver and alternate for a follow-up of the employee, or null when no authority covers them. */
export function selectApprover(authorities: readonly AuthorityCandidate[], input: SelectionInput): SelectedApprover | null {
  const candidates = authorities
    .filter((authority) => isAuthorityCovering(authority, input.ancestry, input.now))
    .filter((authority) => {
      if (input.selfApprovalAllowed || authority.userId !== input.employeeUserId) return true;
      const alternate = alternateOf(authority);
      return alternate !== null && alternate !== input.employeeUserId;
    })
    .map((authority) => ({ authority, depth: coverageDepth(authority, input.ancestry)! }))
    .sort(
      (a, b) =>
        a.depth - b.depth ||
        a.authority.createdAt.getTime() - b.authority.createdAt.getTime() ||
        a.authority.id.localeCompare(b.authority.id),
    );
  const chosen = candidates[0]?.authority;
  if (!chosen) return null;
  return { authorityId: chosen.id, approverUserId: chosen.userId, alternateUserId: alternateOf(chosen) };
}

/**
 * True when `userId` is the approver or the alternate of an authority that
 * covers the employee now: an item stays decidable only by someone whose
 * authority still reaches the employee's unit.
 */
export function mayDecide(
  userId: string,
  authorities: readonly AuthorityCandidate[],
  ancestry: UnitAncestry | null,
  now: Date,
): boolean {
  return authorities.some(
    (authority) =>
      (authority.userId === userId || alternateOf(authority) === userId) && isAuthorityCovering(authority, ancestry, now),
  );
}
