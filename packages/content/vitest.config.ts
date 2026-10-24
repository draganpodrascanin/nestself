import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // Render tests need jsdom; schema tests stay in node.
    environmentMatchGlobs: [
      ['src/render/**/*.test.tsx', 'jsdom'],
    ],
  },
});
