import { describe, it, expect } from 'vitest';
import type { OrgUnitResponse } from '@nestself/contracts';
import { IMPORT_MAX_ROWS, parseImport } from './import-parse';

const UNITS: OrgUnitResponse[] = [
  { id: 'ou_root', orgId: 'org_x', parentId: null, kind: 'COMPANY', name: 'Example d.o.o.', costCenterCode: null, archivedAt: null },
  { id: 'team_product', orgId: 'org_x', parentId: 'ou_root', kind: 'TEAM', name: 'Product', costCenterCode: null, archivedAt: null },
];

describe('parseImport', () => {
  it('parses rows, normalises the email and resolves the unit by id or name', () => {
    const parsed = parseImport(
      'email,templateKey,orgUnit\n\nMarko@Example.com, employee\nana@example.com,team_manager,team_product\nivan@example.com,employee,product\n',
      UNITS,
    );
    expect(parsed.problems).toEqual([]);
    expect(parsed.rows).toEqual([
      { email: 'marko@example.com', templateKey: 'employee' },
      { email: 'ana@example.com', templateKey: 'team_manager', orgUnitId: 'team_product' },
      { email: 'ivan@example.com', templateKey: 'employee', orgUnitId: 'team_product' },
    ]);
  });

  it('reports each bad line with its number and kind', () => {
    const parsed = parseImport(
      'not-an-email,employee\nana@example.com\nivan@example.com,platform_admin\npetar@example.com,employee,Nowhere\nok@example.com,employee',
      UNITS,
    );
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.problems).toEqual([
      { line: 1, kind: 'email', value: 'not-an-email' },
      { line: 2, kind: 'columns', value: 'ana@example.com' },
      { line: 3, kind: 'template', value: 'platform_admin' },
      { line: 4, kind: 'orgUnit', value: 'Nowhere' },
    ]);
  });

  it('refuses a unit name shared by two units, but still accepts either id', () => {
    const units = [...UNITS, { ...UNITS[1]!, id: 'team_product_2', parentId: 'ou_root' }];
    const parsed = parseImport('ana@example.com,employee,Product\nivan@example.com,employee,team_product_2', units);
    expect(parsed.problems).toEqual([{ line: 1, kind: 'orgUnitAmbiguous', value: 'Product' }]);
    expect(parsed.rows).toEqual([{ email: 'ivan@example.com', templateKey: 'employee', orgUnitId: 'team_product_2' }]);
  });

  it('refuses more rows than the server accepts', () => {
    const text = Array.from({ length: IMPORT_MAX_ROWS + 1 }, (_, i) => `p${i}@example.com,employee`).join('\n');
    expect(parseImport(text, UNITS).problems).toEqual([{ line: 0, kind: 'tooMany', value: String(IMPORT_MAX_ROWS + 1) }]);
  });
});
