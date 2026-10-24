import { react } from '@nestself/eslint-config/react';

/** @type {import('eslint').Linter.Config[]} */
export default [
  ...react,
  // Guard: src/schema/** and src/search/** must not import React or React-
  // dependent packages, editor/render subpaths, or motion internals.
  // The schema subpath is imported by the API (Node.js) and must stay
  // free of browser/React dependencies (C-04, I12).
  {
    name: 'nestself/content-schema-no-react',
    files: [
      'src/schema/**/*.ts',
      'src/schema/**/*.tsx',
      'src/schema/**/*.mjs',
      'src/search/**/*.ts',
      'src/search/**/*.tsx',
      'src/search/**/*.mjs',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['react', 'react/*'], message: 'Schema and search subpaths must not import React (C-04).' },
            { group: ['react-dom', 'react-dom/*'], message: 'Schema and search subpaths must not import react-dom (C-04).' },
            { group: ['@tiptap/react', '@tiptap/react/*'], message: 'Schema and search subpaths must not import @tiptap/react (C-04).' },
            { group: ['@nestself/ui', '@nestself/ui/*'], message: 'Schema and search subpaths must not import @nestself/ui (C-04).' },
            { group: ['**/render/**'], message: 'Schema and search subpaths must not import render internals (I12).' },
            { group: ['**/editor/**'], message: 'Schema and search subpaths must not import editor internals (I12).' },
            { group: ['@nestself/content/editor'], message: 'Schema and search subpaths must not import the editor subpath (I12).' },
            { group: ['@nestself/content/render'], message: 'Schema and search subpaths must not import the render subpath (I12).' },
          ],
        },
      ],
    },
  },
];
