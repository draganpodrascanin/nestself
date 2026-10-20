import type { OrgRole, PlatformRole } from '@nestself/contracts';

/**
 * Authenticated user attached to every request after JWT verification.
 * Role values use the lower-case contracts enums (employee, manager, hr_admin, etc.).
 */
export interface AuthUser {
  userId: string;
  displayName: string;
  platformRole: PlatformRole | null;
  memberships: Array<{ orgId: string; role: OrgRole }>;
}

/**
 * Map a Prisma UPPER_CASE OrgRole enum to the lower-case contracts value.
 */
export function prismaOrgRoleToContract(
  prismaRole: string,
): OrgRole {
  return prismaRole.toLowerCase() as OrgRole;
}

/**
 * Map a Prisma UPPER_CASE PlatformRole enum to the lower-case contracts value.
 */
export function prismaPlatformRoleToContract(
  prismaRole: string | null,
): PlatformRole | null {
  if (!prismaRole) return null;
  return prismaRole.toLowerCase() as PlatformRole;
}
