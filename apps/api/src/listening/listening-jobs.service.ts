/**
 * ListeningJobsService: what the `nestself-listening` jobs do (spec 4.2,
 * EMP-03, SUR-04, section 12). The scheduler's worker hands every job here;
 * tests call the methods with a fixed clock. Jobs run in system context under
 * their own service authority; nothing here depends on a user grant.
 *
 * - `listening.tick` (every 5 minutes): creates the next recurring cycle of
 *   every client whose launch is due, launches scheduled cycles whose start
 *   has passed, and finalizes open cycles whose close has passed (the
 *   finalizer arrives with the reporting task; until then closing is left to
 *   it).
 * - `listening.remind` (hourly): at most `reminderLimit` reminders per
 *   participant per cycle, only to still-eligible non-submitters, only
 *   between 09:00 and 18:00 in the organization's time zone, and at most one
 *   per local day, so a retry within the hour sends nothing twice.
 * - `listening.purge` (nightly): deletes the private drafts of cycles that are
 *   no longer open and the participation links of cycles published longer
 *   ago than the `survey_participation_links` retention (one year); both are
 *   idempotent and touch no answer or snapshot (spec PRI-05).
 */
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { AuditWriter } from '../audit/audit-writer.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { DbService } from '../db/db.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { OrganizationsRepository } from '../db/repositories/organizations.repository.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { CyclesService } from './cycles.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ListeningNotifier } from './listening-notifier.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ListeningRepository } from './listening.repository.js';

export const LISTENING_JOB_NAMES = ['listening.tick', 'listening.remind', 'listening.purge'] as const;
export type ListeningJobName = (typeof LISTENING_JOB_NAMES)[number];

export function isListeningJobName(value: string): value is ListeningJobName {
  return (LISTENING_JOB_NAMES as readonly string[]).includes(value);
}

/** Reminders go out between these local hours (inclusive start, exclusive end). */
export const REMINDER_WINDOW = { fromHour: 9, toHour: 18 } as const;

export interface TickReport {
  job: 'listening.tick';
  scheduled: number;
  launched: string[];
  finalized: string[];
  failed: string[];
}

export interface RemindReport {
  job: 'listening.remind';
  cyclesChecked: number;
  sent: number;
  skippedOutsideWindow: number;
}

export interface PurgeReport {
  job: 'listening.purge';
  draftsDeleted: number;
  participationsDeleted: number;
}

export type ListeningJobReport = TickReport | RemindReport | PurgeReport;

/** Participation links are kept one year after publication (`survey_participation_links`). */
export const PARTICIPATION_RETENTION_DAYS = 365;

/** Finalizes one cycle; provided by the reporting task's `FinalizationService`. */
export interface CycleFinalizer {
  finalize(cycleId: string, now?: Date): Promise<'published' | 'skipped' | 'failed'>;
}

export const CYCLE_FINALIZER = Symbol('CYCLE_FINALIZER');

/** The hour of day (0-23) of `at` in `timeZone`. */
export function localHour(at: Date, timeZone: string): number {
  const text = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone }).format(at);
  return Number.parseInt(text, 10);
}

/** `YYYY-MM-DD` of `at` in `timeZone`. */
export function localDateKey(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone }).format(at);
}

export function withinReminderWindow(at: Date, timeZone: string): boolean {
  const hour = localHour(at, timeZone);
  return hour >= REMINDER_WINDOW.fromHour && hour < REMINDER_WINDOW.toHour;
}

@Injectable()
export class ListeningJobsService {
  private readonly logger = new Logger(ListeningJobsService.name);

  constructor(
    private readonly dbs: DbService,
    private readonly repo: ListeningRepository,
    private readonly cycles: CyclesService,
    private readonly notifier: ListeningNotifier,
    private readonly organizations: OrganizationsRepository,
    private readonly audit: AuditWriter,
    @Optional() @Inject(CYCLE_FINALIZER) private readonly finalizer: CycleFinalizer | null = null,
  ) {}

  async run(name: ListeningJobName, now = new Date()): Promise<ListeningJobReport> {
    switch (name) {
      case 'listening.tick':
        return this.tick(now);
      case 'listening.remind':
        return this.remind(now);
      case 'listening.purge':
        return this.purge(now);
    }
  }

  async purge(now = new Date()): Promise<PurgeReport> {
    const draftsDeleted = await this.repo.deleteStaleDrafts();
    const before = new Date(now.getTime() - PARTICIPATION_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const participationsDeleted = await this.repo.deleteExpiredParticipations(before);
    this.logger.log(`listening purge: ${draftsDeleted} drafts, ${participationsDeleted} participation links`);
    return { job: 'listening.purge', draftsDeleted, participationsDeleted };
  }

  async tick(now = new Date()): Promise<TickReport> {
    const scheduled = await this.cycles.scheduleRecurring(now);
    const launched = await this.cycles.launchDue(now);
    const finalized: string[] = [];
    const failed: string[] = [];
    if (this.finalizer) {
      for (const cycle of await this.repo.findCyclesDueToFinalize(now)) {
        const outcome = await this.finalizer.finalize(cycle.id, now);
        if (outcome === 'published') finalized.push(cycle.id);
        if (outcome === 'failed') failed.push(cycle.id);
      }
    }
    this.logger.log(`listening tick: ${scheduled} scheduled, ${launched.length} launched, ${finalized.length} finalized, ${failed.length} failed`);
    return { job: 'listening.tick', scheduled, launched, finalized, failed };
  }

  async remind(now = new Date()): Promise<RemindReport> {
    const report: RemindReport = { job: 'listening.remind', cyclesChecked: 0, sent: 0, skippedOutsideWindow: 0 };
    for (const cycle of await this.repo.findOpenCycles()) {
      if (cycle.closesAt.getTime() <= now.getTime()) continue;
      report.cyclesChecked += 1;
      const [org, policy] = await Promise.all([this.organizations.findById(cycle.orgId), this.repo.findPolicyVersion(cycle.policyVersionId)]);
      const timeZone = org?.timezone ?? 'Europe/Belgrade';
      if (!withinReminderWindow(now, timeZone)) {
        report.skippedOutsideWindow += 1;
        continue;
      }
      const limit = policy?.reminderLimit ?? 2;
      const today = localDateKey(now, timeZone);
      // The rows are marked inside the transaction and the mails go out once it
      // committed (email after commit): a rolled-back run sends nothing, a retried
      // run finds the rows marked, and a crash between commit and send loses one
      // reminder, never doubles it.
      const due = await this.dbs.withOrgScope(cycle.orgId, async (tx) => {
        const marked: Awaited<ReturnType<ListeningRepository['findReminderCandidates']>> = [];
        for (const candidate of await this.repo.findReminderCandidates(cycle.id, limit, tx)) {
          if (candidate.lastReminderAt && localDateKey(candidate.lastReminderAt, timeZone) === today) continue;
          await this.repo.updateParticipation(candidate.id, { remindersSent: candidate.remindersSent + 1, lastReminderAt: now }, tx);
          marked.push(candidate);
        }
        return marked;
      });
      let sent = 0;
      for (const candidate of due) {
        if (await this.notifier.reminder(cycle, candidate, org?.name ?? 'your organization', timeZone)) sent += 1;
      }
      if (sent > 0) {
        await this.audit.record({
          action: 'listening.reminders.sent',
          actorUserId: null,
          actorKind: 'JOB',
          orgId: cycle.orgId,
          recordType: 'survey_cycle',
          recordId: cycle.id,
          result: 'ALLOWED',
          details: { cycleId: cycle.id, sent },
        });
      }
      report.sent += sent;
    }
    return report;
  }
}
