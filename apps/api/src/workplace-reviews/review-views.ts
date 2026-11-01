/**
 * The allowlist mappers of the workplace reviews module: the only way a row
 * leaves the service. People appear by first name and function; the
 * employer-facing views carry no reviewer account id, and no view carries a
 * note body or a score.
 */
import {
  REVIEW_TRIAGE_TARGET_WORKING_DAYS,
  type ImprovementActionView,
  type ListeningDimensionKey,
  type ReviewAppointmentView,
  type ReviewEngagementResponse,
  type ReviewQueueItem,
  type ReviewReportSections,
  type ReviewReportView,
  type ReviewRequestOpsResponse,
  type ReviewRequestResponse,
  type ReviewScopeView,
  type ReviewServiceView,
  type ReviewSharingGrantView,
} from '@nestself/contracts';
import { firstNameOf } from '../appointments/appointment-mapper.js';
import type { AppointmentRecord } from '../appointments/appointments.repository.js';
import type { ActionRow, EngagementRow, ReportVersionRow, RequestRow, ScopeRow, ServiceRow, SharingGrantRow } from './workplace-reviews.repository.js';

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

export type Names = ReadonlyMap<string, string>;
const first = (names: Names, userId: string | null | undefined): string | null => (userId ? firstNameOf(names.get(userId)) : null);

/** `days` working days after `from` (weekends skipped), same time of day. */
export function workingDaysAfter(from: Date, days: number): Date {
  const result = new Date(from);
  let remaining = days;
  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + 1);
    const day = result.getUTCDay();
    if (day !== 0 && day !== 6) remaining -= 1;
  }
  return result;
}

export function toServiceView(row: ServiceRow): ReviewServiceView {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    durationMinutes: row.durationMinutes,
    priceMinor: row.priceMinor,
    currency: row.currency,
    introductory: row.introductory,
    termsVersion: row.termsVersion,
    termsText: row.termsText,
    pricing: row.priceMinor === null ? 'quote' : row.priceMinor === 0 ? 'free' : 'fixed',
  };
}

export function toScopeView(row: ScopeRow): ReviewScopeView {
  return {
    id: row.id,
    version: row.version,
    status: row.status,
    serviceId: row.serviceId,
    title: row.title,
    deliverables: row.deliverables,
    participants: row.participants,
    priceMinor: row.priceMinor,
    currency: row.currency,
    taxNote: row.taxNote,
    termsVersion: row.termsVersion,
    validUntil: row.validUntil.toISOString(),
    cancellationPolicy: row.cancellationPolicy,
    sentAt: iso(row.sentAt),
    acceptedAt: iso(row.acceptedAt),
  };
}

export function toRequestResponse(row: RequestRow, scopes: readonly ScopeRow[], names: Names): ReviewRequestResponse {
  return {
    id: row.id,
    status: row.status,
    scopeCohortKey: row.scopeCohortKey,
    dimensionKeys: row.dimensionKeys as ListeningDimensionKey[],
    snapshotIds: [...row.snapshotIds],
    serviceId: row.serviceId,
    shareAggregates: row.shareAggregates,
    context: row.context,
    termsVersion: row.termsVersion,
    noticeVersion: row.noticeVersion,
    createdAt: row.createdAt.toISOString(),
    coordinatorFirstName: first(names, row.coordinatorUserId),
    declineReason: row.declineReason,
    informationRequest: row.informationRequest,
    informationAnswer: row.informationAnswer,
    scopes: scopes.map(toScopeView),
    engagementId: row.engagementId,
  };
}

export function toRequestOps(row: RequestRow, scopes: readonly ScopeRow[], names: Names, organizationName: string): ReviewRequestOpsResponse {
  return {
    ...toRequestResponse(row, scopes, names),
    orgId: row.orgId,
    organizationName,
    requesterFirstName: first(names, row.requesterUserId),
    coordinatorUserId: row.coordinatorUserId,
  };
}

