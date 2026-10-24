import { describe, expect, it } from 'vitest';
import { PlatformGrantCreateRequestSchema, UserAccessResponseSchema } from './ops-admin.ts';

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
});
