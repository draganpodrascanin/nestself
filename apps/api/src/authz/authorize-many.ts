/**
 * Batch authorization evaluation.
 *
 * Evaluates multiple authorization requests in a single call,
 * returning a positional array of decisions.
 *
 * @see Section 4.5.8 of auth-strategy.md
 * Satisfies AUTHZ-R-41.
 */
import type { AuthorizationRequest, Decision } from '@nestself/contracts';
import { authorize } from './authorize.js';

/**
 * Evaluate an array of authorization requests.
 *
 * Each request carries its own `AuthorizationContext`. The function
 * returns `Decision[i]` corresponding to `requests[i]`. No shared
 * mutable state exists between evaluations.
 *
 * Satisfies AUTHZ-R-41.
 */
export function authorizeMany(
  requests: readonly AuthorizationRequest[],
): Decision[] {
  return requests.map((req) =>
    authorize(req.principal, req.action, req.resource, req.ctx),
  );
}
