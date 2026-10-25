/**
 * Tree helpers over the flat org-unit list the API returns.
 */
import type { OrgUnitResponse } from '@nestself/contracts';

export interface TreeNode {
  unit: OrgUnitResponse;
  /** 0 for a root. */
  depth: number;
}

function childrenByParent(units: readonly OrgUnitResponse[]): Map<string | null, OrgUnitResponse[]> {
  const ids = new Set(units.map((u) => u.id));
  const map = new Map<string | null, OrgUnitResponse[]>();
  for (const unit of units) {
    // A unit whose parent is not in the list is shown as a root, never dropped.
    const parent = unit.parentId !== null && ids.has(unit.parentId) ? unit.parentId : null;
    const list = map.get(parent) ?? [];
    list.push(unit);
    map.set(parent, list);
  }
  for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  return map;
}

/** Depth-first order with each unit's depth, children sorted by name. */
export function flattenTree(units: readonly OrgUnitResponse[]): TreeNode[] {
  const children = childrenByParent(units);
  const out: TreeNode[] = [];
  const seen = new Set<string>();
  const visit = (unit: OrgUnitResponse, depth: number) => {
    if (seen.has(unit.id)) return;
    seen.add(unit.id);
    out.push({ unit, depth });
    for (const child of children.get(unit.id) ?? []) visit(child, depth + 1);
  };
  for (const root of children.get(null) ?? []) visit(root, 0);
  // Units only reachable through a cycle still appear, at the top level.
  for (const unit of units) if (!seen.has(unit.id)) visit(unit, 0);
  return out;
}

/** The unit itself and every unit below it. */
export function subtreeIds(units: readonly OrgUnitResponse[], unitId: string): Set<string> {
  const children = childrenByParent(units);
  const out = new Set<string>();
  const stack = [unitId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    for (const child of children.get(id) ?? []) stack.push(child.id);
  }
  return out;
}

/** A root unit (no parent, or the organization's COMPANY) cannot be moved. */
export function isMovable(unit: OrgUnitResponse): boolean {
  return unit.parentId !== null && unit.kind !== 'COMPANY';
}
