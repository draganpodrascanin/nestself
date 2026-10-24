import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MAX_IDENTIFIER_LENGTH,
  findRepositoryRoot,
  testDatabaseName,
} from './test-database-name.js';

function fakeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'nestself-repo-'));
  writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages: []\n');
  mkdirSync(join(root, 'apps', 'api'), { recursive: true });
  return root;
}

describe('testDatabaseName', () => {
  it('gives two repository roots different names', () => {
    const a = fakeRepo();
    const b = fakeRepo();
    const nameA = testDatabaseName('nestself_test', 'grants', { env: {}, cwd: a });
    const nameB = testDatabaseName('nestself_test', 'grants', { env: {}, cwd: b });
    expect(nameA).not.toBe(nameB);
    expect(nameA).toMatch(/^nestself_test_[0-9a-f]{8}_grants$/);
  });

  it('gives the same root the same name, from any directory inside it', () => {
    const root = fakeRepo();
    const fromRoot = testDatabaseName('nestself_test', 'schema', { env: {}, cwd: root });
    const fromApp = testDatabaseName('nestself_test', 'schema', {
      env: {},
      cwd: join(root, 'apps', 'api'),
    });
    expect(fromApp).toBe(fromRoot);
    expect(findRepositoryRoot(join(root, 'apps', 'api'))).toBe(root);
  });

  it('lets TEST_DATABASE_PREFIX win over the root hash', () => {
    const a = fakeRepo();
    const b = fakeRepo();
    const env = { TEST_DATABASE_PREFIX: 'Ci_Run7' };
    expect(testDatabaseName('nestself_test', 'auth', { env, cwd: a })).toBe(
      'nestself_test_ci_run7_auth',
    );
    expect(testDatabaseName('nestself_test', 'auth', { env, cwd: b })).toBe(
      'nestself_test_ci_run7_auth',
    );
  });

  it('refuses a prefix that is not a plain identifier', () => {
    expect(() =>
      testDatabaseName('nestself_test', 'auth', { env: { TEST_DATABASE_PREFIX: 'a"; drop' } }),
    ).toThrow(/TEST_DATABASE_PREFIX/);
  });

  it('shortens the base to stay within the identifier limit', () => {
    const root = fakeRepo();
    const name = testDatabaseName('b'.repeat(80), 'authzrepo', { env: {}, cwd: root });
    expect(name).toHaveLength(MAX_IDENTIFIER_LENGTH);
    expect(name).toMatch(/_[0-9a-f]{8}_authzrepo$/);
    expect(testDatabaseName('short', 'x', { env: {}, cwd: root }).length).toBeLessThan(63);
  });
});
