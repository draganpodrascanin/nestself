import { describe, expect, it, vi } from 'vitest';
import type { Principal } from '@nestself/contracts';
import { ImprovementActionsService } from './improvement-actions.service.js';
import { ReviewEngagementsService } from './review-engagements.service.js';
import { ReviewReportsService } from './review-reports.service.js';
import { ReviewRequestsService } from './review-requests.service.js';
import { ReviewScopesService } from './review-scopes.service.js';
import { ReviewSharingService } from './review-sharing.service.js';
import { toQueueItem, workingDaysAfter } from './review-views.js';
import type { ActionRow, EngagementRow, ReportVersionRow, RequestRow, ScopeRow, SharingGrantRow } from './workplace-reviews.repository.js';

const NOW = new Date('2026-11-03T10:00:00.000Z');
const ORG = 'org_sample';
const IVANA: Principal = { userId: 'user_ivana', context: { kind: 'organization', orgId: ORG }, staffTemplates: [] } as unknown as Principal;
const MILICA: Principal = { userId: 'user_milica', context: { kind: 'expert' }, staffTemplates: [] } as unknown as Principal;
const NIKOLA: Principal = { userId: 'user_nikola', context: { kind: 'operations' }, staffTemplates: [] } as unknown as Principal;

const REQUEST: RequestRow = {
  id: 'req_1',
  orgId: ORG,
  requesterUserId: 'user_ivana',
  snapshotIds: ['snap_1'],
  scopeCohortKey: 'company',
  dimensionKeys: ['sustainable_workload'],
  serviceId: null,
  context: null,
  shareAggregates: true,
  termsVersion: '2026-11',
  noticeVersion: '2026-11',
  status: 'scoped',
  coordinatorUserId: 'user_nikola',
  declineReason: null,
  informationRequest: null,
  informationAnswer: null,
  engagementId: null,
  createdAt: new Date('2026-10-30T10:00:00.000Z'),
  updatedAt: NOW,
};

const SCOPE: ScopeRow = {
  id: 'scope_1',
  orgId: ORG,
  requestId: 'req_1',
  version: 1,
  serviceId: 'svc_1',
  title: 'Workplace review',
  deliverables: 'Report',
  participants: 'HR lead',
  priceMinor: 120000,
  currency: 'EUR',
  taxNote: null,
  termsVersion: '2026-11',
  validUntil: new Date('2026-11-10T10:00:00.000Z'),
  cancellationPolicy: '48 hours',
  status: 'sent',
  sentAt: NOW,
  acceptedAt: null,
  acceptedByUserId: null,
  rejectedAt: null,
  createdByUserId: 'user_nikola',
  createdAt: NOW,
  updatedAt: NOW,
};

const ENGAGEMENT: EngagementRow = {
  id: 'eng_1',
  orgId: ORG,
  requestId: 'req_1',
  scopeId: 'scope_1',
  reviewerUserId: 'user_milica',
  coordinatorUserId: 'user_nikola',
  status: 'accepted',
  appointmentId: null,
  proposedWindows: [{ startsAt: '2026-11-12T09:00:00.000Z', endsAt: '2026-11-12T10:30:00.000Z' }],
  proposedTimeZone: 'Europe/Belgrade',
  participantUserId: null,
  followUpTargetDate: null,
  followUpOwnerUserId: null,
  followUpAppointmentId: null,
  completedAt: null,
  canceledAt: null,
  cancelReason: null,
  createdAt: NOW,
  updatedAt: NOW,
};

const tx = { tag: 'tx' };
const dbs = () => ({
  withOrgScope: vi.fn().mockImplementation(async (_org: string, fn: (t: unknown) => Promise<unknown>) => fn(tx)),
  withTransaction: vi.fn().mockImplementation(async (fn: (t: unknown) => Promise<unknown>) => fn(tx)),
});
const audit = () => ({ record: vi.fn().mockResolvedValue(undefined) });
const notifier = () => ({
  requestUpdate: vi.fn().mockResolvedValue(true),
  scopeSent: vi.fn().mockResolvedValue(true),
  booked: vi.fn().mockResolvedValue(2),
  reportShared: vi.fn().mockResolvedValue(true),
});

