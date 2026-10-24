import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        // Schema tests run in node
        test: {
          name: 'schema',
          environment: 'node',
          include: ['src/schema/**/*.test.ts'],
        },
      },
      {
        // Render tests run in jsdom with the test setup
        test: {
          name: 'render',
          environment: 'jsdom',
          include: ['src/render/**/*.test.tsx'],
          setupFiles: ['src/test/setup.ts'],
        },
      },
    ],
  },
});
