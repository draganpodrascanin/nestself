import { describe, it, expect } from 'vitest';
import { IMPORT_MAX_ROWS, parseImport } from './import-parse';

describe('parseImport (operations)', () => {
  it('parses email,template[,orgUnitId] rows and skips blank lines and a header', () => {
    const parsed = parseImport('email,templateKey\n\nana@example.test, employee\nbo@example.test,hr_admin,team_product\n');
    expect(parsed.problems).toEqual([]);
    expect(parsed.rows).toEqual([
      { email: 'ana@example.test', templateKey: 'employee' },
      { email: 'bo@example.test', templateKey: 'hr_admin', orgUnitId: 'team_product' },
    ]);
  });

  it('reports wrong column counts, bad emails and templates that cannot be invited', () => {
    const parsed = parseImport('ana@example.test\nnope,employee\ncy@example.test,platform_owner\na,b,c,d');
    expect(parsed.rows).toEqual([]);
    expect(parsed.problems).toEqual([
      { line: 1, kind: 'columns', value: 'ana@example.test' },
      { line: 2, kind: 'email', value: 'nope' },
      { line: 3, kind: 'template', value: 'platform_owner' },
      { line: 4, kind: 'columns', value: 'a,b,c,d' },
    ]);
  });

  it('refuses more rows than one import takes', () => {
    const text = Array.from({ length: IMPORT_MAX_ROWS + 1 }, (_, i) => `p${i}@example.test,employee`).join('\n');
    const parsed = parseImport(text);
    expect(parsed.problems).toEqual([{ line: 0, kind: 'tooMany', value: String(IMPORT_MAX_ROWS + 1) }]);
  });
});
