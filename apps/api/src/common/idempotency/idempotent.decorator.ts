/**
 * @Idempotent(scope) -- request-level idempotency for a controller handler.
 *
 * Applies {@link IdempotencyInterceptor} to the handler, so no per-controller
 * or module wiring is needed (the KeyValueStore is global). Interceptors run
 * after the global guards, so the Principal is already resolved.
 *
 * @see ARC-R-10, RTE-R-05, CLI-R-10, T-C1.07
 */
import { SetMetadata, UseInterceptors, applyDecorators } from '@nestjs/common';
import { IdempotencyInterceptor } from './idempotency.interceptor.js';
import { IDEMPOTENT_KEY, type IdempotentMetadata } from './idempotent.metadata.js';

export interface IdempotentOptions {
  /** Reject requests without an `Idempotency-Key` header (400). Default false. */
  required?: boolean;
  /** Override the in-flight reservation TTL in seconds (default 60). Use for long uploads. */
  inFlightTtlSeconds?: number;
  /**
   * Header names (lowercase) included in the request fingerprint so that
   * the idempotency key is also tied to their values.  For media uploads
   * this carries `['content-digest']` so a replayed key with a different
   * payload digest triggers `payload_mismatch` without buffering the body.
   */
  fingerprintHeaders?: string[];
}

export const Idempotent = (scope: string, options: IdempotentOptions = {}) =>
  applyDecorators(
    SetMetadata(IDEMPOTENT_KEY, {
      scope,
      required: options.required ?? false,
      inFlightTtlSeconds: options.inFlightTtlSeconds,
      fingerprintHeaders: options.fingerprintHeaders,
    } satisfies IdempotentMetadata),
    UseInterceptors(IdempotencyInterceptor),
  );
