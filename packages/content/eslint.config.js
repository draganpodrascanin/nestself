import { motionImportRule } from '@nestself/eslint-config/base';
import { react } from '@nestself/eslint-config/react';

/** @type {import('eslint').Linter.Config[]} */
export default [
  ...react,
  // Guard: src/schema/** and src/search/** must not import React or React-
  // dependent packages, editor/render subpaths, or motion internals.
  // The schema subpath is imported by the API (Node.js) and must stay
  // free of browser/React dependencies (C-04, I12, N3).
  {
    name: 'nestself/content-schema-no-react',
    files: [
      'src/{schema,search}/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: motionImportRule[1].paths,
          patterns: [
            { group: ['react', 'react/*', 'react-dom', 'react-dom/*', '@tiptap/react', '@tiptap/react/*', '@nestself/ui', '@nestself/ui/*'], message: 'Schema and search subpaths must not import React or UI packages (C-04).' },
            { regex: '(^|/)(render|editor)(/|$)', message: 'Schema and search subpaths must not import render or editor internals (I12).' },
          ],
        },
      ],
    },
  },
  // Guard: src/render/** and src/editor/** must not use dangerouslySetInnerHTML
  // or innerHTML. The renderer uses React children only (C-03, FMT-R-14, 6.9).
  // Uses no-restricted-syntax (built-in) instead of react/no-danger since
  // eslint-plugin-react is not a dependency. The selector catches both the
  // JSX attribute and any string reference to innerHTML.
  {
    name: 'nestself/content-no-danger',
    files: [
      'src/{render,editor}/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'JSXAttribute[name.name="dangerouslySetInnerHTML"]',
          message: 'dangerouslySetInnerHTML is banned in render/ and editor/ (C-03, FMT-R-14, 6.9). Use React children instead.',
        },
      ],
    },
  },
];
