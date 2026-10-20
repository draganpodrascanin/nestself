// @ts-check
import globals from 'globals';
import { base } from './base.js';

/** @type {import('eslint').Linter.Config[]} */
export const node = [
  ...base,
  { name: 'nestself/node', languageOptions: { globals: globals.node }, rules: { 'no-console': 'off' } },
];
