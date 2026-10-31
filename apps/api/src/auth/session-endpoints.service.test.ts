import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionEndpointsService } from './session-endpoints.service.js';
import { resolveDefaultPersonalOrgId } from '../authz/personal-context.js';
import { ApiHttpException } from '../common/api-error.js';
import type { Principal, PrincipalMembership } from '@nestself/contracts';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

function createMocks(memberships: PrincipalMembership[] = [], opts?: {
  staffTemplates?: string[];
  expert?: { id: string; approvedCategories: string[] } | null;
  orgGrantTemplateKeys?: Map<string, string[]>;
  orgNames?: Map<string, string>;
}) {
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
        staffTemplates: opts?.staffTemplates ?? [],
        expert: opts?.expert ?? null,
        isSuspended: false,
        isDeactivated: false,
      }),
      loadAvailableContextExtras: vi.fn().mockResolvedValue({
        orgGrantTemplateKeys: opts?.orgGrantTemplateKeys ?? new Map(),
        orgNames: opts?.orgNames ?? new Map(),
      }),
      loadGrants: vi.fn().mockResolvedValue([]),
    },
    store: {
      set: vi.fn(),
      get: vi.fn(),
      delete: vi.fn(),
    },
    meResponse: {
      build: vi.fn().mockImplementation((principal: Principal, _opts?: unknown) => {
        return Promise.resolve({
          principal,
          effectiveActions: [],
          availableContexts: [],
        });
      }),
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
  orgName: 'Test Org A',
  orgUnitId: null,
  status: 'ACTIVE',
  startDate: '2024-01-15T00:00:00Z',
  endDate: null,
};

const EARLIER_MEMBERSHIP: PrincipalMembership = {
  membershipId: 'mem-2',
  orgId: 'org_b',
  orgName: 'Test Org B',
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
      mocks.meResponse as never,
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

    // Last used was org_a, still valid -> keeps org_a
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

    // No last personal orgId -> earliest is org_b (2023-06-01)
    expect(result.principal.context).toEqual({
      kind: 'personal',
      orgId: 'org_b',
    });
  });

  it('throws 403 invalid_context when user has no ACTIVE memberships and switches to personal (C1)', async () => {
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
    try {
      await service.switchContext('sess-1', principal, { kind: 'personal' });
      expect.unreachable('should have thrown');
    } catch (err) {
      const e = err as ApiHttpException;
      expect(e.getStatus()).toBe(403);
      expect(e.code).toBe('invalid_context');
    }
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
// C1: Organization context switch requires canEnterContext
// ---------------------------------------------------------------------------

describe('SessionEndpointsService.switchContext – organization context via canEnterContext (C1)', () => {
  it('rejects organization context for a plain employee (no org-workspace grant)', async () => {
    // Employee: has active membership but no org-workspace grant.
    const mocks = createMocks([ACTIVE_MEMBERSHIP]);
    const service = new SessionEndpointsService(
      mocks.sessions as never,
      mocks.principalLoader as never,
      mocks.store as never,
      mocks.meResponse as never,
    );
    const principal = makePrincipal({ kind: 'personal', orgId: 'org_a' }, [ACTIVE_MEMBERSHIP]);

    try {
      await service.switchContext('sess-1', principal, {
        kind: 'organization',
        orgId: 'org_a',
      });
      expect.unreachable('should have thrown');
    } catch (err) {
      const e = err as ApiHttpException;
      expect(e.getStatus()).toBe(403);
      expect(e.code).toBe('invalid_context');
    }
  });

  it('allows organization context for HR admin (holds org-workspace grant)', async () => {
    const mocks = createMocks([ACTIVE_MEMBERSHIP], {
      orgGrantTemplateKeys: new Map([['org_a', ['hr_admin']]]),
      orgNames: new Map([['org_a', 'Test Org']]),
    });
    const service = new SessionEndpointsService(
      mocks.sessions as never,
      mocks.principalLoader as never,
      mocks.store as never,
      mocks.meResponse as never,
    );
    const principal = makePrincipal({ kind: 'personal', orgId: 'org_a' }, [ACTIVE_MEMBERSHIP]);

    const result = await service.switchContext('sess-1', principal, {
      kind: 'organization',
      orgId: 'org_a',
    });

    expect(result.principal.context).toEqual({ kind: 'organization', orgId: 'org_a' });
  });

  it('rejects organization context with invalid_context when membership endDate is past (ruling 2)', async () => {
    const expired: PrincipalMembership = {
      ...ACTIVE_MEMBERSHIP,
      endDate: '2025-01-01T00:00:00Z',
    };
    const mocks = createMocks([expired], {
      orgGrantTemplateKeys: new Map([['org_a', ['hr_admin']]]),
    });
    mocks.principalLoader.load.mockResolvedValue({
      userId: 'user-1', displayName: 'Test', initials: 'T', locale: 'sr-Latn',
      memberships: [expired], staffTemplates: [], expert: null,
      isSuspended: false, isDeactivated: false,
    });
    const service = new SessionEndpointsService(
      mocks.sessions as never,
      mocks.principalLoader as never,
      mocks.store as never,
      mocks.meResponse as never,
    );
    const principal = makePrincipal({ kind: 'personal' }, [expired]);

    try {
      await service.switchContext('sess-1', principal, { kind: 'organization', orgId: 'org_a' });
      expect.unreachable('should have thrown');
    } catch (err) {
      const e = err as ApiHttpException;
      expect(e.getStatus()).toBe(403);
      // Ruling 2: switchContext always throws invalid_context;
      // the guard (not the service) maps to org_context_expired.
      expect(e.code).toBe('invalid_context');
    }
  });

  it('rejects organization context with invalid_context when membership startDate is future', async () => {
    const future: PrincipalMembership = {
      ...ACTIVE_MEMBERSHIP,
      startDate: '2099-01-01T00:00:00Z',
    };
    const mocks = createMocks([future], {
      orgGrantTemplateKeys: new Map([['org_a', ['hr_admin']]]),
    });
    mocks.principalLoader.load.mockResolvedValue({
      userId: 'user-1', displayName: 'Test', initials: 'T', locale: 'sr-Latn',
      memberships: [future], staffTemplates: [], expert: null,
      isSuspended: false, isDeactivated: false,
    });
    const service = new SessionEndpointsService(
      mocks.sessions as never,
      mocks.principalLoader as never,
      mocks.store as never,
      mocks.meResponse as never,
    );
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
    const mocks = createMocks([ACTIVE_MEMBERSHIP]);
    const service = new SessionEndpointsService(
      mocks.sessions as never,
      mocks.principalLoader as never,
      mocks.store as never,
      mocks.meResponse as never,
    );
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
      mocks.meResponse as never,
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

describe('SessionEndpointsService.getMe – effectiveActions via engine (Ruling F)', () => {
  it('returns actions from engine effectiveActions via MeResponseBuilder', async () => {
    const mocks = createMocks([ACTIVE_MEMBERSHIP]);
    mocks.meResponse.build.mockResolvedValue({
      principal: makePrincipal({ kind: 'organization', orgId: 'org_a' }, [ACTIVE_MEMBERSHIP]),
      effectiveActions: ['program.overview', 'people.invite'],
      availableContexts: [],
    });
    const service = new SessionEndpointsService(
      mocks.sessions as never,
      mocks.principalLoader as never,
      mocks.store as never,
      mocks.meResponse as never,
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
