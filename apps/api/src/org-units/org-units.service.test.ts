/**
 * Unit tests for OrgUnitsService — mocked repository, in-memory closure.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OrgUnitsService } from './org-units.service.js';
import type { OrgUnitsRepository } from '../db/repositories/org-units.repository.js';
import type { DbService } from '../db/db.service.js';
import type { CacheGateway } from '../principal/cache-gateway.js';
import type { KeyValueStore } from '../redis/key-value-store.js';
import { buildClosureRows } from './closure.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const UNITS = [
  { id: 'ou_root', parentId: null },
  { id: 'ou_engineering', parentId: 'ou_root' },
  { id: 'ou_commercial', parentId: 'ou_root' },
  { id: 'team_product', parentId: 'ou_engineering' },
  { id: 'team_operations', parentId: 'ou_engineering' },
  { id: 'team_sales', parentId: 'ou_commercial' },
];

const ORG_ID = 'org_sample';

const closureRows = buildClosureRows(UNITS);

function makeUnitRow(id: string) {
  const u = UNITS.find((u) => u.id === id);
  return {
    id,
    orgId: ORG_ID,
    parentId: u?.parentId ?? null,
    kind: (id === 'ou_root' ? 'COMPANY' : id.startsWith('ou_') ? 'DEPARTMENT' : 'TEAM') as 'COMPANY' | 'DEPARTMENT' | 'TEAM',
    name: id,
    costCenterCode: null as string | null,
    archivedAt: null as Date | null,
    createdAt: new Date(),
  };
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

function createMocks() {
  let currentClosure = [...closureRows];

  const repo: Partial<OrgUnitsRepository> = {
    findByIdAndOrg: vi.fn(async (unitId: string, _orgId: string) => {
      const u = UNITS.find((u) => u.id === unitId);
      return u ? makeUnitRow(unitId) : null;
    }) as OrgUnitsRepository['findByIdAndOrg'],
    closureRowsByOrg: vi.fn(async () => currentClosure),
    insertClosureRows: vi.fn(async (rows) => {
      currentClosure = [...currentClosure, ...rows];
    }),
    deleteExternalClosureRows: vi.fn(async (subtreeNodeIds: string[]) => {
      const subtreeSet = new Set(subtreeNodeIds);
      currentClosure = currentClosure.filter(
        (r) => !(subtreeSet.has(r.descendantId) && !subtreeSet.has(r.ancestorId)),
      );
    }),
    create: vi.fn(async (values) => ({
      id: 'new_unit',
      orgId: values.orgId ?? ORG_ID,
      parentId: values.parentId ?? null,
      kind: (values.kind ?? 'TEAM') as 'COMPANY' | 'DEPARTMENT' | 'TEAM',
      name: values.name ?? 'New',
      costCenterCode: values.costCenterCode ?? null,
      archivedAt: null as Date | null,
      createdAt: new Date(),
    })) as OrgUnitsRepository['create'],
    update: vi.fn(async (unitId: string, _orgId: string, values: Record<string, unknown>) => ({
      ...makeUnitRow(unitId),
      ...values,
    })) as OrgUnitsRepository['update'],
    listByOrg: vi.fn(async () => []) as OrgUnitsRepository['listByOrg'],
  };

  const dbService: Partial<DbService> = {
    withOrgScope: vi.fn(async (_orgId: string, fn: (tx: never) => Promise<unknown>) => fn(null as never)) as DbService['withOrgScope'],
  };

  const cache: Partial<CacheGateway> = {
    del: vi.fn(async () => {}),
  };

  const store: Partial<KeyValueStore> = {
    publish: vi.fn(async () => 0),
  };

  return { repo, dbService, cache, store, currentClosure: () => currentClosure };
}

function createService(mocks: ReturnType<typeof createMocks>) {
  return new OrgUnitsService(
    mocks.dbService as DbService,
    mocks.repo as OrgUnitsRepository,
    mocks.cache as CacheGateway,
    mocks.store as KeyValueStore,
    { record: vi.fn().mockResolvedValue(undefined) } as never,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OrgUnitsService', () => {
  let mocks: ReturnType<typeof createMocks>;
  let service: OrgUnitsService;

  beforeEach(() => {
    mocks = createMocks();
    service = createService(mocks);
  });

  describe('createUnit', () => {
    it('inserts correct closure rows for a new unit under ou_engineering', async () => {
      const result = await service.createUnit(ORG_ID, {
        parentId: 'ou_engineering',
        kind: 'TEAM',
        name: 'New Team',
      });

      expect(result.id).toBe('new_unit');
      expect(mocks.repo.create).toHaveBeenCalledTimes(1);
      expect(mocks.repo.insertClosureRows).toHaveBeenCalledTimes(1);

      const insertedRows = (mocks.repo.insertClosureRows as ReturnType<typeof vi.fn>).mock.calls[0]![0];
      // Should have: self(0), ou_engineering(1), ou_root(2)
      expect(insertedRows).toHaveLength(3);
      const selfRow = insertedRows.find(
        (r: { ancestorId: string; descendantId: string }) => r.ancestorId === 'new_unit' && r.descendantId === 'new_unit',
      );
      expect(selfRow.depth).toBe(0);
    });

    it('rejects COMPANY kind', async () => {
      await expect(
        service.createUnit(ORG_ID, {
          parentId: 'ou_root',
          kind: 'COMPANY',
          name: 'Nope',
        }),
      ).rejects.toThrow('COMPANY units cannot be created through the API');
    });
  });

  describe('moveUnit', () => {
    it('rejects moving a root', async () => {
      await expect(
        service.moveUnit(ORG_ID, 'ou_root', { parentId: 'ou_engineering' }),
      ).rejects.toThrow('A root unit cannot be moved');
    });

    it('rejects a cycle (moving under a descendant)', async () => {
      await expect(
        service.moveUnit(ORG_ID, 'ou_engineering', { parentId: 'team_product' }),
      ).rejects.toThrow('Cannot move a unit under itself or one of its descendants');
    });

    it('rejects moving under self', async () => {
      await expect(
        service.moveUnit(ORG_ID, 'ou_engineering', { parentId: 'ou_engineering' }),
      ).rejects.toThrow('Cannot move a unit under itself or one of its descendants');
    });

    it('computes correct depths when moving team_sales under ou_engineering', async () => {
      await service.moveUnit(ORG_ID, 'team_sales', { parentId: 'ou_engineering' });

      expect(mocks.repo.deleteExternalClosureRows).toHaveBeenCalledTimes(1);
      expect(mocks.repo.insertClosureRows).toHaveBeenCalledTimes(1);
      expect(mocks.repo.update).toHaveBeenCalledWith(
        'team_sales',
        ORG_ID,
        { parentId: 'ou_engineering' },
        null,
      );

      const insertedRows = (mocks.repo.insertClosureRows as ReturnType<typeof vi.fn>).mock.calls[0]![0];
      // ou_engineering -> team_sales at 1, ou_root -> team_sales at 2
      expect(insertedRows).toHaveLength(2);
      const engRow = insertedRows.find(
        (r: { ancestorId: string }) => r.ancestorId === 'ou_engineering',
      );
      expect(engRow.depth).toBe(1);
      const rootRow = insertedRows.find(
        (r: { ancestorId: string }) => r.ancestorId === 'ou_root',
      );
      expect(rootRow.depth).toBe(2);
    });

    it('invalidates org tree cache after move', async () => {
      await service.moveUnit(ORG_ID, 'team_sales', { parentId: 'ou_engineering' });

      expect(mocks.cache.del).toHaveBeenCalledWith('org_tree:org_sample');
      expect(mocks.store.publish).toHaveBeenCalledWith(
        'invalidate',
        expect.stringContaining('org_tree:org_sample'),
      );
    });
  });
});
