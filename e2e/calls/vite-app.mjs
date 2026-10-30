/**
 * Wraps an app's own Vite config for the consultation journeys: same
 * plugins and settings, but its own port, its own dependency cache and the
 * `/api` proxy (HTTP and the call room's WebSocket) pointed at the journeys'
 * API instead of the default `localhost:4000`.
 */
import { API_URL } from './servers.mjs';

export function forJourneys(appConfig, port) {
  return async (env) => {
    const config = typeof appConfig === 'function' ? await appConfig(env) : await appConfig;
    return {
      ...config,
      // A separate optimizer cache: another dev server of the same app in this
      // checkout must not re-optimize the dependencies under this one.
      cacheDir: 'node_modules/.vite-e2e-calls',
      server: {
        ...config.server,
        port,
        strictPort: true,
        // No hot updates: an edit elsewhere in the checkout must not reload a page in the
        // middle of a call. Every navigation still gets the current code.
        hmr: false,
        proxy: { '/api': { target: API_URL, changeOrigin: true, ws: true } },
      },
    };
  };
}
