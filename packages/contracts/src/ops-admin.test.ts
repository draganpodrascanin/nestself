import { describe, expect, it } from 'vitest';
import { AUTH_ERROR_CODES } from './auth.ts';
import {
  EmergencyAccessCreateRequestSchema,
  EmergencyAccessListResponseSchema,
  EmergencyAccessResponseSchema,
  EmergencyRecordResponseSchema,
  OrganizationListQuerySchema,
  OrganizationListResponseSchema,
  OrganizationResponseSchema,
  PlatformGrantCreateRequestSchema,
  UserAccessResponseSchema,
} from './ops-admin.ts';

describe('ops-admin schemas', () => {
  it('PlatformGrantCreateRequestSchema accepts an operations grant request', () => {
    const parsed = PlatformGrantCreateRequestSchema.parse({
      templateKey: 'support_operator',
      subjectUserId: 'user_nikola',
      scopeType: 'assigned_cases',
    });
    expect(parsed).toEqual({
      templateKey: 'support_operator',
      subjectUserId: 'user_nikola',
      scopeType: 'assigned_cases',
      conditions: [],
    });
  });

  it('PlatformGrantCreateRequestSchema drops org-unit scoping fields', () => {
    const parsed = PlatformGrantCreateRequestSchema.parse({
      templateKey: 'platform_owner',
      subjectUserId: 'user_nikola',
      scopeType: 'platform',
      scopeOrgUnitId: 'team_product',
      includeDescendants: true,
    });
    expect(parsed).not.toHaveProperty('scopeOrgUnitId');
    expect(parsed).not.toHaveProperty('includeDescendants');
  });

  it('PlatformGrantCreateRequestSchema rejects a missing subject or unknown scope type', () => {
    expect(
      PlatformGrantCreateRequestSchema.safeParse({ templateKey: 'platform_owner', scopeType: 'platform' }).success,
    ).toBe(false);
    expect(
      PlatformGrantCreateRequestSchema.safeParse({
        templateKey: 'platform_owner',
        subjectUserId: 'user_nikola',
        scopeType: 'galaxy',
      }).success,
    ).toBe(false);
  });

  it('UserAccessResponseSchema accepts organization and platform contexts', () => {
    const response = {
      userId: 'user_ana',
      contexts: [
        { orgId: 'org_sample', actions: ['content.read'], grantIds: ['grant_1'], assignmentIds: [] },
        { orgId: null, actions: [], grantIds: [], assignmentIds: ['asg_1'] },
      ],
    };
    expect(UserAccessResponseSchema.parse(response)).toEqual(response);
  });

  it('UserAccessResponseSchema rejects a context without arrays', () => {
    expect(
      UserAccessResponseSchema.safeParse({ userId: 'user_ana', contexts: [{ orgId: 'org_sample' }] }).success,
    ).toBe(false);
    expect(UserAccessResponseSchema.safeParse({ userId: '', contexts: [] }).success).toBe(false);
  });

  const emergencyRequest = {
    purpose: 'Safeguarding concern raised by the assigned expert',
    scopeKind: 'CASE',
    scopeId: 'case_sample',
  };

  it('EmergencyAccessCreateRequestSchema defaults the duration to 240 minutes', () => {
    expect(EmergencyAccessCreateRequestSchema.parse(emergencyRequest)).toEqual({
      ...emergencyRequest,
      durationMinutes: 240,
    });
    expect(
      EmergencyAccessCreateRequestSchema.parse({ ...emergencyRequest, durationMinutes: 30 }).durationMinutes,
    ).toBe(30);
  });

  it('EmergencyAccessCreateRequestSchema bounds duration, purpose and scope', () => {
    const invalid = [
      { ...emergencyRequest, durationMinutes: 14 },
      { ...emergencyRequest, durationMinutes: 241 },
      { ...emergencyRequest, durationMinutes: 30.5 },
      { ...emergencyRequest, purpose: 'too short' },
      { ...emergencyRequest, purpose: 'x'.repeat(1001) },
      { ...emergencyRequest, scopeKind: 'ORGANIZATION' },
      { ...emergencyRequest, scopeId: '' },
    ];
    for (const body of invalid) {
      expect(EmergencyAccessCreateRequestSchema.safeParse(body).success).toBe(false);
    }
  });

  const emergencyAccess = {
    id: 'ema_1',
    userId: 'user_nikola',
    approvedByUserId: null,
    purpose: emergencyRequest.purpose,
    scopeKind: 'CASE',
    scopeId: 'case_sample',
    durationMinutes: 30,
    grantedAt: '2026-10-24T10:00:00.000Z',
    approvedAt: null,
    expiresAt: '2026-10-24T10:30:00.000Z',
    revokedAt: null,
  };

  it('EmergencyAccessResponseSchema accepts a pending and an approved record', () => {
    expect(EmergencyAccessResponseSchema.parse(emergencyAccess)).toEqual(emergencyAccess);
    const approved = {
      ...emergencyAccess,
      approvedByUserId: 'user_admin_test',
      approvedAt: '2026-10-24T10:05:00.000Z',
    };
    expect(EmergencyAccessResponseSchema.parse(approved)).toEqual(approved);
    expect(EmergencyAccessResponseSchema.safeParse({ ...emergencyAccess, approvedAt: 'yesterday' }).success).toBe(
      false,
    );
  });

  it('EmergencyAccessListResponseSchema wraps records in items', () => {
    expect(EmergencyAccessListResponseSchema.parse({ items: [emergencyAccess] }).items).toHaveLength(1);
    expect(EmergencyAccessListResponseSchema.safeParse({}).success).toBe(false);
  });

  it('EmergencyRecordResponseSchema accepts conversation and intake reads only', () => {
    const read = { emergencyAccessId: 'ema_1', recordType: 'conversation', recordId: 'conv_sample', content: {} };
    expect(EmergencyRecordResponseSchema.parse(read)).toEqual(read);
    expect(EmergencyRecordResponseSchema.parse({ ...read, recordType: 'intake' }).recordType).toBe('intake');
    expect(EmergencyRecordResponseSchema.safeParse({ ...read, recordType: 'note' }).success).toBe(false);
  });

  it('AUTH_ERROR_CODES includes the emergency access codes', () => {
    expect(AUTH_ERROR_CODES).toContain('self_approval_denied');
    expect(AUTH_ERROR_CODES).toContain('emergency_not_active');
  });

  describe('organizations', () => {
    const ORG = { id: 'org_1', name: 'Sample Org', slug: 'sample-org', status: 'ACTIVE', createdAt: '2026-01-01T00:00:00.000Z' };

    it('OrganizationResponseSchema accepts the five fields and strips the rest', () => {
      expect(OrganizationResponseSchema.parse({ ...ORG, ownerUserId: 'user_ivana' })).toEqual(ORG);
    });

    it('OrganizationResponseSchema rejects an unknown status', () => {
      expect(OrganizationResponseSchema.safeParse({ ...ORG, status: 'DELETED' }).success).toBe(false);
    });

    it('OrganizationListQuerySchema trims search and drops an empty one as invalid', () => {
      expect(OrganizationListQuerySchema.parse({ search: '  sam ' })).toEqual({ limit: 25, search: 'sam' });
      expect(OrganizationListQuerySchema.safeParse({ search: '   ' }).success).toBe(false);
    });

    it('OrganizationListResponseSchema accepts a last page', () => {
      expect(OrganizationListResponseSchema.parse({ items: [ORG], nextCursor: null })).toEqual({ items: [ORG], nextCursor: null });
    });
  });
});
