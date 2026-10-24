/**
 * Authorization engine public surface.
 *
 * @see Section 4.5 of auth-strategy.md
 */
export { authorize, evaluate } from './authorize.js';
export { authorizeMany } from './authorize-many.js';
export { explain } from './explain.js';
export { effectiveAccess, effectiveActions } from './effective-access.js';
export { isContextValid, type ContextValidationResult } from './context.js';
export {
  isMembershipDateCurrent,
  hasActiveDateCurrentMembership,
  resolveDefaultPersonalOrgId,
  computeAvailableContexts,
  type AvailableContextSource,
} from './personal-context.js';
export { matchesScope, ADMINISTRATIVE_SCOPE_TYPES } from './scope.js';
export { evaluateCondition, evaluateConditions } from './conditions.js';
export { validateDelegation } from './delegation.js';
