/**
 * ParticipationService unit tests (spec EMP-02, 4.2): the acceptance window,
 * eligibility, the version check, the once-only submission and the receipt.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Principal } from '@nestself/contracts';
import type { CycleRow, ParticipationRow } from './listening.repository.js';
import { ParticipationService } from './participation.service.js';

const OPENS = new Date('2026-11-02T07:00:00.000Z');
const CLOSES = new Date('2026-11-09T07:00:00.000Z');
const NOW = new Date('2026-11-05T10:00:00.000Z');

const jovan = { userId: 'user_jovan', context: { kind: 'personal', orgId: 'org_sample' } } as Principal;

function cycle(overrides: Partial<CycleRow> = {}): CycleRow {
  return {
    id: 'cycle_1',
    orgId: 'org_sample',
    questionnaireVersionId: 'q1',
    policyVersionId: 'policy_1',
    opensAt: OPENS,
    closesAt: CLOSES,
    status: 'open',
    audienceSize: 3,
    launchedAt: OPENS,
    finalizedAt: null,
    canceledAt: null,
    failureReason: null,
    createdAt: OPENS,
    updatedAt: OPENS,
    ...overrides,
  };
}

function participation(overrides: Partial<ParticipationRow> = {}): ParticipationRow {
  return {
    id: 'part_jovan',
    orgId: 'org_sample',
    cycleId: 'cycle_1',
    membershipId: 'mem_jovan',
    userId: 'user_jovan',
    cohortUnitId: 'ou_engineering',
    state: 'invited',
    responseId: null,
    remindersSent: 0,
    lastReminderAt: null,
    submittedAt: null,
    createdAt: OPENS,
    updatedAt: OPENS,
    ...overrides,
  };
}

function setup(opts: { cycle?: CycleRow | null; participation?: ParticipationRow | null; membership?: unknown; serverNow?: Date; markSubmitted?: boolean } = {}) {
  const current = opts.cycle === undefined ? cycle() : opts.cycle;
  const part = opts.participation === undefined ? participation() : opts.participation;
  const tx = {
    execute: vi.fn().mockResolvedValue({ rows: [{ now: opts.serverNow ?? NOW }] }),
  };
  const repo = {
    findOpenCycle: vi.fn().mockResolvedValue(current),
    findCycle: vi.fn().mockResolvedValue(current),
    lockCycle: vi.fn().mockResolvedValue(current),
    findParticipation: vi.fn().mockResolvedValue(part),
    findQuestionnaire: vi.fn().mockResolvedValue({ id: 'q1', version: 1, dimensions: [{ key: 'speaking_up' }], notice: { en: 'n' } }),
    findDraft: vi.fn().mockResolvedValue(null),
    upsertDraft: vi.fn().mockResolvedValue(undefined),
    updateParticipation: vi.fn().mockResolvedValue(undefined),
    markSubmitted: vi.fn().mockResolvedValue(opts.markSubmitted === false ? null : participation({ state: 'submitted' })),
    insertResponse: vi.fn(async (values: unknown) => values),
    deleteDraft: vi.fn().mockResolvedValue(undefined),
  };
  const memberships = {
    findByIdAndOrg: vi.fn().mockResolvedValue(opts.membership === undefined ? { id: 'mem_jovan', status: 'ACTIVE', endDate: null } : opts.membership),
  };
  const organizations = { findById: vi.fn().mockResolvedValue({ id: 'org_sample', timezone: 'Europe/Belgrade' }) };
  const dbs = { withOrgScope: vi.fn(async (_orgId: string, fn: (t: unknown) => Promise<unknown>) => fn(tx)) };
  const service = new ParticipationService(dbs as never, repo as never, memberships as never, organizations as never);
  return { service, repo, tx };
}

const body = { answers: { speaking_up: 4, manager_support: 2 }, questionnaireVersionId: 'q1' };

describe('ParticipationService.current', () => {
  it('returns the open cycle, the questionnaire, the notice and the caller state', async () => {
    const { service } = setup();
    const res = await service.current(jovan, NOW);
    expect(res.cycle).toMatchObject({ id: 'cycle_1', timeZone: 'Europe/Belgrade', estimatedMinutes: 3 });
    if (res.cycle) {
      expect(res.participation).toEqual({ state: 'invited', draft: null, submittedAt: null });
      expect(res.questionnaire.version).toBe(1);
    }
  });

  it('answers no cycle without an open one, or when the caller joined after the launch', async () => {
    expect(await setup({ cycle: null }).service.current(jovan, NOW)).toEqual({ cycle: null });
    expect(await setup({ participation: null }).service.current(jovan, NOW)).toEqual({ cycle: null });
  });
});

describe('ParticipationService.submit', () => {
  it('accepts once under the share lock with the server instant and the launch cohort', async () => {
    const { service, repo } = setup();
    const receipt = await service.submit(jovan, 'cycle_1', body);
    expect(repo.lockCycle).toHaveBeenCalledWith('cycle_1', 'share', expect.anything());
    expect(repo.markSubmitted).toHaveBeenCalledWith('part_jovan', expect.any(String), NOW, expect.anything());
    expect(repo.insertResponse).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org_sample', cycleId: 'cycle_1', cohortUnitId: 'ou_engineering', answers: body.answers, acceptedAt: NOW }),
      expect.anything(),
    );
    const inserted = repo.insertResponse.mock.calls[0]![0] as Record<string, unknown>;
    expect(inserted).not.toHaveProperty('userId');
    expect(inserted).not.toHaveProperty('membershipId');
    expect(repo.deleteDraft).toHaveBeenCalled();
    expect(receipt).toEqual({ submittedAt: NOW.toISOString() });
  });

  it('refuses at or after the close, whatever the browser said', async () => {
    const atClose = setup({ serverNow: CLOSES });
    await expect(atClose.service.submit(jovan, 'cycle_1', body)).rejects.toMatchObject({ code: 'cycle_closed' });
    const closing = setup({ cycle: cycle({ status: 'closing' }) });
    await expect(closing.service.submit(jovan, 'cycle_1', body)).rejects.toMatchObject({ code: 'cycle_closed' });
    const early = setup({ serverNow: new Date('2026-11-02T06:59:59.000Z') });
    await expect(early.service.submit(jovan, 'cycle_1', body)).rejects.toMatchObject({ code: 'cycle_closed' });
  });

  it('refuses someone outside the audience or whose membership ended', async () => {
    await expect(setup({ participation: null }).service.submit(jovan, 'cycle_1', body)).rejects.toMatchObject({ code: 'not_eligible', status: 403 });
    await expect(
      setup({ membership: { id: 'mem_jovan', status: 'ENDED', endDate: new Date('2026-11-03T00:00:00.000Z') } }).service.submit(jovan, 'cycle_1', body),
    ).rejects.toMatchObject({ code: 'not_eligible' });
  });

  it('refuses a stale questionnaire version', async () => {
    const { service } = setup();
    await expect(service.submit(jovan, 'cycle_1', { ...body, questionnaireVersionId: 'q0' })).rejects.toMatchObject({ code: 'template_version_mismatch' });
  });

  it('answers already_submitted on a second submission, including a lost race', async () => {
    const submitted = setup({ participation: participation({ state: 'submitted' }) });
    await expect(submitted.service.submit(jovan, 'cycle_1', body)).rejects.toMatchObject({ code: 'already_submitted' });
    const raced = setup({ markSubmitted: false });
    await expect(raced.service.submit(jovan, 'cycle_1', body)).rejects.toMatchObject({ code: 'already_submitted' });
    expect(raced.repo.insertResponse).not.toHaveBeenCalled();
  });

  it('404s a cycle of another organization', async () => {
    const { service } = setup({ cycle: cycle({ orgId: 'org_other' }) });
    await expect(service.submit(jovan, 'cycle_1', body)).rejects.toMatchObject({ status: 404 });
  });
});

describe('ParticipationService.saveDraft', () => {
  it('saves while open and moves the state to draft', async () => {
    const { service, repo } = setup();
    const res = await service.saveDraft(jovan, 'cycle_1', { answers: { speaking_up: 3 } }, NOW);
    expect(repo.upsertDraft).toHaveBeenCalledWith('part_jovan', 'org_sample', { speaking_up: 3 }, expect.anything());
    expect(repo.updateParticipation).toHaveBeenCalledWith('part_jovan', { state: 'draft' }, expect.anything());
    expect(res.savedAt).toBe(NOW.toISOString());
  });

  it('refuses after submission and after the close', async () => {
    await expect(setup({ participation: participation({ state: 'submitted' }) }).service.saveDraft(jovan, 'cycle_1', { answers: {} }, NOW)).rejects.toMatchObject({ code: 'already_submitted' });
    await expect(setup().service.saveDraft(jovan, 'cycle_1', { answers: {} }, new Date('2026-11-10T00:00:00.000Z'))).rejects.toMatchObject({ code: 'cycle_closed' });
  });
});
