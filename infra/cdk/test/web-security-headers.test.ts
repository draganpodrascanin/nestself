import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import {
  CLOUDFRONT_CSP_MAX_LENGTH,
  webAppContentSecurityPolicy,
  webAppInlineScriptHashes,
} from '../lib/web-security-headers.js';
import { getStageConfig } from '../lib/config.js';

/** The shape of `apps/<app>/src/security/content-security-policy.ts` (docs/web/csp.md). */
interface AppPolicyModule {
  contentSecurityPolicy(options: {
    inlineScriptHashes: readonly string[];
    apiOrigin?: string | null;
    delivery: 'meta' | 'header';
  }): string;
  inlineScripts(html: string): string[];
}

const repoRoot = path.join(import.meta.dirname, '..', '..', '..');

async function appPolicyModule(app: 'workspace' | 'admin'): Promise<AppPolicyModule> {
  const modulePath = path.join(repoRoot, 'apps', app, 'src', 'security', 'content-security-policy.ts');
  return (await import(modulePath)) as AppPolicyModule;
}

const sha256 = (body: string) => `sha256-${createHash('sha256').update(body).digest('base64')}`;

describe.each(['workspace', 'admin'] as const)('%s app headers', (app) => {
  const appUrls = (['staging', 'production'] as const).map((stage) => {
    const config = getStageConfig(stage);
    return app === 'workspace' ? config.workspaceUrl : config.adminUrl;
  });

  it('hashes the inline scripts of index.html the way the Vite config does', async () => {
    const policy = await appPolicyModule(app);
    const html = readFileSync(path.join(repoRoot, 'apps', app, 'index.html'), 'utf8');
    const expected = policy.inlineScripts(html).map(sha256);
    expect(expected.length).toBeGreaterThan(0);
    expect(webAppInlineScriptHashes(app)).toEqual(expected);
  });

  it('is exactly the header form of the app policy, per stage origin (no drift)', async () => {
    const policy = await appPolicyModule(app);
    const inlineScriptHashes = webAppInlineScriptHashes(app);
    for (const url of appUrls) {
      const apiOrigin = new URL(url).origin;
      expect(webAppContentSecurityPolicy({ inlineScriptHashes, apiOrigin })).toBe(
        policy.contentSecurityPolicy({ inlineScriptHashes, apiOrigin, delivery: 'header' }),
      );
    }
  });

  it('fits the CloudFront Content-Security-Policy limit', () => {
    for (const url of appUrls) {
      const header = webAppContentSecurityPolicy({
        inlineScriptHashes: webAppInlineScriptHashes(app),
        apiOrigin: new URL(url).origin,
      });
      expect(header.length).toBeLessThanOrEqual(CLOUDFRONT_CSP_MAX_LENGTH);
    }
  });
});
