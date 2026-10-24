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
}

export const Idempotent = (scope: string, options: IdempotentOptions = {}) =>
  applyDecorators(
    SetMetadata(IDEMPOTENT_KEY, {
      scope,
      required: options.required ?? false,
      inFlightTtlSeconds: options.inFlightTtlSeconds,
    } satisfies IdempotentMetadata),
    UseInterceptors(IdempotencyInterceptor),
  );
