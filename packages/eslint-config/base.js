// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier/flat';

/**
 * Motion rule (CLAUDE.md): Motion was renamed from Framer Motion, and the
 * full `motion` component defeats LazyMotion; `@nestself/ui` re-exports `m`.
 */
export const motionImportRule = [
  'error',
  {
    paths: [
      { name: 'framer-motion', message: 'Framer Motion is now Motion: use m, AnimatePresence and useMotionPreset from @nestself/ui.' },
      { name: 'motion/react', importNames: ['motion'], message: 'Use m (motion/react-m) inside MotionFeatures so LazyMotion keeps the bundle small.' },
    ],
  },
];

/** @type {import('eslint').Linter.Config[]} */
export const base = [
  {
    name: 'nestself/ignores',
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/out/**',
      '**/node_modules/**',
      '**/.turbo/**',
      '**/.expo/**',
      '**/coverage/**',
      '**/storybook-static/**',
      '**/*.gen.ts',
      '**/src/generated/**',
      '**/public/**',
    ],
  },
  { name: 'eslint/recommended', ...eslint.configs.recommended },
  ...tseslint.configs.recommended,
  { name: 'prettier', ...prettier },
  {
    name: 'nestself/rules',
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports', fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-empty-object-type': 'off',
      'no-restricted-imports': motionImportRule,
    },
  },
];
