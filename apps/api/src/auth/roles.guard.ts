import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { Reflector } from '@nestjs/core';
import type { OrgRole, PlatformRole } from '@nestself/contracts';
import { ROLES_KEY, ORG_PARAM_KEY } from './roles.decorator.js';
import type { AuthUser } from './types.js';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<
      Array<OrgRole | PlatformRole> | undefined
    >(ROLES_KEY, [context.getHandler(), context.getClass()]);

    // No roles metadata means no restriction
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      user?: AuthUser;
      params: Record<string, string>;
    }>();
    const user = request.user;
    if (!user) {
      throw new ForbiddenException('No authenticated user');
    }

    // Check platform role first
    if (user.platformRole && requiredRoles.includes(user.platformRole)) {
      return true;
    }

    // Check org-scoped role
    const orgParam = this.reflector.getAllAndOverride<string | undefined>(
      ORG_PARAM_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (orgParam) {
      const orgId = request.params[orgParam];
      if (orgId) {
        const membership = user.memberships.find((m) => m.orgId === orgId);
        if (membership && requiredRoles.includes(membership.role)) {
          return true;
        }
      }
    }

    throw new ForbiddenException('Insufficient permissions');
  }
}
