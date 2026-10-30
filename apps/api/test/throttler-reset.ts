/**
 * Resets the in-memory throttler between integration tests: every request of
 * a suite comes from the same socket address, and the SSO routes allow 10 a
 * minute per IP.
 *
 * `@nestjs/throttler` 6.7.1 has no public reset on `ThrottlerStorageService`:
 * only the `storage` getter (the per-key records) is public, and the hit
 * timestamps live in the private `hitExpirations` map, which `increment`
 * prunes but never clears. Both are cleared here through that 6.7.1 shape;
 * re-check this helper when the catalog upgrades `@nestjs/throttler` (a
 * missing `hitExpirations` is tolerated, a missing `storage` fails loudly).
 */
import type { INestApplication } from '@nestjs/common';
import { getStorageToken } from '@nestjs/throttler';

interface ThrottlerStorage671Shape {
  /** Public getter in 6.7.1. */
  storage: Map<string, unknown>;
  /** Private in 6.7.1. */
  hitExpirations?: Map<string, unknown>;
}

export function resetThrottlerStorage(app: INestApplication): void {
  const service = app.get(getStorageToken()) as ThrottlerStorage671Shape;
  if (!(service.storage instanceof Map)) {
    throw new Error('ThrottlerStorageService no longer exposes `storage` as a Map: update test/throttler-reset.ts');
  }
  service.storage.clear();
  service.hitExpirations?.clear();
}
