// @ts-check
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import { base } from './base.js';

/** @type {import('eslint').Linter.Config[]} */
export const reactNative = [
  ...base,
  reactHooks.configs.flat['recommended-latest'],
  {
    name: 'nestself/react-native',
    languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
    settings: { react: { version: '19' } },
  },
  {
    name: 'nestself/react-native-cjs',
    files: ['**/*.cjs', 'babel.config.js'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
  },
];
