import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Full-app synth with cdk-nag takes >10 s when turbo runs every package's tests in parallel.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
