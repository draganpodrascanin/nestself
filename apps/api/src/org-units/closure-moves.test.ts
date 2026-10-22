/**
 * Unit tests for pure closure-move functions.
 *
 * Uses the sample org-unit tree:
 *   ou_root
 *   ├── ou_engineering
 *   │   ├── team_product
 *   │   └── team_operations
 *   └── ou_commercial
 *       └── team_sales
 */
import { describe, it, expect } from 'vitest';
import type { ClosureRow } from './closure.js';
import { buildClosureRows } from './closure.js';
import {
  closureRowsToDelete,
  closureRowsToInsert,
  closureRowsForCreate,
  subtreeIds,
} from './closure-moves.js';

const UNITS = [
  { id: 'ou_root', parentId: null },
  { id: 'ou_engineering', parentId: 'ou_root' },
  { id: 'ou_commercial', parentId: 'ou_root' },
  { id: 'team_product', parentId: 'ou_engineering' },
  { id: 'team_operations', parentId: 'ou_engineering' },
  { id: 'team_sales', parentId: 'ou_commercial' },
];

const allClosure = buildClosureRows(UNITS);

function findRow(
  rows: ClosureRow[],
  ancestorId: string,
  descendantId: string,
): ClosureRow | undefined {
  return rows.find(
    (r) => r.ancestorId === ancestorId && r.descendantId === descendantId,
  );
}

describe('subtreeIds', () => {
  it('returns the full subtree for ou_engineering', () => {
    const ids = subtreeIds(allClosure, 'ou_engineering');
    expect(ids).toEqual(
      new Set(['ou_engineering', 'team_product', 'team_operations']),
    );
  });

  it('returns only the node itself for a leaf', () => {
    const ids = subtreeIds(allClosure, 'team_sales');
    expect(ids).toEqual(new Set(['team_sales']));
  });
});

describe('closureRowsToDelete', () => {
  it('computes correct rows when moving ou_engineering under ou_commercial', () => {
    const toDelete = closureRowsToDelete(allClosure, 'ou_engineering');

    // Should delete all rows where ancestor is outside the subtree
    // and descendant is inside. Subtree = {ou_engineering, team_product, team_operations}
    // Outside ancestors that point in: ou_root
    expect(toDelete.length).toBe(3); // ou_root -> ou_engineering, ou_root -> team_product, ou_root -> team_operations
    for (const row of toDelete) {
      expect(row.ancestorId).toBe('ou_root');
    }
    expect(toDelete.map((r) => r.descendantId).sort()).toEqual([
      'ou_engineering',
      'team_operations',
      'team_product',
    ]);
  });

  it('returns one row for a leaf node (team_sales)', () => {
    const toDelete = closureRowsToDelete(allClosure, 'team_sales');
    // team_sales subtree = {team_sales}
    // Outside ancestors: ou_root, ou_commercial
    expect(toDelete.length).toBe(2);
    expect(toDelete.map((r) => r.ancestorId).sort()).toEqual([
      'ou_commercial',
      'ou_root',
    ]);
  });
});

describe('closureRowsToInsert', () => {
  it('computes correct rows moving team_sales under ou_engineering', () => {
    const toInsert = closureRowsToInsert(
      allClosure,
      'team_sales',
      'ou_engineering',
    );

    // Ancestors of ou_engineering: ou_engineering(0), ou_root(1)
    // Subtree of team_sales: team_sales(0)
    // New rows:
    //   ou_engineering -> team_sales at depth 0+1+0 = 1
    //   ou_root -> team_sales at depth 1+1+0 = 2
    expect(toInsert).toHaveLength(2);
    const eng = findRow(toInsert, 'ou_engineering', 'team_sales');
    expect(eng).toBeDefined();
    expect(eng!.depth).toBe(1);
    const root = findRow(toInsert, 'ou_root', 'team_sales');
    expect(root).toBeDefined();
    expect(root!.depth).toBe(2);
  });

  it('computes correct depths for a 3-level move (ou_engineering under ou_commercial)', () => {
    const toInsert = closureRowsToInsert(
      allClosure,
      'ou_engineering',
      'ou_commercial',
    );

    // Ancestors of ou_commercial: ou_commercial(0), ou_root(1)
    // Subtree of ou_engineering: ou_engineering(0), team_product(1), team_operations(1)
    // New rows:
    //   ou_commercial -> ou_engineering at 0+1+0 = 1
    //   ou_commercial -> team_product at 0+1+1 = 2
    //   ou_commercial -> team_operations at 0+1+1 = 2
    //   ou_root -> ou_engineering at 1+1+0 = 2
    //   ou_root -> team_product at 1+1+1 = 3
    //   ou_root -> team_operations at 1+1+1 = 3
    expect(toInsert).toHaveLength(6);

    expect(findRow(toInsert, 'ou_commercial', 'ou_engineering')!.depth).toBe(1);
    expect(findRow(toInsert, 'ou_commercial', 'team_product')!.depth).toBe(2);
    expect(findRow(toInsert, 'ou_commercial', 'team_operations')!.depth).toBe(2);
    expect(findRow(toInsert, 'ou_root', 'ou_engineering')!.depth).toBe(2);
    expect(findRow(toInsert, 'ou_root', 'team_product')!.depth).toBe(3);
    expect(findRow(toInsert, 'ou_root', 'team_operations')!.depth).toBe(3);
  });
});

describe('closureRowsForCreate', () => {
  it('creates correct rows for a node under ou_engineering', () => {
    const rows = closureRowsForCreate(allClosure, 'new_team', 'ou_engineering');

    // Self-row + ancestors of ou_engineering (ou_engineering at 0, ou_root at 1)
    // => new_team -> new_team at 0
    //    ou_engineering -> new_team at 1
    //    ou_root -> new_team at 2
    expect(rows).toHaveLength(3);
    expect(findRow(rows, 'new_team', 'new_team')!.depth).toBe(0);
    expect(findRow(rows, 'ou_engineering', 'new_team')!.depth).toBe(1);
    expect(findRow(rows, 'ou_root', 'new_team')!.depth).toBe(2);
  });

  it('creates correct rows for a node directly under the root', () => {
    const rows = closureRowsForCreate(allClosure, 'new_dept', 'ou_root');

    // Self-row + ancestors of ou_root (only ou_root at 0)
    // => new_dept -> new_dept at 0
    //    ou_root -> new_dept at 1
    expect(rows).toHaveLength(2);
    expect(findRow(rows, 'new_dept', 'new_dept')!.depth).toBe(0);
    expect(findRow(rows, 'ou_root', 'new_dept')!.depth).toBe(1);
  });
});
