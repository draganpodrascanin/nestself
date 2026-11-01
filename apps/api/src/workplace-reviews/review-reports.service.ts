/**
 * ReviewReportsService: the reviewer's human report (spec REV-07) and
 * internal notes. Sections are rich-text documents validated like CMS
 * bodies (`validateContentDocument`); one working version at a time; sharing
 * freezes it, a later save opens the next version. The employer reads only
 * the latest shared version; notes never leave the reviewer.
 */
import { Injectable } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ConfigService } from '@nestjs/config';
import { validateContentDocument } from '@nestself/content/schema';
import {
  ACTIONS,
  ACTIVE_REVIEW_ENGAGEMENT_STATUSES,
  REPORT_SECTION_KEYS,
  type Principal,
  type ReviewNoteRequest,
  type ReviewNotesResponse,
  type ReviewReportDraftRequest,
  type ReviewReportView,
} from '@nestself/contracts';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { AuditWriter } from '../audit/audit-writer.js';
import { ApiHttpException } from '../common/api-error.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { DbService } from '../db/db.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ReviewEngagementsService } from './review-engagements.service.js';
import { conflict, notFound } from './review-errors.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ReviewNotifier } from './review-notifier.js';
import { toReportView } from './review-views.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { WorkplaceReviewsRepository, type ReportVersionRow } from './workplace-reviews.repository.js';

@Injectable()
export class ReviewReportsService {
  private readonly linkHostAllowlist: string[];

