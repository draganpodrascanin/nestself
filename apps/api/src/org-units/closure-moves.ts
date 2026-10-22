/**
 * Pure functions for computing closure-table changes on org-unit moves.
 *
 * These encode the classic closure-table move algorithm (Appendix A.3.2):
 *   1. Delete all closure rows where ancestor is NOT in the subtree but
 *      descendant IS in the subtree.
 *   2. Insert new rows for every (ancestorOfNewParent × subtreeNode) pair
 *      with correct depths.
 *
 * @module
 */

import type { ClosureRow } from './closure.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Collect the ids of every node in the subtree rooted at `rootId`
 * (including `rootId` itself) from the existing closure rows.
 */
export function subtreeIds(
  closureRows: ReadonlyArray<ClosureRow>,
  rootId: string,
): Set<string> {
  const ids = new Set<string>();
  for (const row of closureRows) {
    if (row.ancestorId === rootId) {
      ids.add(row.descendantId);
    }
  }
  return ids;
}

/**
 * Collect the ancestors of `nodeId` (including itself at depth 0)
 * sorted by ascending depth.
 */
export function ancestorsOf(
  closureRows: ReadonlyArray<ClosureRow>,
  nodeId: string,
): Array<{ ancestorId: string; depth: number }> {
  return closureRows
    .filter((r) => r.descendantId === nodeId)
    .sort((a, b) => a.depth - b.depth);
}

// ---------------------------------------------------------------------------
// Delete set
// ---------------------------------------------------------------------------

/**
 * Compute the set of closure rows to delete when moving `unitId` under a
 * new parent.
 *
 * These are the rows where `descendant_id` is inside the subtree and
 * `ancestor_id` is outside the subtree: i.e. the links from old ancestors
 * into the subtree.
 */
export function closureRowsToDelete(
  closureRows: ReadonlyArray<ClosureRow>,
  unitId: string,
): ClosureRow[] {
  const subtree = subtreeIds(closureRows, unitId);
  return closureRows.filter(
    (row) => subtree.has(row.descendantId) && !subtree.has(row.ancestorId),
  );
}

// ---------------------------------------------------------------------------
// Insert set
// ---------------------------------------------------------------------------

/**
 * Compute the set of closure rows to insert when moving `unitId` under
 * `newParentId`.
 *
 * For every ancestor of newParent (including newParent itself) and every
 * node in the subtree of `unitId` (including unitId itself), insert a row
 * with:
 *   depth = depth(ancestor → newParent) + 1 + depth(unitId → subtreeNode)
 */
export function closureRowsToInsert(
  closureRows: ReadonlyArray<ClosureRow>,
  unitId: string,
  newParentId: string,
): ClosureRow[] {
  const subtree = subtreeIds(closureRows, unitId);
  const newParentAncestors = ancestorsOf(closureRows, newParentId);

  // depth(unitId → each subtreeNode) from the existing closure
  const subtreeDepths = new Map<string, number>();
  for (const row of closureRows) {
    if (row.ancestorId === unitId && subtree.has(row.descendantId)) {
      subtreeDepths.set(row.descendantId, row.depth);
    }
  }

  const rows: ClosureRow[] = [];
  for (const ancestor of newParentAncestors) {
    const depthToNewParent = ancestor.depth; // depth from ancestor to newParent
    for (const [descendantId, subtreeDepth] of subtreeDepths) {
      rows.push({
        ancestorId: ancestor.ancestorId,
        descendantId,
        depth: depthToNewParent + 1 + subtreeDepth,
      });
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Convenience: rows for a newly created node
// ---------------------------------------------------------------------------

/**
 * Compute the closure rows for a newly created node with the given
 * `parentId`. Includes the self-row at depth 0 and one row per ancestor
 * of the parent, each at depth + 1.
 */
export function closureRowsForCreate(
  closureRows: ReadonlyArray<ClosureRow>,
  nodeId: string,
  parentId: string,
): ClosureRow[] {
  const result: ClosureRow[] = [
    { ancestorId: nodeId, descendantId: nodeId, depth: 0 },
  ];
  const parentAncestors = ancestorsOf(closureRows, parentId);
  for (const ancestor of parentAncestors) {
    result.push({
      ancestorId: ancestor.ancestorId,
      descendantId: nodeId,
      depth: ancestor.depth + 1,
    });
  }
  return result;
}
