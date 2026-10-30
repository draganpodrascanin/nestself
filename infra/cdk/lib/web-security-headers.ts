/**
 * Response headers for the workspace and admin SPAs on CloudFront (T-CW-1.5).
 *
 * The Content-Security-Policy is the header form of
 * `apps/<app>/src/security/content-security-policy.ts` (docs/web/csp.md),
 * rebuilt here so the CDK app does not import app source.
 * `test/web-security-headers.test.ts` compares the two and fails on any drift.
 * The inline-script hash is read from the app's `index.html` at synth time,
 * so editing the theme bootstrap needs no change here.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';

export type WebApp = 'workspace' | 'admin';

/** The Chime SDK media session: signalling over WebSocket, control over HTTPS (D-CW-20, CORE-30). */
const CHIME_CONNECT_SOURCES = ['https://*.chime.aws', 'wss://*.chime.aws', 'https://*.sdkassets.chime.aws'];
/** Background blur and Voice Focus load their worker and WebAssembly from the SDK asset host (CW-R-55b). */
const CHIME_ASSET_SOURCES = ['https://*.sdkassets.chime.aws'];

/** Calls need the camera, microphone, screen share and full screen; only the app itself may ask. */
export const WEB_APP_PERMISSIONS_POLICY = 'camera=(self), microphone=(self), display-capture=(self), fullscreen=(self)';

/** CloudFront's limit on the Content-Security-Policy value of a response headers policy. */
export const CLOUDFRONT_CSP_MAX_LENGTH = 1783;

const repoRoot = path.join(import.meta.dirname, '..', '..', '..');

/** `sha256-…` hashes of the inline `<script>` bodies (scripts without `src`) of an HTML document. */
export function inlineScriptHashes(html: string): string[] {
  return [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
    .map((match) => match[1] ?? '')
    .filter((body) => body.trim() !== '')
    .map((body) => `sha256-${createHash('sha256').update(body).digest('base64')}`);
}

/** The inline-script hashes of `apps/<app>/index.html`. */
export function webAppInlineScriptHashes(app: WebApp): string[] {
  return inlineScriptHashes(readFileSync(path.join(repoRoot, 'apps', app, 'index.html'), 'utf8'));
}

export interface WebAppContentSecurityPolicyOptions {
  readonly inlineScriptHashes: readonly string[];
  /** The origin the app calls the API on; deployed, `/api/*` goes through the app's own distribution. */
  readonly apiOrigin: string;
}

/** The header form of the web apps' policy, including `frame-ancestors 'none'`. */
export function webAppContentSecurityPolicy({ inlineScriptHashes: hashes, apiOrigin }: WebAppContentSecurityPolicyOptions): string {
  const api = [apiOrigin, apiOrigin.replace(/^http/, 'ws')];
  const directives: [string, readonly string[]][] = [
    ['default-src', ["'self'"]],
    // 'wasm-unsafe-eval' compiles the blur and Voice Focus WebAssembly; it does not allow eval().
    ['script-src', ["'self'", "'wasm-unsafe-eval'", 'blob:', ...CHIME_ASSET_SOURCES, ...hashes.map((hash) => `'${hash}'`)]],
    ['worker-src', ["'self'", 'blob:', ...CHIME_ASSET_SOURCES]],
    // Older Safari reads workers from child-src.
    ['child-src', ["'self'", 'blob:']],
    ['connect-src', ["'self'", ...api, ...CHIME_CONNECT_SOURCES]],
    ['img-src', ["'self'", 'data:', 'blob:']],
    ['media-src', ["'self'", 'blob:']],
    // Base UI and Motion set inline styles at runtime.
    ['style-src', ["'self'", "'unsafe-inline'"]],
    ['font-src', ["'self'", 'data:']],
    ['object-src', ["'none'"]],
    ['base-uri', ["'self'"]],
    ['form-action', ["'self'"]],
    ['frame-ancestors', ["'none'"]],
  ];
  const policy = directives.map(([name, sources]) => `${name} ${sources.join(' ')}`).join('; ');
  if (policy.length > CLOUDFRONT_CSP_MAX_LENGTH) {
    throw new Error(`Content-Security-Policy is ${policy.length} characters; CloudFront accepts at most ${CLOUDFRONT_CSP_MAX_LENGTH}.`);
  }
  return policy;
}
