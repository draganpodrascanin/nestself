/// <reference types="node" />
/**
 * Proves the ESLint guard rejects React imports from schema/ and search/.
 *
 * Runs ESLint programmatically on a fixture string to verify the
 * `no-restricted-imports` rule fires for react, react-dom, @tiptap/react
 * and @nestself/ui.
 */
import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';
import { join } from 'node:path';

const contentRoot = join(import.meta.dirname!, '..', '..');

async function lintFixture(code: string, filename: string): Promise<ESLint.LintResult[]> {
  const eslint = new ESLint({
    overrideConfigFile: join(contentRoot, 'eslint.config.js'),
    cwd: contentRoot,
  });
  return eslint.lintText(code, { filePath: filename });
}

describe('ESLint guard — no React imports in schema/', () => {
  const forbidden = ['react', 'react-dom', '@tiptap/react', '@nestself/ui'];

  for (const mod of forbidden) {
    it(`rejects import of '${mod}' from a schema file`, async () => {
      const code = `import something from '${mod}';\nexport default something;\n`;
      const results = await lintFixture(code, 'src/schema/test-fixture.ts');
      const errors = results.flatMap((r) => r.messages).filter((m) => m.ruleId === 'no-restricted-imports');
      expect(errors.length).toBeGreaterThan(0);
    });
  }

  for (const mod of forbidden) {
    it(`rejects import of '${mod}' from a search file`, async () => {
      const code = `import something from '${mod}';\nexport default something;\n`;
      const results = await lintFixture(code, 'src/search/test-fixture.ts');
      const errors = results.flatMap((r) => r.messages).filter((m) => m.ruleId === 'no-restricted-imports');
      expect(errors.length).toBeGreaterThan(0);
    });
  }

  it('allows import of @tiptap/core from a schema file', async () => {
    const code = `import { getSchema } from '@tiptap/core';\nexport { getSchema };\n`;
    const results = await lintFixture(code, 'src/schema/test-fixture.ts');
    const errors = results.flatMap((r) => r.messages).filter((m) => m.ruleId === 'no-restricted-imports');
    expect(errors.length).toBe(0);
  });
});
