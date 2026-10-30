import { defineConfig, loadEnv } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import tailwindcss from '@tailwindcss/vite';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { contentSecurityPolicy, inlineScripts } from './src/security/content-security-policy';
import type { ContentSecurityPolicyOptions } from './src/security/content-security-policy';

const sha256 = (body: string) => `sha256-${createHash('sha256').update(body).digest('base64')}`;

/** The API origin when `VITE_API_URL` is absolute; same-origin `/api` needs no entry. */
function apiOrigin(url: string | undefined): string | null {
  try {
    return url ? new URL(url).origin : null;
  } catch {
    return null;
  }
}

/**
 * Injects the Content Security Policy as the first `<meta>` after the charset
 * in the built `index.html` (docs/web/csp.md). Build only: the dev server
 * needs React Refresh's inline script and the HMR websocket.
 */
function contentSecurityPolicyMeta(options: Omit<ContentSecurityPolicyOptions, 'inlineScriptHashes' | 'delivery'>): Plugin {
  return {
    name: 'nestself-content-security-policy',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const policy = contentSecurityPolicy({ ...options, inlineScriptHashes: inlineScripts(html).map(sha256), delivery: 'meta' });
        return html.replace(/(<meta charset="[^"]*"\s*\/?>)/i, `$1\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`);
      },
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), 'VITE_');
  const csp = { apiOrigin: apiOrigin(env.VITE_API_URL) };
  const indexHtml = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  return {
    plugins: [
      tanstackRouter({
        target: 'react',
        routesDirectory: './src/routes',
        generatedRouteTree: './src/routeTree.gen.ts',
        autoCodeSplitting: true,
      }),
      react(),
      tailwindcss(),
      contentSecurityPolicyMeta(csp),
    ],
    server: {
      port: 5174,
      strictPort: true,
      fs: { allow: [fileURLToPath(new URL('../..', import.meta.url))] },
      // `ws` carries the call room's Socket.IO connection (/api/ws) to the API.
      proxy: { '/api': { target: 'http://localhost:4000', changeOrigin: true, ws: true } },
    },
    preview: {
      headers: {
        'Content-Security-Policy': contentSecurityPolicy({ ...csp, inlineScriptHashes: inlineScripts(indexHtml).map(sha256), delivery: 'header' }),
      },
    },
    build: { sourcemap: true },
  };
});
