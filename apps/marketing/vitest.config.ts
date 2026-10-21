import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react-swc';
import { defineConfig } from 'vitest/config';

const alias = { '@': fileURLToPath(new URL('./src', import.meta.url)) };

export default defineConfig({
  test: {
    projects: [
      {
        // Component tests run in jsdom with Testing Library and axe.
        plugins: [],
        resolve: { alias },
        // The Next tsconfig keeps jsx: preserve, so JSX in tests is transformed by the React SWC plugin.
        plugins: [react()],
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['src/**/*.test.tsx'],
          setupFiles: ['./src/test/setup.ts'],
          css: false,
        },
      },
      {
        // Loaders, schemas, route handlers and scripts run in node.
        resolve: { alias },
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs'],
        },
      },
    ],
  },
});
