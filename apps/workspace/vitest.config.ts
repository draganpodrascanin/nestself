import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
    // Tests assume sample mode regardless of a developer's `.env.local`.
    env: { VITE_DATA_SOURCE: 'sample' },
  },
});
