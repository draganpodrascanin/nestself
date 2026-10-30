/**
 * Unit tests for MembersAdminService — mocked repositories.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemberItemSchema } from '@nestself/contracts';
import { MembersAdminService } from './members-admin.service.js';
import type { MembershipsRepository } from '../db/repositories/memberships.repository.js';
import type { OrgUnitsRepository, OrgUnitRow } from '../db/repositories/org-units.repository.js';
import type { MembershipRow } from '../db/repositories/memberships.repository.js';
import type { DbService } from '../db/db.service.js';
import type { CacheGateway } from '../principal/cache-gateway.js';
import type { KeyValueStore } from '../redis/key-value-store.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG_ID = 'org_sample';

function makeMembership(overrides: Record<string, unknown> = {}): MembershipRow {
  return {
    id: 'mem_1',
    userId: 'user_jovan',
    orgId: ORG_ID,
    orgUnitId: 'team_product',
    costCenterUnitId: null,
    lineManagerUserId: null,
    status: 'ACTIVE' as const,
    startDate: new Date('2026-01-01'),
    endDate: null,
    endedReason: null,
    teamId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as MembershipRow;
}

function makeOrgUnitRow(): OrgUnitRow {
  return {
    id: 'team_product',
    orgId: ORG_ID,
    parentId: 'ou_engineering',
    kind: 'TEAM' as const,
    name: 'Product',
    costCenterCode: null,
    archivedAt: null,
    createdAt: new Date(),
  };
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

function createMocks() {
  const memberships: Partial<MembershipsRepository> = {
    findByIdAndOrg: vi.fn(async () => makeMembership()) as MembershipsRepository['findByIdAndOrg'],
    findActiveByUserAndOrg: vi.fn(async () => makeMembership()) as MembershipsRepository['findActiveByUserAndOrg'],
    listMembers: vi.fn(async () => []) as MembershipsRepository['listMembers'],
    updateMembership: vi.fn(async (_id: string, _orgId: string, values: Record<string, unknown>) =>
      makeMembership(values),
    ) as MembershipsRepository['updateMembership'],
    findMemberContact: vi.fn(async () => ({
      displayName: 'Jovan Petrović',
      email: 'user_jovan@example.com',
    })) as MembershipsRepository['findMemberContact'],
  };

  const orgUnits: Partial<OrgUnitsRepository> = {
    findByIdAndOrg: vi.fn(async () => makeOrgUnitRow()) as OrgUnitsRepository['findByIdAndOrg'],
  };

  const dbService: Partial<DbService> = {
    withOrgScope: vi.fn(async (_orgId: string, fn: (tx: never) => Promise<unknown>) =>
      fn(null as never),
    ) as DbService['withOrgScope'],
  };

  const cache: Partial<CacheGateway> = {
    del: vi.fn(async () => {}),
  };

  const store: Partial<KeyValueStore> = {
    publish: vi.fn(async () => 0),
  };

  return { memberships, orgUnits, dbService, cache, store };
}

function createService(mocks: ReturnType<typeof createMocks>) {
  return new MembersAdminService(
    mocks.dbService as DbService,
    mocks.memberships as MembershipsRepository,
    mocks.orgUnits as OrgUnitsRepository,
    mocks.cache as CacheGateway,
    mocks.store as KeyValueStore,
    { record: vi.fn().mockResolvedValue(undefined) } as never,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MembersAdminService', () => {
  let mocks: ReturnType<typeof createMocks>;
  let service: MembersAdminService;

  beforeEach(() => {
    mocks = createMocks();
    service = createService(mocks);
  });

  describe('updateMember', () => {
    it('validates orgUnitId belongs to org', async () => {
      (mocks.orgUnits.findByIdAndOrg as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

      await expect(
        service.updateMember(ORG_ID, 'mem_1', { orgUnitId: 'bad_unit' }),
      ).rejects.toThrow('Org unit not found');
    });

    it('validates lineManagerUserId has active membership', async () => {
      (mocks.memberships.findActiveByUserAndOrg as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

      await expect(
        service.updateMember(ORG_ID, 'mem_1', { lineManagerUserId: 'bad_user' }),
      ).rejects.toThrow('Line manager has no active membership');
    });

    it('returns the member item with the member\'s name and email', async () => {
      const item = await service.updateMember(ORG_ID, 'mem_1', { orgUnitId: 'team_product' });

      expect((mocks.memberships.findMemberContact as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBe('user_jovan');
      expect(item).toMatchObject({
        userId: 'user_jovan',
        displayName: 'Jovan Petrović',
        email: 'user_jovan@example.com',
        orgUnitId: 'team_product',
      });
      expect(MemberItemSchema.safeParse(item).success).toBe(true);
    });

    it('invalidates cache after update', async () => {
      await service.updateMember(ORG_ID, 'mem_1', { orgUnitId: 'team_product' });

      expect(mocks.cache.del).toHaveBeenCalledWith(
        'principal:user_jovan',
        'grants:user_jovan:org_sample',
      );
    });
  });

  describe('listMembers', () => {
    it('detects next page when limit+1 rows returned', async () => {
      const items = Array.from({ length: 3 }, (_, i) => ({
        membershipId: `mem_${i}`,
        userId: `user_${i}`,
        displayName: `User ${i}`,
        email: `user_${i}@example.com`,
        orgUnitId: null,
        costCenterUnitId: null,
        lineManagerUserId: null,
        status: 'ACTIVE' as const,
        startDate: new Date('2026-01-01'),
        endDate: null,
      }));

      (mocks.memberships.listMembers as ReturnType<typeof vi.fn>).mockResolvedValueOnce(items);

      const result = await service.listMembers(ORG_ID, { limit: 2 });
      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).toBe('mem_1');
    });

    it('returns null cursor when no next page', async () => {
      (mocks.memberships.listMembers as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      const result = await service.listMembers(ORG_ID, { limit: 25 });
      expect(result.items).toHaveLength(0);
      expect(result.nextCursor).toBeNull();
    });
  });
});
