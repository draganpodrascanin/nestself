/**
 * Unit tests for GrantsService: every grant administration rule with
 * mocked repositories and loaders.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CONFIDENTIAL_ACTIONS, PERMISSION_TEMPLATES, type GrantInput, type Principal } from '@nestself/contracts';
import { ApiHttpException } from '../common/api-error.js';
import type { GrantRow } from '../db/repositories/authorization.repository.js';
import { GrantsService } from './grants.service.js';

const ORG = 'org_sample';
const NOW = new Date('2026-10-24T10:00:00.000Z');

function row(overrides: Partial<GrantRow> = {}): GrantRow {
  return {
    id: 'grant_1',
    subjectUserId: 'user_ana',
    templateKey: 'team_manager',
    actions: ['budget.read', 'spend.approve'],
    scopeType: 'org_unit',
    scopeOrgId: ORG,
    scopeOrgUnitId: 'team_product',
    includeDescendants: false,
    scopeRefKind: null,
    scopeRefId: null,
    conditions: [{ type: 'spending_ceiling', amountMinor: 1000, currency: 'EUR' }],
    validFrom: NOW,
    validUntil: null,
    delegationEnvelope: null,
    parentGrantId: null,
    grantedByUserId: 'user_ivana',
    grantedAt: NOW,
    revokedAt: null,
    revokedByUserId: null,
    revokedReason: null,
    ...overrides,
  } as GrantRow;
}

/** Ivana's employer_owner grant: the parent for delegation tests. */
const PARENT = row({
  id: 'grant_parent',
  subjectUserId: 'user_ivana',
  templateKey: 'employer_owner',
  actions: ['access.delegate', 'access.preview', 'people.invite'],
  scopeType: 'organization',
  scopeOrgUnitId: null,
  conditions: null,
});

function input(r: GrantRow): GrantInput {
  return {
    id: r.id,
    subjectUserId: r.subjectUserId,
    templateKey: r.templateKey ?? '',
    actions: r.actions,
    scopeType: r.scopeType as GrantInput['scopeType'],
    scopeOrgId: r.scopeOrgId,
    scopeOrgUnitId: r.scopeOrgUnitId,
    includeDescendants: r.includeDescendants,
    scopeRefKind: null,
    scopeRefId: null,
    conditions: [],
    validFrom: r.validFrom,
    validUntil: r.validUntil,
    delegationEnvelope: null,
    parentGrantId: r.parentGrantId,
    revokedAt: r.revokedAt,
  };
}

/** Executor handed out by the mocked `withTransaction` (system context). */
const SYSTEM_TX = { kind: 'system-tx' };

const ACTOR = { userId: 'user_ivana', context: { kind: 'organization', orgId: ORG } } as Principal;

function createMocks() {
  const grants = new Map<string, GrantRow>([[PARENT.id, PARENT]]);
  const authzRepo = {
    findActiveMembership: vi.fn(async () => ({ membershipId: 'mem_1', orgUnitId: 'team_product' })),
    createGrant: vi.fn(async (values: Partial<GrantRow>, _tx?: unknown) => row({ ...values, id: 'grant_new' } as Partial<GrantRow>)),
    findGrantById: vi.fn(async (id: string) => grants.get(id) ?? null),
    updateGrant: vi.fn(async (id: string, patch: Record<string, unknown>) => ({ ...grants.get(id)!, ...patch })),
    revokeGrantTree: vi.fn(async (ids: string[]) => ({ roots: ids, children: [] as string[] })),
    delegationDepth: vi.fn(async () => 0),
    findActiveChildGrants: vi.fn(async (_parentIds: string[], _tx?: unknown): Promise<GrantRow[]> => []),
    listGrantsForOrg: vi.fn(async () => [row()]),
    findAncestorIds: vi.fn(async (id: string) => [id, 'ou_engineering']),
    listPlatformGrants: vi.fn(async () => [row({ id: 'grant_platform', scopeType: 'platform', scopeOrgId: null, scopeOrgUnitId: null })]),
  };
  const orgUnits = {
    findByIdAndOrg: vi.fn(async (id: string) => ({ id, orgId: ORG })),
  };
  const db = {
    withOrgScope: vi.fn(async (_org: string, fn: (tx: never) => Promise<unknown>) => fn(null as never)),
    withTransaction: vi.fn(async (fn: (tx: never) => Promise<unknown>) => fn(SYSTEM_TX as never)),
  };
  const principalLoader = {
    loadGrants: vi.fn(async () => [input(PARENT)]),
    load: vi.fn(async (userId: string) => ({
      userId,
      displayName: 'Ana',
      initials: 'A',
      locale: 'en',
      memberships: [{ membershipId: 'mem_1', orgId: ORG, orgUnitId: 'team_product', status: 'ACTIVE', startDate: NOW.toISOString(), endDate: null }],
      staffTemplates: [],
      expert: null,
      isSuspended: false,
      isDeactivated: false,
      populationHints: { hasStaffGrants: false, hasExpertGrants: false, hasActiveMembership: true },
    })),
    invalidateUser: vi.fn(async () => {}),
    loadAssignments: vi.fn(async () => [
      { id: 'asg_client', userId: 'user_ana', kind: 'CLIENT', targetId: 'org_client', startAt: NOW, endAt: null },
    ]),
  };
  const contextLoader = { build: vi.fn() };
  const audit = { record: vi.fn(async () => {}) };
  return { grants, authzRepo, orgUnits, db, principalLoader, contextLoader, audit };
}

