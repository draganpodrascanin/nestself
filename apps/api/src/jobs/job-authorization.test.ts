import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JobAuthorization, validateJobPayload, type AuthorizedJobPayload } from './job-authorization.js';

const LOADED = {
  userId: 'user-1',
  displayName: 'Ana Petrović',
  initials: 'AP',
  locale: 'sr-Latn',
  memberships: [
    {
      membershipId: 'm-1',
      orgId: 'org-1',
      orgUnitId: null,
      status: 'ACTIVE' as const,
      startDate: '2025-01-01T00:00:00.000Z',
      endDate: null,
    },
  ],
  staffTemplates: [],
  expert: null,
  isSuspended: false,
  isDeactivated: false,
  populationHints: { hasStaffGrants: false, hasExpertGrants: false, hasActiveMembership: true },
};

/** A grant that allows `report.export` in org-1 (organization scope). */
const EXPORT_GRANT = {
  id: 'g-1',
  subjectUserId: 'user-1',
  templateKey: 'reporting_user',
  actions: ['report.export'],
  scopeType: 'organization',
  scopeOrgId: 'org-1',
  scopeOrgUnitId: null,
  includeDescendants: false,
  scopeRefKind: null,
  scopeRefId: null,
  conditions: [],
  validFrom: new Date('2025-01-01'),
  validUntil: null,
  delegationEnvelope: null,
  parentGrantId: null,
  revokedAt: null,
};

function createMocks(grants: unknown[] = [EXPORT_GRANT]) {
  return {
    principalLoader: { load: vi.fn().mockResolvedValue(LOADED) },
    contextLoader: {
      build: vi.fn().mockResolvedValue({
        now: new Date('2026-10-22T10:00:00Z'),
        isDeactivated: false,
        isSuspended: false,
        grants,
        assignments: [],
        ancestorIds: [],
        orgSelfApprovalAllowed: false,
        organizationTimezone: 'Europe/Belgrade',
      }),
    },
    audit: { record: vi.fn().mockResolvedValue(undefined) },
  };
}

function payload(overrides: Partial<AuthorizedJobPayload<{ reportId: string }>> = {}) {
  return {
    principalId: 'user-1',
    context: { kind: 'organization' as const, orgId: 'org-1' },
    action: 'report.export' as const,
    resource: { type: 'report', id: 'r-1', orgId: 'org-1' },
    data: { reportId: 'r-1' },
    ...overrides,
  } satisfies AuthorizedJobPayload<{ reportId: string }>;
}

describe('validateJobPayload', () => {
  it('accepts a well-formed payload', () => {
    expect(validateJobPayload(payload())).toBeNull();
  });

  it('rejects a payload carrying tokens (AUTHZ-R-54)', () => {
    expect(
      validateJobPayload(payload({ data: { reportId: 'r', accessToken: 'x' } as never })),
    ).toMatch(/accessToken/);
  });

  it('rejects an action outside the catalogue', () => {
    expect(validateJobPayload({ ...payload(), action: 'nope.nothing' })).toMatch(/catalogue/);
  });

  it('rejects a missing principal', () => {
    expect(validateJobPayload({ ...payload(), principalId: '' })).toMatch(/principalId/);
  });
});

describe('JobAuthorization', () => {
  let mocks: ReturnType<typeof createMocks>;
  let jobs: JobAuthorization;
  const handler = vi.fn().mockResolvedValue({ rows: 3 });

  beforeEach(() => {
    handler.mockClear();
    mocks = createMocks();
    jobs = new JobAuthorization(
      mocks.principalLoader as never,
      mocks.contextLoader as never,
      mocks.audit as never,
    );
  });

  it('runs an authorized job and audits it with actorKind JOB', async () => {
    const outcome = await jobs.run({ id: '1', name: 'export', data: payload() }, handler);

    expect(outcome).toEqual({ status: 'completed', result: { rows: 3 } });
    expect(handler).toHaveBeenCalledOnce();
    const [principal, data] = handler.mock.calls[0]!;
    expect(principal.userId).toBe('user-1');
    expect(principal.context).toEqual({ kind: 'organization', orgId: 'org-1' });
    expect(data).toEqual({ reportId: 'r-1' });
    expect(mocks.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ actorKind: 'JOB', result: 'ALLOWED', actorUserId: 'user-1' }),
    );
  });

  it('skips (not fails) when the grant was revoked since enqueue', async () => {
    mocks = createMocks([]);
    jobs = new JobAuthorization(
      mocks.principalLoader as never,
      mocks.contextLoader as never,
      mocks.audit as never,
    );

    const outcome = await jobs.run({ id: '2', name: 'export', data: payload() }, handler);

    expect(outcome.status).toBe('skipped');
    expect(outcome).toMatchObject({ reason: 'denied' });
    expect(handler).not.toHaveBeenCalled();
    expect(mocks.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'access.denied', actorKind: 'JOB', result: 'DENIED' }),
    );
  });

  it('skips when the principal is suspended (current state, not enqueue state)', async () => {
    mocks.principalLoader.load.mockResolvedValue({ ...LOADED, isSuspended: true });

    const outcome = await jobs.run({ id: '3', name: 'export', data: payload() }, handler);

    expect(outcome).toMatchObject({ status: 'skipped', reason: 'principal_inactive' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('skips when the principal no longer exists', async () => {
    mocks.principalLoader.load.mockResolvedValue(null);
    const outcome = await jobs.run({ id: '4', name: 'export', data: payload() }, handler);
    expect(outcome).toMatchObject({ status: 'skipped', reason: 'principal_not_found' });
  });

  it('skips when the enqueue-time context is no longer valid (membership ended)', async () => {
    mocks.principalLoader.load.mockResolvedValue({ ...LOADED, memberships: [] });
    const outcome = await jobs.run({ id: '5', name: 'export', data: payload() }, handler);
    expect(outcome).toMatchObject({ status: 'skipped', reason: 'context_invalid' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('skips an invalid payload without touching the database', async () => {
    const outcome = await jobs.run(
      { id: '6', name: 'export', data: { ...payload(), principalId: '' } },
      handler,
    );
    expect(outcome).toMatchObject({ status: 'skipped', reason: 'invalid_payload' });
    expect(mocks.principalLoader.load).not.toHaveBeenCalled();
  });

  it('wrap() produces a processor returning the outcome', async () => {
    const processor = jobs.wrap(handler);
    const outcome = await processor({ id: '7', name: 'export', data: payload() });
    expect(outcome.status).toBe('completed');
  });

  it('propagates handler errors so BullMQ can retry genuine failures', async () => {
    handler.mockRejectedValueOnce(new Error('S3 unavailable'));
    await expect(jobs.run({ id: '8', name: 'export', data: payload() }, handler)).rejects.toThrow(
      'S3 unavailable',
    );
  });
});
