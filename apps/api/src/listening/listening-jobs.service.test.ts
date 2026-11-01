/**
 * ListeningJobsService unit tests (spec EMP-03, SUR-04): the local delivery
 * window, the per-cycle limit, one reminder per local day and the tick's
 * delegation.
 */
import { describe, expect, it, vi } from 'vitest';
import { ListeningJobsService, localDateKey, localHour, withinReminderWindow } from './listening-jobs.service.js';
import type { CycleRow } from './listening.repository.js';

const cycle: CycleRow = {
  id: 'cycle_1',
  orgId: 'org_sample',
  questionnaireVersionId: 'q1',
  policyVersionId: 'policy_1',
  opensAt: new Date('2026-11-02T07:00:00.000Z'),
  closesAt: new Date('2026-11-09T07:00:00.000Z'),
  status: 'open',
  audienceSize: 3,
  launchedAt: new Date('2026-11-02T07:00:00.000Z'),
  finalizedAt: null,
  canceledAt: null,
  failureReason: null,
  createdAt: new Date('2026-11-02T07:00:00.000Z'),
  updatedAt: new Date('2026-11-02T07:00:00.000Z'),
};

const candidate = (id: string, remindersSent = 0, lastReminderAt: Date | null = null) => ({
  id,
  orgId: 'org_sample',
  cycleId: 'cycle_1',
  membershipId: `mem_${id}`,
  userId: `user_${id}`,
  cohortUnitId: null,
  state: 'invited' as const,
  responseId: null,
  remindersSent,
  lastReminderAt,
  submittedAt: null,
  createdAt: cycle.opensAt,
  updatedAt: cycle.opensAt,
  email: `${id}@example.com`,
  locale: 'sr-Latn',
});

function setup(candidates: ReturnType<typeof candidate>[], finalizer: { finalize: ReturnType<typeof vi.fn> } | null = null) {
  const tx = {};
  const repo = {
    findOpenCycles: vi.fn().mockResolvedValue([cycle]),
    findPolicyVersion: vi.fn().mockResolvedValue({ id: 'policy_1', reminderLimit: 2 }),
    findReminderCandidates: vi.fn().mockResolvedValue(candidates),
    updateParticipation: vi.fn().mockResolvedValue(undefined),
    findCyclesDueToFinalize: vi.fn().mockResolvedValue([{ ...cycle, status: 'open' }]),
  };
  const cycles = { scheduleRecurring: vi.fn().mockResolvedValue(1), launchDue: vi.fn().mockResolvedValue(['cycle_x']) };
  const notifier = { reminder: vi.fn().mockResolvedValue(true) };
  const organizations = { findById: vi.fn().mockResolvedValue({ id: 'org_sample', name: 'Example', timezone: 'Europe/Belgrade' }) };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const dbs = { withOrgScope: vi.fn(async (_orgId: string, fn: (t: unknown) => Promise<unknown>) => fn(tx)) };
  const service = new ListeningJobsService(dbs as never, repo as never, cycles as never, notifier as never, organizations as never, audit as never, finalizer as never);
  return { service, repo, cycles, notifier, audit };
}

describe('local time helpers', () => {
  it('reads the hour and the day in the organization zone', () => {
    // 08:30 UTC is 09:30 in Belgrade (CET, November).
    expect(localHour(new Date('2026-11-05T08:30:00.000Z'), 'Europe/Belgrade')).toBe(9);
    expect(withinReminderWindow(new Date('2026-11-05T07:59:00.000Z'), 'Europe/Belgrade')).toBe(false);
    expect(withinReminderWindow(new Date('2026-11-05T08:00:00.000Z'), 'Europe/Belgrade')).toBe(true);
    expect(withinReminderWindow(new Date('2026-11-05T17:00:00.000Z'), 'Europe/Belgrade')).toBe(false);
    expect(localDateKey(new Date('2026-11-05T23:30:00.000Z'), 'Europe/Belgrade')).toBe('2026-11-06');
  });
});

