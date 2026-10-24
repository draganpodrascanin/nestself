import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react-swc';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    // Tests assume sample mode regardless of a developer's `.env.local`.
    env: { VITE_DATA_SOURCE: 'sample' },
  },
});