export function toQueueItem(row: RequestRow, names: Names, organizationName: string, now: Date): ReviewQueueItem {
  const dueAt = workingDaysAfter(row.createdAt, REVIEW_TRIAGE_TARGET_WORKING_DAYS);
  return {
    id: row.id,
    orgId: row.orgId,
    organizationName,
    status: row.status,
    scopeCohortKey: row.scopeCohortKey,
    dimensionKeys: row.dimensionKeys as ListeningDimensionKey[],
    snapshotCount: row.snapshotIds.length,
    shareAggregates: row.shareAggregates,
    requesterFirstName: first(names, row.requesterUserId),
    coordinatorFirstName: first(names, row.coordinatorUserId),
    coordinatorUserId: row.coordinatorUserId,
    createdAt: row.createdAt.toISOString(),
    dueAt: dueAt.toISOString(),
    overdue: row.status === 'submitted' && dueAt.getTime() < now.getTime(),
    engagementId: row.engagementId,
  };
}

export function toAppointmentView(row: AppointmentRecord): ReviewAppointmentView {
  return { id: row.id, startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString(), timeZone: row.timeZone, status: row.status };
}

export function grantActive(row: SharingGrantRow, now: Date): boolean {
  return row.revokedAt === null && (row.validUntil === null || row.validUntil.getTime() > now.getTime());
}

export function toSharingGrantView(row: SharingGrantRow, now: Date): ReviewSharingGrantView {
  return {
    id: row.id,
    snapshotIds: [...row.snapshotIds],
    cohortKeys: [...row.cohortKeys],
    validUntil: iso(row.validUntil),
    revokedAt: iso(row.revokedAt),
    createdAt: row.createdAt.toISOString(),
    active: grantActive(row, now),
  };
}

export function toReportView(row: ReportVersionRow, names: Names): ReviewReportView {
  return {
    id: row.id,
    version: row.version,
    status: row.status,
    sections: row.sections as ReviewReportSections,
    evidenceSnapshotIds: [...row.evidenceSnapshotIds],
    authorFirstName: first(names, row.authorUserId),
    sharedAt: iso(row.sharedAt),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toActionView(row: ActionRow, names: Names, reviewerUserId: string | null): ImprovementActionView {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    ownerUserId: row.ownerUserId,
    ownerFirstName: first(names, row.ownerUserId),
    dueDate: iso(row.dueDate),
    intendedCheck: row.intendedCheck,
    dimensionKey: (row.dimensionKey as ListeningDimensionKey | null) ?? null,
    reportVersionId: row.reportVersionId,
    proposedBy: reviewerUserId !== null && row.proposedByUserId === reviewerUserId ? 'reviewer' : 'employer',
    agreedAt: iso(row.agreedAt),
    completedAt: iso(row.completedAt),
    notProceedingReason: row.notProceedingReason,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface EngagementParts {
  engagement: EngagementRow;
  request: RequestRow;
  scope: ScopeRow;
  appointment: AppointmentRecord | null;
  grants: readonly SharingGrantRow[];
  sharedReport: ReportVersionRow | null;
  actions: readonly ActionRow[];
  names: Names;
  now: Date;
}

export function toEngagementResponse(parts: EngagementParts): ReviewEngagementResponse {
  const { engagement, request, scope, appointment, grants, sharedReport, actions, names, now } = parts;
  return {
    id: engagement.id,
    orgId: engagement.orgId,
    requestId: engagement.requestId,
    status: engagement.status,
    scope: toScopeView(scope),
    scopeCohortKey: request.scopeCohortKey,
    dimensionKeys: request.dimensionKeys as ListeningDimensionKey[],
    reviewerFirstName: first(names, engagement.reviewerUserId),
    coordinatorFirstName: first(names, engagement.coordinatorUserId),
    appointment: appointment ? toAppointmentView(appointment) : null,
    proposedWindows: engagement.proposedWindows ? engagement.proposedWindows.map((w) => ({ startsAt: w.startsAt, endsAt: w.endsAt })) : null,
    proposedTimeZone: engagement.proposedTimeZone,
    sharingGrants: grants.map((g) => toSharingGrantView(g, now)),
    sharedReport: sharedReport ? toReportView(sharedReport, names) : null,
    actions: actions.map((a) => toActionView(a, names, engagement.reviewerUserId)),
    followUp: engagement.followUpTargetDate
      ? { targetDate: engagement.followUpTargetDate.toISOString(), ownerUserId: engagement.followUpOwnerUserId, ownerFirstName: first(names, engagement.followUpOwnerUserId) }
      : null,
    completedAt: iso(engagement.completedAt),
    canceledAt: iso(engagement.canceledAt),
    cancelReason: engagement.cancelReason,
    createdAt: engagement.createdAt.toISOString(),
  };
}
