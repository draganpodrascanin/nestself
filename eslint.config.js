// @ts-check
import globals from 'globals';
import { node } from '@nestself/eslint-config/node';

/** @type {import('eslint').Linter.Config[]} */
export default [
  ...node,
  {
    name: 'nestself-root/ignore-workspaces',
    // Workspaces lint themselves; the Playwright report and results folders are generated (git-ignored).
    ignores: ['apps/**', 'packages/**', 'e2e/auth-report/**', 'e2e/auth-results/**'],
  },
  {
    name: 'nestself-e2e/browser-globals',
    files: ['e2e/**/*.ts', 'e2e/**/*.mjs'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
];
