import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['src/**/*.{spec,test}.ts', 'test/**/*.{spec,test}.ts'],
    environment: 'node',
    env: {
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
      JWT_SECRET: 'test-secret-that-is-at-least-32-characters-long',
      NODE_ENV: 'test',
      // Tests never reach S3: a developer's `.env` with MEDIA_STORAGE=s3 must not
      // make every e2e suite's AppModule construct the S3 adapter (dotenv keeps
      // a variable that is already set).
      MEDIA_STORAGE: 'local',
    },
  },
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
