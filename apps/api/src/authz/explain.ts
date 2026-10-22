/**
 * Authorization engine with explanation trace.
 *
 * Delegates to the same `evaluate()` function as `authorize()`, passing
 * a trace array so the two can never disagree (AUTHZ-R-42).
 *
 * @see Section 4.5.9 of auth-strategy.md
 * Satisfies AUTHZ-R-42.
 */
import type {
  Action,
  Principal,
  Resource,
  AuthorizationContext,
  Decision,
} from '@nestself/contracts';
import { evaluate } from './authorize.js';

/**
 * Evaluate authorization with a populated explanation trace.
 *
 * Satisfies AUTHZ-R-42.
 */
export function explain(
  principal: Principal,
  action: Action,
  resource: Resource,
  ctx: AuthorizationContext,
): Decision {
  const trace: string[] = [];
  return evaluate(principal, action, resource, ctx, trace);
}
