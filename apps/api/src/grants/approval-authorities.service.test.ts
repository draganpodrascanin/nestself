/**
 * Unit tests for ApprovalAuthoritiesService: membership, alternate and org
 * unit rules, explicit field mapping and the `approval_authority.changed`
 * audit event.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Principal } from '@nestself/contracts';
import { ApiHttpException } from '../common/api-error.js';
import type { ApprovalAuthorityRow } from '../db/repositories/approval-authorities.repository.js';
import { ApprovalAuthoritiesService } from './approval-authorities.service.js';

const ORG = 'org_sample';
const NOW = new Date('2026-10-24T10:00:00.000Z');
const ACTOR = { userId: 'user_ivana', context: { kind: 'organization', orgId: ORG } } as Principal;

function aaRow(overrides: Partial<ApprovalAuthorityRow> = {}): ApprovalAuthorityRow {
  return {
    id: 'aa_1',
    userId: 'user_stefan',
    orgId: ORG,
    orgUnitId: null,
    includeDescendants: false,
    categories: ['events'],
    maxAmountMinor: 50_000,
    currency: 'EUR',
    validFrom: NOW,
    validUntil: null,
    delegatedFromId: null,
    alternateUserId: null,
    isConfidentialApprover: false,
    createdAt: NOW,
    ...overrides,
  };
}

function createMocks() {
  const rows = new Map<string, ApprovalAuthorityRow>([['aa_1', aaRow()]]);
  const repo = {
    list: vi.fn(async () => [...rows.values()]),
    findById: vi.fn(async (id: string) => rows.get(id) ?? null),
    create: vi.fn(async (values: Partial<ApprovalAuthorityRow>) => aaRow({ ...values, id: 'aa_new' })),
    update: vi.fn(async (id: string, patch: Partial<ApprovalAuthorityRow>) => ({ ...rows.get(id)!, ...patch })),
  };
  const authzRepo = {
    findActiveMembership: vi.fn(async (_userId: string): Promise<{ membershipId: string; orgUnitId: string | null } | null> => ({
      membershipId: 'mem_1',
      orgUnitId: null,
    })),
  };
  const orgUnits = { findByIdAndOrg: vi.fn(async (id: string) => ({ id, orgId: ORG })) };
  const db = { withOrgScope: vi.fn(async (_org: string, fn: (tx: never) => Promise<unknown>) => fn(null as never)) };
  const audit = { record: vi.fn(async (_event: Record<string, unknown>) => {}) };
  return { rows, repo, authzRepo, orgUnits, db, audit };
}

type Mocks = ReturnType<typeof createMocks>;

function service(m: Mocks): ApprovalAuthoritiesService {
  return new ApprovalAuthoritiesService(
    m.db as never,
    m.repo as never,
    m.authzRepo as never,
    m.orgUnits as never,
    m.audit as never,
  );
}

async function apiError(p: Promise<unknown>): Promise<ApiHttpException> {
  try {
    await p;
  } catch (err) {
    if (err instanceof ApiHttpException) return err;
    throw err;
  }
  throw new Error('expected an ApiHttpException');
}

const CREATE = {
  userId: 'user_stefan',
  includeDescendants: false,
  categories: ['events'],
  isConfidentialApprover: false,
};

describe('ApprovalAuthoritiesService', () => {
  let m: Mocks;
  let svc: ApprovalAuthoritiesService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    m = createMocks();
    svc = service(m);
  });

  describe('list', () => {
    it('lists the organization authorities in its tenant scope with ISO dates', async () => {
      const res = await svc.list(ORG);
      expect(m.db.withOrgScope).toHaveBeenCalledWith(ORG, expect.any(Function));
      expect(m.repo.list).toHaveBeenCalledWith(ORG, null);
      expect(res.items).toEqual([
        {
          id: 'aa_1',
          userId: 'user_stefan',
          orgId: ORG,
          orgUnitId: null,
          includeDescendants: false,
          categories: ['events'],
          maxAmountMinor: 50_000,
          currency: 'EUR',
          validFrom: NOW.toISOString(),
          validUntil: null,
          delegatedFromId: null,
          alternateUserId: null,
          isConfidentialApprover: false,
        },
      ]);
    });
  });

  describe('create', () => {
    it('rejects a user without an ACTIVE membership with 409 subject_not_member', async () => {
      m.authzRepo.findActiveMembership.mockResolvedValueOnce(null as never);
      const err = await apiError(svc.create(ORG, CREATE, ACTOR));
      expect(err.getStatus()).toBe(409);
      expect(err.code).toBe('subject_not_member');
      expect(m.repo.create).not.toHaveBeenCalled();
    });

    it('rejects alternateUserId equal to userId with 400 validation', async () => {
      const err = await apiError(svc.create(ORG, { ...CREATE, alternateUserId: 'user_stefan' }, ACTOR));
      expect(err.getStatus()).toBe(400);
      expect(err.code).toBe('validation');
      expect(m.repo.create).not.toHaveBeenCalled();
    });

    it('rejects an alternate without an ACTIVE membership with 409 subject_not_member', async () => {
      m.authzRepo.findActiveMembership.mockImplementation(async (userId: string) =>
        userId === 'user_milica' ? null : { membershipId: 'mem_1', orgUnitId: null },
      );
      const err = await apiError(svc.create(ORG, { ...CREATE, alternateUserId: 'user_milica' }, ACTOR));
      expect(err.getStatus()).toBe(409);
      expect(err.code).toBe('subject_not_member');
    });

    it('rejects an org unit outside the organization with 404', async () => {
      m.orgUnits.findByIdAndOrg.mockResolvedValueOnce(null as never);
      const err = await apiError(svc.create(ORG, { ...CREATE, orgUnitId: 'ou_other' }, ACTOR));
      expect(err.getStatus()).toBe(404);
      expect(m.orgUnits.findByIdAndOrg).toHaveBeenCalledWith('ou_other', ORG, null);
    });

    it('rejects validUntil not after validFrom with 400 validation', async () => {
      const err = await apiError(
        svc.create(ORG, { ...CREATE, validFrom: '2026-11-01T00:00:00.000Z', validUntil: '2026-10-01T00:00:00.000Z' }, ACTOR),
      );
      expect(err.getStatus()).toBe(400);
      expect(err.code).toBe('validation');
    });

    it('maps fields explicitly, takes orgId from the route and defaults validFrom to now', async () => {
      const res = await svc.create(
        ORG,
        { ...CREATE, orgUnitId: 'team_product', includeDescendants: true, maxAmountMinor: 9000, currency: 'RSD', alternateUserId: 'user_ana' },
        ACTOR,
      );
      expect(m.repo.create).toHaveBeenCalledWith(
        {
          userId: 'user_stefan',
          orgId: ORG,
          orgUnitId: 'team_product',
          includeDescendants: true,
          categories: ['events'],
          maxAmountMinor: 9000,
          currency: 'RSD',
          validFrom: NOW,
          validUntil: null,
          delegatedFromId: null,
          alternateUserId: 'user_ana',
          isConfidentialApprover: false,
        },
        null,
      );
      expect(res.id).toBe('aa_new');
      expect(res.orgId).toBe(ORG);
    });

    it('without an org unit stores no descendants flag and the default currency', async () => {
      await svc.create(ORG, { ...CREATE, includeDescendants: true }, ACTOR);
      const values = m.repo.create.mock.calls[0]![0] as Record<string, unknown>;
      expect(values['orgUnitId']).toBeNull();
      expect(values['includeDescendants']).toBe(false);
      expect(values['currency']).toBe('EUR');
      expect(values['maxAmountMinor']).toBeNull();
    });

    it('audits approval_authority.changed with the changed fields and no values', async () => {
      await svc.create(ORG, { ...CREATE, maxAmountMinor: 9000 }, ACTOR);
      expect(m.audit.record).toHaveBeenCalledTimes(1);
      const event = m.audit.record.mock.calls[0]![0];
      expect(event).toMatchObject({
        action: 'approval_authority.changed',
        actorUserId: 'user_ivana',
        orgId: ORG,
        recordType: 'approval_authority',
        recordId: 'aa_new',
        result: 'ALLOWED',
      });
      const details = event['details'] as Record<string, unknown>;
      expect(details['operation']).toBe('created');
      expect(details['subjectUserId']).toBe('user_stefan');
      expect(details['changedFields']).toEqual(
        expect.arrayContaining(['userId', 'categories', 'maxAmountMinor', 'isConfidentialApprover']),
      );
      expect(details).not.toHaveProperty('maxAmountMinor');
    });
  });

  describe('update', () => {
    it('returns 404 for an authority of another organization or an unknown id', async () => {
      m.rows.set('aa_other', aaRow({ id: 'aa_other', orgId: 'org_other' }));
      expect((await apiError(svc.update(ORG, 'aa_other', { categories: [] }, ACTOR))).getStatus()).toBe(404);
      expect((await apiError(svc.update(ORG, 'aa_missing', { categories: [] }, ACTOR))).getStatus()).toBe(404);
      expect(m.repo.update).not.toHaveBeenCalled();
    });

    it('maps only the allowed fields, never userId or orgId', async () => {
      const body = {
        categories: ['travel'],
        maxAmountMinor: 100,
        validUntil: '2027-01-01T00:00:00.000Z',
        alternateUserId: 'user_ana',
        isConfidentialApprover: true,
        userId: 'user_evil',
        orgId: 'org_evil',
      };
      await svc.update(ORG, 'aa_1', body as never, ACTOR);
      expect(m.repo.update).toHaveBeenCalledWith(
        'aa_1',
        {
          categories: ['travel'],
          maxAmountMinor: 100,
          validUntil: new Date('2027-01-01T00:00:00.000Z'),
          alternateUserId: 'user_ana',
          isConfidentialApprover: true,
        },
        null,
      );
    });

    it('allows clearing the alternate with null', async () => {
      m.rows.set('aa_1', aaRow({ alternateUserId: 'user_ana' }));
      await svc.update(ORG, 'aa_1', { alternateUserId: null }, ACTOR);
      expect(m.repo.update).toHaveBeenCalledWith('aa_1', { alternateUserId: null }, null);
    });

    it('rejects an alternate equal to the stored userId with 400 validation', async () => {
      const err = await apiError(svc.update(ORG, 'aa_1', { alternateUserId: 'user_stefan' }, ACTOR));
      expect(err.getStatus()).toBe(400);
      expect(err.code).toBe('validation');
    });

    it('rejects an alternate without an ACTIVE membership with 409 subject_not_member', async () => {
      m.authzRepo.findActiveMembership.mockResolvedValueOnce(null as never);
      const err = await apiError(svc.update(ORG, 'aa_1', { alternateUserId: 'user_milica' }, ACTOR));
      expect(err.getStatus()).toBe(409);
      expect(err.code).toBe('subject_not_member');
    });

    it('rejects validUntil before the stored validFrom', async () => {
      const err = await apiError(svc.update(ORG, 'aa_1', { validUntil: '2026-01-01T00:00:00.000Z' }, ACTOR));
      expect(err.getStatus()).toBe(400);
    });

    it('audits approval_authority.changed with the changed field names', async () => {
      await svc.update(ORG, 'aa_1', { categories: ['travel'], isConfidentialApprover: true }, ACTOR);
      const event = m.audit.record.mock.calls[0]![0];
      expect(event).toMatchObject({ action: 'approval_authority.changed', recordId: 'aa_1', orgId: ORG });
      expect(event['details']).toEqual({
        operation: 'updated',
        subjectUserId: 'user_stefan',
        changedFields: ['categories', 'isConfidentialApprover'],
      });
    });

    it('an empty patch writes nothing and audits nothing', async () => {
      const res = await svc.update(ORG, 'aa_1', {}, ACTOR);
      expect(res.id).toBe('aa_1');
      expect(m.repo.update).not.toHaveBeenCalled();
      expect(m.audit.record).not.toHaveBeenCalled();
    });
  });
});
