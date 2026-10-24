/**
 * Synchronous approval hash for server-side use only.
 *
 * This module lives behind a separate package.json export
 * (`@nestself/content/schema/node`) to keep the main
 * `@nestself/content/schema` entry point free of Node.js built-in
 * imports.
 *
 * Design choice: `@nestself/content` does not list `@types/node` as a
 * dependency because its main entry targets both browser and server.
 * This file declares a minimal inline type for `createHash` and uses
 * a dynamic `import()` cached on first call. The function is technically
 * async on the first invocation (to resolve the dynamic import), but
 * the API should call `initNodeCrypto()` at startup to warm the cache,
 * after which `approvalHashSync()` is synchronous.
 *
 * In browser contexts, use the async `approvalHash()` from
 * `@nestself/content/schema` which uses the Web Crypto API.
 */
import { type ApprovalHashInput, canonicalize } from './canonicalize.ts';

// ---------------------------------------------------------------------------
// Minimal type for the subset of node:crypto we use
// ---------------------------------------------------------------------------

interface CreateHashFn {
  (algorithm: string): { update(data: string): { digest(encoding: 'hex'): string } };
}

let _createHash: CreateHashFn | undefined;

/**
 * Warm the node:crypto cache. Call this once at API startup so that
 * subsequent `approvalHashSync()` calls are truly synchronous.
 */
export async function initNodeCrypto(): Promise<void> {
  if (_createHash) return;
  const mod: { createHash: CreateHashFn } = await import('node:crypto' as string);
  _createHash = mod.createHash;
}

/**
 * Compute the SHA-256 hex digest synchronously using Node.js crypto.
 *
 * Requires `initNodeCrypto()` to have been called first (once, at
 * startup). Throws if the crypto module has not been loaded.
 */
export function approvalHashSync(input: ApprovalHashInput): string {
  if (!_createHash) {
    throw new Error(
      'approvalHashSync: call initNodeCrypto() first. ' +
        'Use the async approvalHash() in browsers.',
    );
  }
  const canonical = canonicalize(input);
  return _createHash('sha256').update(canonical).digest('hex');
}