describe('ReviewRequestsService.create', () => {
  it('answers active_request_exists with the active request id', async () => {
    const repo = { findActiveRequest: vi.fn().mockResolvedValue({ ...REQUEST, status: 'in_review' }), insertRequest: vi.fn() };
    const configuration = { isEnabled: vi.fn().mockResolvedValue(true) };
    const service = new ReviewRequestsService(dbs() as never, repo as never, {} as never, configuration as never, {} as never, audit() as never, notifier() as never);
    await expect(
      service.create(ORG, { snapshotIds: ['snap_1'], scopeCohortKey: 'company', dimensionKeys: ['sustainable_workload'], shareAggregates: true, termsVersion: '2026-11', noticeVersion: '2026-11' }, IVANA, NOW),
    ).rejects.toMatchObject({ code: 'active_request_exists', details: { requestId: 'req_1' } });
    expect(repo.insertRequest).not.toHaveBeenCalled();
  });

  it('refuses when workplace reviews are not enabled and when a snapshot is foreign', async () => {
    const configuration = { isEnabled: vi.fn().mockResolvedValue(false) };
    const service = new ReviewRequestsService(dbs() as never, {} as never, {} as never, configuration as never, {} as never, audit() as never, notifier() as never);
    const body = { snapshotIds: ['snap_x'], scopeCohortKey: 'company', dimensionKeys: ['speaking_up' as const], shareAggregates: false, termsVersion: '2026-11', noticeVersion: '2026-11' };
    await expect(service.create(ORG, body, IVANA, NOW)).rejects.toMatchObject({ code: 'workplace_reviews_disabled' });

    const repo = { findActiveRequest: vi.fn().mockResolvedValue(null), insertRequest: vi.fn() };
    const listening = { findSnapshot: vi.fn().mockResolvedValue({ id: 'snap_x', orgId: 'org_other' }) };
    const enabled = { isEnabled: vi.fn().mockResolvedValue(true) };
    const second = new ReviewRequestsService(dbs() as never, repo as never, listening as never, enabled as never, {} as never, audit() as never, notifier() as never);
    await expect(second.create(ORG, body, IVANA, NOW)).rejects.toMatchObject({ code: 'snapshot_not_found' });
  });
});

describe('ReviewScopesService.accept', () => {
  function make(scope: ScopeRow, existing: EngagementRow | null = null) {
    const repo = {
      lockScope: vi.fn().mockResolvedValue(scope),
      lockRequest: vi.fn().mockResolvedValue(REQUEST),
      findEngagementByRequest: vi.fn().mockResolvedValue(existing),
      updateScope: vi.fn().mockResolvedValue(scope),
      insertEngagement: vi.fn().mockResolvedValue(ENGAGEMENT),
      updateRequest: vi.fn().mockResolvedValue(REQUEST),
    };
    const engagements = { response: vi.fn().mockImplementation(async (row: EngagementRow) => ({ id: row.id })) };
    const service = new ReviewScopesService(dbs() as never, repo as never, {} as never, engagements as never, audit() as never, notifier() as never);
    return { service, repo };
  }

  it('answers quote_expired for a scope past its validity and marks it expired', async () => {
    const { service, repo } = make({ ...SCOPE, validUntil: new Date('2026-11-01T00:00:00.000Z') });
    await expect(service.accept(ORG, 'scope_1', IVANA, NOW)).rejects.toMatchObject({ code: 'quote_expired' });
    expect(repo.updateScope).toHaveBeenCalledWith('scope_1', { status: 'expired' }, tx);
    expect(repo.insertEngagement).not.toHaveBeenCalled();
  });

  it('accepts a sent scope once: the engagement is created, the request converts, a replay returns the same engagement', async () => {
    const { service, repo } = make(SCOPE);
    const first = await service.accept(ORG, 'scope_1', IVANA, NOW);
    expect(first).toEqual({ id: 'eng_1' });
    expect(repo.updateScope).toHaveBeenCalledWith('scope_1', expect.objectContaining({ status: 'accepted', acceptedByUserId: 'user_ivana' }), tx);
    expect(repo.updateRequest).toHaveBeenCalledWith('req_1', { status: 'converted', engagementId: 'eng_1' }, tx);

    const replay = make({ ...SCOPE, status: 'accepted' }, ENGAGEMENT);
    expect(await replay.service.accept(ORG, 'scope_1', IVANA, NOW)).toEqual({ id: 'eng_1' });
    expect(replay.repo.insertEngagement).not.toHaveBeenCalled();
  });

  it('refuses a draft scope', async () => {
    const { service } = make({ ...SCOPE, status: 'draft' });
    await expect(service.accept(ORG, 'scope_1', IVANA, NOW)).rejects.toMatchObject({ code: 'scope_not_sent' });
  });
});

