import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PrincipalLoader } from './principal-loader.js';

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function createMockIdentities() {
  return {
    findUserForPrincipal: vi.fn(),
  };
}

function createMockAuthz() {
  return {
    findActiveGrantTemplateKeys: vi.fn().mockResolvedValue([]),
    findGrantsForOrg: vi.fn().mockResolvedValue([]),
    findActiveAssignments: vi.fn().mockResolvedValue([]),
    findOrgSettings: vi.fn(),
    findClosureForOrg: vi.fn().mockResolvedValue([]),
    findApprovedCategories: vi.fn().mockResolvedValue([]),
    findActiveOrgGrantTemplateKeys: vi.fn().mockResolvedValue([]),
    findOrgNames: vi.fn().mockResolvedValue(new Map()),
  };
}

function createMockCache() {
  return {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    del: vi.fn().mockResolvedValue(undefined),
    purgeLru: vi.fn(),
  };
}

function createMockStore() {
  return {
    publish: vi.fn().mockResolvedValue(undefined),
  };
}

const DB_USER = {
  id: 'user-1',
  displayName: 'Ana Petrović',
  locale: 'sr-Latn',
  suspendedAt: null,
  deactivatedAt: null,
  memberships: [
    {
      id: 'm-1',
      orgId: 'org-1',
      orgUnitId: null,
      status: 'ACTIVE',
      startDate: new Date('2025-01-01'),
      endDate: null,
    },
  ],
  expert: null,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PrincipalLoader', () => {
  let identities: ReturnType<typeof createMockIdentities>;
  let authz: ReturnType<typeof createMockAuthz>;
  let cache: ReturnType<typeof createMockCache>;
  let store: ReturnType<typeof createMockStore>;
  let loader: PrincipalLoader;

  beforeEach(() => {
    identities = createMockIdentities();
    authz = createMockAuthz();
    cache = createMockCache();
    store = createMockStore();
    loader = new PrincipalLoader(identities as never, authz as never, cache as never, store as never);
  });

  // ── load() ──────────────────────────────────────────────────────────────

  describe('load()', () => {
    it('loads from database and caches the result', async () => {
      identities.findUserForPrincipal.mockResolvedValue(DB_USER);

      const result = await loader.load('user-1');

      expect(result).not.toBeNull();
      expect(result!.userId).toBe('user-1');
      expect(result!.displayName).toBe('Ana Petrović');
      expect(result!.initials).toBe('AP');
      expect(result!.locale).toBe('sr-Latn');
      expect(result!.isSuspended).toBe(false);
      expect(result!.isDeactivated).toBe(false);
      expect(result!.memberships).toHaveLength(1);
      expect(result!.memberships[0]!.status).toBe('ACTIVE');

      expect(cache.set).toHaveBeenCalledOnce();
      const [key, value] = cache.set.mock.calls[0]!;
      expect(key).toContain('user-1');
      expect(JSON.parse(value as string).userId).toBe('user-1');
    });

    it('returns cached principal when available', async () => {
      const cached = {
        userId: 'user-1',
        displayName: 'Cached',
        initials: 'C',
        locale: 'sr-Latn',
        memberships: [],
        staffTemplates: [],
        expert: null,
        isSuspended: false,
        isDeactivated: false,
        populationHints: { hasStaffGrants: false, hasExpertGrants: false, hasActiveMembership: false },
      };
      cache.get.mockResolvedValue(JSON.stringify(cached));

      const result = await loader.load('user-1');

      expect(result).toEqual(cached);
      expect(identities.findUserForPrincipal).not.toHaveBeenCalled();
    });

    it('returns null for unknown user', async () => {
      identities.findUserForPrincipal.mockResolvedValue(null);
      const result = await loader.load('no-such-user');
      expect(result).toBeNull();
    });

    it('marks suspended user', async () => {
      identities.findUserForPrincipal.mockResolvedValue({
        ...DB_USER,
        suspendedAt: new Date(),
      });

      const result = await loader.load('user-1');
      expect(result!.isSuspended).toBe(true);
    });

    it('falls through on corrupted cache', async () => {
      cache.get.mockResolvedValue('NOT-JSON{{{');
      identities.findUserForPrincipal.mockResolvedValue(DB_USER);

      const result = await loader.load('user-1');
      expect(result).not.toBeNull();
      expect(result!.userId).toBe('user-1');
      expect(identities.findUserForPrincipal).toHaveBeenCalledOnce();
    });
  });

  // ── loadGrants() ────────────────────────────────────────────────────────

  describe('loadGrants()', () => {
    it('loads grants from DB and caches them', async () => {
      const dbGrant = {
        id: 'g-1',
        subjectUserId: 'user-1',
        templateKey: 'employee_base',
        actions: ['wellbeing_checkin:read'],
        scopeType: 'ORG',
        scopeOrgId: 'org-1',
        scopeOrgUnitId: null,
        includeDescendants: false,
        scopeRefKind: null,
        scopeRefId: null,
        conditions: [],
        validFrom: new Date(),
        validUntil: null,
        delegationEnvelope: null,
        parentGrantId: null,
        revokedAt: null,
      };
      authz.findGrantsForOrg.mockResolvedValue([dbGrant]);

      const result = await loader.loadGrants('user-1', 'org-1');

      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe('g-1');
      expect(cache.set).toHaveBeenCalledOnce();
    });

    it('returns cached grants', async () => {
      const cached = [{ id: 'g-cached', subjectUserId: 'user-1' }];
      cache.get.mockResolvedValue(JSON.stringify(cached));

      const result = await loader.loadGrants('user-1', 'org-1');
      expect(result).toEqual(cached);
      expect(authz.findGrantsForOrg).not.toHaveBeenCalled();
    });
  });

  // ── loadAssignments() ───────────────────────────────────────────────────

  describe('loadAssignments()', () => {
    it('loads assignments from DB', async () => {
      const dbAssignment = {
        id: 'a-1',
        userId: 'user-1',
        kind: 'CASE_MANAGER',
        targetId: 'target-1',
        startAt: new Date('2025-06-01'),
        endAt: null,
      };
      authz.findActiveAssignments.mockResolvedValue([dbAssignment]);

      const result = await loader.loadAssignments('user-1');
      expect(result).toHaveLength(1);
      expect(result[0]!.kind).toBe('CASE_MANAGER');
    });
  });

  // ── loadOrgTree() ──────────────────────────────────────────────────────

  describe('loadOrgTree()', () => {
    it('loads org tree with closure rows', async () => {
      authz.findOrgSettings.mockResolvedValue({
        selfApprovalAllowed: true,
        timezone: 'Europe/Belgrade',
        status: 'ACTIVE',
      });
      authz.findClosureForOrg.mockResolvedValue([
        { ancestorId: 'root', descendantId: 'ou-1' },
        { ancestorId: 'ou-1', descendantId: 'ou-2' },
      ]);

      const result = await loader.loadOrgTree('org-1');

      expect(result).not.toBeNull();
      expect(result!.selfApprovalAllowed).toBe(true);
      expect(result!.timezone).toBe('Europe/Belgrade');
      expect(result!.ancestorIds).toContain('root');
      expect(result!.ancestorIds).toContain('ou-1');
    });

    it('returns null for unknown org', async () => {
      authz.findOrgSettings.mockResolvedValue(null);
      const result = await loader.loadOrgTree('no-org');
      expect(result).toBeNull();
    });
  });

  // ── loadAvailableContextExtras() caching (item 11, T-C1.02) ────────────

  describe('loadAvailableContextExtras() caching (item 11)', () => {
    const loaded = {
      userId: 'user-1',
      displayName: 'Test',
      initials: 'T',
      locale: 'sr-Latn',
      memberships: [
        {
          membershipId: 'm-1',
          orgId: 'org-1',
          orgUnitId: null,
          status: 'ACTIVE' as const,
          startDate: '2026-01-01T00:00:00Z',
          endDate: null,
        },
      ],
      staffTemplates: [],
      expert: null,
      isSuspended: false,
      isDeactivated: false,
      populationHints: { hasStaffGrants: false, hasExpertGrants: false, hasActiveMembership: true },
    };

    it('two consecutive calls do not query grants and names twice', async () => {
      authz.findActiveOrgGrantTemplateKeys.mockResolvedValue([
        { orgId: 'org-1', templateKey: 'hr_admin' },
      ]);
      authz.findOrgNames.mockResolvedValue(new Map([['org-1', 'Org One']]));

      // First call: hits DB, caches.
      const first = await loader.loadAvailableContextExtras(loaded);
      expect(first.orgNames.get('org-1')).toBe('Org One');
      expect(authz.findActiveOrgGrantTemplateKeys).toHaveBeenCalledOnce();
      expect(authz.findOrgNames).toHaveBeenCalledOnce();

      // Mock cache.get to return what cache.set stored.
      const storedValue = cache.set.mock.calls.find(
        (c: unknown[]) => (c[0] as string).startsWith('ctx_extras:'),
      )?.[1] as string;
      expect(storedValue).toBeTruthy();
      cache.get.mockResolvedValue(storedValue);

      // Second call: served from cache, no new DB queries.
      const second = await loader.loadAvailableContextExtras(loaded);
      expect(second.orgNames.get('org-1')).toBe('Org One');
      expect(authz.findActiveOrgGrantTemplateKeys).toHaveBeenCalledOnce(); // still once
      expect(authz.findOrgNames).toHaveBeenCalledOnce(); // still once
    });
  });

  // ── invalidateUser() ───────────────────────────────────────────────────

  describe('invalidateUser()', () => {
    it('deletes cache keys and publishes invalidation', async () => {
      await loader.invalidateUser('user-1', ['org-1']);

      expect(cache.del).toHaveBeenCalledOnce();
      expect(cache.purgeLru).toHaveBeenCalled();
      expect(store.publish).toHaveBeenCalledOnce();

      const msg = JSON.parse(store.publish.mock.calls[0]![1] as string);
      expect(msg.userId).toBe('user-1');
      expect(msg.reason).toBe('invalidation');
    });

    it('continues when publish fails', async () => {
      store.publish.mockRejectedValue(new Error('Redis down'));
      await expect(loader.invalidateUser('user-1')).resolves.toBeUndefined();
    });
  });
});
