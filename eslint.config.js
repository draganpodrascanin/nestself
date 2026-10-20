// @ts-check
import globals from 'globals';
import { node } from '@nestself/eslint-config/node';

/** @type {import('eslint').Linter.Config[]} */
export default [
  ...node,
  {
    name: 'nestself-root/ignore-workspaces',
    ignores: ['apps/**', 'packages/**'],
  },
  {
    name: 'nestself-e2e/browser-globals',
    files: ['e2e/**/*.ts', 'e2e/**/*.mjs'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
];
