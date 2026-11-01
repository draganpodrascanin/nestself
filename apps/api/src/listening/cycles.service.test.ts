/**
 * CyclesService unit tests (spec SUR-02, SUR-03): the launch window, the
 * refusals, the immediate launch of a cycle that starts now, and the audience
 * snapshot's cohorts.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Principal } from '@nestself/contracts';
import { ApiHttpException } from '../common/api-error.js';
import { CyclesService, addDays } from './cycles.service.js';
import type { ConfigurationRow, CycleRow, QuestionnaireRow } from './listening.repository.js';

const NOW = new Date('2026-11-02T08:00:00.000Z');
const actor = { userId: 'user_ivana' } as Principal;

const config: ConfigurationRow = {
  id: 'cfg',
  orgId: 'org_sample',
  measurementFrom: new Date('2026-01-01T00:00:00.000Z'),
  measurementUntil: null,
  feedbackFrom: null,
  feedbackUntil: null,
  workplaceReviewsFrom: null,
  workplaceReviewsUntil: null,
  feedbackSensitiveEnabled: false,
  cadenceDays: 14,
  responseWindowDays: 7,
  reminderLimit: 2,
  freshnessDays: 45,
  minimumCohort: 10,
  goodThresholdTenths: 750,
  monitorThresholdTenths: 600,
  algorithmVersion: 1,
  questionnaireVersionId: 'q1',
  nextLaunchAt: null,
  policyVersion: 1,
  updatedByUserId: null,
  createdAt: NOW,
  updatedAt: NOW,
};

const questionnaire = { id: 'q1', version: 1, status: 'published' } as QuestionnaireRow;

function cycle(overrides: Partial<CycleRow> = {}): CycleRow {
  return {
    id: 'cycle_1',
    orgId: 'org_sample',
    questionnaireVersionId: 'q1',
    policyVersionId: 'policy_1',
    opensAt: NOW,
    closesAt: addDays(NOW, 7),
    status: 'scheduled',
    audienceSize: null,
    launchedAt: null,
    finalizedAt: null,
    canceledAt: null,
    failureReason: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function setup(opts: { config?: ConfigurationRow; questionnaire?: QuestionnaireRow | null; overlapping?: CycleRow[]; existing?: CycleRow | null } = {}) {
  const tx = { tag: 'tx' };
  const stored: CycleRow = opts.existing ?? cycle();
  const repo = {
    findQuestionnaire: vi.fn().mockResolvedValue(opts.questionnaire === undefined ? questionnaire : opts.questionnaire),
    findQuestionnaires: vi.fn().mockResolvedValue([questionnaire]),
    findOverlappingCycles: vi.fn().mockResolvedValue(opts.overlapping ?? []),
    insertCycle: vi.fn(async (values: Partial<CycleRow>) => cycle({ ...values, id: 'cycle_new' })),
    findCycle: vi.fn().mockResolvedValue(stored),
    lockCycle: vi.fn().mockResolvedValue(stored),
    updateCycle: vi.fn(async (_id: string, patch: Partial<CycleRow>) => cycle({ ...stored, ...patch })),
    findAudience: vi.fn().mockResolvedValue([
      { membershipId: 'mem_jovan', userId: 'user_jovan', orgUnitId: 'team_product' },
      { membershipId: 'mem_ana', userId: 'user_ana', orgUnitId: 'team_sales' },
      { membershipId: 'mem_ivana', userId: 'user_ivana', orgUnitId: null },
    ]),
    findUnits: vi.fn().mockResolvedValue([
      { id: 'ou_root', parentId: null, kind: 'COMPANY', name: 'Root' },
      { id: 'ou_engineering', parentId: 'ou_root', kind: 'DEPARTMENT', name: 'Engineering' },
      { id: 'ou_commercial', parentId: 'ou_root', kind: 'DEPARTMENT', name: 'Commercial' },
      { id: 'team_product', parentId: 'ou_engineering', kind: 'TEAM', name: 'Product' },
      { id: 'team_sales', parentId: 'ou_commercial', kind: 'TEAM', name: 'Sales' },
    ]),
    insertParticipations: vi.fn().mockResolvedValue(undefined),
    listCycles: vi.fn().mockResolvedValue([stored]),
    listSnapshots: vi.fn().mockResolvedValue([]),
    countActiveMembers: vi.fn().mockResolvedValue(3),
    findCyclesDueToLaunch: vi.fn().mockResolvedValue([]),
    findConfigurationsWithLaunchDue: vi.fn().mockResolvedValue([]),
    findConfiguration: vi.fn().mockResolvedValue(opts.config ?? config),
    updateConfiguration: vi.fn().mockResolvedValue(undefined),
  };
  const configuration = {
    ensure: vi.fn().mockResolvedValue(opts.config ?? config),
    currentPolicy: vi.fn().mockResolvedValue({ id: 'policy_1', policyVersion: 1 }),
  };
  const dbs = { withOrgScope: vi.fn(async (_orgId: string, fn: (t: unknown) => Promise<unknown>) => fn(tx)) };
  const organizations = { findById: vi.fn().mockResolvedValue({ id: 'org_sample', name: 'Example d.o.o.', timezone: 'Europe/Belgrade' }) };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const notifier = { invitations: vi.fn().mockResolvedValue(3) };
  const service = new CyclesService(dbs as never, repo as never, configuration as never, organizations as never, audit as never, notifier as never);
  return { service, repo, audit, notifier, tx };
}

describe('CyclesService.schedule', () => {
  it('computes the close from the response window and locks the policy version', async () => {
    const { service, repo } = setup();
    const opensAt = new Date('2026-11-10T07:00:00.000Z');
    const created = await service.schedule('org_sample', { opensAt: opensAt.toISOString() }, actor, NOW);
    expect(repo.insertCycle).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org_sample', opensAt, closesAt: new Date('2026-11-17T07:00:00.000Z'), policyVersionId: 'policy_1', status: 'scheduled' }),
      expect.anything(),
    );
    expect(created.status).toBe('scheduled');
    expect(repo.findAudience).not.toHaveBeenCalled();
  });

  it('refuses when measurement is disabled at the start', async () => {
    const { service } = setup({ config: { ...config, measurementUntil: new Date('2026-06-01T00:00:00.000Z') } });
    await expect(service.schedule('org_sample', { opensAt: NOW.toISOString() }, actor, NOW)).rejects.toMatchObject({ code: 'measurement_disabled' });
  });

  it('refuses without a published questionnaire', async () => {
    const draft = setup({ questionnaire: { ...questionnaire, status: 'draft' } });
    await expect(draft.service.schedule('org_sample', { opensAt: NOW.toISOString() }, actor, NOW)).rejects.toMatchObject({ code: 'no_published_questionnaire' });
    const none = setup({ config: { ...config, questionnaireVersionId: null }, questionnaire: null });
    await expect(none.service.schedule('org_sample', { opensAt: NOW.toISOString() }, actor, NOW)).rejects.toMatchObject({ code: 'no_published_questionnaire' });
  });

  it('refuses an overlapping window', async () => {
    const { service, repo } = setup({ overlapping: [cycle({ status: 'open' })] });
    const err = await service.schedule('org_sample', { opensAt: NOW.toISOString() }, actor, NOW).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiHttpException);
    expect((err as ApiHttpException).code).toBe('cycle_overlap');
    expect(repo.insertCycle).not.toHaveBeenCalled();
  });

  it('launches at once when the start is now, snapshotting the audience with primary departments', async () => {
    const { service, repo, notifier, audit } = setup();
    repo.findCycle.mockResolvedValue(cycle({ id: 'cycle_new' }));
    repo.lockCycle.mockResolvedValue(cycle({ id: 'cycle_new' }));
    await service.schedule('org_sample', { opensAt: NOW.toISOString() }, actor, NOW);
    expect(repo.insertParticipations).toHaveBeenCalledWith(
      [
        expect.objectContaining({ userId: 'user_jovan', cohortUnitId: 'ou_engineering', state: 'invited' }),
        expect.objectContaining({ userId: 'user_ana', cohortUnitId: 'ou_commercial' }),
        expect.objectContaining({ userId: 'user_ivana', cohortUnitId: null }),
      ],
      expect.anything(),
    );
    expect(repo.updateCycle).toHaveBeenCalledWith('cycle_new', expect.objectContaining({ status: 'open', audienceSize: 3 }), expect.anything());
    expect(notifier.invitations).toHaveBeenCalledTimes(1);
    const actions = audit.record.mock.calls.map((c) => (c[0] as { action: string }).action);
    expect(actions).toEqual(['listening.cycle.scheduled', 'listening.cycle.launched']);
    // No participant is named in any audit row.
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain('user_jovan');
  });
});

describe('CyclesService.launch and cancel', () => {
  it('skips a cycle that is no longer scheduled (a second launch job)', async () => {
    const { service, repo } = setup({ existing: cycle({ status: 'open' }) });
    expect(await service.launch('cycle_1', NOW)).toBe('skipped');
    expect(repo.insertParticipations).not.toHaveBeenCalled();
  });

  it('cancels a scheduled or open cycle but never a published one', async () => {
    const open = setup({ existing: cycle({ status: 'open' }) });
    expect((await open.service.cancel('org_sample', 'cycle_1', actor, NOW)).status).toBe('canceled');
    const published = setup({ existing: cycle({ status: 'published' }) });
    await expect(published.service.cancel('org_sample', 'cycle_1', actor, NOW)).rejects.toMatchObject({ code: 'conflict' });
  });

  it('404s a cycle of another organization', async () => {
    const { service } = setup({ existing: cycle({ orgId: 'org_other' }) });
    await expect(service.cancel('org_sample', 'cycle_1', actor, NOW)).rejects.toMatchObject({ status: 404 });
  });
});

describe('CyclesService.scheduleRecurring', () => {
  it('creates the due cycle and advances the next launch by the cadence', async () => {
    const { service, repo } = setup({ config: { ...config, nextLaunchAt: new Date('2026-11-01T07:00:00.000Z') } });
    repo.findConfigurationsWithLaunchDue.mockResolvedValue([{ ...config, nextLaunchAt: new Date('2026-11-01T07:00:00.000Z') }]);
    expect(await service.scheduleRecurring(NOW)).toBe(1);
    expect(repo.insertCycle).toHaveBeenCalledWith(
      expect.objectContaining({ opensAt: new Date('2026-11-01T07:00:00.000Z'), closesAt: new Date('2026-11-08T07:00:00.000Z') }),
      expect.anything(),
    );
    expect(repo.updateConfiguration).toHaveBeenCalledWith('org_sample', { nextLaunchAt: new Date('2026-11-15T07:00:00.000Z') }, expect.anything());
  });

  it('skips a client whose questionnaire is not published and keeps its date', async () => {
    const { service, repo } = setup({ config: { ...config, nextLaunchAt: NOW }, questionnaire: { ...questionnaire, status: 'archived' } });
    repo.findConfigurationsWithLaunchDue.mockResolvedValue([{ ...config, nextLaunchAt: NOW }]);
    expect(await service.scheduleRecurring(NOW)).toBe(0);
    expect(repo.updateConfiguration).not.toHaveBeenCalled();
  });
});
