/// <reference types="node" />
/**
 * Proves the ESLint guard rejects React, editor, render, and motion
 * imports from schema/ and search/ (I12, N3).
 *
 * Runs ESLint programmatically on fixture strings to verify the
 * `no-restricted-imports` rule fires for all restricted patterns.
 */
import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';
import { join } from 'node:path';

const contentRoot = join(import.meta.dirname!, '..', '..');

// Shared ESLint instance — reusing avoids the cold-start penalty that
// causes timeouts under parallel vitest runs.
let _eslint: ESLint | null = null;
function getEslint(): ESLint {
  if (!_eslint) {
    _eslint = new ESLint({
      overrideConfigFile: join(contentRoot, 'eslint.config.js'),
      cwd: contentRoot,
    });
  }
  return _eslint;
}

async function lintFixture(code: string, filename: string): Promise<ESLint.LintResult[]> {
  return getEslint().lintText(code, { filePath: filename });
}

function hasRestrictedImport(results: ESLint.LintResult[]): boolean {
  return results.flatMap((r) => r.messages).some((m) => m.ruleId === 'no-restricted-imports');
}

// ---------------------------------------------------------------------------
// Forbidden imports from schema/ and search/ (I12)
// ---------------------------------------------------------------------------

describe('ESLint guard — forbidden imports (I12)', { timeout: 15_000 }, () => {
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

  // Relative editor/render paths (I12, N3: regex pattern)
  for (const pattern of ['../editor/foo', '../render/bar', './render', './render/index.ts', '../editor']) {
    it(`rejects relative '${pattern}' from schema/`, async () => {
      const code = `import something from '${pattern}';\nexport default something;\n`;
      const results = await lintFixture(code, 'src/schema/test-fixture.ts');
      expect(hasRestrictedImport(results)).toBe(true);
    });
  }

  // N3: framer-motion and motion/react paths merged from base config
  for (const mod of ['framer-motion', 'motion/react']) {
    it(`rejects '${mod}' from schema/ (N3 motion paths)`, async () => {
      const code = `import { motion } from '${mod}';\nexport { motion };\n`;
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

  it('allows ../renderer-utils (not render or editor)', async () => {
    const code = `import something from '../renderer-utils';\nexport default something;\n`;
    const results = await lintFixture(code, 'src/schema/test-fixture.ts');
    expect(hasRestrictedImport(results)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Multiple file extensions covered (N3: widened files glob)
// ---------------------------------------------------------------------------

describe('ESLint guard — file extensions (N3)', () => {
  for (const ext of ['.ts', '.tsx', '.mjs', '.js', '.jsx', '.mts', '.cjs', '.cts']) {
    it(`rejects react from schema ${ext} file`, async () => {
      const code = `import something from 'react';\nexport default something;\n`;
      const results = await lintFixture(code, `src/schema/test-fixture${ext}`);
      expect(hasRestrictedImport(results)).toBe(true);
    });
  }

  for (const ext of ['.ts', '.mjs']) {
    it(`rejects react from search ${ext} file`, async () => {
      const code = `import something from 'react';\nexport default something;\n`;
      const results = await lintFixture(code, `src/search/test-fixture${ext}`);
      expect(hasRestrictedImport(results)).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// react/no-danger guard for render/ and editor/ (T-C1.06)
// ---------------------------------------------------------------------------

function hasNoDangerViolation(results: ESLint.LintResult[]): boolean {
  return results.flatMap((r) => r.messages).some(
    (m) => m.ruleId === 'no-restricted-syntax' && m.message.includes('dangerouslySetInnerHTML'),
  );
}

describe('ESLint guard — no dangerouslySetInnerHTML (T-C1.06)', { timeout: 15_000 }, () => {
  it('rejects dangerouslySetInnerHTML in render/', async () => {
    const code = `import React from 'react';\nexport default function X() { return <div dangerouslySetInnerHTML={{ __html: '' }} />; }\n`;
    const results = await lintFixture(code, 'src/render/test-fixture.tsx');
    expect(hasNoDangerViolation(results)).toBe(true);
  });

  it('rejects dangerouslySetInnerHTML in editor/', async () => {
    const code = `import React from 'react';\nexport default function X() { return <div dangerouslySetInnerHTML={{ __html: '' }} />; }\n`;
    const results = await lintFixture(code, 'src/editor/test-fixture.tsx');
    expect(hasNoDangerViolation(results)).toBe(true);
  });

  it('allows normal JSX in render/', async () => {
    const code = `import React from 'react';\nexport default function X() { return <div>Hello</div>; }\n`;
    const results = await lintFixture(code, 'src/render/test-fixture.tsx');
    expect(hasNoDangerViolation(results)).toBe(false);
  });

  it('allows dangerouslySetInnerHTML outside render/ and editor/ (no rule applied)', async () => {
    const code = `import React from 'react';\nexport default function X() { return <div dangerouslySetInnerHTML={{ __html: '' }} />; }\n`;
    const results = await lintFixture(code, 'src/components/test-fixture.tsx');
    expect(hasNoDangerViolation(results)).toBe(false);
  });
});
