/** Shared error constructors and context helpers of the workplace reviews module. */
import type { Principal } from '@nestself/contracts';
import { ApiHttpException } from '../common/api-error.js';

export function conflict(code: string, message: string, details?: Record<string, unknown>): ApiHttpException {
  return new ApiHttpException({ status: 409, code, message, details });
}

export function notFound(): ApiHttpException {
  return new ApiHttpException({ status: 404, code: 'not_found', message: 'Resource not found' });
}

export function validationError(message: string, field: string, extra: Record<string, unknown> = {}): ApiHttpException {
  return new ApiHttpException({ status: 400, code: 'validation', message, details: { field, ...extra } });
}

/** Passed to every single-record check on the reviewer's side: a denial must look exactly like a missing engagement. */
export const DENY_AS_NOT_FOUND = { denyAs: 'not_found' } as const;

/** The organization of the caller's organization context (the employer routes carry `:orgId`, which must match). */
export function assertOrgContext(principal: Principal, orgId: string): void {
  const ctx = principal.context;
  if (ctx.kind !== 'organization' || ctx.orgId !== orgId) {
    throw new ApiHttpException({ status: 403, code: 'invalid_context', message: 'This endpoint requires the organization context of the route' });
  }
}

export function assertExpertContext(principal: Principal): void {
  if (principal.context.kind !== 'expert') {
    throw new ApiHttpException({ status: 403, code: 'invalid_context', message: 'This endpoint requires the expert context' });
  }
}
