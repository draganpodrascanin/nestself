/**
 * Pure closure-table builder for OrgUnit trees.
 *
 * Given a flat list of units with {id, parentId} adjacency pointers,
 * produces the full set of (ancestorId, descendantId, depth) rows
 * including every node's self-entry at depth 0.
 *
 * @module
 */

export interface OrgUnitInput {
  id: string;
  parentId: string | null;
}

export interface ClosureRow {
  ancestorId: string;
  descendantId: string;
  depth: number;
}

/**
 * Build closure rows for the full tree of units.
 *
 * @throws if a parentId references an id not present in `units`
 * @throws if the adjacency list contains a cycle
 */
export function buildClosureRows(
  units: ReadonlyArray<OrgUnitInput>,
): ClosureRow[] {
  const idSet = new Set(units.map((u) => u.id));
  const childrenOf = new Map<string | '__roots__', string[]>();
  childrenOf.set('__roots__', []);

  for (const u of units) {
    if (u.parentId !== null && !idSet.has(u.parentId)) {
      throw new Error(
        `OrgUnit "${u.id}" references missing parent "${u.parentId}"`,
      );
    }
    if (u.parentId === null) {
      childrenOf.get('__roots__')!.push(u.id);
    } else {
      const siblings = childrenOf.get(u.parentId);
      if (siblings) {
        siblings.push(u.id);
      } else {
        childrenOf.set(u.parentId, [u.id]);
      }
    }
  }

  // Topological walk; track visited to detect cycles.
  const visited = new Set<string>();
  const rows: ClosureRow[] = [];

  // ancestorChain[i] = the ancestor at depth i from the root
  function walk(nodeId: string, ancestorChain: string[]): void {
    if (visited.has(nodeId)) {
      throw new Error(
        `Cycle detected: "${nodeId}" was visited twice`,
      );
    }
    visited.add(nodeId);

    // Self-entry at depth 0.
    rows.push({ ancestorId: nodeId, descendantId: nodeId, depth: 0 });

    // Entries for each ancestor in the chain (depth 1, 2, ...).
    for (let i = ancestorChain.length - 1; i >= 0; i--) {
      rows.push({
        ancestorId: ancestorChain[i]!,
        descendantId: nodeId,
        depth: ancestorChain.length - i,
      });
    }

    const children = childrenOf.get(nodeId) ?? [];
    for (const childId of children) {
      walk(childId, [...ancestorChain, nodeId]);
    }
  }

  for (const rootId of childrenOf.get('__roots__')!) {
    walk(rootId, []);
  }

  // Check all nodes were visited (detects disconnected cycles).
  if (visited.size !== units.length) {
    const unvisited = units
      .filter((u) => !visited.has(u.id))
      .map((u) => u.id);
    throw new Error(
      `Cycle detected: nodes not reachable from roots: ${unvisited.join(', ')}`,
    );
  }

  return rows;
}

/**
 * Verify that moving `movingId` under `newParentId` would not create
 * a cycle. Throws if it would (i.e. newParentId is a descendant of
 * movingId or is movingId itself).
 */
export function assertNoCycle(
  units: ReadonlyArray<OrgUnitInput>,
  movingId: string,
  newParentId: string,
): void {
  if (movingId === newParentId) {
    throw new Error('A unit cannot be its own parent');
  }

  // Build the descendant set of movingId from the adjacency list.
  const childrenOf = new Map<string, string[]>();
  for (const u of units) {
    if (u.parentId !== null) {
      const siblings = childrenOf.get(u.parentId);
      if (siblings) {
        siblings.push(u.id);
      } else {
        childrenOf.set(u.parentId, [u.id]);
      }
    }
  }

  const descendants = new Set<string>();
  const stack = [movingId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    descendants.add(current);
    for (const child of childrenOf.get(current) ?? []) {
      stack.push(child);
    }
  }

  if (descendants.has(newParentId)) {
    throw new Error(
      `Moving "${movingId}" under "${newParentId}" would create a cycle`,
    );
  }
}
