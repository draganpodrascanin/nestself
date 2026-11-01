import { describe, expect, it } from 'vitest';
import { departmentsOf, primaryDepartmentOf } from './audience.js';
import type { UnitNode } from './listening.repository.js';

const UNITS: UnitNode[] = [
  { id: 'ou_root', parentId: null, kind: 'COMPANY', name: 'Example d.o.o.' },
  { id: 'ou_engineering', parentId: 'ou_root', kind: 'DEPARTMENT', name: 'Engineering' },
  { id: 'ou_commercial', parentId: 'ou_root', kind: 'DEPARTMENT', name: 'Commercial' },
  { id: 'team_product', parentId: 'ou_engineering', kind: 'TEAM', name: 'Product' },
  { id: 'team_operations', parentId: 'ou_engineering', kind: 'TEAM', name: 'Operations' },
  { id: 'team_sales', parentId: 'ou_commercial', kind: 'TEAM', name: 'Sales' },
  { id: 'squad_alpha', parentId: 'team_product', kind: 'TEAM', name: 'Alpha' },
  { id: 'team_direct', parentId: 'ou_root', kind: 'TEAM', name: 'Directly under root' },
  { id: 'orphan', parentId: 'gone', kind: 'TEAM', name: 'Orphan' },
];

describe('primaryDepartmentOf', () => {
  it('walks up to the department directly under the company root', () => {
    expect(primaryDepartmentOf('team_product', UNITS)).toBe('ou_engineering');
    expect(primaryDepartmentOf('squad_alpha', UNITS)).toBe('ou_engineering');
    expect(primaryDepartmentOf('team_sales', UNITS)).toBe('ou_commercial');
    expect(primaryDepartmentOf('ou_engineering', UNITS)).toBe('ou_engineering');
  });

  it('a team directly under the root is its own cohort', () => {
    expect(primaryDepartmentOf('team_direct', UNITS)).toBe('team_direct');
  });

  it('members without a unit, on the root, or on a broken chain are unassigned', () => {
    expect(primaryDepartmentOf(null, UNITS)).toBeNull();
    expect(primaryDepartmentOf('ou_root', UNITS)).toBeNull();
    expect(primaryDepartmentOf('orphan', UNITS)).toBeNull();
    expect(primaryDepartmentOf('unknown', UNITS)).toBeNull();
  });

  it('survives a cycle in a corrupt tree', () => {
    const loop: UnitNode[] = [
      { id: 'a', parentId: 'b', kind: 'TEAM', name: 'a' },
      { id: 'b', parentId: 'a', kind: 'TEAM', name: 'b' },
    ];
    expect(primaryDepartmentOf('a', loop)).toBeNull();
  });
});

describe('departmentsOf', () => {
  it('lists the direct children of the root in input order', () => {
    expect(departmentsOf(UNITS).map((u) => u.id)).toEqual(['ou_engineering', 'ou_commercial', 'team_direct']);
  });
});