describe('ListeningJobsService.remind', () => {
  const inWindow = new Date('2026-11-05T10:00:00.000Z');

  it('sends to still-eligible non-submitters and records the reminder before mailing', async () => {
    const { service, repo, notifier, audit } = setup([candidate('a'), candidate('b', 1)]);
    const report = await service.remind(inWindow);
    expect(report.sent).toBe(2);
    expect(repo.updateParticipation).toHaveBeenCalledWith('a', { remindersSent: 1, lastReminderAt: inWindow }, expect.anything());
    expect(repo.updateParticipation).toHaveBeenCalledWith('b', { remindersSent: 2, lastReminderAt: inWindow }, expect.anything());
    expect(notifier.reminder).toHaveBeenCalledTimes(2);
    expect(repo.findReminderCandidates).toHaveBeenCalledWith('cycle_1', 2, expect.anything());
    expect(audit.record.mock.calls[0]![0]).toMatchObject({ action: 'listening.reminders.sent', actorKind: 'JOB', details: { cycleId: 'cycle_1', sent: 2 } });
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain('user_a');
  });

  it('skips a participant already reminded today and sends nothing outside the local window', async () => {
    const today = setup([candidate('a', 1, new Date('2026-11-05T08:05:00.000Z'))]);
    expect((await today.service.remind(inWindow)).sent).toBe(0);
    expect(today.notifier.reminder).not.toHaveBeenCalled();

    const night = setup([candidate('a')]);
    const report = await night.service.remind(new Date('2026-11-05T21:00:00.000Z'));
    expect(report.sent).toBe(0);
    expect(report.skippedOutsideWindow).toBe(1);
    expect(night.repo.findReminderCandidates).not.toHaveBeenCalled();
  });

  it('ignores a cycle whose close has passed', async () => {
    const { service, repo } = setup([candidate('a')]);
    const report = await service.remind(new Date('2026-11-09T10:00:00.000Z'));
    expect(report.cyclesChecked).toBe(0);
    expect(repo.findReminderCandidates).not.toHaveBeenCalled();
  });
});

describe('ListeningJobsService.purge', () => {
  it('deletes stale drafts and participation links older than a year after publication', async () => {
    const { service, repo } = setup([]);
    (repo as unknown as { deleteStaleDrafts: unknown }).deleteStaleDrafts = vi.fn().mockResolvedValue(4);
    (repo as unknown as { deleteExpiredParticipations: unknown }).deleteExpiredParticipations = vi.fn().mockResolvedValue(30);
    const report = await service.run('listening.purge', new Date('2026-11-05T03:20:00.000Z'));
    expect(report).toEqual({ job: 'listening.purge', draftsDeleted: 4, participationsDeleted: 30 });
    expect((repo as unknown as { deleteExpiredParticipations: ReturnType<typeof vi.fn> }).deleteExpiredParticipations).toHaveBeenCalledWith(new Date('2025-11-05T03:20:00.000Z'));
  });
});

describe('ListeningJobsService.tick', () => {
  it('schedules, launches and finalizes through the finalizer when one is bound', async () => {
    const finalizer = { finalize: vi.fn().mockResolvedValue('published') };
    const { service } = setup([], finalizer);
    const report = await service.tick(new Date('2026-11-09T07:05:00.000Z'));
    expect(report).toEqual({ job: 'listening.tick', scheduled: 1, launched: ['cycle_x'], finalized: ['cycle_1'], failed: [] });
    expect(finalizer.finalize).toHaveBeenCalledWith('cycle_1', expect.any(Date));
  });

  it('leaves finalization alone without a finalizer', async () => {
    const { service, repo } = setup([]);
    const report = await service.tick(new Date('2026-11-09T07:05:00.000Z'));
    expect(report.finalized).toEqual([]);
    expect(repo.findCyclesDueToFinalize).not.toHaveBeenCalled();
  });
});
