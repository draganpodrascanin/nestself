import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionEndpointsService } from './session-endpoints.service.js';
import { resolveDefaultPersonalOrgId } from '../authz/personal-context.js';
import { ApiHttpException } from '../common/api-error.js';
import type { Principal, PrincipalMembership } from '@nestself/contracts';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

function createMocks(memberships: PrincipalMembership[] = []) {
  return {
    sessions: {
      updateContext: vi.fn(),
      destroy: vi.fn(),
      destroyAllForUser: vi.fn(),
      listForUser: vi.fn().mockResolvedValue([]),
      destroyOwnedByHash: vi.fn(),
    },
    principalLoader: {
      load: vi.fn().mockResolvedValue({
        userId: 'user-1',
        displayName: 'Test',
        initials: 'T',
        locale: 'sr-Latn',
        memberships,
        staffTemplates: [],
        expert: null,
        isSuspended: false,
        isDeactivated: false,
      }),
      loadAvailableContextExtras: vi.fn().mockResolvedValue({
        orgGrantTemplateKeys: new Map(),
        orgNames: new Map(),
      }),
      loadGrants: vi.fn().mockResolvedValue([]),
    },
    store: {
      set: vi.fn(),
      get: vi.fn(),
      delete: vi.fn(),
    },
  };
}

function makePrincipal(
  context: Principal['context'],
  memberships: PrincipalMembership[] = [],
): Principal {
  return {
    userId: 'user-1',
    displayName: 'Test',
    initials: 'T',
    locale: 'sr-Latn',
    memberships,
    staffTemplates: [],
    expert: null,
    context,
    auth: {
      method: 'email_otp',
      time: new Date().toISOString(),
      secondFactor: false,
      lastStepUpAt: null,
    },
    sessionId: 'sess-1',
    tokenFamily: null,
  };
}

const ACTIVE_MEMBERSHIP: PrincipalMembership = {
  membershipId: 'mem-1',
  orgId: 'org_a',
  orgUnitId: null,
  status: 'ACTIVE',
  startDate: '2024-01-15T00:00:00Z',
  endDate: null,
};

const EARLIER_MEMBERSHIP: PrincipalMembership = {
  membershipId: 'mem-2',
  orgId: 'org_b',
  orgUnitId: null,
  status: 'ACTIVE',
  startDate: '2023-06-01T00:00:00Z',
  endDate: null,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SessionEndpointsService.switchContext – personal context orgId (ACC-R-12)', () => {
  let mocks: ReturnType<typeof createMocks>;
  let service: SessionEndpointsService;

  beforeEach(() => {
    mocks = createMocks([ACTIVE_MEMBERSHIP, EARLIER_MEMBERSHIP]);
    service = new SessionEndpointsService(
      mocks.sessions as never,
      mocks.principalLoader as never,
      mocks.store as never,
    );
  });

  it('stores personal context with explicit orgId when membership is ACTIVE', async () => {
    const principal = makePrincipal({ kind: 'personal' }, [ACTIVE_MEMBERSHIP]);
    const result = await service.switchContext('sess-1', principal, {
      kind: 'personal',
      orgId: 'org_a',
    });

    expect(result.principal.context).toEqual({
      kind: 'personal',
      orgId: 'org_a',
    });
    expect(mocks.sessions.updateContext).toHaveBeenCalledWith(
      'sess-1',
      { kind: 'personal', orgId: 'org_a' },
      'employee',
    );
  });

  it('throws 403 invalid_context when explicit orgId has no ACTIVE membership', async () => {
    const principal = makePrincipal({ kind: 'personal' }, [ACTIVE_MEMBERSHIP]);
    await expect(
      service.switchContext('sess-1', principal, {
        kind: 'personal',
        orgId: 'org_nonexistent',
      }),
    ).rejects.toThrow(ApiHttpException);

    try {
      await service.switchContext('sess-1', principal, {
        kind: 'personal',
        orgId: 'org_nonexistent',
      });
    } catch (err) {
      const e = err as ApiHttpException;
      expect(e.getStatus()).toBe(403);
      expect(e.code).toBe('invalid_context');
    }
  });

  it('resolves default orgId (last used) when switching to personal without orgId', async () => {
    const principal = makePrincipal(
      { kind: 'personal', orgId: 'org_a' },
      [ACTIVE_MEMBERSHIP, EARLIER_MEMBERSHIP],
    );
    const result = await service.switchContext('sess-1', principal, {
      kind: 'personal',
    });

    // Last used was org_a, still valid → keeps org_a
    expect(result.principal.context).toEqual({
      kind: 'personal',
      orgId: 'org_a',
    });
  });

  it('resolves default orgId (earliest startDate) when no last used', async () => {
    const principal = makePrincipal(
      { kind: 'organization', orgId: 'org_a' },
      [ACTIVE_MEMBERSHIP, EARLIER_MEMBERSHIP],
    );
    const result = await service.switchContext('sess-1', principal, {
      kind: 'personal',
    });

    // No last personal orgId → earliest is org_b (2023-06-01)
    expect(result.principal.context).toEqual({
      kind: 'personal',
      orgId: 'org_b',
    });
  });

  it('returns personal without orgId when user has no ACTIVE memberships', async () => {
    // Override loader to return no memberships
    mocks.principalLoader.load.mockResolvedValue({
      userId: 'user-1',
      displayName: 'Test',
      initials: 'T',
      locale: 'sr-Latn',
      memberships: [],
      staffTemplates: [],
      expert: null,
      isSuspended: false,
      isDeactivated: false,
    });

    const principal = makePrincipal({ kind: 'personal' }, []);
    const result = await service.switchContext('sess-1', principal, {
      kind: 'personal',
    });

    expect(result.principal.context).toEqual({ kind: 'personal' });
  });
});

