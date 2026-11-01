/**
 * Audience snapshot helpers (spec 4.2, SUR-02, SUR-03; ADR 0002, D-EL-13).
 *
 * The reporting cohorts of the pilot are the company and the disjoint
 * departments directly under the company root. A member's primary department
 * is the ancestor of their org unit at that level; a member whose unit is the
 * root itself, or whose chain is broken, has none and reports in the
 * `unassigned` cohort. Transfers during a cycle keep the launch snapshot's
 * attribution because the cohort is stored on the participation at launch.
 */
import type { UnitNode } from './listening.repository.js';

/** The cohort key of members with no primary department. */
export const UNASSIGNED_COHORT = 'unassigned';
/** The cohort key of the whole organization. */
export const COMPANY_COHORT = 'company';

/**
 * The id of the department-level ancestor (a direct child of the COMPANY
 * root) of `unitId`, or null when the unit is the root, unknown, or not under
 * a root.
 */
export function primaryDepartmentOf(unitId: string | null, units: readonly UnitNode[]): string | null {
  if (!unitId) return null;
  const byId = new Map(units.map((u) => [u.id, u]));
  let current = byId.get(unitId);
  const seen = new Set<string>();
  while (current) {
    if (seen.has(current.id)) return null; // a cycle in a corrupt tree
    seen.add(current.id);
    if (current.kind === 'COMPANY' || current.parentId === null) return null;
    const parent = byId.get(current.parentId);
    if (!parent) return null;
    if (parent.kind === 'COMPANY' || parent.parentId === null) return current.id;
    current = parent;
  }
  return null;
}

/** The department-level units (direct children of a root), for heatmap rows. */
export function departmentsOf(units: readonly UnitNode[]): UnitNode[] {
  const byId = new Map(units.map((u) => [u.id, u]));
  return units.filter((u) => {
    if (u.kind === 'COMPANY' || u.parentId === null) return false;
    const parent = byId.get(u.parentId);
    return !!parent && (parent.kind === 'COMPANY' || parent.parentId === null);
  });
}
