/**
 * Unit tests for SubscriptionAuthorizer.
 *
 * @see T-1.11, AUTHZ-R-59
 */
import { describe, it, expect, vi } from 'vitest';
import { SubscriptionAuthorizer } from './subscription-authorizer.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const PRINCIPAL = {
  userId: 'user_jovan',
  displayName: 'Jovan',
  initials: 'JP',
  locale: 'sr-Latn',
  memberships: [
    {
      membershipId: 'mem_1',
      orgId: 'org_sample',
      orgName: 'Org org_sample',
      orgUnitId: 'ou_root',
      status: 'ACTIVE' as const,
      startDate: '2024-01-01T00:00:00.000Z',
      endDate: null,
    },
  ],
  staffTemplates: [],
  expert: null,
  context: { kind: 'organization' as const, orgId: 'org_sample' },
  auth: {
    method: 'email_otp' as const,
    time: '2024-01-01T00:00:00Z',
    secondFactor: false,
    lastStepUpAt: null,
  },
  sessionId: 'sid_1',
  tokenFamily: null,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SubscriptionAuthorizer', () => {
  it('returns allow when the grant-based engine approves', async () => {
    const contextLoader = {
      build: vi.fn().mockResolvedValue({
        now: new Date(),
        isDeactivated: false,
        isSuspended: false,
        grants: [
          {
            id: 'grant_1',
            subjectUserId: 'user_jovan',
            templateKey: '',
            actions: ['program.overview'],
            scopeType: 'organization',
            scopeOrgId: 'org_sample',
            scopeOrgUnitId: null,
            includeDescendants: false,
            scopeRefKind: null,
            scopeRefId: null,
            conditions: [],
            validFrom: null,
            validUntil: null,
            delegationEnvelope: null,
            parentGrantId: null,
            revokedAt: null,
          },
        ],
        assignments: [],
        ancestorIds: [],
        orgSelfApprovalAllowed: false,
        organizationTimezone: 'UTC',
      }),
    };

    const authorizer = new SubscriptionAuthorizer(contextLoader as never);
    const decision = await authorizer.authorizeSubscription(
      PRINCIPAL,
      'program.overview',
      { type: 'program', orgId: 'org_sample' },
    );

    expect(decision.allowed).toBe(true);
  });

  it('returns deny when no matching grant exists', async () => {
    const contextLoader = {
      build: vi.fn().mockResolvedValue({
        now: new Date(),
        isDeactivated: false,
        isSuspended: false,
        grants: [],
        assignments: [],
        ancestorIds: [],
        orgSelfApprovalAllowed: false,
        organizationTimezone: 'UTC',
      }),
    };

    const authorizer = new SubscriptionAuthorizer(contextLoader as never);
    const decision = await authorizer.authorizeSubscription(
      PRINCIPAL,
      'program.overview',
      { type: 'program', orgId: 'org_sample' },
    );

    expect(decision.allowed).toBe(false);
  });

  it('reauthorizeAll revokes rooms that are no longer allowed', async () => {
    const contextLoader = {
      build: vi.fn().mockResolvedValue({
        now: new Date(),
        isDeactivated: false,
        isSuspended: false,
        grants: [],
        assignments: [],
        ancestorIds: [],
        orgSelfApprovalAllowed: false,
        organizationTimezone: 'UTC',
      }),
    };

    const authorizer = new SubscriptionAuthorizer(contextLoader as never);

    const subscriptions = new Map([
      [
        'org:org_sample:programme',
        {
          action: 'program.overview' as const,
          resource: { type: 'program', orgId: 'org_sample' },
        },
      ],
    ]);

    const socket = {
      data: {
        principal: PRINCIPAL,
        subscriptions,
      },
      leave: vi.fn(),
      emit: vi.fn(),
    };

    const revoked = await authorizer.reauthorizeAll(socket as never);

    expect(revoked).toEqual(['org:org_sample:programme']);
    expect(socket.leave).toHaveBeenCalledWith('org:org_sample:programme');
    expect(socket.emit).toHaveBeenCalledWith('subscription:revoked', {
      room: 'org:org_sample:programme',
    });
    expect(subscriptions.size).toBe(0);
  });
});