describe('resolveDefaultPersonalOrgId (shared helper)', () => {
  it('returns lastUsed when it is still ACTIVE and date-current', () => {
    const result = resolveDefaultPersonalOrgId(
      [ACTIVE_MEMBERSHIP, EARLIER_MEMBERSHIP],
      'org_a',
    );
    expect(result).toBe('org_a');
  });

  it('falls back to earliest startDate when lastUsed is not found', () => {
    const result = resolveDefaultPersonalOrgId(
      [ACTIVE_MEMBERSHIP, EARLIER_MEMBERSHIP],
      'org_gone',
    );
    expect(result).toBe('org_b');
  });

  it('returns undefined when no ACTIVE memberships exist', () => {
    const result = resolveDefaultPersonalOrgId([], undefined);
    expect(result).toBeUndefined();
  });

  it('skips expired memberships', () => {
    const expired: PrincipalMembership = {
      ...EARLIER_MEMBERSHIP,
      endDate: '2024-01-01T00:00:00Z',
    };
    const result = resolveDefaultPersonalOrgId([expired, ACTIVE_MEMBERSHIP]);
    expect(result).toBe('org_a');
  });

  it('skips future-start memberships', () => {
    const future: PrincipalMembership = {
      ...EARLIER_MEMBERSHIP,
      startDate: '2099-01-01T00:00:00Z',
    };
    const result = resolveDefaultPersonalOrgId([future, ACTIVE_MEMBERSHIP]);
    expect(result).toBe('org_a');
  });

  it('skips INVITED memberships', () => {
    const invited: PrincipalMembership = {
      ...EARLIER_MEMBERSHIP,
      status: 'INVITED',
    };
    const result = resolveDefaultPersonalOrgId([invited, ACTIVE_MEMBERSHIP]);
    expect(result).toBe('org_a');
  });
});

// ---------------------------------------------------------------------------
// Ruling A: Organization context switch enforces date-currency
// ---------------------------------------------------------------------------

