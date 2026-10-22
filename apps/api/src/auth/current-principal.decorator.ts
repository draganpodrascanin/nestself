/**
 * @CurrentPrincipal() parameter decorator — extracts the Principal
 * set by the AuthenticationGuard.
 *
 * @see D-19
 */
import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Principal } from '@nestself/contracts';

export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Principal => {
    const request = ctx.switchToHttp().getRequest<{ principal: Principal }>();
    return request.principal;
  },
);
