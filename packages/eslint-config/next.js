// @ts-check
import nextConfig from 'eslint-config-next';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier/flat';

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
    },
  },
];
