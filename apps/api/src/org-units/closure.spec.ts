import { describe, it, expect } from 'vitest';
import { buildClosureRows, assertNoCycle } from './closure.js';
import type { OrgUnitInput } from './closure.js';

describe('buildClosureRows', () => {
  it('returns a single self-entry for a lone root', () => {
    const units: OrgUnitInput[] = [{ id: 'root', parentId: null }];
    const rows = buildClosureRows(units);
    expect(rows).toEqual([
      { ancestorId: 'root', descendantId: 'root', depth: 0 },
    ]);
  });

  it('builds correct rows for a linear chain root -> dept -> team', () => {
    const units: OrgUnitInput[] = [
      { id: 'root', parentId: null },
      { id: 'dept', parentId: 'root' },
      { id: 'team', parentId: 'dept' },
    ];
    const rows = buildClosureRows(units);

    // Self-entries
    expect(rows).toContainEqual({ ancestorId: 'root', descendantId: 'root', depth: 0 });
    expect(rows).toContainEqual({ ancestorId: 'dept', descendantId: 'dept', depth: 0 });
    expect(rows).toContainEqual({ ancestorId: 'team', descendantId: 'team', depth: 0 });

    // Parent entries
    expect(rows).toContainEqual({ ancestorId: 'root', descendantId: 'dept', depth: 1 });
    expect(rows).toContainEqual({ ancestorId: 'dept', descendantId: 'team', depth: 1 });

    // Grandparent
    expect(rows).toContainEqual({ ancestorId: 'root', descendantId: 'team', depth: 2 });

    expect(rows).toHaveLength(6);
  });

  it('handles branching (root with two children)', () => {
    const units: OrgUnitInput[] = [
      { id: 'root', parentId: null },
      { id: 'a', parentId: 'root' },
      { id: 'b', parentId: 'root' },
    ];
    const rows = buildClosureRows(units);
    expect(rows).toHaveLength(5); // 3 self + 2 parent
    expect(rows).toContainEqual({ ancestorId: 'root', descendantId: 'a', depth: 1 });
    expect(rows).toContainEqual({ ancestorId: 'root', descendantId: 'b', depth: 1 });
  });

  it('every node is its own ancestor at depth 0 (AUTHZ-R-09)', () => {
    const units: OrgUnitInput[] = [
      { id: 'co', parentId: null },
      { id: 'd1', parentId: 'co' },
      { id: 'd2', parentId: 'co' },
      { id: 't1', parentId: 'd1' },
      { id: 't2', parentId: 'd1' },
      { id: 't3', parentId: 'd2' },
    ];
    const rows = buildClosureRows(units);

    for (const u of units) {
      const selfRow = rows.find(
        (r) => r.ancestorId === u.id && r.descendantId === u.id,
      );
      expect(selfRow).toBeDefined();
      expect(selfRow!.depth).toBe(0);
    }
  });

  it('throws on missing parent reference', () => {
    const units: OrgUnitInput[] = [
      { id: 'a', parentId: 'nonexistent' },
    ];
    expect(() => buildClosureRows(units)).toThrow('missing parent');
  });

  it('throws on a cycle (A -> B -> A)', () => {
    const units: OrgUnitInput[] = [
      { id: 'a', parentId: 'b' },
      { id: 'b', parentId: 'a' },
    ];
    expect(() => buildClosureRows(units)).toThrow(/[Cc]ycle/);
  });

  it('throws on a self-referencing node', () => {
    const units: OrgUnitInput[] = [
      { id: 'root', parentId: null },
      { id: 'x', parentId: 'x' },
    ];
    expect(() => buildClosureRows(units)).toThrow(/[Cc]ycle/);
  });

  it('handles an empty array', () => {
    expect(buildClosureRows([])).toEqual([]);
  });
});

describe('assertNoCycle', () => {
  const tree: OrgUnitInput[] = [
    { id: 'root', parentId: null },
    { id: 'dept', parentId: 'root' },
    { id: 'team', parentId: 'dept' },
  ];

  it('does not throw for a valid move (team under root)', () => {
    expect(() => assertNoCycle(tree, 'team', 'root')).not.toThrow();
  });

  it('throws when moving a node under its own descendant', () => {
    expect(() => assertNoCycle(tree, 'root', 'team')).toThrow(/cycle/i);
  });

  it('throws when moving a node under itself', () => {
    expect(() => assertNoCycle(tree, 'dept', 'dept')).toThrow(
      'A unit cannot be its own parent',
    );
  });
});
