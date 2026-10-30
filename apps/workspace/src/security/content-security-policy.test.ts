import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, contentSecurityPolicyDirectives, inlineScripts } from './content-security-policy';

const html = readFileSync(join(import.meta.dirname, '../../index.html'), 'utf8');
const sha256 = (body: string) => `sha256-${createHash('sha256').update(body).digest('base64')}`;

describe('content security policy', () => {
  const hashes = inlineScripts(html).map(sha256);

  it('allows the Chime SDK media session and its asset host (CW-R-55)', () => {
    const directives = contentSecurityPolicyDirectives({ inlineScriptHashes: hashes, delivery: 'header' });
    expect(directives['connect-src']).toEqual(expect.arrayContaining(['https://*.chime.aws', 'wss://*.chime.aws', 'https://*.sdkassets.chime.aws']));
    expect(directives['script-src']).toEqual(expect.arrayContaining(['https://*.sdkassets.chime.aws', "'wasm-unsafe-eval'"]));
    expect(directives['worker-src']).toEqual(expect.arrayContaining(['https://*.sdkassets.chime.aws', 'blob:']));
  });

  it('allows exactly the inline theme script by hash, and no inline script otherwise', () => {
    expect(hashes).toHaveLength(1);
    const scriptSrc = contentSecurityPolicyDirectives({ inlineScriptHashes: hashes, delivery: 'meta' })['script-src'];
    expect(scriptSrc).toContain(`'${hashes[0]}'`);
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
  });

  it('adds the API origin and its websocket when the API lives elsewhere', () => {
    const connect = contentSecurityPolicyDirectives({ inlineScriptHashes: [], apiOrigin: 'https://api.example.test', delivery: 'meta' })['connect-src'];
    expect(connect).toEqual(expect.arrayContaining(['https://api.example.test', 'wss://api.example.test']));
  });

  it('carries frame-ancestors only in the header form', () => {
    expect(contentSecurityPolicy({ inlineScriptHashes: [], delivery: 'header' })).toContain("frame-ancestors 'none'");
    expect(contentSecurityPolicy({ inlineScriptHashes: [], delivery: 'meta' })).not.toContain('frame-ancestors');
  });
});
