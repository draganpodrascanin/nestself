// @ts-check
import nextConfig from 'eslint-config-next';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier/flat';
import { motionImportRule } from './base.js';

/** @type {import('eslint').Linter.Config[]} */
export const next = [
  { name: 'nestself/ignores', ignores: ['**/.next/**', '**/out/**', '**/public/**', '**/node_modules/**'] },
  ...nextConfig,
  { name: 'prettier', ...prettier },
  {
    name: 'nestself/next-rules',
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-restricted-imports': motionImportRule,
    },
  },
];