type Mocks = ReturnType<typeof createMocks>;

function service(m: Mocks): GrantsService {
  return new GrantsService(
    m.db as never,
    m.authzRepo as never,
    m.orgUnits as never,
    m.principalLoader as never,
    m.contextLoader as never,
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
  templateKey: 'team_manager',
  subjectUserId: 'user_ana',
  scopeType: 'org_unit' as const,
  scopeOrgUnitId: 'team_product',
  includeDescendants: false,
  conditions: [{ type: 'spending_ceiling' as const, amountMinor: 1000, currency: 'EUR' }],
};

describe('GrantsService', () => {
  let m: Mocks;
  let svc: GrantsService;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    m = createMocks();
    svc = service(m);
  });

  // ── create ──────────────────────────────────────────────────────────

  describe('create', () => {
    it('rejects an unknown template with 400 template_inactive', async () => {
      const err = await apiError(svc.create(ORG, { ...CREATE, templateKey: 'nope' }, ACTOR));
      expect(err.getStatus()).toBe(400);
      expect(err.code).toBe('template_inactive');
      expect(m.authzRepo.createGrant).not.toHaveBeenCalled();
    });

    it('rejects a template from another workspace with 400 validation', async () => {
      const err = await apiError(
        svc.create(ORG, { ...CREATE, templateKey: 'platform_owner', scopeType: 'organization', scopeOrgUnitId: undefined, conditions: [] }, ACTOR),
      );
      expect(err.getStatus()).toBe(400);
      expect(err.code).toBe('validation');
    });

    it('rejects a scope type other than organization or org_unit with 400 validation', async () => {
      const err = await apiError(svc.create(ORG, { ...CREATE, scopeType: 'platform' }, ACTOR));
      expect(err.getStatus()).toBe(400);
      expect(err.code).toBe('validation');
    });

    it('requires scopeOrgUnitId for org_unit scope', async () => {
      const err = await apiError(svc.create(ORG, { ...CREATE, scopeOrgUnitId: undefined }, ACTOR));
      expect(err.code).toBe('validation');
    });

    it('rejects a subject without an ACTIVE membership with 409 subject_not_member', async () => {
      m.authzRepo.findActiveMembership.mockResolvedValueOnce(null as never);
      const err = await apiError(svc.create(ORG, CREATE, ACTOR));
      expect(err.getStatus()).toBe(409);
      expect(err.code).toBe('subject_not_member');
      expect(m.authzRepo.findActiveMembership).toHaveBeenCalledWith('user_ana', ORG, null);
    });

    it('rejects an org unit that does not belong to the organization with 404', async () => {
      m.orgUnits.findByIdAndOrg.mockResolvedValueOnce(null as never);
      const err = await apiError(svc.create(ORG, CREATE, ACTOR));
      expect(err.getStatus()).toBe(404);
      expect(m.orgUnits.findByIdAndOrg).toHaveBeenCalledWith('team_product', ORG, null);
    });

    it('rejects missing required condition types with 400 missing_conditions', async () => {
      const err = await apiError(svc.create(ORG, { ...CREATE, conditions: [] }, ACTOR));
      expect(err.getStatus()).toBe(400);
      expect(err.code).toBe('missing_conditions');
      expect(err.details).toEqual({ missing: ['spending_ceiling'] });
    });

    it('rejects validUntil not after validFrom', async () => {
      const err = await apiError(
        svc.create(ORG, { ...CREATE, validFrom: '2026-11-01T00:00:00.000Z', validUntil: '2026-10-30T00:00:00.000Z' }, ACTOR),
      );
      expect(err.code).toBe('validation');
    });

    it('copies actions from the template, defaults validFrom to now and records the grantor', async () => {
      const res = await svc.create(ORG, CREATE, ACTOR);
      const values = m.authzRepo.createGrant.mock.calls[0]![0] as Record<string, unknown>;
      expect(values).toMatchObject({
        subjectUserId: 'user_ana',
        templateKey: 'team_manager',
        scopeType: 'org_unit',
        scopeOrgId: ORG,
        scopeOrgUnitId: 'team_product',
        grantedByUserId: 'user_ivana',
        validFrom: NOW,
        validUntil: null,
        parentGrantId: null,
      });
      expect(values.actions).toEqual([
        'events.request', 'activity.request', 'offer.accept', 'event.invite',
        'budget.read', 'budget.allocate', 'budget.topup.request', 'spend.approve',
      ]);
      expect(res.id).toBe('grant_new');
      expect(res.grantedAt).toBe(NOW.toISOString());
    });

    it('organization scope stores no org unit and no descendants', async () => {
      await svc.create(
        ORG,
        { templateKey: 'hr_admin', subjectUserId: 'user_ana', scopeType: 'organization', includeDescendants: true, conditions: [] },
        ACTOR,
      );
      expect(m.authzRepo.createGrant.mock.calls[0]![0]).toMatchObject({ scopeOrgUnitId: null, includeDescendants: false });
    });

    it('audits grant.created with template, scope, action count and condition type names only', async () => {
      await svc.create(ORG, CREATE, ACTOR);
      expect(m.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'grant.created',
          actorUserId: 'user_ivana',
          orgId: ORG,
          recordType: 'grant',
          recordId: 'grant_new',
          details: {
            subjectUserId: 'user_ana',
            templateKey: 'team_manager',
            scopeType: 'org_unit',
            actionsCount: 8,
            conditionTypes: ['spending_ceiling'],
          },
        }),
      );
    });

    it("invalidates the subject's principal for the organization", async () => {
      await svc.create(ORG, CREATE, ACTOR);
      expect(m.principalLoader.invalidateUser).toHaveBeenCalledWith('user_ana', [ORG]);
    });
  });

  // ── list ────────────────────────────────────────────────────────────

  describe('list', () => {
    it('lists org grants in the org scope with the filter', async () => {
      const res = await svc.list(ORG, { subjectUserId: 'user_ana', includeRevoked: true });
      expect(m.db.withOrgScope).toHaveBeenCalledWith(ORG, expect.any(Function));
      expect(m.authzRepo.listGrantsForOrg).toHaveBeenCalledWith(ORG, { subjectUserId: 'user_ana', includeRevoked: true }, null);
      expect(res.items).toHaveLength(1);
      expect(res.items[0]!.conditions).toEqual([{ type: 'spending_ceiling', amountMinor: 1000, currency: 'EUR' }]);
    });
  });

  // ── update ──────────────────────────────────────────────────────────

  describe('update', () => {
    beforeEach(() => {
      m.grants.set('grant_1', row());
    });

    it('returns 404 for a grant of another organization or a platform grant', async () => {
      m.grants.set('grant_x', row({ id: 'grant_x', scopeOrgId: null }));
      expect((await apiError(svc.update(ORG, 'grant_x', { validUntil: '2027-01-01T00:00:00.000Z' }, ACTOR))).getStatus()).toBe(404);
      expect((await apiError(svc.update(ORG, 'missing', { validUntil: '2027-01-01T00:00:00.000Z' }, ACTOR))).getStatus()).toBe(404);
    });

    it('returns 409 conflict for a revoked grant', async () => {
      m.grants.set('grant_1', row({ revokedAt: NOW }));
      const err = await apiError(svc.update(ORG, 'grant_1', { validUntil: '2027-01-01T00:00:00.000Z' }, ACTOR));
      expect(err.getStatus()).toBe(409);
    });

    it('maps the patch fields explicitly and audits the changed fields', async () => {
      const res = await svc.update(ORG, 'grant_1', { validUntil: '2027-01-01T00:00:00.000Z' }, ACTOR);
      expect(m.authzRepo.updateGrant).toHaveBeenCalledWith('grant_1', { validUntil: new Date('2027-01-01T00:00:00.000Z') }, null);
      expect(res.validUntil).toBe('2027-01-01T00:00:00.000Z');
      expect(m.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'grant.adjusted',
          recordId: 'grant_1',
          details: expect.objectContaining({ changedFields: ['validUntil'], templateKey: 'team_manager', scopeType: 'org_unit' }),
        }),
      );
      expect(m.principalLoader.invalidateUser).toHaveBeenCalledWith('user_ana', [ORG]);
    });

    it('invalidates every delegatee below the adjusted grant (their cached ancestor copy)', async () => {
      m.authzRepo.findActiveChildGrants.mockImplementation(async (parentIds: string[]) => {
        if (parentIds.includes('grant_1')) return [row({ id: 'grant_child', subjectUserId: 'user_stefan', parentGrantId: 'grant_1' })];
        if (parentIds.includes('grant_child')) {
          return [row({ id: 'grant_grandchild', subjectUserId: 'user_jovan', parentGrantId: 'grant_child' })];
        }
        return [];
      });
      await svc.update(ORG, 'grant_1', { validUntil: '2027-01-01T00:00:00.000Z' }, ACTOR);
      expect(m.principalLoader.invalidateUser).toHaveBeenCalledWith('user_ana', [ORG]);
      expect(m.principalLoader.invalidateUser).toHaveBeenCalledWith('user_stefan', [ORG]);
      expect(m.principalLoader.invalidateUser).toHaveBeenCalledWith('user_jovan', [ORG]);
    });

    it('rejects conditions missing a required type of the template', async () => {
      const err = await apiError(svc.update(ORG, 'grant_1', { conditions: [] }, ACTOR));
      expect(err.code).toBe('missing_conditions');
    });

    it('rejects validUntil before the stored validFrom', async () => {
      const err = await apiError(svc.update(ORG, 'grant_1', { validUntil: '2026-01-01T00:00:00.000Z' }, ACTOR));
      expect(err.code).toBe('validation');
    });

    it('keeps a delegated grant within its parent bound', async () => {
      m.grants.set('grant_parent', row({ ...PARENT, conditions: [{ type: 'spending_ceiling', amountMinor: 500, currency: 'EUR' }] }));
      m.grants.set('grant_1', row({ parentGrantId: 'grant_parent', templateKey: null, actions: ['people.invite'], scopeType: 'organization', scopeOrgUnitId: null, conditions: [{ type: 'spending_ceiling', amountMinor: 400, currency: 'EUR' }] }));
      const err = await apiError(
        svc.update(ORG, 'grant_1', { conditions: [{ type: 'spending_ceiling', amountMinor: 600, currency: 'EUR' }] }, ACTOR),
      );
      expect(err.getStatus()).toBe(403);
      expect(err.code).toBe('delegation_exceeds_boundary');
      expect(err.details).toEqual({ reason: 'spending_ceiling_exceeds_parent' });
    });

    it('keeps a delegated grant within its parent bound when the parent has an envelope', async () => {
      m.grants.set(
        'grant_parent',
        row({ ...PARENT, delegationEnvelope: { maxDepth: 2 }, conditions: [{ type: 'spending_ceiling', amountMinor: 500, currency: 'EUR' }] }),
      );
      m.grants.set('grant_1', row({ parentGrantId: 'grant_parent', templateKey: null, actions: ['people.invite'], scopeType: 'organization', scopeOrgUnitId: null, conditions: [{ type: 'spending_ceiling', amountMinor: 400, currency: 'EUR' }] }));
      const err = await apiError(
        svc.update(ORG, 'grant_1', { conditions: [{ type: 'spending_ceiling', amountMinor: 600, currency: 'EUR' }] }, ACTOR),
      );
      expect(err.details).toEqual({ reason: 'spending_ceiling_exceeds_parent' });
    });
  });

  // ── revoke ──────────────────────────────────────────────────────────

  describe('revoke', () => {
    beforeEach(() => {
      m.grants.set('grant_1', row());
      m.grants.set('grant_child', row({ id: 'grant_child', subjectUserId: 'user_stefan', parentGrantId: 'grant_1' }));
      m.authzRepo.revokeGrantTree.mockResolvedValue({ roots: ['grant_1'], children: ['grant_child'] });
    });

    it('revokes through revokeGrantTree with the caller reason', async () => {
      await svc.revoke(ORG, 'grant_1', { reason: 'role ended' }, ACTOR);
      expect(m.authzRepo.revokeGrantTree).toHaveBeenCalledWith(
        ['grant_1'],
        { at: NOW, byUserId: 'user_ivana', reason: 'role ended' },
        null,
      );
    });

    it('audits the root as grant.revoked and each descendant as grant.delegation_revoked', async () => {
      await svc.revoke(ORG, 'grant_1', { reason: 'role ended' }, ACTOR);
      const actions = m.audit.record.mock.calls.map((c) => (c as unknown as [{ action: string; recordId: string }])[0]);
      expect(actions).toEqual([
        expect.objectContaining({
          action: 'grant.revoked',
          recordId: 'grant_1',
          details: expect.objectContaining({ reason: 'role ended', templateKey: 'team_manager', revokedDescendants: 1 }),
        }),
        expect.objectContaining({
          action: 'grant.delegation_revoked',
          recordId: 'grant_child',
          details: { reason: 'parent_revoked', rootGrantId: 'grant_1' },
        }),
      ]);
    });

    it('invalidates every subject in the revoked tree', async () => {
      await svc.revoke(ORG, 'grant_1', { reason: 'role ended' }, ACTOR);
      expect(m.principalLoader.invalidateUser).toHaveBeenCalledWith('user_ana', [ORG]);
      expect(m.principalLoader.invalidateUser).toHaveBeenCalledWith('user_stefan', [ORG]);
    });

    it('returns 409 for an already revoked grant and 404 for an unknown one', async () => {
      m.grants.set('grant_1', row({ revokedAt: NOW }));
      expect((await apiError(svc.revoke(ORG, 'grant_1', { reason: 'again' }, ACTOR))).getStatus()).toBe(409);
      expect((await apiError(svc.revoke(ORG, 'nope', { reason: 'again' }, ACTOR))).getStatus()).toBe(404);
    });
  });

  // ── delegate ────────────────────────────────────────────────────────

  describe('delegate', () => {
    const DELEGATE = { parentGrantId: 'grant_parent', subjectUserId: 'user_stefan', actions: ['people.invite'], conditions: [] };

    async function boundary(p: Promise<unknown>): Promise<unknown> {
      const err = await apiError(p);
      expect(err.getStatus()).toBe(403);
      expect(err.code).toBe('delegation_exceeds_boundary');
      expect(m.authzRepo.createGrant).not.toHaveBeenCalled();
      return err.details?.reason;
    }

    it('creates a delegated grant within the parent bound', async () => {
      const res = await svc.delegate(ORG, DELEGATE, ACTOR);
      expect(m.principalLoader.loadGrants).toHaveBeenCalledWith('user_ivana', ORG);
      expect(m.authzRepo.createGrant.mock.calls[0]![0]).toMatchObject({
        subjectUserId: 'user_stefan',
        templateKey: null,
        actions: ['people.invite'],
        scopeType: 'organization',
        scopeOrgId: ORG,
        scopeOrgUnitId: null,
        parentGrantId: 'grant_parent',
        grantedByUserId: 'user_ivana',
        validFrom: NOW,
      });
      expect(res.id).toBe('grant_new');
      expect(m.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'grant.delegated',
          details: expect.objectContaining({ parentGrantId: 'grant_parent', depth: 1, actionsCount: 1, scopeType: 'organization' }),
        }),
      );
      expect(m.principalLoader.invalidateUser).toHaveBeenCalledWith('user_stefan', [ORG]);
    });

    it('returns 404 when the parent grant is not in the organization', async () => {
      const err = await apiError(svc.delegate(ORG, { ...DELEGATE, parentGrantId: 'nope' }, ACTOR));
      expect(err.getStatus()).toBe(404);
    });

    it("rejects a parent grant that is not the actor's", async () => {
      m.grants.set('grant_parent', row({ ...PARENT, subjectUserId: 'user_stefan' }));
      expect(await boundary(svc.delegate(ORG, DELEGATE, ACTOR))).toBe('not_parent_subject');
    });

    it('rejects a subject outside the organization (Review Focus 3)', async () => {
      m.authzRepo.findActiveMembership.mockResolvedValueOnce(null as never);
      expect(await boundary(svc.delegate(ORG, DELEGATE, ACTOR))).toBe('subject_not_member');
    });

    it('rejects a depth beyond 3 (Review Focus 3)', async () => {
      m.authzRepo.delegationDepth.mockResolvedValueOnce(3);
      expect(await boundary(svc.delegate(ORG, DELEGATE, ACTOR))).toBe('delegation_depth_exceeded');
    });

    it('accepts depth 3 exactly', async () => {
      m.authzRepo.delegationDepth.mockResolvedValueOnce(2);
      await svc.delegate(ORG, DELEGATE, ACTOR);
      expect(m.authzRepo.createGrant).toHaveBeenCalled();
    });

    it('rejects an action the parent grant does not contain', async () => {
      expect(await boundary(svc.delegate(ORG, { ...DELEGATE, actions: ['people.invite', 'policy.manage.extra'] }, ACTOR))).toBe(
        'actions_exceed_parent',
      );
    });

    it('rejects a scope type outside the org endpoints with 400 validation', async () => {
      const err = await apiError(svc.delegate(ORG, { ...DELEGATE, scopeType: 'platform' }, ACTOR));
      expect(err.getStatus()).toBe(400);
      expect(err.code).toBe('validation');
    });

    it('checks the org unit belongs to the organization', async () => {
      m.orgUnits.findByIdAndOrg.mockResolvedValueOnce(null as never);
      const err = await apiError(svc.delegate(ORG, { ...DELEGATE, scopeType: 'org_unit', scopeOrgUnitId: 'ou_other' }, ACTOR));
      expect(err.getStatus()).toBe(404);
    });

    it('runs the engine check with the delegator grants merged with the DB parent chain', async () => {
      // The cached delegator grants miss the parent's ancestor; the chain
      // loaded from the DB supplies it, so the engine passes.
      const root = row({ id: 'grant_root', subjectUserId: 'user_jovan', actions: PARENT.actions, scopeType: 'organization', scopeOrgUnitId: null, conditions: null });
      m.grants.set('grant_root', root);
      m.grants.set('grant_parent', row({ ...PARENT, parentGrantId: 'grant_root' }));
      m.authzRepo.delegationDepth.mockResolvedValueOnce(1);
      await svc.delegate(ORG, DELEGATE, ACTOR);
      expect(m.authzRepo.createGrant).toHaveBeenCalled();
    });

    it('maps an engine rejection (revoked ancestor) to 403 with the engine reason', async () => {
      m.grants.set('grant_root', row({ id: 'grant_root', subjectUserId: 'user_jovan', scopeType: 'organization', scopeOrgUnitId: null, revokedAt: NOW }));
      m.grants.set('grant_parent', row({ ...PARENT, parentGrantId: 'grant_root' }));
      m.authzRepo.delegationDepth.mockResolvedValueOnce(1);
      expect(await boundary(svc.delegate(ORG, DELEGATE, ACTOR))).toBe('delegation_parent_revoked');
    });

    it('prefers the DB parent row over a stale cached copy', async () => {
      m.grants.set('grant_parent', row({ ...PARENT, revokedAt: NOW }));
      expect(await boundary(svc.delegate(ORG, DELEGATE, ACTOR))).toBe('delegation_parent_revoked');
    });

    it('applies the parent bound even when the parent has an envelope without actions (API-R-23)', async () => {
      m.grants.set('grant_parent', row({ ...PARENT, delegationEnvelope: { maxDepth: 2 } }));
      expect(await boundary(svc.delegate(ORG, { ...DELEGATE, actions: ['people.invite', 'policy.manage'] }, ACTOR))).toBe(
        'actions_exceed_parent',
      );
    });

    it('creates the delegation when both the parent bound and the envelope pass', async () => {
      m.grants.set('grant_parent', row({ ...PARENT, delegationEnvelope: { maxDepth: 2 } }));
      await svc.delegate(ORG, DELEGATE, ACTOR);
      expect(m.authzRepo.createGrant).toHaveBeenCalled();
    });

    it('lets the engine apply an envelope maxDepth over the full parent chain', async () => {
      const root = row({ id: 'grant_root', subjectUserId: 'user_jovan', actions: PARENT.actions, scopeType: 'organization', scopeOrgUnitId: null, conditions: null });
      m.grants.set('grant_root', root);
      m.grants.set('grant_parent', row({ ...PARENT, parentGrantId: 'grant_root', delegationEnvelope: { maxDepth: 1 } }));
      m.authzRepo.delegationDepth.mockResolvedValueOnce(1);
      // Proposed depth 2 > envelope maxDepth 1; the engine needs the DB chain to count it.
      expect(await boundary(svc.delegate(ORG, DELEGATE, ACTOR))).toBe('delegation_depth_exceeded');
    });

    it('maps an envelope rejection from the engine', async () => {
      m.grants.set(
        'grant_parent',
        row({ ...PARENT, delegationEnvelope: { actions: ['access.preview'], scopeType: null, scopeOrgUnitId: null, includeDescendants: null, maxDepth: null } }),
      );
      expect(await boundary(svc.delegate(ORG, DELEGATE, ACTOR))).toBe('delegation_exceeds_envelope');
    });
  });

  // ── preview ─────────────────────────────────────────────────────────

  describe('preview', () => {
    it("builds the subject's principal and context and drops confidential actions (AUDIT-R-02)", async () => {
      const own = { ...input(row({ id: 'grant_own', scopeType: 'own', scopeOrgId: null, scopeOrgUnitId: null, templateKey: 'employee' })), actions: ['content.read', 'conversation.participate'] };
      const team = { ...input(row()), actions: ['budget.read'] };
      m.contextLoader.build.mockResolvedValueOnce({
        now: NOW,
        isDeactivated: false,
        isSuspended: false,
        grants: [own, team],
        assignments: [{ id: 'asg_1', userId: 'user_ana', kind: 'CASE', targetId: 'c', startAt: NOW, endAt: null }],
        ancestorIds: [],
        orgSelfApprovalAllowed: false,
        organizationTimezone: 'UTC',
      });

      const res = await svc.preview(ORG, 'user_ana', ACTOR);

      expect(m.principalLoader.load).toHaveBeenCalledWith('user_ana');
      const [principal, resource] = m.contextLoader.build.mock.calls[0]! as [Principal, { orgId: string }];
      expect(principal.userId).toBe('user_ana');
      expect(principal.context).toEqual({ kind: 'organization', orgId: ORG });
      expect(resource.orgId).toBe(ORG);
      expect(res.userId).toBe('user_ana');
      expect(res.orgId).toBe(ORG);
      expect(res.actions).toEqual(expect.arrayContaining(['content.read', 'budget.read']));
      for (const action of CONFIDENTIAL_ACTIONS) expect(res.actions).not.toContain(action);
      expect(res.grantIds).toEqual(expect.arrayContaining(['grant_own', 'grant_1']));
      expect(res.assignmentIds).toEqual(['asg_1']);
    });

    it('returns 404 for a user without an ACTIVE membership in the organization', async () => {
      m.authzRepo.findActiveMembership.mockResolvedValueOnce(null as never);
      const err = await apiError(svc.preview(ORG, 'user_other', ACTOR));
      expect(err.getStatus()).toBe(404);
      expect(m.contextLoader.build).not.toHaveBeenCalled();
    });
  });

  // ── platform grants (operations) ────────────────────────────────────

  describe('createPlatform', () => {
    const OPS_ACTOR = { userId: 'user_nikola', context: { kind: 'operations' } } as Principal;
    const PLATFORM = {
      templateKey: 'support_operator',
      subjectUserId: 'user_nikola',
      scopeType: 'assigned_cases' as const,
      conditions: [],
    };

    it('rejects an unknown template with 400 template_inactive', async () => {
      const err = await apiError(svc.createPlatform({ ...PLATFORM, templateKey: 'nope' }, OPS_ACTOR));
      expect(err.getStatus()).toBe(400);
      expect(err.code).toBe('template_inactive');
    });

    it('rejects a template outside the operations workspace with 400 validation', async () => {
      for (const templateKey of ['hr_admin', 'employee', 'expert']) {
        const err = await apiError(svc.createPlatform({ ...PLATFORM, templateKey, scopeType: 'organization' }, OPS_ACTOR));
        expect(err.getStatus()).toBe(400);
        expect(err.code).toBe('validation');
      }
      expect(m.authzRepo.createGrant).not.toHaveBeenCalled();
    });

    it("rejects a scope type other than the template's own with 400 validation", async () => {
      const err = await apiError(svc.createPlatform({ ...PLATFORM, scopeType: 'platform' }, OPS_ACTOR));
      expect(err.getStatus()).toBe(400);
      expect(err.code).toBe('validation');
    });

    it('returns 404 for an unknown subject', async () => {
      m.principalLoader.load.mockResolvedValueOnce(null as never);
      const err = await apiError(svc.createPlatform(PLATFORM, OPS_ACTOR));
      expect(err.getStatus()).toBe(404);
      expect(m.authzRepo.createGrant).not.toHaveBeenCalled();
    });

    it('stores a grant without an organization, with the template actions and scope', async () => {
      const res = await svc.createPlatform(PLATFORM, OPS_ACTOR);
      const values = m.authzRepo.createGrant.mock.calls[0]![0] as Record<string, unknown>;
      expect(values).toMatchObject({
        subjectUserId: 'user_nikola',
        templateKey: 'support_operator',
        scopeType: 'assigned_cases',
        scopeOrgId: null,
        scopeOrgUnitId: null,
        includeDescendants: false,
        parentGrantId: null,
        grantedByUserId: 'user_nikola',
        validFrom: NOW,
        validUntil: null,
      });
      expect(values['actions']).toEqual([...PERMISSION_TEMPLATES.find((t) => t.key === 'support_operator')!.actions]);
      expect(m.db.withOrgScope).not.toHaveBeenCalled();
      expect(res.id).toBe('grant_new');
    });

    it('audits grant.created without an organization', async () => {
      await svc.createPlatform(PLATFORM, OPS_ACTOR);
      const event = (m.audit.record.mock.calls[0] as unknown as [Record<string, unknown>])[0];
      expect(event).toMatchObject({ action: 'grant.created', orgId: null, recordId: 'grant_new' });
      expect(event['details']).toMatchObject({ subjectUserId: 'user_nikola', templateKey: 'support_operator', scopeType: 'assigned_cases' });
    });

    it('inserts the grant and records its audit event inside one system transaction', async () => {
      const order: string[] = [];
      m.authzRepo.createGrant.mockImplementationOnce(async (values: Partial<GrantRow>) => {
        order.push('insert');
        return row({ ...values, id: 'grant_new' } as Partial<GrantRow>);
      });
      m.audit.record.mockImplementationOnce(async () => {
        order.push('audit');
      });
      m.db.withTransaction.mockImplementationOnce(async (fn: (tx: never) => Promise<unknown>) => {
        order.push('begin');
        const result = await fn(SYSTEM_TX as never);
        order.push('commit');
        return result;
      });

      await svc.createPlatform(PLATFORM, OPS_ACTOR);

      expect(m.db.withTransaction).toHaveBeenCalledTimes(1);
      expect(m.authzRepo.createGrant.mock.calls[0]![1]).toBe(SYSTEM_TX);
      expect(order).toEqual(['begin', 'insert', 'audit', 'commit']);
    });

    it('rolls the platform grant back when the audit writer rejects (strict mode)', async () => {
      let committed = false;
      m.db.withTransaction.mockImplementationOnce(async (fn: (tx: never) => Promise<unknown>) => {
        const result = await fn(SYSTEM_TX as never); // a rejection here rolls the insert back
        committed = true;
        return result;
      });
      m.audit.record.mockRejectedValueOnce(new Error('audit insert failed'));

      await expect(svc.createPlatform(PLATFORM, OPS_ACTOR)).rejects.toThrow('audit insert failed');
      expect(m.db.withTransaction).toHaveBeenCalledTimes(1);
      expect(m.authzRepo.createGrant).toHaveBeenCalledTimes(1);
      expect(m.authzRepo.createGrant.mock.calls[0]![1]).toBe(SYSTEM_TX);
      expect(committed).toBe(false);
      expect(m.principalLoader.invalidateUser).not.toHaveBeenCalled();
    });

    it("invalidates the subject's grants for the platform, member and client organizations", async () => {
      await svc.createPlatform(PLATFORM, OPS_ACTOR);
      expect(m.principalLoader.invalidateUser).toHaveBeenCalledWith('user_nikola', ['platform', ORG, 'org_client']);
    });
  });

  describe('listPlatform', () => {
    it('passes the subject and revoked filters to the repository', async () => {
      m.authzRepo.listPlatformGrants.mockResolvedValueOnce([
        row({ id: 'g_a', subjectUserId: 'user_ana', scopeType: 'platform', scopeOrgId: null, scopeOrgUnitId: null }),
        row({ id: 'g_n', subjectUserId: 'user_nikola', scopeType: 'platform', scopeOrgId: null, scopeOrgUnitId: null }),
      ]);
      const res = await svc.listPlatform({ subjectUserId: 'user_nikola', includeRevoked: true });
      expect(m.authzRepo.listPlatformGrants).toHaveBeenCalledWith({ subjectUserId: 'user_nikola', includeRevoked: true });
      expect(res.items.map((g) => g.id)).toEqual(['g_a', 'g_n']);
    });
  });

  describe('userAccess', () => {
    function ctxWith(grants: GrantInput[], assignmentIds: string[] = []) {
      return {
        now: NOW,
        isDeactivated: false,
        isSuspended: false,
        grants,
        assignments: assignmentIds.map((id) => ({ id, userId: 'user_ana', kind: 'CASE', targetId: 'c', startAt: NOW, endAt: null })),
        ancestorIds: [],
        orgSelfApprovalAllowed: false,
        organizationTimezone: 'UTC',
      };
    }

    it('evaluates one context per ACTIVE membership plus the platform context', async () => {
      const baseLoaded = await m.principalLoader.load('user_ana');
      m.principalLoader.load.mockResolvedValueOnce({
        ...baseLoaded,
        memberships: [
          ...baseLoaded.memberships,
          { membershipId: 'mem_2', orgId: 'org_invited', orgUnitId: null, status: 'INVITED', startDate: NOW.toISOString(), endDate: null },
        ],
      } as never);
      const own = { ...input(row({ id: 'grant_own', scopeType: 'own', scopeOrgId: null, scopeOrgUnitId: null })), actions: ['content.read', 'conversation.participate'] };
      m.contextLoader.build.mockResolvedValueOnce(ctxWith([own], ['asg_1'])).mockResolvedValueOnce(ctxWith([]));

      const res = await svc.userAccess('user_ana');

      expect(m.contextLoader.build).toHaveBeenCalledTimes(2);
      const [orgPrincipal, orgResource] = m.contextLoader.build.mock.calls[0]! as [Principal, { orgId?: string }];
      expect(orgPrincipal.context).toEqual({ kind: 'organization', orgId: ORG });
      expect(orgResource.orgId).toBe(ORG);
      const [platformPrincipal, platformResource] = m.contextLoader.build.mock.calls[1]! as [Principal, { orgId?: string }];
      expect(platformPrincipal.context).toEqual({ kind: 'operations' });
      expect(platformResource.orgId).toBeUndefined();

      expect(res.userId).toBe('user_ana');
      expect(res.contexts.map((c) => c.orgId)).toEqual([ORG, null]);
      expect(res.contexts[0]!.actions).toContain('content.read');
      expect(res.contexts[0]!.actions).not.toContain('conversation.participate');
      expect(res.contexts[0]!.grantIds).toEqual(['grant_own']);
      expect(res.contexts[0]!.assignmentIds).toEqual(['asg_1']);
      expect(res.contexts[1]).toEqual({ orgId: null, actions: [], grantIds: [], assignmentIds: [] });
    });

    it('returns 404 for an unknown user', async () => {
      m.principalLoader.load.mockResolvedValueOnce(null as never);
      const err = await apiError(svc.userAccess('user_missing'));
      expect(err.getStatus()).toBe(404);
    });
  });
});
