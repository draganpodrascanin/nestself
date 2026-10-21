import { z } from 'zod';
import { LocaleSchema } from './locale.ts';

export const orgRoles = ['employee', 'manager', 'hr_admin'] as const;
export const OrgRoleSchema = z.enum(orgRoles);
export type OrgRole = z.infer<typeof OrgRoleSchema>;

export const platformRoles = ['expert', 'operations', 'admin'] as const;
export const PlatformRoleSchema = z.enum(platformRoles);
export type PlatformRole = z.infer<typeof PlatformRoleSchema>;

/** Session shape every client and the API agree on. The API is the only enforcement point. */
export const SessionSchema = z.object({
  userId: z.string().min(1),
  displayName: z.string().min(1),
  initials: z.string().min(1).max(3),
  orgId: z.string().min(1).nullable(),
  orgRole: OrgRoleSchema.nullable(),
  platformRole: PlatformRoleSchema.nullable(),
  locale: LocaleSchema.default('en'),
});
export type Session = z.infer<typeof SessionSchema>;

export const canAccessHr = (s: Pick<Session, 'orgRole'>): boolean =>
  s.orgRole === 'hr_admin';

export const canManageTeam = (s: Pick<Session, 'orgRole'>): boolean =>
  s.orgRole === 'manager' || s.orgRole === 'hr_admin';
