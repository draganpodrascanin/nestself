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
    findActiveOwnerGrants: vi.fn(async (_orgId: string, _now: Date, _tx?: unknown): Promise<GrantRow[]> => []),
    revokeGrants: vi.fn(async (ids: string[], _revoked: unknown, _tx?: unknown) => ids),
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
    invalidateDelegatees: vi.fn(async (_grantIds: string[]): Promise<string[]> => []),
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

  // ── single employer owner (owner model, 2026-10-24) ─────────────────

  describe('single employer owner per organization', () => {
    const OWNER_CREATE = {
      templateKey: 'employer_owner',
      subjectUserId: 'user_stefan',
      scopeType: 'organization' as const,
      includeDescendants: false,
      conditions: [],
    };
    const IVANA_OWNER = row({
      id: 'grant_owner_ivana',
      subjectUserId: 'user_ivana',
      templateKey: 'employer_owner',
      actions: ['access.grant', 'access.revoke', 'access.delegate'],
      scopeType: 'organization',
      scopeOrgUnitId: null,
      conditions: null,
    });

    it('create rejects a second active employer_owner with 409 owner_exists and the current owner', async () => {
      m.authzRepo.findActiveOwnerGrants.mockResolvedValueOnce([IVANA_OWNER]);
      const err = await apiError(svc.create(ORG, OWNER_CREATE, ACTOR));
      expect(err.getStatus()).toBe(409);
      expect(err.code).toBe('owner_exists');
      expect(err.details).toEqual({ currentOwnerUserId: 'user_ivana' });
      expect(m.authzRepo.findActiveOwnerGrants).toHaveBeenCalledWith(ORG, NOW, null);
      expect(m.authzRepo.createGrant).not.toHaveBeenCalled();
      expect(m.audit.record).not.toHaveBeenCalled();
    });

    it('create allows the first employer_owner of an organization', async () => {
      const res = await svc.create(ORG, OWNER_CREATE, ACTOR);
      expect(m.authzRepo.findActiveOwnerGrants).toHaveBeenCalledWith(ORG, NOW, null);
      expect(m.authzRepo.createGrant.mock.calls[0]![0]).toMatchObject({ templateKey: 'employer_owner', subjectUserId: 'user_stefan' });
      expect(res.id).toBe('grant_new');
    });

    it('create does not look up owners for other templates', async () => {
      await svc.create(ORG, CREATE, ACTOR);
      expect(m.authzRepo.findActiveOwnerGrants).not.toHaveBeenCalled();
    });

    it('update refuses to change the window of an owner grant while another owner is active', async () => {
      const expired = row({ ...IVANA_OWNER, id: 'grant_owner_old', subjectUserId: 'user_stefan', validUntil: new Date('2026-10-01T00:00:00.000Z') });
      m.grants.set(expired.id, expired);
      m.authzRepo.findActiveOwnerGrants.mockResolvedValueOnce([IVANA_OWNER]);
      const err = await apiError(svc.update(ORG, expired.id, { validUntil: '2027-01-01T00:00:00.000Z' }, ACTOR));
      expect(err.code).toBe('owner_exists');
      expect(m.authzRepo.updateGrant).not.toHaveBeenCalled();
    });

    it('update of an owner grant ignores the grant itself', async () => {
      m.grants.set(IVANA_OWNER.id, IVANA_OWNER);
      m.authzRepo.findActiveOwnerGrants.mockResolvedValueOnce([IVANA_OWNER]);
      await svc.update(ORG, IVANA_OWNER.id, { validUntil: '2027-01-01T00:00:00.000Z' }, ACTOR);
      expect(m.authzRepo.updateGrant).toHaveBeenCalled();
    });
  });

  // ── transferOwnership (owner model, 2026-10-24) ────────────────────

  describe('transferOwnership', () => {
    const IVANA_OWNER = row({
      id: 'grant_owner_ivana',
      subjectUserId: 'user_ivana',
      templateKey: 'employer_owner',
      actions: ['access.grant', 'access.revoke', 'access.delegate'],
      scopeType: 'organization',
      scopeOrgUnitId: null,
      conditions: null,
    });
    const BODY = { newOwnerUserId: 'user_stefan' };
    const STAFF = { userId: 'user_nikola', context: { kind: 'operations' } } as Principal;

    beforeEach(() => {
      m.grants.set(IVANA_OWNER.id, IVANA_OWNER);
      m.authzRepo.findActiveOwnerGrants.mockResolvedValue([IVANA_OWNER]);
    });

    it('rejects a caller who is not the current owner with 403 forbidden', async () => {
      const other = { userId: 'user_ana', context: { kind: 'organization', orgId: ORG } } as Principal;
      const err = await apiError(svc.transferOwnership(ORG, BODY, other));
      expect(err.getStatus()).toBe(403);
      expect(err.code).toBe('forbidden');
      expect(m.authzRepo.revokeGrants).not.toHaveBeenCalled();
      expect(m.authzRepo.createGrant).not.toHaveBeenCalled();
    });

    it('rejects with 403 when the organization has no owner (org route)', async () => {
      m.authzRepo.findActiveOwnerGrants.mockResolvedValue([]);
      const err = await apiError(svc.transferOwnership(ORG, BODY, ACTOR));
      expect(err.code).toBe('forbidden');
    });

    it("rejects with 403 when the caller's owner grant has not started yet", async () => {
      m.authzRepo.findActiveOwnerGrants.mockResolvedValue([row({ ...IVANA_OWNER, validFrom: new Date('2026-11-01T00:00:00.000Z') })]);
      const err = await apiError(svc.transferOwnership(ORG, BODY, ACTOR));
      expect(err.code).toBe('forbidden');
    });

    it('rejects a new owner without an ACTIVE membership with 409 subject_not_member', async () => {
      m.authzRepo.findActiveMembership.mockResolvedValueOnce(null as never);
      const err = await apiError(svc.transferOwnership(ORG, BODY, ACTOR));
      expect(err.getStatus()).toBe(409);
      expect(err.code).toBe('subject_not_member');
      expect(m.authzRepo.findActiveMembership).toHaveBeenCalledWith('user_stefan', ORG, null);
      expect(m.authzRepo.revokeGrants).not.toHaveBeenCalled();
    });

    it('rejects transferring to the current owner with 409 conflict', async () => {
      const err = await apiError(svc.transferOwnership(ORG, { newOwnerUserId: 'user_ivana' }, ACTOR));
      expect(err.getStatus()).toBe(409);
      expect(err.code).toBe('conflict');
    });

    it('revokes only the owner grant (children stay) and creates the new owner grant in one org-scoped transaction', async () => {
      const res = await svc.transferOwnership(ORG, BODY, ACTOR);
      expect(m.db.withOrgScope).toHaveBeenCalledTimes(1);
      expect(m.db.withOrgScope).toHaveBeenCalledWith(ORG, expect.any(Function));
      expect(m.authzRepo.revokeGrants).toHaveBeenCalledWith(
        ['grant_owner_ivana'],
        { at: NOW, byUserId: 'user_ivana', reason: 'ownership_transferred' },
        null,
      );
      expect(m.authzRepo.revokeGrantTree).not.toHaveBeenCalled();
      const values = m.authzRepo.createGrant.mock.calls[0]![0] as Record<string, unknown>;
      const owner = PERMISSION_TEMPLATES.find((t) => t.key === 'employer_owner')!;
      expect(values).toMatchObject({
        subjectUserId: 'user_stefan',
        templateKey: 'employer_owner',
        actions: [...owner.actions],
        scopeType: 'organization',
        scopeOrgId: ORG,
        scopeOrgUnitId: null,
        includeDescendants: false,
        conditions: [],
        validFrom: NOW,
        validUntil: null,
        parentGrantId: null,
        grantedByUserId: 'user_ivana',
      });
      expect(res.revokedGrantId).toBe('grant_owner_ivana');
      expect(res.createdGrant.id).toBe('grant_new');
    });

    it('audits grant.revoked (ownership_transferred) and grant.created with transfer = true', async () => {
      await svc.transferOwnership(ORG, BODY, ACTOR);
      expect(m.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'grant.revoked',
          actorUserId: 'user_ivana',
          orgId: ORG,
          recordId: 'grant_owner_ivana',
          details: expect.objectContaining({
            subjectUserId: 'user_ivana',
            templateKey: 'employer_owner',
            reason: 'ownership_transferred',
            transfer: true,
            newOwnerUserId: 'user_stefan',
          }),
        }),
      );
      expect(m.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'grant.created',
          actorUserId: 'user_ivana',
          orgId: ORG,
          recordId: 'grant_new',
          details: expect.objectContaining({
            subjectUserId: 'user_stefan',
            templateKey: 'employer_owner',
            transfer: true,
            previousOwnerUserId: 'user_ivana',
          }),
        }),
      );
      for (const [event] of m.audit.record.mock.calls as unknown as [{ details: Record<string, unknown> }][]) {
        expect(event.details).not.toHaveProperty('byStaff');
      }
    });

    it('invalidates both subjects and the delegatees of the old owner grant', async () => {
      await svc.transferOwnership(ORG, BODY, ACTOR);
      expect(m.principalLoader.invalidateUser).toHaveBeenCalledWith('user_ivana', [ORG]);
      expect(m.principalLoader.invalidateUser).toHaveBeenCalledWith('user_stefan', [ORG]);
      expect(m.principalLoader.invalidateDelegatees).toHaveBeenCalledWith(['grant_owner_ivana']);
    });

    it('does not create the new grant when the revoke step fails (one transaction)', async () => {
      m.authzRepo.revokeGrants.mockRejectedValueOnce(new Error('db down'));
      await expect(svc.transferOwnership(ORG, BODY, ACTOR)).rejects.toThrow('db down');
      expect(m.authzRepo.createGrant).not.toHaveBeenCalled();
      expect(m.principalLoader.invalidateUser).not.toHaveBeenCalled();
    });

    describe('by staff', () => {
      it('needs no owner grant and audits byStaff = true', async () => {
        const res = await svc.transferOwnership(ORG, BODY, STAFF, { byStaff: true });
        expect(m.authzRepo.revokeGrants).toHaveBeenCalledWith(
          ['grant_owner_ivana'],
          { at: NOW, byUserId: 'user_nikola', reason: 'ownership_transferred' },
          null,
        );
        expect(m.authzRepo.createGrant.mock.calls[0]![0]).toMatchObject({ subjectUserId: 'user_stefan', grantedByUserId: 'user_nikola' });
        expect(res.revokedGrantId).toBe('grant_owner_ivana');
        const events = (m.audit.record.mock.calls as unknown as [{ action: string; details: Record<string, unknown> }][]).map((c) => c[0]);
        expect(events.map((e) => e.action)).toEqual(['grant.revoked', 'grant.created']);
        for (const e of events) expect(e.details).toMatchObject({ transfer: true, byStaff: true });
      });

      it('creates the first owner when the organization has none', async () => {
        m.authzRepo.findActiveOwnerGrants.mockResolvedValue([]);
        const res = await svc.transferOwnership(ORG, BODY, STAFF, { byStaff: true });
        expect(m.authzRepo.revokeGrants).not.toHaveBeenCalled();
        expect(res.revokedGrantId).toBeNull();
        const events = (m.audit.record.mock.calls as unknown as [{ action: string; details: Record<string, unknown> }][]).map((c) => c[0]);
        expect(events.map((e) => e.action)).toEqual(['grant.created']);
        expect(events[0]!.details).toMatchObject({ transfer: true, byStaff: true, previousOwnerUserId: null });
        expect(m.principalLoader.invalidateUser).toHaveBeenCalledWith('user_stefan', [ORG]);
        expect(m.principalLoader.invalidateUser).toHaveBeenCalledTimes(1);
      });

      it('still requires the new owner to be an ACTIVE member', async () => {
        m.authzRepo.findActiveMembership.mockResolvedValueOnce(null as never);
        const err = await apiError(svc.transferOwnership(ORG, BODY, STAFF, { byStaff: true }));
        expect(err.code).toBe('subject_not_member');
      });
    });

    it('audit details carry no credential-like keys', async () => {
      await svc.transferOwnership(ORG, BODY, STAFF, { byStaff: true });
      for (const [event] of m.audit.record.mock.calls as unknown as [{ details: Record<string, unknown> }][]) {
        for (const key of Object.keys(event.details)) {
          expect(key).not.toMatch(/password|code|tokens?|secret/i);
        }
      }
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

    it('invalidates the delegatees below the adjusted grant (their cached ancestor copy)', async () => {
      await svc.update(ORG, 'grant_1', { validUntil: '2027-01-01T00:00:00.000Z' }, ACTOR);
      expect(m.principalLoader.invalidateDelegatees).toHaveBeenCalledWith(['grant_1']);
    });

    describe('active delegated children (AUTHZ-R-37)', () => {
      const ceiling = (amountMinor: number) => [{ type: 'spending_ceiling' as const, amountMinor, currency: 'EUR' }];
      beforeEach(() => {
        m.authzRepo.findActiveChildGrants.mockImplementation(async (parentIds: string[]) =>
          parentIds.includes('grant_1')
            ? [row({ id: 'grant_child', subjectUserId: 'user_stefan', parentGrantId: 'grant_1', templateKey: null, actions: ['budget.read'], conditions: ceiling(800) })]
            : [],
        );
      });

      it('refuses a ceiling below a child ceiling: 409 conflict naming the child, nothing written or audited', async () => {
        const err = await apiError(svc.update(ORG, 'grant_1', { conditions: ceiling(500) }, ACTOR));
        expect(err.getStatus()).toBe(409);
        expect(err.code).toBe('conflict');
        expect(err.details).toEqual({ children: ['grant_child'] });
        expect(m.authzRepo.updateGrant).not.toHaveBeenCalled();
        expect(m.audit.record).not.toHaveBeenCalled();
        expect(m.principalLoader.invalidateUser).not.toHaveBeenCalled();
      });

      it('accepts a tighter ceiling that still contains the children and invalidates them', async () => {
        const res = await svc.update(ORG, 'grant_1', { conditions: ceiling(900) }, ACTOR);
        expect(res.conditions).toEqual(ceiling(900));
        expect(m.authzRepo.updateGrant).toHaveBeenCalledOnce();
        expect(m.principalLoader.invalidateDelegatees).toHaveBeenCalledWith(['grant_1']);
      });
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
      expect(m.principalLoader.invalidateDelegatees).toHaveBeenCalledWith(['grant_1']);
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

  describe('revokePlatform', () => {
    const OPS_ACTOR = { userId: 'user_nikola', context: { kind: 'operations' } } as Principal;
    const PLATFORM_GRANT = row({
      id: 'grant_platform',
      subjectUserId: 'user_ana',
      templateKey: 'support_operator',
      actions: ['support.case.read'],
      scopeType: 'assigned_cases',
      scopeOrgId: null,
      scopeOrgUnitId: null,
      conditions: null,
    });

    beforeEach(() => {
      m.grants.set(PLATFORM_GRANT.id, PLATFORM_GRANT);
      m.grants.set('grant_1', row());
      m.authzRepo.revokeGrantTree.mockImplementation(async (ids: string[]) => {
        m.grants.set(PLATFORM_GRANT.id, { ...PLATFORM_GRANT, revokedAt: NOW, revokedReason: 'left the team' });
        return { roots: ids, children: ['grant_child'] };
      });
    });

    it('revokes the tree in one system transaction and audits the root and each descendant', async () => {
      const res = await svc.revokePlatform('grant_platform', { reason: 'left the team' }, OPS_ACTOR);

      expect(m.db.withTransaction).toHaveBeenCalledTimes(1);
      expect(m.db.withOrgScope).not.toHaveBeenCalled();
      expect(m.authzRepo.revokeGrantTree).toHaveBeenCalledWith(
        ['grant_platform'],
        { at: NOW, byUserId: 'user_nikola', reason: 'left the team' },
        SYSTEM_TX,
      );
      const events = m.audit.record.mock.calls.map((c) => (c as unknown as [Record<string, unknown>])[0]);
      expect(events).toEqual([
        expect.objectContaining({
          action: 'grant.revoked',
          orgId: null,
          recordId: 'grant_platform',
          details: expect.objectContaining({ reason: 'left the team', templateKey: 'support_operator', revokedDescendants: 1 }),
        }),
        expect.objectContaining({
          action: 'grant.delegation_revoked',
          orgId: null,
          recordId: 'grant_child',
          details: { reason: 'parent_revoked', rootGrantId: 'grant_platform' },
        }),
      ]);
      expect(res.revokedAt).not.toBeNull();
    });

    it("invalidates the subject for the platform, member and client organizations, then the delegatees", async () => {
      await svc.revokePlatform('grant_platform', { reason: 'left the team' }, OPS_ACTOR);
      expect(m.principalLoader.invalidateUser).toHaveBeenCalledWith('user_ana', ['platform', ORG, 'org_client']);
      expect(m.principalLoader.invalidateDelegatees).toHaveBeenCalledWith(['grant_platform']);
    });

    it('returns 404 for an organization-scoped or unknown grant without writing', async () => {
      expect((await apiError(svc.revokePlatform('grant_1', { reason: 'x' }, OPS_ACTOR))).getStatus()).toBe(404);
      expect((await apiError(svc.revokePlatform('nope', { reason: 'x' }, OPS_ACTOR))).getStatus()).toBe(404);
      expect(m.authzRepo.revokeGrantTree).not.toHaveBeenCalled();
      expect(m.audit.record).not.toHaveBeenCalled();
    });

    it('returns 409 conflict for an already revoked platform grant', async () => {
      m.grants.set(PLATFORM_GRANT.id, { ...PLATFORM_GRANT, revokedAt: NOW });
      const err = await apiError(svc.revokePlatform('grant_platform', { reason: 'again' }, OPS_ACTOR));
      expect(err.getStatus()).toBe(409);
      expect(err.code).toBe('conflict');
      expect(m.authzRepo.revokeGrantTree).not.toHaveBeenCalled();
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
