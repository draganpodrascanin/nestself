import { describe, it, expect } from 'vitest';
import type { OrgUnitResponse } from '@nestself/contracts';
import { flattenTree, isMovable, subtreeIds } from './org-unit-tree';

function unit(id: string, parentId: string | null, kind: OrgUnitResponse['kind'], name: string): OrgUnitResponse {
  return { id, orgId: 'org_x', parentId, kind, name, costCenterCode: null, archivedAt: null };
}

const UNITS = [
  unit('team_sales', 'ou_commercial', 'TEAM', 'Sales'),
  unit('ou_root', null, 'COMPANY', 'Example d.o.o.'),
  unit('ou_engineering', 'ou_root', 'DEPARTMENT', 'Engineering'),
  unit('team_product', 'ou_engineering', 'TEAM', 'Product'),
  unit('ou_commercial', 'ou_root', 'DEPARTMENT', 'Commercial'),
];

describe('flattenTree', () => {
  it('orders depth first with depths and children by name', () => {
    expect(flattenTree(UNITS).map((n) => [n.unit.id, n.depth])).toEqual([
      ['ou_root', 0],
      ['ou_commercial', 1],
      ['team_sales', 2],
      ['ou_engineering', 1],
      ['team_product', 2],
    ]);
  });

  it('keeps a unit whose parent is missing as a root', () => {
    expect(flattenTree([unit('orphan', 'gone', 'TEAM', 'Orphan')])).toEqual([
      { unit: expect.objectContaining({ id: 'orphan' }), depth: 0 },
    ]);
  });
});

describe('subtreeIds', () => {
  it('returns the unit and all its descendants', () => {
    expect([...subtreeIds(UNITS, 'ou_engineering')].sort()).toEqual(['ou_engineering', 'team_product']);
    expect(subtreeIds(UNITS, 'ou_root').size).toBe(5);
  });
});

describe('isMovable', () => {
  it('refuses the root COMPANY', () => {
    expect(isMovable(UNITS[1]!)).toBe(false);
    expect(isMovable(UNITS[0]!)).toBe(true);
  });
});
