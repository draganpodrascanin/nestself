/**
 * Resolve the PrincipalContext for the library from the authenticated
 * Principal. Finds the ACTIVE membership matching the personal context's
 * orgId and returns `{ userId, orgId, membershipId }`.
 *
 * Throws if the context is not personal or has no matching ACTIVE membership.
 */
import { HttpStatus } from '@nestjs/common';
import type { Principal } from '@nestself/contracts';
import type { PrincipalContext } from './availability/availability-context-loader.js';
import { ApiHttpException } from '../common/api-error.js';

export function resolveLibraryContext(principal: Principal): PrincipalContext {
  const ctx = principal.context;
  if (ctx.kind !== 'personal' || !ctx.orgId) {
    throw new ApiHttpException({
      status: HttpStatus.FORBIDDEN,
      code: 'invalid_context',
      message: 'This endpoint requires a personal context with an organisation',
    });
  }

  const membership = principal.memberships.find(
    (m) => m.orgId === ctx.orgId && m.status === 'ACTIVE',
  );
  if (!membership) {
    throw new ApiHttpException({
      status: HttpStatus.FORBIDDEN,
      code: 'invalid_context',
      message: 'No active membership found for the current context',
    });
  }

  return {
    userId: principal.userId,
    orgId: ctx.orgId,
    membershipId: membership.membershipId,
  };
}