describe('SessionEndpointsService.switchContext – organization date-currency (Ruling A)', () => {
  let mocks: ReturnType<typeof createMocks>;
  let service: SessionEndpointsService;

  beforeEach(() => {
    mocks = createMocks([ACTIVE_MEMBERSHIP]);
    service = new SessionEndpointsService(
      mocks.sessions as never,
      mocks.principalLoader as never,
      mocks.store as never,
    );
  });

  it('allows organization context when membership is ACTIVE and date-current', async () => {
    const principal = makePrincipal({ kind: 'personal', orgId: 'org_a' }, [ACTIVE_MEMBERSHIP]);
    const result = await service.switchContext('sess-1', principal, {
      kind: 'organization',
      orgId: 'org_a',
    });
    expect(result.principal.context).toEqual({ kind: 'organization', orgId: 'org_a' });
  });

  it('rejects organization context with org_context_expired when membership endDate is past', async () => {
    const expired: PrincipalMembership = {
      ...ACTIVE_MEMBERSHIP,
      endDate: '2025-01-01T00:00:00Z',
    };
    mocks.principalLoader.load.mockResolvedValue({
      userId: 'user-1', displayName: 'Test', initials: 'T', locale: 'sr-Latn',
      memberships: [expired], staffTemplates: [], expert: null,
      isSuspended: false, isDeactivated: false,
    });
    const principal = makePrincipal({ kind: 'personal' }, [expired]);

    try {
      await service.switchContext('sess-1', principal, { kind: 'organization', orgId: 'org_a' });
      expect.unreachable('should have thrown');
    } catch (err) {
      const e = err as ApiHttpException;
      expect(e.getStatus()).toBe(403);
      expect(e.code).toBe('org_context_expired');
    }
  });

  it('rejects organization context with invalid_context when membership startDate is future', async () => {
    const future: PrincipalMembership = {
      ...ACTIVE_MEMBERSHIP,
      startDate: '2099-01-01T00:00:00Z',
    };
    mocks.principalLoader.load.mockResolvedValue({
      userId: 'user-1', displayName: 'Test', initials: 'T', locale: 'sr-Latn',
      memberships: [future], staffTemplates: [], expert: null,
      isSuspended: false, isDeactivated: false,
    });
    const principal = makePrincipal({ kind: 'personal' }, [future]);

    try {
      await service.switchContext('sess-1', principal, { kind: 'organization', orgId: 'org_a' });
      expect.unreachable('should have thrown');
    } catch (err) {
      const e = err as ApiHttpException;
      expect(e.getStatus()).toBe(403);
      expect(e.code).toBe('invalid_context');
    }
  });

  it('rejects organization context with invalid_context when no membership exists', async () => {
    const principal = makePrincipal({ kind: 'personal' }, [ACTIVE_MEMBERSHIP]);

    try {
      await service.switchContext('sess-1', principal, { kind: 'organization', orgId: 'org_nonexistent' });
      expect.unreachable('should have thrown');
    } catch (err) {
      const e = err as ApiHttpException;
      expect(e.getStatus()).toBe(403);
      expect(e.code).toBe('invalid_context');
    }
  });
});

// ---------------------------------------------------------------------------
// Ruling D: lastPersonalOrgId stickiness
// ---------------------------------------------------------------------------

describe('SessionEndpointsService.switchContext – lastPersonalOrgId (Ruling D)', () => {
  let mocks: ReturnType<typeof createMocks>;
  let service: SessionEndpointsService;

  beforeEach(() => {
    mocks = createMocks([ACTIVE_MEMBERSHIP, EARLIER_MEMBERSHIP]);
    service = new SessionEndpointsService(
      mocks.sessions as never,
      mocks.principalLoader as never,
      mocks.store as never,
    );
  });

  it('switching org -> bare personal returns lastPersonalOrgId rather than earliest', async () => {
    const principal = makePrincipal(
      { kind: 'organization', orgId: 'org_a' },
      [ACTIVE_MEMBERSHIP, EARLIER_MEMBERSHIP],
    );
    // lastPersonalOrgId was previously set to org_a.
    const result = await service.switchContext(
      'sess-1',
      principal,
      { kind: 'personal' },
      'org_a', // lastPersonalOrgId from the session
    );

    // Should pick org_a (the sticky value), not org_b (earliest).
    expect(result.principal.context).toEqual({ kind: 'personal', orgId: 'org_a' });
  });
});

// ---------------------------------------------------------------------------
// Ruling F: effectiveActions populated from grants
// ---------------------------------------------------------------------------

describe('SessionEndpointsService.getMe – effectiveActions (Ruling F)', () => {
  it('returns actions from loaded grants', async () => {
    const mocks = createMocks([ACTIVE_MEMBERSHIP]);
    mocks.principalLoader.loadGrants.mockResolvedValue([
      {
        id: 'g1',
        subjectUserId: 'user-1',
        templateKey: 'hr_admin',
        actions: ['program.overview', 'people.invite'],
        scopeType: 'organization',
        scopeOrgId: 'org_a',
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
    ]);
    const service = new SessionEndpointsService(
      mocks.sessions as never,
      mocks.principalLoader as never,
      mocks.store as never,
    );
    const principal = makePrincipal(
      { kind: 'organization', orgId: 'org_a' },
      [ACTIVE_MEMBERSHIP],
    );
    const result = await service.getMe(principal);

    expect(result.effectiveActions).toContain('program.overview');
    expect(result.effectiveActions).toContain('people.invite');
  });
});
