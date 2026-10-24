/**
 * Operations administration request and response schemas (5.4).
 *
 * Shared by the API controllers under `/ops/*` and the admin client.
 */
import { z } from 'zod';
import { GrantCreateRequestSchema } from './org-admin.ts';

/**
 * `POST /ops/grants`: a platform-level grant (`scope_org_id` null) from an
 * operations template. The server accepts only templates whose workspace is
 * `operations` and whose own `scopeType` matches the request.
 */
export const PlatformGrantCreateRequestSchema = GrantCreateRequestSchema.omit({
  scopeOrgUnitId: true,
  includeDescendants: true,
});
export type PlatformGrantCreateRequest = z.infer<typeof PlatformGrantCreateRequestSchema>;

/** One evaluated context of `GET /ops/users/:userId/access`; `orgId` null is the platform context. */
export const UserAccessContextSchema = z.object({
  orgId: z.string().min(1).nullable(),
  actions: z.array(z.string().min(1)),
  grantIds: z.array(z.string().min(1)),
  assignmentIds: z.array(z.string().min(1)),
});
export type UserAccessContext = z.infer<typeof UserAccessContextSchema>;

export const UserAccessResponseSchema = z.object({
  userId: z.string().min(1),
  contexts: z.array(UserAccessContextSchema),
});
export type UserAccessResponse = z.infer<typeof UserAccessResponseSchema>;
