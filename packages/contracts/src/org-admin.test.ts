import { describe, expect, it } from 'vitest';
import {
  InvitationCreateResponseSchema,
  InvitationListQuerySchema,
  InvitationListResponseSchema,
  OrgUnitListResponseSchema,
} from './org-admin.ts';

const INVITATION = {
  id: 'inv_1',
  email: 'newhire@example.com',
  orgId: 'org_1',
  orgUnitId: null,
  templateKey: 'employee',
  expiresAt: '2026-11-01T00:00:00.000Z',
  revokedAt: null,
  acceptedAt: null,
  invitedByUserId: 'user_ivana',
  createdAt: '2026-10-25T00:00:00.000Z',
};

describe('org-admin invitation schemas', () => {
  it('InvitationListQuerySchema defaults limit to 25 and status to pending, and coerces limit', () => {
    expect(InvitationListQuerySchema.parse({})).toEqual({ limit: 25, status: 'pending' });
    expect(InvitationListQuerySchema.parse({ limit: '5', cursor: 'inv_1' })).toEqual({
      limit: 5,
      cursor: 'inv_1',
      status: 'pending',
    });
  });

  it('InvitationListQuerySchema rejects other statuses and limits above 100', () => {
    expect(InvitationListQuerySchema.safeParse({ status: 'revoked' }).success).toBe(false);
    expect(InvitationListQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
  });

  it('InvitationListResponseSchema accepts a page with a cursor', () => {
    const page = { items: [INVITATION], nextCursor: 'inv_1' };
    expect(InvitationListResponseSchema.parse(page)).toEqual(page);
  });

  it('InvitationCreateResponseSchema keeps an optional devToken', () => {
    expect(InvitationCreateResponseSchema.parse({ ...INVITATION, devToken: 'tok' }).devToken).toBe('tok');
    expect(InvitationCreateResponseSchema.parse(INVITATION)).not.toHaveProperty('devToken');
  });

  it('OrgUnitListResponseSchema accepts the flat org-unit list', () => {
    const unit = { id: 'u', orgId: 'org_1', parentId: null, kind: 'COMPANY', name: 'A', costCenterCode: null, archivedAt: null };
    expect(OrgUnitListResponseSchema.parse({ items: [unit] })).toEqual({ items: [unit] });
  });
});
