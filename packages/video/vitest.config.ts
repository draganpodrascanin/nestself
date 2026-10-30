import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
    // The webinar flows drive several clients, dialogs and Motion exits end to end; parallel agents load the machine.
    testTimeout: 15_000,
  },
});
