/**
 * Ports, URLs and the dedicated database of the consultation journeys
 * (`playwright.calls.config.ts`). Plain JavaScript so the Vite wrapper
 * configs, the database script and the TypeScript specs share one source.
 *
 * Every value has its own port so the suite never reuses a dev server from
 * another checkout (the main checkout runs the API on 4000 and the
 * workspace on 5173). Override with the environment variables named here.
 */
const env = (name, fallback) => process.env[name] || fallback;

export const API_PORT = Number(env('E2E_CALLS_API_PORT', '4117'));
export const WORKSPACE_PORT = Number(env('E2E_CALLS_WORKSPACE_PORT', '5187'));
export const ADMIN_PORT = Number(env('E2E_CALLS_ADMIN_PORT', '5188'));

export const API_URL = `http://localhost:${API_PORT}`;
export const WORKSPACE_URL = `http://localhost:${WORKSPACE_PORT}`;
export const ADMIN_URL = `http://localhost:${ADMIN_PORT}`;

/**
 * The journeys write to their own database (sessions end, outcomes are
 * recorded), never to the `nestself` development database.
 */
export const DATABASE_URL = env(
  'E2E_CALLS_DATABASE_URL',
  'postgresql://nestself:nestself_dev@localhost:54329/nestself_test_e2e17',
);

/**
 * Its own Redis database index, so the API's BullMQ queues and caches never
 * mix with a development API on index 0. (Pub/sub channels are global in
 * Redis; the only one the suite publishes on is the principal cache
 * invalidation, which is harmless to any listener.)
 */
export const REDIS_URL = env('E2E_CALLS_REDIS_URL', 'redis://localhost:6379/7');
