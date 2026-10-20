import { SetMetadata } from '@nestjs/common';
import type { OrgRole, PlatformRole } from '@nestself/contracts';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: Array<OrgRole | PlatformRole>) =>
  SetMetadata(ROLES_KEY, roles);

export const ORG_PARAM_KEY = 'orgParam';
export const OrgParam = (paramName: string) =>
  SetMetadata(ORG_PARAM_KEY, paramName);