describe('ReviewEngagementsService', () => {
  function make(overrides: Partial<EngagementRow> = {}, options: { busy?: boolean; credential?: boolean } = {}) {
    const row = { ...ENGAGEMENT, ...overrides };
    const repo = {
      findEngagement: vi.fn().mockResolvedValue(row),
      lockEngagement: vi.fn().mockResolvedValue(row),
      lockReviewerCalendar: vi.fn().mockResolvedValue(undefined),
      reviewerBusy: vi.fn().mockResolvedValue(options.busy ?? false),
      updateEngagement: vi.fn().mockImplementation(async (_id: string, patch: Partial<EngagementRow>) => ({ ...row, ...patch })),
      hasReviewerCredential: vi.fn().mockResolvedValue(options.credential ?? true),
      findRequest: vi.fn().mockResolvedValue(REQUEST),
      findScope: vi.fn().mockResolvedValue(SCOPE),
      listSharingGrants: vi.fn().mockResolvedValue([]),
      listReportVersions: vi.fn().mockResolvedValue([]),
      listActions: vi.fn().mockResolvedValue([]),
      displayNames: vi.fn().mockResolvedValue(new Map([['user_milica', 'Milica Radović']])),
      endReviewerAssignments: vi.fn().mockResolvedValue(undefined),
      insertReviewerAssignment: vi.fn().mockResolvedValue(undefined),
    };
    const appointments = {
      create: vi.fn().mockImplementation(async (values: Record<string, unknown>) => ({ ...values, status: 'confirmed' })),
      assignExpert: vi.fn().mockResolvedValue(undefined),
      findById: vi.fn().mockResolvedValue(null),
      transitionStatus: vi.fn(),
    };
    const callsJobs = { scheduleReminders: vi.fn().mockResolvedValue(1), cancelAppointmentJobs: vi.fn().mockResolvedValue(undefined) };
    const principals = { load: vi.fn().mockResolvedValue(null), invalidateUser: vi.fn().mockResolvedValue(undefined) };
    const organizations = { findById: vi.fn().mockResolvedValue({ timezone: 'Europe/Belgrade' }) };
    const n = notifier();
    const service = new ReviewEngagementsService(
      dbs() as never,
      repo as never,
      appointments as never,
      { run: vi.fn() } as never,
      callsJobs as never,
      { require: vi.fn(), allows: vi.fn().mockResolvedValue(true) } as never,
      { findActiveAssignments: vi.fn().mockResolvedValue([]) } as never,
      principals as never,
      { build: vi.fn() } as never,
      organizations as never,
      audit() as never,
      n as never,
      { findActiveByUserAndOrg: vi.fn().mockResolvedValue({ id: 'membership_1' }) } as never
    );
    return { service, repo, appointments, callsJobs, notifier: n };
  }

  it('books the chosen window under the reviewer lock, creates the workplace_review appointment and tells both participants', async () => {
    const { service, repo, appointments, callsJobs, notifier: n } = make();
    const res = await service.book(ORG, 'eng_1', { windowIndex: 0 }, IVANA, NOW);
    expect(repo.lockReviewerCalendar).toHaveBeenCalledWith('user_milica', tx);
    expect(appointments.create).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: ORG, expertUserId: 'user_milica', employeeUserId: 'user_ivana', serviceCategory: 'workplace_review', status: 'confirmed', timeZone: 'Europe/Belgrade' }),
      tx,
    );
    expect(repo.updateEngagement).toHaveBeenCalledWith('eng_1', expect.objectContaining({ status: 'scheduled', participantUserId: 'user_ivana', proposedWindows: null }), tx);
    expect(callsJobs.scheduleReminders).toHaveBeenCalledTimes(1);
    expect(n.booked).toHaveBeenCalledTimes(1);
    expect(res.status).toBe('scheduled');
    expect(res.reviewerFirstName).toBe('Milica');
    expect(JSON.stringify(res)).not.toContain('user_milica');
  });

  it('answers slot_unavailable when the reviewer is busy and invalid_state once scheduled', async () => {
    const busy = make({}, { busy: true });
    await expect(busy.service.book(ORG, 'eng_1', { windowIndex: 0 }, IVANA, NOW)).rejects.toMatchObject({ code: 'slot_unavailable' });
    expect(busy.appointments.create).not.toHaveBeenCalled();
    const scheduled = make({ status: 'scheduled' });
    await expect(scheduled.service.book(ORG, 'eng_1', { windowIndex: 0 }, IVANA, NOW)).rejects.toMatchObject({ code: 'invalid_state' });
    const noWindow = make();
    await expect(noWindow.service.book(ORG, 'eng_1', { windowIndex: 2 }, IVANA, NOW)).rejects.toMatchObject({ code: 'no_windows' });
  });

  it('refuses to assign an expert without the workplace review credential', async () => {
    const { service, repo } = make({ reviewerUserId: null }, { credential: false });
    await expect(service.assign('eng_1', { reviewerUserId: 'user_legal' }, NIKOLA, NOW)).rejects.toMatchObject({ code: 'reviewer_not_qualified' });
    expect(repo.insertReviewerAssignment).not.toHaveBeenCalled();
  });
});

