/**
 * Module-level mutable ref for the global error handler deps (ruling 6).
 *
 * Set by the root component once auth and router are available.
 * Read by QueryCache/MutationCache onError callbacks.
 */
import type { ErrorHandlerDeps } from './handle-api-error';

export const globalErrorDepsRef: { current: ErrorHandlerDeps | null } = { current: null };