  constructor(
    private readonly dbs: DbService,
    private readonly repo: WorkplaceReviewsRepository,
    private readonly engagements: ReviewEngagementsService,
    private readonly audit: AuditWriter,
    private readonly notifier: ReviewNotifier,
    config: ConfigService,
  ) {
    this.linkHostAllowlist = (config.get<string>('CONTENT_LINK_HOST_ALLOWLIST') ?? '')
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean);
  }

  /** Every section as a valid content document; the first failing section names itself in `details.section`. */
  validateSections(sections: ReviewReportDraftRequest['sections']): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const key of REPORT_SECTION_KEYS) {
      const outcome = validateContentDocument(sections[key], { linkHostAllowlist: this.linkHostAllowlist });
      if (!outcome.ok) {
        throw new ApiHttpException({
          status: 400,
          code: 'validation',
          message: outcome.errors.map((e) => e.message).join('; '),
          details: { section: key, errors: outcome.errors },
        });
      }
      result[key] = outcome.document;
    }
    return result;
  }

  /** The reviewer's current version (the latest of any status), or 404. */
  async current(principal: Principal, engagementId: string): Promise<ReviewReportView> {
    const engagement = await this.engagements.forReviewer(principal, engagementId);
    return this.dbs.withOrgScope(engagement.orgId, async (tx) => {
      const versions = await this.repo.listReportVersions(engagementId, tx);
      const latest = versions.at(-1);
      if (!latest) throw notFound();
      return toReportView(latest, await this.repo.displayNames([latest.authorUserId], tx));
    });
  }

  async saveDraft(principal: Principal, engagementId: string, body: ReviewReportDraftRequest): Promise<ReviewReportView> {
    const engagement = await this.engagements.forReviewer(principal, engagementId, ACTIONS['workplace_reviews.report.write']);
    if (!ACTIVE_REVIEW_ENGAGEMENT_STATUSES.includes(engagement.status)) throw conflict('invalid_state', 'The engagement is closed');
    const sections = this.validateSections(body.sections);
    const saved = await this.dbs.withOrgScope(engagement.orgId, async (tx) => {
      const versions = await this.repo.listReportVersions(engagementId, tx);
      const latest = versions.at(-1);
      let row: ReportVersionRow;
      if (latest && (latest.status === 'draft' || latest.status === 'in_review')) {
        row = await this.repo.updateReportVersion(latest.id, { sections, evidenceSnapshotIds: [...body.evidenceSnapshotIds], status: 'draft', authorUserId: principal.userId }, tx);
      } else {
        row = await this.repo.insertReportVersion(
          { orgId: engagement.orgId, engagementId, version: (latest?.version ?? 0) + 1, status: 'draft', sections, evidenceSnapshotIds: [...body.evidenceSnapshotIds], authorUserId: principal.userId },
          tx,
        );
      }
      await this.engagements.markInProgress(engagement, tx);
      await this.audit.record(
        {
          action: 'workplace_review.report_saved',
          actorUserId: principal.userId,
          actorKind: 'USER',
          orgId: engagement.orgId,
          recordType: 'review_report_version',
          recordId: row.id,
          result: 'ALLOWED',
          details: { engagementId, version: row.version, status: row.status, evidenceSnapshotIds: body.evidenceSnapshotIds },
        },
        { tx },
      );
      return row;
    });
    return toReportView(saved, await this.repo.displayNames([saved.authorUserId]));
  }

  async submitReview(principal: Principal, engagementId: string): Promise<ReviewReportView> {
    const engagement = await this.engagements.forReviewer(principal, engagementId, ACTIONS['workplace_reviews.report.write']);
    const row = await this.dbs.withOrgScope(engagement.orgId, async (tx) => {
      const latest = (await this.repo.listReportVersions(engagementId, tx)).at(-1);
      if (!latest || latest.status !== 'draft') throw conflict('invalid_state', 'Only a draft can be submitted for review');
      const next = await this.repo.updateReportVersion(latest.id, { status: 'in_review' }, tx);
      await this.audit.record(
        {
          action: 'workplace_review.report_saved',
          actorUserId: principal.userId,
          actorKind: 'USER',
          orgId: engagement.orgId,
          recordType: 'review_report_version',
          recordId: next.id,
          result: 'ALLOWED',
          details: { engagementId, version: next.version, status: next.status },
        },
        { tx },
      );
      return next;
    });
    return toReportView(row, await this.repo.displayNames([row.authorUserId]));
  }

  /** Releases the working version (spec REV-07): it freezes, the previous shared one is superseded, the requester is told. */
  async share(principal: Principal, engagementId: string, now = new Date()): Promise<ReviewReportView> {
    const engagement = await this.engagements.forReviewer(principal, engagementId, ACTIONS['workplace_reviews.report.publish']);
    if (!ACTIVE_REVIEW_ENGAGEMENT_STATUSES.includes(engagement.status)) throw conflict('invalid_state', 'The engagement is closed');
    const row = await this.dbs.withOrgScope(engagement.orgId, async (tx) => {
      const versions = await this.repo.listReportVersions(engagementId, tx);
      const latest = versions.at(-1);
      if (!latest || (latest.status !== 'draft' && latest.status !== 'in_review')) throw conflict('invalid_state', 'There is no version to share');
      for (const earlier of versions) {
        if (earlier.status === 'shared') await this.repo.updateReportVersion(earlier.id, { status: 'superseded' }, tx);
      }
      const shared = await this.repo.updateReportVersion(latest.id, { status: 'shared', sharedAt: now, sharedByUserId: principal.userId }, tx);
      if (engagement.status !== 'follow_up') await this.repo.updateEngagement(engagementId, { status: 'report_shared' }, tx);
      await this.audit.record(
        {
          action: 'workplace_review.report_shared',
          actorUserId: principal.userId,
          actorKind: 'USER',
          orgId: engagement.orgId,
          recordType: 'review_report_version',
          recordId: shared.id,
          result: 'ALLOWED',
          details: { engagementId, version: shared.version },
        },
        { tx },
      );
      return shared;
    });
    const request = await this.repo.findRequest(engagement.requestId);
    if (request) await this.notifier.reportShared(engagement.orgId, engagementId, request.requesterUserId);
    return toReportView(row, await this.repo.displayNames([row.authorUserId]));
  }

  /** The employer's read: the latest shared version, audited as content access; nothing before a human shared it. */
  async sharedReport(orgId: string, engagementId: string, principal: Principal): Promise<ReviewReportView> {
    const engagement = await this.engagements.inOrg(orgId, engagementId);
    const view = await this.dbs.withOrgScope(orgId, async (tx) => {
      const shared = [...(await this.repo.listReportVersions(engagementId, tx))].reverse().find((v) => v.status === 'shared');
      if (!shared) throw new ApiHttpException({ status: 404, code: 'report_not_shared', message: 'No report has been shared with this engagement yet' });
      return toReportView(shared, await this.repo.displayNames([shared.authorUserId], tx));
    });
    await this.audit.record({
      action: 'workplace_review.report_read',
      actorUserId: principal.userId,
      actorKind: 'USER',
      orgId: engagement.orgId,
      recordType: 'review_report_version',
      recordId: view.id,
      result: 'ALLOWED',
      details: { engagementId, version: view.version },
    });
    return view;
  }

  // ── Internal notes (reviewer only) ──────────────────────────────────────

  async notes(principal: Principal, engagementId: string): Promise<ReviewNotesResponse> {
    const engagement = await this.engagements.forReviewer(principal, engagementId);
    const rows = await this.dbs.withOrgScope(engagement.orgId, (tx) => this.repo.listNotes(engagementId, principal.userId, tx));
    return { items: rows.map((n) => ({ id: n.id, body: n.body, createdAt: n.createdAt.toISOString() })) };
  }

  async addNote(principal: Principal, engagementId: string, body: ReviewNoteRequest): Promise<ReviewNotesResponse> {
    const engagement = await this.engagements.forReviewer(principal, engagementId, ACTIONS['workplace_reviews.report.write']);
    await this.dbs.withOrgScope(engagement.orgId, async (tx) => {
      const note = await this.repo.insertNote({ orgId: engagement.orgId, engagementId, authorUserId: principal.userId, body: body.body }, tx);
      await this.audit.record(
        {
          action: 'workplace_review.note_added',
          actorUserId: principal.userId,
          actorKind: 'USER',
          orgId: engagement.orgId,
          recordType: 'review_engagement_note',
          recordId: note.id,
          result: 'ALLOWED',
          details: { engagementId },
        },
        { tx },
      );
    });
    return this.notes(principal, engagementId);
  }
}
