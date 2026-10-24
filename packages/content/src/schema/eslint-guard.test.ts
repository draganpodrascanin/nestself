/// <reference types="node" />
/**
 * Proves the ESLint guard rejects React, editor and render imports
 * from schema/ and search/ (I12).
 *
 * Runs ESLint programmatically on fixture strings to verify the
 * `no-restricted-imports` rule fires for all restricted patterns.
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

function hasRestrictedImport(results: ESLint.LintResult[]): boolean {
  return results.flatMap((r) => r.messages).some((m) => m.ruleId === 'no-restricted-imports');
}

// ---------------------------------------------------------------------------
// Forbidden imports from schema/ and search/
// ---------------------------------------------------------------------------

describe('ESLint guard — forbidden imports (I12)', () => {
  const forbidden = [
    'react',
    'react/jsx-runtime',
    'react-dom',
    'react-dom/client',
    '@tiptap/react',
    '@tiptap/react/hooks',
    '@nestself/ui',
    '@nestself/ui/button',
    '@nestself/content/editor',
    '@nestself/content/render',
  ];

  for (const mod of forbidden) {
    it(`rejects '${mod}' from schema/`, async () => {
      const code = `import something from '${mod}';\nexport default something;\n`;
      const results = await lintFixture(code, 'src/schema/test-fixture.ts');
      expect(hasRestrictedImport(results)).toBe(true);
    });
  }

  for (const mod of forbidden) {
    it(`rejects '${mod}' from search/`, async () => {
      const code = `import something from '${mod}';\nexport default something;\n`;
      const results = await lintFixture(code, 'src/search/test-fixture.ts');
      expect(hasRestrictedImport(results)).toBe(true);
    });
  }

  // Relative editor/render paths
  for (const pattern of ['../editor/foo', '../render/bar']) {
    it(`rejects relative '${pattern}' from schema/`, async () => {
      const code = `import something from '${pattern}';\nexport default something;\n`;
      const results = await lintFixture(code, 'src/schema/test-fixture.ts');
      expect(hasRestrictedImport(results)).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// Allowed imports
// ---------------------------------------------------------------------------

describe('ESLint guard — allowed imports', () => {
  it('allows @tiptap/core from schema/', async () => {
    const code = `import { getSchema } from '@tiptap/core';\nexport { getSchema };\n`;
    const results = await lintFixture(code, 'src/schema/test-fixture.ts');
    expect(hasRestrictedImport(results)).toBe(false);
  });

  it('allows zod from schema/', async () => {
    const code = `import { z } from 'zod';\nexport { z };\n`;
    const results = await lintFixture(code, 'src/schema/test-fixture.ts');
    expect(hasRestrictedImport(results)).toBe(false);
  });

  it('allows react from non-schema file', async () => {
    const code = `import React from 'react';\nexport default React;\n`;
    const results = await lintFixture(code, 'src/components/test-fixture.ts');
    expect(hasRestrictedImport(results)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// .mjs files covered
// ---------------------------------------------------------------------------

describe('ESLint guard — .mjs files', () => {
  it('rejects react from schema .mjs file', async () => {
    const code = `import something from 'react';\nexport default something;\n`;
    const results = await lintFixture(code, 'src/schema/test-fixture.mjs');
    expect(hasRestrictedImport(results)).toBe(true);
  });
});
