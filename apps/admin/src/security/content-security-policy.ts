/**
 * The admin app's Content Security Policy (guidelines 11.4, CW-R-55;
 * documented in docs/web/csp.md).
 *
 * `vite.config.ts` applies it twice: as a `<meta http-equiv>` tag injected
 * into the built `index.html` (so any static host enforces it) and as the
 * `vite preview` response header (which can also carry `frame-ancestors`).
 * The dev server sends no policy: React Refresh injects an inline module
 * script and HMR opens a websocket, neither of which belongs in production.
 * The CloudFront response-headers policy (`infra/cdk/lib/edge-stack.ts`)
 * must send the same header for deployed stages.
 *
 * Pure: no Node imports, so the test and the Vite config share it.
 */

/** The Chime SDK media session: signalling over WebSocket, control over HTTPS (D-CW-20, CORE-30). */
export const CHIME_CONNECT_SOURCES = ['https://*.chime.aws', 'wss://*.chime.aws', 'https://*.sdkassets.chime.aws'] as const;

/** Background blur and Voice Focus load their worker and WebAssembly from the SDK asset host (CW-R-55b, CW-R-99). */
export const CHIME_ASSET_SOURCES = ['https://*.sdkassets.chime.aws'] as const;

export interface ContentSecurityPolicyOptions {
  /** `sha256-…` hashes of the inline scripts in `index.html` (the theme bootstrap). */
  inlineScriptHashes: readonly string[];
  /** The API origin when `VITE_API_URL` points away from the page's own origin. */
  apiOrigin?: string | null;
  /** A `<meta>` policy cannot carry `frame-ancestors`; a header can. */
  delivery: 'meta' | 'header';
}

function websocketOrigin(origin: string): string {
  return origin.replace(/^http/, 'ws');
}

export function contentSecurityPolicyDirectives({
  inlineScriptHashes,
  apiOrigin,
  delivery,
}: ContentSecurityPolicyOptions): Record<string, readonly string[]> {
  const api = apiOrigin ? [apiOrigin, websocketOrigin(apiOrigin)] : [];
  const directives: Record<string, readonly string[]> = {
    'default-src': ["'self'"],
    // 'wasm-unsafe-eval' compiles the blur and Voice Focus WebAssembly; it does not allow eval().
    'script-src': ["'self'", "'wasm-unsafe-eval'", 'blob:', ...CHIME_ASSET_SOURCES, ...inlineScriptHashes.map((hash) => `'${hash}'`)],
    'worker-src': ["'self'", 'blob:', ...CHIME_ASSET_SOURCES],
    // Older Safari reads workers from child-src.
    'child-src': ["'self'", 'blob:'],
    'connect-src': ["'self'", ...api, ...CHIME_CONNECT_SOURCES],
    'img-src': ["'self'", 'data:', 'blob:'],
    'media-src': ["'self'", 'blob:'],
    // Base UI and Motion set inline styles at runtime.
    'style-src': ["'self'", "'unsafe-inline'"],
    'font-src': ["'self'", 'data:'],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
  };
  if (delivery === 'header') directives['frame-ancestors'] = ["'none'"];
  return directives;
}

export function contentSecurityPolicy(options: ContentSecurityPolicyOptions): string {
  return Object.entries(contentSecurityPolicyDirectives(options))
    .map(([name, sources]) => `${name} ${sources.join(' ')}`)
    .join('; ');
}

/** The inline `<script>` bodies of an HTML document (scripts without `src`). */
export function inlineScripts(html: string): string[] {
  return [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1] ?? '').filter((body) => body.trim() !== '');
}