describe('ReviewSharingService.pack', () => {
  it('answers sharing_revoked without an active grant and skips revoked or expired ones', async () => {
    const revoked: SharingGrantRow = { id: 'g1', orgId: ORG, engagementId: 'eng_1', snapshotIds: ['snap_1'], cohortKeys: ['company'], grantedByUserId: 'user_ivana', validUntil: null, revokedAt: NOW, revokedByUserId: 'user_ivana', createdAt: NOW };
    const expired: SharingGrantRow = { ...revoked, id: 'g2', revokedAt: null, revokedByUserId: null, validUntil: new Date('2026-11-01T00:00:00.000Z') };
    const repo = { listSharingGrants: vi.fn().mockResolvedValue([revoked, expired]) };
    const engagements = { forReviewer: vi.fn().mockResolvedValue(ENGAGEMENT) };
    const service = new ReviewSharingService(dbs() as never, repo as never, {} as never, {} as never, engagements as never, audit() as never);
    await expect(service.pack(MILICA, 'eng_1', NOW)).rejects.toMatchObject({ code: 'sharing_revoked' });
  });
});

describe('ReviewReportsService', () => {
  const PARAGRAPH = { type: 'doc', schemaVersion: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Context.' }] }] };
  const SECTIONS = { context: PARAGRAPH, evidence: PARAGRAPH, findings: PARAGRAPH, uncertainties: PARAGRAPH, proposals: PARAGRAPH };

  function make(versions: ReportVersionRow[]) {
    const repo = {
      listReportVersions: vi.fn().mockResolvedValue(versions),
      updateReportVersion: vi.fn().mockImplementation(async (id: string, patch: Partial<ReportVersionRow>) => ({ ...versions.find((v) => v.id === id)!, ...patch })),
      insertReportVersion: vi.fn().mockImplementation(async (values: Partial<ReportVersionRow>) => ({ ...values, id: 'rep_new', createdAt: NOW, updatedAt: NOW, sharedAt: null, sharedByUserId: null })),
      updateEngagement: vi.fn().mockResolvedValue(ENGAGEMENT),
      findRequest: vi.fn().mockResolvedValue(REQUEST),
      displayNames: vi.fn().mockResolvedValue(new Map()),
    };
    const engagements = { forReviewer: vi.fn().mockResolvedValue({ ...ENGAGEMENT, status: 'scheduled' }), markInProgress: vi.fn().mockResolvedValue(ENGAGEMENT), inOrg: vi.fn() };
    const service = new ReviewReportsService(dbs() as never, repo as never, engagements as never, audit() as never, notifier() as never, { get: () => undefined } as never);
    return { service, repo };
  }

  const shared: ReportVersionRow = {
    id: 'rep_1',
    orgId: ORG,
    engagementId: 'eng_1',
    version: 1,
    status: 'shared',
    sections: SECTIONS,
    evidenceSnapshotIds: ['snap_1'],
    authorUserId: 'user_milica',
    sharedAt: NOW,
    sharedByUserId: 'user_milica',
    createdAt: NOW,
    updatedAt: NOW,
  };

  it('a save after sharing opens version 2 as a draft and leaves the shared version untouched', async () => {
    const { service, repo } = make([shared]);
    const view = await service.saveDraft(MILICA, 'eng_1', { sections: SECTIONS, evidenceSnapshotIds: [] });
    expect(view).toMatchObject({ version: 2, status: 'draft' });
    expect(repo.updateReportVersion).not.toHaveBeenCalled();
    expect(repo.insertReportVersion).toHaveBeenCalledWith(expect.objectContaining({ version: 2, status: 'draft' }), tx);
  });

  it('a save on a draft updates it in place and an invalid section names itself', async () => {
    const draft: ReportVersionRow = { ...shared, id: 'rep_2', version: 2, status: 'draft', sharedAt: null, sharedByUserId: null };
    const { service, repo } = make([shared, draft]);
    await service.saveDraft(MILICA, 'eng_1', { sections: SECTIONS, evidenceSnapshotIds: ['snap_1'] });
    expect(repo.updateReportVersion).toHaveBeenCalledWith('rep_2', expect.objectContaining({ status: 'draft' }), tx);
    const bad = { ...SECTIONS, findings: { type: 'doc', schemaVersion: 1, content: [{ type: 'bogus' }] } };
    await expect(service.saveDraft(MILICA, 'eng_1', { sections: bad, evidenceSnapshotIds: [] })).rejects.toMatchObject({ code: 'validation', details: expect.objectContaining({ section: 'findings' }) });
  });

  it('share requires a draft or in-review version', async () => {
    const { service } = make([shared]);
    await expect(service.share(MILICA, 'eng_1', NOW)).rejects.toMatchObject({ code: 'invalid_state' });
  });
});

describe('ImprovementActionsService.update', () => {
  it('refuses proposed -> completed and records who agreed', async () => {
    const action: ActionRow = {
      id: 'act_1',
      orgId: ORG,
      engagementId: 'eng_1',
      reportVersionId: null,
      dimensionKey: 'sustainable_workload',
      title: 'Fix the rota',
      description: 'Two weeks notice',
      ownerUserId: null,
      dueDate: null,
      intendedCheck: 'Next cycle',
      status: 'proposed',
      proposedByUserId: 'user_milica',
      agreedByUserId: null,
      agreedAt: null,
      completedByUserId: null,
      completedAt: null,
      notProceedingReason: null,
      createdAt: NOW,
      updatedAt: NOW,
    };
    const repo = {
      lockAction: vi.fn().mockResolvedValue(action),
      updateAction: vi.fn().mockImplementation(async (_id: string, patch: Partial<ActionRow>) => ({ ...action, ...patch })),
      listActions: vi.fn().mockResolvedValue([action]),
      displayNames: vi.fn().mockResolvedValue(new Map()),
    };
    const engagements = { inOrg: vi.fn().mockResolvedValue(ENGAGEMENT) };
    const service = new ImprovementActionsService(dbs() as never, repo as never, engagements as never, audit() as never);
    await expect(service.update(ORG, 'eng_1', 'act_1', { status: 'completed' }, IVANA, NOW)).rejects.toMatchObject({ code: 'invalid_state' });
    await service.update(ORG, 'eng_1', 'act_1', { status: 'agreed' }, IVANA, NOW);
    expect(repo.updateAction).toHaveBeenCalledWith('act_1', expect.objectContaining({ status: 'agreed', agreedByUserId: 'user_ivana' }), tx);
  });
});

describe('queue response targets', () => {
  it('skips weekends and flags only unread requests as overdue', () => {
    // Friday 30 Oct 2026 + 2 working days = Tuesday 3 Nov 2026.
    expect(workingDaysAfter(new Date('2026-10-30T10:00:00.000Z'), 2).toISOString()).toBe('2026-11-03T10:00:00.000Z');
    const item = toQueueItem({ ...REQUEST, status: 'submitted' }, new Map(), 'Example d.o.o.', new Date('2026-11-04T10:00:00.000Z'));
    expect(item.overdue).toBe(true);
    expect(toQueueItem({ ...REQUEST, status: 'in_review' }, new Map(), 'Example d.o.o.', new Date('2026-11-04T10:00:00.000Z')).overdue).toBe(false);
    expect(item.requesterFirstName).toBeNull();
    expect(JSON.stringify(item)).not.toContain('user_ivana');
  });
});
